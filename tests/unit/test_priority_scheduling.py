import datetime

from app.scheduling_utils import (
    infer_priority_from_messages,
    normalize_priority,
    priority_label,
    sort_tasks_for_scheduling,
    get_sequential_schedulable_tasks,
)
from app.state_store import pace_and_schedule_goals, state_store


def test_normalize_priority():
    assert normalize_priority(0) == 0
    assert normalize_priority(1) == 1
    assert normalize_priority(2) == 2
    assert normalize_priority(5) == 2
    assert normalize_priority(-1) == 0
    assert normalize_priority(None) == 1


def test_infer_priority_from_messages_defaults_to_medium():
    messages = [
        {"role": "user", "text": "I want to learn Python"},
        {"role": "model", "text": "Great!"},
        {"role": "user", "text": "I am a beginner and prefer hands-on projects."},
    ]
    assert infer_priority_from_messages(messages) == 1


def test_infer_priority_from_messages_high_urgency():
    messages = [
        {"role": "user", "text": "This is urgent and very important for my job interview next month."},
    ]
    assert infer_priority_from_messages(messages) == 2


def test_infer_priority_from_messages_low_urgency():
    messages = [
        {"role": "user", "text": "Low priority background skill, no rush."},
    ]
    assert infer_priority_from_messages(messages) == 0


def test_priority_label():
    assert priority_label(0) == "Low urgency"
    assert priority_label(2) == "High urgency"


def test_pace_and_schedule_goals_prioritizes_higher_priority_projects():
    today = datetime.date.today()

    profile = {
        "hours_per_week": 5,
        "study_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        "goals": [
            {
                "title": "Low Priority Project",
                "status": "in-progress",
                "priority": 0,
                "sub_projects": [{
                    "title": "M1",
                    "completed": False,
                    "tasks": [{
                        "title": "Task L",
                        "estimated_time": "2 hours",
                        "completed": False,
                    }],
                }],
            },
            {
                "title": "High Priority Project",
                "status": "in-progress",
                "priority": 2,
                "sub_projects": [{
                    "title": "M1",
                    "completed": False,
                    "tasks": [{
                        "title": "Task H",
                        "estimated_time": "2 hours",
                        "completed": False,
                    }],
                }],
            },
        ],
    }

    paced = pace_and_schedule_goals(profile)
    goals_by_title = {g["title"]: g for g in paced["goals"]}
    high_task_date = datetime.date.fromisoformat(
        goals_by_title["High Priority Project"]["sub_projects"][0]["tasks"][0]["dueDate"]
    )
    low_task_date = datetime.date.fromisoformat(
        goals_by_title["Low Priority Project"]["sub_projects"][0]["tasks"][0]["dueDate"]
    )
    assert high_task_date <= low_task_date


def test_sort_tasks_for_scheduling_orders_by_due_date_then_priority():
    items = [
        {
            "task": {"dueDate": "2026-07-10"},
            "goal": {"priority": 1},
            "goal_priority": 1,
            "milestone_idx": 0,
            "task_idx": 0,
        },
        {
            "task": {"dueDate": "2026-07-10"},
            "goal": {"priority": 2},
            "goal_priority": 2,
            "milestone_idx": 0,
            "task_idx": 0,
        },
        {
            "task": {"dueDate": "2026-07-08"},
            "goal": {"priority": 0},
            "goal_priority": 0,
            "milestone_idx": 0,
            "task_idx": 0,
        },
    ]
    sorted_items = sort_tasks_for_scheduling(items)
    assert sorted_items[0]["task"]["dueDate"] == "2026-07-08"
    assert sorted_items[1]["goal_priority"] == 2


def test_sequential_schedulable_tasks_only_first_incomplete_per_milestone_chain():
    week_start = datetime.date(2026, 7, 6)
    week_end = datetime.date(2026, 7, 12)
    goals = [{
        "title": "Learn JS",
        "status": "in-progress",
        "priority": 1,
        "sub_projects": [{
            "title": "M1",
            "completed": False,
            "tasks": [
                {
                    "title": "Task 1",
                    "estimated_time": "2 hours",
                    "dueDate": "2026-07-07",
                    "completed": False,
                    "allocated_time_mins": 0,
                },
                {
                    "title": "Task 2",
                    "estimated_time": "2 hours",
                    "dueDate": "2026-07-08",
                    "completed": False,
                    "allocated_time_mins": 0,
                },
            ],
        }],
    }]

    schedulable = get_sequential_schedulable_tasks(
        goals, week_start=week_start, week_end=week_end
    )
    assert len(schedulable) == 1
    assert schedulable[0]["task"]["title"] == "Task 1"


def test_create_goal_sets_default_priority():
    state_store.reset()
    state_store.create_goal({
        "title": "Test Goal",
        "sub_projects": [],
    })
    goals = state_store.get_goals()
    assert goals[0]["priority"] == 1
