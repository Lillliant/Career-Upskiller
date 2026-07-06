import datetime
from unittest.mock import patch, MagicMock
import pytest
import asyncio

from app.state_store import state_store, adjust_past_due_dates
from app.orchestrator import stage_schedule
from app.scheduling_utils import parse_duration, find_task_due_date_for_event
from google.adk.agents.context import Context

def test_adjust_past_due_dates():
    today = datetime.date.today()
    today_str = today.isoformat()
    future_str = (today + datetime.timedelta(days=5)).isoformat()
    past_str = (today - datetime.timedelta(days=5)).isoformat()

    sub_projects = [
        {"title": "Task 1", "dueDate": past_str},
        {"title": "Task 2", "dueDate": future_str},
        {"title": "Task 3", "dueDate": today_str},
    ]

    adjusted = adjust_past_due_dates(sub_projects)
    assert adjusted[0]["dueDate"] == today_str
    assert adjusted[1]["dueDate"] == future_str
    assert adjusted[2]["dueDate"] == today_str


def test_adjust_past_due_dates_nested():
    from app.state_store import adjust_past_due_dates
    today = datetime.date.today()
    today_str = today.isoformat()
    future_str = (today + datetime.timedelta(days=5)).isoformat()
    past_str = (today - datetime.timedelta(days=5)).isoformat()

    sub_projects = [
        {
            "title": "Milestone 1",
            "dueDate": past_str,
            "tasks": [
                {"title": "Subtask 1", "dueDate": past_str},
                {"title": "Subtask 2", "dueDate": future_str}
            ]
        }
    ]

    adjusted = adjust_past_due_dates(sub_projects)
    assert adjusted[0]["dueDate"] == today_str
    assert adjusted[0]["tasks"][0]["dueDate"] == today_str
    assert adjusted[0]["tasks"][1]["dueDate"] == future_str


def test_pace_and_schedule_goals():
    from app.state_store import pace_and_schedule_goals
    today = datetime.date.today()
    
    profile = {
        "hours_per_week": 5,
        "study_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        "goals": [
            {
                "title": "Learn JS",
                "status": "in-progress",
                "sub_projects": [
                    {
                        "title": "Milestone 1",
                        "dueDate": today.isoformat(),
                        "completed": False,
                        "tasks": [
                            {
                                "title": "Variables",
                                "estimated_time": "2 hours",
                                "dueDate": today.isoformat(),
                                "completed": False
                            },
                            {
                                "title": "Conditionals",
                                "estimated_time": "3 hours",
                                "dueDate": today.isoformat(),
                                "completed": False
                            }
                        ]
                    }
                ]
            }
        ]
    }
    
    paced = pace_and_schedule_goals(profile)
    milestone = paced["goals"][0]["sub_projects"][0]
    tasks = milestone["tasks"]
    
    assert tasks[0]["dueDate"] is not None
    assert tasks[1]["dueDate"] is not None
    assert milestone["dueDate"] == tasks[1]["dueDate"]


def test_state_store_auto_adjust():
    # Setup state store with mock profile or reset
    state_store.reset()
    
    today = datetime.date.today()
    past_str = (today - datetime.timedelta(days=5)).isoformat()
    
    goal_data = {
        "title": "Test Goal",
        "sub_projects": [
            {"title": "Past Task", "dueDate": past_str}
        ]
    }
    
    state_store.create_goal(goal_data)
    goals = state_store.get_goals()
    assert len(goals) == 1
    assert goals[0]["sub_projects"][0]["dueDate"] == today.isoformat()


def test_update_goal_preserves_manual_edits():
    state_store.reset()

    future_milestone = (datetime.date.today() + datetime.timedelta(days=30)).isoformat()
    future_task = (datetime.date.today() + datetime.timedelta(days=25)).isoformat()

    state_store.create_goal({
        "title": "Original Goal",
        "description": "Original description",
        "status": "in-progress",
        "sub_projects": [{
            "title": "Milestone 1",
            "description": "M1 desc",
            "dueDate": (datetime.date.today() + datetime.timedelta(days=7)).isoformat(),
            "completed": False,
            "tasks": [{
                "title": "Task 1",
                "description": "T1 desc",
                "estimated_time": "2 hours",
                "dueDate": (datetime.date.today() + datetime.timedelta(days=5)).isoformat(),
                "completed": False,
            }],
        }],
    })

    goal_id = state_store.get_goals()[0]["id"]
    state_store.update_goal(goal_id, {
        "title": "Updated Goal",
        "description": "Updated description",
        "sub_projects": [{
            "title": "Updated Milestone",
            "description": "Updated M1 desc",
            "dueDate": future_milestone,
            "completed": False,
            "tasks": [{
                "title": "Updated Task",
                "description": "Updated T1 desc",
                "estimated_time": "3 hours",
                "dueDate": future_task,
                "completed": False,
            }],
        }],
    })

    updated = state_store.get_goals()[0]
    assert updated["title"] == "Updated Goal"
    assert updated["description"] == "Updated description"
    milestone = updated["sub_projects"][0]
    assert milestone["title"] == "Updated Milestone"
    assert milestone["description"] == "Updated M1 desc"
    assert milestone["dueDate"] == future_milestone
    task = milestone["tasks"][0]
    assert task["title"] == "Updated Task"
    assert task["description"] == "Updated T1 desc"
    assert task["estimated_time"] == "3 hours"
    assert task["dueDate"] == future_task


def test_update_user_profile_skips_goal_reschedule_for_proposals():
    state_store.reset()
    future_task = (datetime.date.today() + datetime.timedelta(days=20)).isoformat()
    state_store.create_goal({
        "title": "Test Project",
        "status": "in-progress",
        "sub_projects": [{
            "title": "M1",
            "dueDate": future_task,
            "completed": False,
            "tasks": [{
                "title": "Task A",
                "estimated_time": "1 hour",
                "dueDate": future_task,
                "completed": False,
            }],
        }],
    })

    state_store.update_user_profile({
        "proposed_events": [{"id": "evt-test", "summary": "Learning: Test"}],
        "transaction_id": "tx-test",
        "token": "token-test",
    })

    saved = state_store.get_goals()[0]
    assert saved["sub_projects"][0]["tasks"][0]["dueDate"] == future_task

@pytest.mark.asyncio
async def test_stage_schedule_future_only():
    # Mock profile and context to run stage_schedule
    mock_profile = {
        "career_goals": "AI Specialist",
        "hours_per_week": 5,
        "study_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        "goals": [{"title": "AI Engineering"}],
        "target_calendars": []
    }
    
    class MockSession:
        id = "test_session_123"
        
    mock_ctx = MagicMock(spec=Context)
    mock_ctx.resume_inputs = {}
    mock_ctx.session = MockSession()
    mock_ctx.state = {}
    
    with patch("app.state_store.state_store.get_user_profile", return_value=mock_profile), \
         patch("app.orchestrator.get_calendar_free_busy", return_value=[]):
        
        # Collect yielded events/requests from stage_schedule generator
        yielded = []
        async for item in stage_schedule._func(mock_ctx, None):
            yielded.append(item)
            
        # The first yielded item should be the RequestInput with the staged events
        assert len(yielded) > 0
        from google.adk.events.request_input import RequestInput
        assert isinstance(yielded[0], RequestInput)
        
        import json
        payload = json.loads(yielded[0].message)
        proposed_events = payload["data"]["proposed_events"]
        
        # Check that all proposed events have a start time in the future
        tz_local = datetime.timezone(datetime.timedelta(hours=-4))
        now_local = datetime.datetime.now(tz_local)
        
        for event in proposed_events:
            start_dt = datetime.datetime.fromisoformat(event["start"])
            assert start_dt >= now_local


def test_parse_duration():
    from app.scheduling_utils import parse_duration
    assert parse_duration("2 hours") == 120
    assert parse_duration("1.5 hours") == 90
    assert parse_duration("30 minutes") == 30
    assert parse_duration(None) == 60
    assert parse_duration("garbage") == 60


def test_find_task_due_date_for_event():
    from app.scheduling_utils import find_task_due_date_for_event
    goals = [
        {
            "title": "Python Loop",
            "sub_projects": [
                {
                    "title": "Milestone 1",
                    "dueDate": "2026-07-07",
                    "tasks": [
                        {"title": "Task 1.1", "dueDate": "2026-07-07"}
                    ]
                }
            ]
        }
    ]
    event_with_task = {"summary": "Learning: Python Loop - Task 1.1"}
    event_without_task = {"summary": "Learning: Python Loop"}
    
    assert find_task_due_date_for_event(event_with_task, goals) == "2026-07-07"
    assert find_task_due_date_for_event(event_without_task, goals) == "2026-07-07"


@pytest.mark.asyncio
async def test_stage_schedule_displacement_logic():
    # Test that a less urgent scheduled event is displaced/rescheduled when calendar is dense
    from app.orchestrator import stage_schedule
    
    # Target date: 2026-07-06 (Monday)
    base_date = datetime.date(2026, 7, 6)
    
    mock_profile = {
        "hours_per_week": 2.0, # 120 mins budget
        "study_days": ["Monday"],
        "preferred_start_time": "09:00",
        "preferred_end_time": "10:00", # exactly 60 minutes free slot window
        "goals": [
            {
                "id": "goal-1",
                "title": "Urgent Project",
                "status": "in-progress",
                "sub_projects": [
                    {
                        "title": "Milestone 1",
                        "tasks": [
                            # Due on Tuesday (urgent)
                            {"title": "Task A", "dueDate": "2026-07-07", "estimated_time": "1 hour", "completed": False}
                        ]
                    }
                ]
            },
            {
                "id": "goal-2",
                "title": "Future Project",
                "status": "in-progress",
                "sub_projects": [
                    {
                        "title": "Milestone 2",
                        "tasks": [
                            # Due next week (less urgent)
                            {"title": "Task B", "dueDate": "2026-07-15", "estimated_time": "1 hour", "completed": False}
                        ]
                    }
                ]
            }
        ],
        # Already scheduled event on Monday for the less urgent Task B (1 hour event)
        "scheduled_events": [
            {
                "id": "evt-b",
                "summary": "Learning: Future Project - Task B",
                "start": "2026-07-06T09:00:00-04:00",
                "end": "2026-07-06T10:00:00-04:00",
                "google_event_id": "google-evt-b"
            }
        ],
        "target_calendars": [{"id": "cal-1", "selected": True, "type": "google", "role": "write"}]
    }
    
    class MockSession:
        id = "session_1"
        
    mock_ctx = MagicMock(spec=Context)
    mock_ctx.resume_inputs = {}
    mock_ctx.session = MockSession()
    mock_ctx.state = {}
    
    # We mock get_calendar_free_busy to return the already scheduled event as busy
    mock_busy = [
        {
            "id": "google-evt-b",
            "summary": "Learning: Future Project - Task B",
            "start": "2026-07-06T09:00:00-04:00",
            "end": "2026-07-06T10:00:00-04:00"
        }
    ]
    
    import datetime as dt_module

    class MockDate(dt_module.date):
        @classmethod
        def today(cls):
            return dt_module.date(2026, 7, 6)
            
    class MockDatetimeClass(dt_module.datetime):
        @classmethod
        def now(cls, tz=None):
            tz_local = dt_module.timezone(dt_module.timedelta(hours=-4))
            return dt_module.datetime(2026, 7, 6, 8, 0, 0, tzinfo=tz_local)
            
    class MockDatetime:
        date = MockDate
        time = dt_module.time
        datetime = MockDatetimeClass
        timedelta = dt_module.timedelta
        timezone = dt_module.timezone
    
    with patch("app.state_store.state_store.get_user_profile", return_value=mock_profile), \
         patch("app.state_store.state_store.update_user_profile") as mock_update, \
         patch("app.orchestrator.get_calendar_free_busy", return_value=mock_busy), \
         patch("app.orchestrator.datetime", MockDatetime):
        
        yielded = []
        async for item in stage_schedule._func(mock_ctx, None):
            yielded.append(item)
            
        assert len(yielded) > 0
        import json
        payload = json.loads(yielded[0].message)
        data = payload["data"]
        
        # Verify Task A (urgent) was scheduled on Monday instead of Task B
        proposed_events = data["proposed_events"]
        assert len(proposed_events) > 0
        assert proposed_events[0]["summary"] == "Learning: Urgent Project - Task A"
        
        # Verify that Task B's event is in events_to_delete
        events_to_delete = data["events_to_delete"]
        assert len(events_to_delete) == 1
        assert events_to_delete[0]["id"] == "evt-b"
