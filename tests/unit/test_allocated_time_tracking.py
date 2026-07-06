import datetime
import pytest
from app.state_store import update_tasks_allocated_time, pace_and_schedule_goals
from app.scheduling_utils import parse_duration

def test_update_tasks_allocated_time():
    profile = {
        "scheduled_events": [
            {
                "summary": "Learning: Learn JS - Variables",
                "start": "2026-07-06T15:00:00-04:00",
                "end": "2026-07-06T16:00:00-04:00"
            },
            {
                "summary": "Learning: Learn JS - Variables",
                "start": "2026-07-07T10:00:00-04:00",
                "end": "2026-07-07T11:00:00-04:00"
            },
            {
                "summary": "Learning: Learn JS - Conditionals",
                "start": "2026-07-08T09:00:00-04:00",
                "end": "2026-07-08T09:30:00-04:00"
            }
        ],
        "goals": [
            {
                "title": "Learn JS",
                "sub_projects": [
                    {
                        "title": "Milestone 1",
                        "tasks": [
                            {
                                "title": "Variables",
                                "estimated_time": "2 hours",
                                "completed": False
                            },
                            {
                                "title": "Conditionals",
                                "estimated_time": "30 minutes",
                                "completed": False
                            }
                        ]
                    }
                ]
            }
        ]
    }
    
    update_tasks_allocated_time(profile)
    
    tasks = profile["goals"][0]["sub_projects"][0]["tasks"]
    # 2 events of 1 hour (60 mins) each -> 120 mins
    assert tasks[0]["allocated_time_mins"] == 120
    # 1 event of 30 mins -> 30 mins
    assert tasks[1]["allocated_time_mins"] == 30


def test_pace_and_schedule_goals_respects_allocated():
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
                                "allocated_time_mins": 120, # Fully scheduled
                                "dueDate": today.isoformat(),
                                "completed": False
                            },
                            {
                                "title": "Conditionals",
                                "estimated_time": "2 hours",
                                "allocated_time_mins": 60, # 1 hour remaining
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
    
    # Variables task was already fully scheduled, so remaining time is 0.
    # It should not have advanced the study days/been scheduled further.
    assert tasks[0]["dueDate"] == today.isoformat()
