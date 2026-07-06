import unittest
from unittest.mock import patch

from app.schedule_approval import approve_schedule_proposal, reject_schedule_proposal
from app.scheduling_utils import generate_signature


class TestScheduleApproval(unittest.TestCase):
  def setUp(self):
    self.tx_id = "tx-test1234"
    self.token = generate_signature(self.tx_id)
    self.proposal = {
      "transaction_id": self.tx_id,
      "token": self.token,
      "proposed_events": [
        {
          "id": "evt-abc",
          "summary": "Learning: AI - Task 1",
          "start": "2026-07-07T09:00:00-04:00",
          "end": "2026-07-07T10:00:00-04:00",
          "description": "Test block",
        }
      ],
      "events_to_delete": [],
      "scarcity_flag": False,
      "reason": "ok",
      "scheduled_events": [],
    }

  @patch("app.schedule_approval.state_store")
  @patch("app.schedule_approval.write_calendar_event")
  def test_approve_applies_client_edits(self, mock_write, mock_store):
    mock_store.get_user_profile.return_value = self.proposal.copy()
    mock_write.return_value = {
      "status": "success",
      "event": {"id": "google-evt-1"},
    }

    payload = {
      "transaction_id": self.tx_id,
      "token": self.token,
      "action": "approve",
      "proposed_events": [
        {
          "id": "evt-abc",
          "start": "2026-07-07T11:00:00-04:00",
          "end": "2026-07-07T12:00:00-04:00",
        }
      ],
    }

    result = approve_schedule_proposal(payload)

    self.assertEqual(result["status"], "success")
    mock_write.assert_called_once()
    _, kwargs = mock_write.call_args
    self.assertEqual(kwargs["start_time"], "2026-07-07T11:00:00-04:00")
    self.assertEqual(kwargs["end_time"], "2026-07-07T12:00:00-04:00")

    updated_profile = mock_store.update_user_profile.call_args[0][0]
    self.assertEqual(updated_profile["proposed_events"], [])
    self.assertEqual(updated_profile["transaction_id"], None)
    self.assertEqual(len(updated_profile["scheduled_events"]), 1)

  @patch("app.schedule_approval.state_store")
  @patch("app.schedule_approval.write_calendar_event")
  def test_approve_respects_deleted_events(self, mock_write, mock_store):
    profile = self.proposal.copy()
    profile["proposed_events"] = [
      {
        "id": "evt-abc",
        "summary": "Learning: AI - Task 1",
        "start": "2026-07-07T09:00:00-04:00",
        "end": "2026-07-07T10:00:00-04:00",
        "description": "Keep",
      },
      {
        "id": "evt-def",
        "summary": "Learning: AI - Task 2",
        "start": "2026-07-07T13:00:00-04:00",
        "end": "2026-07-07T14:00:00-04:00",
        "description": "Delete me",
      },
    ]
    mock_store.get_user_profile.return_value = profile
    mock_write.return_value = {
      "status": "success",
      "event": {"id": "google-evt-1"},
    }

    payload = {
      "transaction_id": self.tx_id,
      "token": self.token,
      "action": "approve",
      "proposed_events": [
        {
          "id": "evt-abc",
          "summary": "Learning: AI - Task 1",
          "start": "2026-07-07T10:00:00-04:00",
          "end": "2026-07-07T11:00:00-04:00",
          "description": "Keep",
        }
      ],
    }

    result = approve_schedule_proposal(payload)

    self.assertEqual(result["status"], "success")
    self.assertEqual(mock_write.call_count, 1)
    _, kwargs = mock_write.call_args
    self.assertEqual(kwargs["start_time"], "2026-07-07T10:00:00-04:00")
    self.assertEqual(kwargs["summary"], "Learning: AI - Task 1")

  @patch("app.schedule_approval.state_store")
  def test_approve_rejects_invalid_token(self, mock_store):
    mock_store.get_user_profile.return_value = self.proposal.copy()

    result = approve_schedule_proposal(
      {
        "transaction_id": self.tx_id,
        "token": "bad-token",
        "action": "approve",
      }
    )

    self.assertEqual(result["status"], "error")
    mock_store.update_user_profile.assert_not_called()

  @patch("app.schedule_approval.state_store")
  def test_reject_clears_staged_proposal(self, mock_store):
    mock_store.get_user_profile.return_value = self.proposal.copy()

    result = reject_schedule_proposal(
      {
        "transaction_id": self.tx_id,
        "token": self.token,
        "action": "reject",
      }
    )

    self.assertEqual(result["status"], "success")
    updated_profile = mock_store.update_user_profile.call_args[0][0]
    self.assertEqual(updated_profile["proposed_events"], [])
    self.assertEqual(updated_profile["transaction_id"], None)


if __name__ == "__main__":
  unittest.main()
