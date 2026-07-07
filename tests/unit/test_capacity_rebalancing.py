import datetime
import importlib.util
import sys
import types

import pytest


def _bootstrap_modules():
    if "scheduling_utils_test" in sys.modules:
        return sys.modules["scheduling_utils_test"], sys.modules["state_store_test"]

    su_spec = importlib.util.spec_from_file_location(
        "scheduling_utils_test", "app/scheduling_utils.py"
    )
    su = importlib.util.module_from_spec(su_spec)
    su_spec.loader.exec_module(su)

    app_pkg = types.ModuleType("app")
    app_pkg.__path__ = ["app"]
    sys.modules["app"] = app_pkg
    sys.modules["app.scheduling_utils"] = su

    ss_spec = importlib.util.spec_from_file_location(
        "state_store_test", "app/state_store.py"
    )
    ss = importlib.util.module_from_spec(ss_spec)
    ss_spec.loader.exec_module(ss)

    sys.modules["scheduling_utils_test"] = su
    sys.modules["state_store_test"] = ss
    return su, ss


su, ss = _bootstrap_modules()


def _sample_profile():
    return {
        "hours_per_week": 5,
        "study_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        "goals": [
            {
                "id": "goal-low",
                "title": "Low Priority Project",
                "status": "in-progress",
                "priority": 0,
                "sub_projects": [{
                    "title": "M1",
                    "completed": False,
                    "tasks": [{
                        "title": "Task L",
                        "estimated_time": "5 hours",
                        "completed": False,
                    }],
                }],
            },
            {
                "id": "goal-high",
                "title": "High Priority Project",
                "status": "in-progress",
                "priority": 2,
                "sub_projects": [{
                    "title": "M1",
                    "completed": False,
                    "tasks": [{
                        "title": "Task H",
                        "estimated_time": "5 hours",
                        "completed": False,
                    }],
                }],
            },
        ],
    }


def test_on_hold_goals_excluded_from_capacity():
    profile = _sample_profile()
    profile["goals"][0]["status"] = "on-hold"
    capacity = su.compute_schedule_capacity(profile)
    assert capacity["near_term_hours"] == 5.0
    assert capacity["on_hold_hours"] == 5.0


def test_two_phase_pacing_defers_low_priority_after_high():
    paced = ss.pace_and_schedule_goals(_sample_profile())
    goals = {g["id"]: g for g in paced["goals"]}
    high_due = datetime.date.fromisoformat(
        goals["goal-high"]["sub_projects"][0]["tasks"][0]["dueDate"]
    )
    low_due = datetime.date.fromisoformat(
        goals["goal-low"]["sub_projects"][0]["tasks"][0]["dueDate"]
    )
    assert high_due < low_due


def test_pause_lower_priority_goals():
    profile = _sample_profile()
    profile["goals"][0]["sub_projects"][0]["tasks"][0]["dueDate"] = "2099-06-01"
    paused = ss.pause_lower_priority_goals(profile)
    assert len(paused) == 1
    assert paused[0]["goal_id"] == "goal-low"
    assert profile["goals"][0]["status"] == "on-hold"
    assert profile["goals"][0]["pre_pause_due_dates"]["t:0:0"] == "2099-06-01"


def test_resume_goals_from_hold():
    profile = _sample_profile()
    profile["hours_per_week"] = 5
    profile["goals"][0]["status"] = "on-hold"
    profile["goals"][0]["on_hold_reason"] = "Paused to focus on higher-priority projects"
    profile["goals"][0]["pre_pause_due_dates"] = {
        "t:0:0": "2099-06-01",
    }
    profile["goals"][0]["sub_projects"][0]["tasks"][0]["dueDate"] = "2099-12-01"
    resumed, resumed_ids = ss.resume_goals_from_hold(profile, goal_ids=["goal-low"])
    assert len(resumed) == 1
    assert resumed_ids == {"goal-low"}
    assert profile["goals"][0]["status"] == "to-do"
    assert profile["goals"][0]["sub_projects"][0]["tasks"][0]["dueDate"] == "2099-06-01"
    assert "on_hold_reason" not in profile["goals"][0]
    assert "pre_pause_due_dates" not in profile["goals"][0]
    assert profile["hours_per_week"] == 5


def test_rebalance_preview_returns_changes():
    preview = ss.build_schedule_rebalance_preview(_sample_profile())
    assert "changes" in preview
    assert "capacity" in preview
    assert preview["goals"]


def test_near_term_warning_excludes_deferred_low_priority_hours():
    profile = _sample_profile()
    paced = ss.pace_and_schedule_goals(profile)
    capacity = paced["schedule_capacity"]
    assert capacity["near_term_hours"] == 5.0
    assert capacity["low_priority_hours"] == 5.0
    assert capacity.get("warning_type") != "horizon_overload"


def test_near_term_warning_when_high_priority_alone_exceeds_horizon():
    due_soon = (datetime.date.today() + datetime.timedelta(days=14)).isoformat()
    profile = {
        "hours_per_week": 5,
        "study_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        "goals": [{
            "id": "goal-big",
            "title": "Big Project",
            "status": "in-progress",
            "priority": 2,
            "sub_projects": [{
                "title": "M1",
                "completed": False,
                "tasks": [{
                    "title": "Task",
                    "estimated_time": "50 hours",
                    "completed": False,
                    "dueDate": due_soon,
                }],
            }],
        }],
    }
    capacity = su.compute_schedule_capacity(profile)
    assert capacity["warning_type"] == "horizon_overload"
    assert capacity["suggested_hours_per_week"] >= 6.2


def test_hours_due_within_horizon_excludes_far_future_tasks():
    profile = _sample_profile()
    far_future = (datetime.date.today() + datetime.timedelta(weeks=20)).isoformat()
    profile["goals"][0]["sub_projects"][0]["tasks"][0]["dueDate"] = far_future
    profile["goals"][1]["sub_projects"][0]["tasks"][0]["dueDate"] = far_future
    horizon_hours = su.hours_due_within_horizon(profile["goals"])
    assert horizon_hours == 0.0


def test_refresh_goals_if_past_due():
    profile = _sample_profile()
    past = (datetime.date.today() - datetime.timedelta(days=7)).isoformat()
    profile["goals"][1]["sub_projects"][0]["tasks"][0]["dueDate"] = past
    refreshed, changed = ss.refresh_goals_if_past_due(profile)
    assert changed is True
    new_due = refreshed["goals"][1]["sub_projects"][0]["tasks"][0]["dueDate"]
    assert new_due >= datetime.date.today().isoformat()


def test_get_sunday_week_start_respects_offset():
    today = datetime.date.today()
    current = su.get_sunday_week_start(today, week_offset=0)
    future = su.get_sunday_week_start(today, week_offset=2)
    assert future == current + datetime.timedelta(weeks=2)


def test_portfolio_warning_shown_on_low_priority_goals():
    profile = _sample_profile()
    for goal in profile["goals"]:
        for task in goal["sub_projects"][0]["tasks"]:
            task["estimated_time"] = "30 hours"
    paced = ss.pace_and_schedule_goals(profile)
    low_goal = next(g for g in paced["goals"] if g["id"] == "goal-low")
    info = low_goal.get("scheduling_info", "")
    assert "full portfolio needs about" in info
    assert "scheduling_warning" not in low_goal
    assert "low-priority work will start after" not in info


def test_rebalance_clears_horizon_overload_warning():
    due_soon = (datetime.date.today() + datetime.timedelta(days=14)).isoformat()
    profile = {
        "hours_per_week": 5,
        "study_days": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
        "goals": [{
            "id": "goal-big",
            "title": "Big Project",
            "status": "in-progress",
            "priority": 2,
            "sub_projects": [{
                "title": "M1",
                "completed": False,
                "tasks": [{
                    "title": "Task",
                    "estimated_time": "50 hours",
                    "completed": False,
                    "dueDate": due_soon,
                }],
            }],
        }],
    }
    assert su.compute_schedule_capacity(profile)["warning_type"] == "horizon_overload"
    updated = ss.apply_schedule_rebalance(profile)
    goal = updated["goals"][0]
    assert "scheduling_warning" not in goal
    assert updated["schedule_capacity"]["warning_type"] != "horizon_overload"


def test_update_goal_preserves_manual_due_dates(tmp_path):
    store = ss.LocalJsonStateStore(data_dir=str(tmp_path))
    store.create_goal({
        "title": "Test",
        "status": "in-progress",
        "priority": 1,
        "sub_projects": [{
            "title": "M1",
            "completed": False,
            "tasks": [{
                "title": "T1",
                "estimated_time": "2 hours",
                "completed": False,
                "dueDate": "2099-01-01",
            }],
        }],
    })
    goals = store.get_goals()
    goal_id = goals[0]["id"]

    manual_due = "2099-06-01"
    goals[0]["sub_projects"][0]["tasks"][0]["dueDate"] = manual_due
    goals[0]["sub_projects"][0]["tasks"][0]["title"] = "Updated Task"
    store.update_goal(goal_id, {"sub_projects": goals[0]["sub_projects"]})
    updated = store.get_goals()[0]
    assert updated["sub_projects"][0]["tasks"][0]["dueDate"] == manual_due
    assert updated["sub_projects"][0]["tasks"][0]["title"] == "Updated Task"
