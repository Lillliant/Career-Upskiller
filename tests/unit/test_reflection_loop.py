import copy
import datetime
from unittest.mock import patch

import pytest

from app.skills import reflection_loop


@pytest.fixture
def sample_goal():
    today = datetime.date.today()
    return {
        "id": "goal-test",
        "title": "Test Goal",
        "sub_projects": [
            {
                "title": "Milestone A",
                "description": "First milestone",
                "dueDate": today.isoformat(),
                "completed": False,
                "tasks": [
                    {
                        "title": "Task 1",
                        "description": "Do thing",
                        "dueDate": today.isoformat(),
                        "estimated_time": "2 hours",
                        "resource": "Docs",
                        "completed": False,
                    }
                ],
            }
        ],
    }


@pytest.fixture
def mock_profile(sample_goal):
    return {"goals": [copy.deepcopy(sample_goal)]}


def test_struggle_adds_milestone_and_shifts_dates(mock_profile, sample_goal):
    with patch.object(reflection_loop.state_store, "get_user_profile", return_value=mock_profile), patch.object(
        reflection_loop.state_store, "update_user_profile"
    ) as update_mock, patch.object(reflection_loop.state_store, "add_work_log_entry"), patch.object(
        reflection_loop, "_analyze_reflection_with_llm", return_value=None
    ):
        result = reflection_loop.process_user_reflection(
            user_id="u1",
            learning_block_id="generic",
            reflection_text="This MCP transport setup is too hard for me.",
            goal_id="goal-test",
        )

    assert result["adjustment_action"] == "add_content"
    updated_goal = update_mock.call_args[0][0]["goals"][0]
    assert len(updated_goal["sub_projects"]) == 2
    assert "MCP" in updated_goal["sub_projects"][-1]["title"] or "Model Context" in updated_goal["sub_projects"][-1]["title"]


def test_reschedule_shifts_incomplete_due_dates(mock_profile):
    with patch.object(reflection_loop.state_store, "get_user_profile", return_value=mock_profile), patch.object(
        reflection_loop.state_store, "update_user_profile"
    ) as update_mock, patch.object(reflection_loop.state_store, "add_work_log_entry"), patch.object(
        reflection_loop, "_analyze_reflection_with_llm", return_value=None
    ):
        reflection_loop.process_user_reflection(
            user_id="u1",
            learning_block_id="generic",
            reflection_text="Can you reschedule my incomplete tasks to later dates?",
            goal_id="goal-test",
        )

    updated_goal = update_mock.call_args[0][0]["goals"][0]
    original_due = datetime.date.today().isoformat()
    shifted_due = updated_goal["sub_projects"][0]["dueDate"]
    assert shifted_due != original_due


def test_delete_requires_confirmation(mock_profile):
    with patch.object(reflection_loop.state_store, "get_user_profile", return_value=mock_profile), patch.object(
        reflection_loop.state_store, "update_user_profile"
    ) as update_mock, patch.object(reflection_loop.state_store, "add_work_log_entry"), patch.object(
        reflection_loop, "_analyze_reflection_with_llm", return_value=None
    ):
        result = reflection_loop.process_user_reflection(
            user_id="u1",
            learning_block_id="generic",
            reflection_text="Please delete milestone A",
            goal_id="goal-test",
        )

    assert result["adjustment_action"] == "pending_deletion"
    assert result["pending_deletion"] is not None
    updated_goal = update_mock.call_args[0][0]["goals"][0]
    assert len(updated_goal["sub_projects"]) == 1


def test_delete_confirmed_removes_milestone(mock_profile):
    plan = {
        "action": "request_deletion",
        "feedback": "Deleting milestone.",
        "new_milestones": [],
        "new_tasks": [],
        "date_adjustments": [],
        "resource_recommendations": [],
        "deletion_request": {"type": "milestone", "milestone_index": 0, "task_index": None},
        "day_shift": 0,
    }
    with patch.object(reflection_loop.state_store, "get_user_profile", return_value=mock_profile), patch.object(
        reflection_loop.state_store, "update_user_profile"
    ) as update_mock, patch.object(reflection_loop.state_store, "add_work_log_entry"), patch.object(
        reflection_loop, "_analyze_reflection_with_llm", return_value=plan
    ):
        result = reflection_loop.process_user_reflection(
            user_id="u1",
            learning_block_id="generic",
            reflection_text="confirm delete",
            goal_id="goal-test",
            confirm_deletion=True,
        )

    assert result["adjustment_action"] == "deleted_item"
    updated_goal = update_mock.call_args[0][0]["goals"][0]
    assert len(updated_goal["sub_projects"]) == 0


def test_recommend_resource_adds_suggestion(mock_profile):
    with patch.object(reflection_loop.state_store, "get_user_profile", return_value=mock_profile), patch.object(
        reflection_loop.state_store, "update_user_profile"
    ) as update_mock, patch.object(reflection_loop.state_store, "add_work_log_entry"), patch.object(
        reflection_loop, "_analyze_reflection_with_llm", return_value=None
    ):
        result = reflection_loop.process_user_reflection(
            user_id="u1",
            learning_block_id="generic",
            reflection_text="Can you recommend resources for Kubernetes networking?",
            goal_id="goal-test",
        )

    assert result["adjustment_action"] == "recommend_resource"
    feedback = result["feedback"].lower()
    assert "resource" in feedback or "kubernetes" in feedback
    updated_goal = update_mock.call_args[0][0]["goals"][0]
    assert updated_goal["sub_projects"][0]["tasks"][0]["resource"]


def test_archive_reflection_conversation(mock_profile, sample_goal):
    sample_goal["reflection_messages"] = [
        {"role": "model", "text": "Hi"},
        {"role": "user", "text": "Need help with tasks"},
    ]
    mock_profile["goals"] = [sample_goal]

    with patch.object(reflection_loop.state_store, "get_user_profile", return_value=mock_profile), patch.object(
        reflection_loop.state_store, "update_user_profile"
    ), patch.object(reflection_loop.state_store, "get_goals", return_value=[sample_goal]):
        result = reflection_loop.archive_reflection_conversation("goal-test")

    assert result["status"] == "success"
    assert result["archived"] is not None
    assert sample_goal["reflection_messages"][0]["role"] == "model"


def test_delete_reflection_archived_conversation(mock_profile, sample_goal):
    sample_goal["archived_reflection_conversations"] = [
        {"id": "arch-abc", "title": "Old chat", "messages": [], "archived_at": "2026-07-01T00:00:00Z"},
        {"id": "arch-def", "title": "Another chat", "messages": [], "archived_at": "2026-07-02T00:00:00Z"},
    ]
    mock_profile["goals"] = [sample_goal]

    with patch.object(reflection_loop.state_store, "get_user_profile", return_value=mock_profile), patch.object(
        reflection_loop.state_store, "update_goal"
    ) as update_goal_mock, patch.object(
        reflection_loop.state_store, "get_goals", return_value=[sample_goal]
    ):
        result = reflection_loop.delete_reflection_archived_conversation("goal-test", "arch-abc")

    assert result["status"] == "success"
    update_goal_mock.assert_called_once_with(
        "goal-test",
        {"archived_reflection_conversations": sample_goal["archived_reflection_conversations"][1:]},
    )


def test_delete_builder_archived_conversation(mock_profile):
    mock_profile["builder_archived_conversations"] = [
        {"id": "arch-abc", "title": "Old builder chat", "messages": [], "archived_at": "2026-07-01T00:00:00Z"},
    ]

    with patch.object(reflection_loop.state_store, "get_user_profile", return_value=mock_profile), patch.object(
        reflection_loop.state_store, "update_user_profile"
    ) as update_mock:
        result = reflection_loop.delete_builder_archived_conversation("arch-abc")

    assert result["status"] == "success"
    update_mock.assert_called_once_with({"builder_archived_conversations": []})


def test_reschedule_uses_update_goal_to_preserve_shifted_dates(mock_profile):
    with patch.object(reflection_loop.state_store, "get_user_profile", return_value=mock_profile), patch.object(
        reflection_loop.state_store, "update_goal"
    ) as update_goal_mock, patch.object(
        reflection_loop.state_store, "update_user_profile"
    ), patch.object(reflection_loop.state_store, "add_work_log_entry"), patch.object(
        reflection_loop, "_analyze_reflection_with_llm", return_value=None
    ), patch.object(reflection_loop.state_store, "get_goals", return_value=mock_profile["goals"]):
        reflection_loop.process_user_reflection(
            user_id="u1",
            learning_block_id="generic",
            reflection_text="Push my incomplete tasks back by one week",
            goal_id="goal-test",
        )

    updated_goal = update_goal_mock.call_args[0][1]
    assert "priority" not in updated_goal
    shifted_due = updated_goal["sub_projects"][0]["dueDate"]
    assert shifted_due != datetime.date.today().isoformat()
