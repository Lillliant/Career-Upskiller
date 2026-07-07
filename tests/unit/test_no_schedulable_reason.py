"""Tests for empty-week schedule reason messages."""

import datetime

from app.scheduling_utils import explain_no_schedulable_tasks, get_sequential_schedulable_tasks


def test_no_active_tasks_message():
    reason = explain_no_schedulable_tasks(
        [],
        week_start=datetime.date(2026, 7, 6),
        week_end=datetime.date(2026, 7, 12),
        hours_per_week=5,
    )
    assert "No active tasks found" in reason


def test_weekly_budget_already_allocated_message():
    goals = [
        {
            "title": "High Priority Project",
            "status": "to-do",
            "priority": 2,
            "sub_projects": [
                {
                    "title": "Milestone 1",
                    "completed": False,
                    "tasks": [
                        {
                            "title": "Next task",
                            "estimated_time": "6 hours",
                            "dueDate": "2026-07-13",
                            "completed": False,
                            "allocated_time_mins": 0,
                        }
                    ],
                }
            ],
        }
    ]
    scheduled_events = [
        {
            "summary": "Learning: High Priority Project - Earlier task",
            "start": "2026-07-07T10:00:00-04:00",
            "end": "2026-07-07T12:00:00-04:00",
        },
        {
            "summary": "Learning: High Priority Project - Earlier task",
            "start": "2026-07-08T10:00:00-04:00",
            "end": "2026-07-08T13:00:00-04:00",
        },
    ]
    reason = explain_no_schedulable_tasks(
        goals,
        week_start=datetime.date(2026, 7, 6),
        week_end=datetime.date(2026, 7, 12),
        hours_per_week=5,
        scheduled_events=scheduled_events,
    )
    assert "weekly study budget" in reason
    assert "already allocated" in reason


def test_upcoming_tasks_are_schedulable_outside_selected_week():
    goals = [
        {
            "title": "Future Project",
            "status": "to-do",
            "priority": 2,
            "sub_projects": [
                {
                    "title": "Milestone 1",
                    "completed": False,
                    "tasks": [
                        {
                            "title": "Future task",
                            "estimated_time": "2 hours",
                            "dueDate": "2026-07-20",
                            "completed": False,
                            "allocated_time_mins": 0,
                        }
                    ],
                }
            ],
        }
    ]
    schedulable = get_sequential_schedulable_tasks(
        goals,
        week_start=datetime.date(2026, 7, 6),
        week_end=datetime.date(2026, 7, 12),
    )
    assert len(schedulable) == 1
    assert schedulable[0]["task"]["title"] == "Future task"
