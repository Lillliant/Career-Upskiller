# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
import datetime
import unittest
from unittest.mock import patch, MagicMock

from app.mcp_clients import normalize_to_local_offset
from app.app_utils.ical_parser import parse_ical, parse_ical_date

class TestCalendarIntegrations(unittest.TestCase):
    def test_normalize_to_local_offset(self):
        # 1. UTC Z date string -> shifts 4 hours back
        utc_str = "2026-07-02T13:00:00Z"
        result = normalize_to_local_offset(utc_str)
        self.assertEqual(result, "2026-07-02T09:00:00-04:00")
        
        # 2. Local offset string -> remains unchanged
        local_str = "2026-07-02T10:00:00-04:00"
        result2 = normalize_to_local_offset(local_str)
        self.assertEqual(result2, "2026-07-02T10:00:00-04:00")
        
        # 3. +00:00 offset string -> shifts 4 hours back
        plus_zero_str = "2026-07-02T13:00:00+00:00"
        result3 = normalize_to_local_offset(plus_zero_str)
        self.assertEqual(result3, "2026-07-02T09:00:00-04:00")

    def test_parse_ical_date(self):
        # UTC format
        self.assertEqual(parse_ical_date("20260702T130000Z"), "2026-07-02T09:00:00-04:00")
        # Local format (no timezone)
        self.assertEqual(parse_ical_date("20260702T090000"), "2026-07-02T09:00:00-04:00")
        # Date only format
        self.assertEqual(parse_ical_date("20260702"), "2026-07-02T00:00:00-04:00")

    @patch("requests.get")
    def test_parse_ical_webcal_protocol(self, mock_get):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = "BEGIN:VCALENDAR\nEND:VCALENDAR"
        mock_get.return_value = mock_response
        
        # Verify webcal:// is replaced with https://
        webcal_url = "webcal://example.com/calendar.ics"
        parse_ical(webcal_url)
        mock_get.assert_called_once_with("https://example.com/calendar.ics", timeout=10)

    def test_credentials_validity_with_expiry(self):
        from google.oauth2.credentials import Credentials
        import datetime
        
        # 1. Credential info without expiry defaults to expired in Google Library
        info_no_expiry = {
            "token": "ya29.fake-token",
            "refresh_token": "1//fake-refresh-token",
            "token_uri": "https://oauth2.googleapis.com/token",
            "client_id": "fake-client-id",
            "client_secret": "fake-client-secret",
            "scopes": ["https://www.googleapis.com/auth/calendar"],
        }
        creds_no_expiry = Credentials.from_authorized_user_info(info_no_expiry)
        self.assertFalse(creds_no_expiry.valid)
        self.assertTrue(creds_no_expiry.expired)
        
        # 2. Credential info with future expiry is valid
        future_time = datetime.datetime.utcnow() + datetime.timedelta(seconds=3600)
        info_with_expiry = info_no_expiry.copy()
        info_with_expiry["expiry"] = future_time.isoformat() + "Z"
        
        creds_with_expiry = Credentials.from_authorized_user_info(info_with_expiry)
        self.assertTrue(creds_with_expiry.valid)
        self.assertFalse(creds_with_expiry.expired)

    @patch("app.fast_api_app.datetime.date")
    @patch("app.fast_api_app.state_store")
    @patch("app.fast_api_app.get_calendar_free_busy")
    def test_get_calendar_events_deduplication(self, mock_free_busy, mock_state_store, mock_date):
        from app.fast_api_app import get_calendar_events

        mock_date.today.return_value = datetime.date(2026, 7, 2)
        
        # Mock user profile
        mock_state_store.get_user_profile.return_value = {
            "target_calendars": [{"id": "cal-primary", "type": "google", "selected": True, "role": "write"}],
            "scheduled_events": [
                {
                    "id": "block-1",
                    "google_event_id": "google-evt-1",
                    "summary": "Learning: AI Engineering",
                    "start": "2026-07-02T09:00:00-04:00",
                    "end": "2026-07-02T10:00:00-04:00",
                    "description": "Focused study"
                }
            ]
        }
        mock_state_store.get_work_log.return_value = []
        
        # Mock Google Calendar returning the matching event
        mock_free_busy.return_value = [
            {
                "id": "google-evt-1",
                "summary": "Learning: AI Engineering",
                "start": "2026-07-02T09:00:00-04:00",
                "end": "2026-07-02T10:00:00-04:00"
            },
            {
                "id": "other-evt",
                "summary": "Team Sync Meeting",
                "start": "2026-07-02T11:00:00-04:00",
                "end": "2026-07-02T12:00:00-04:00"
            }
        ]
        
        # Call the endpoint
        events = get_calendar_events(offset=0)
        
        # We expect exactly 2 events in total:
        # 1. "Learning: AI Engineering" styled as "learning"
        # 2. "Team Sync Meeting" styled as "external"
        self.assertEqual(len(events), 2)
        
        learning_evt = next((e for e in events if e.get("type") == "learning"), None)
        self.assertIsNotNone(learning_evt)
        self.assertEqual(learning_evt["id"], "block-1")
        self.assertEqual(learning_evt["color"], "#6366f1")
        
        external_evt = next((e for e in events if e.get("type") == "external"), None)
        self.assertIsNotNone(external_evt)
        self.assertEqual(external_evt["id"], "other-evt")
        self.assertEqual(external_evt["color"], "#475569")

    @patch("app.fast_api_app.datetime.date")
    @patch("app.fast_api_app.state_store")
    @patch("app.fast_api_app.get_calendar_free_busy")
    def test_get_calendar_events_two_pass_matching(self, mock_free_busy, mock_state_store, mock_date):
        from app.fast_api_app import get_calendar_events

        mock_date.today.return_value = datetime.date(2026, 7, 9)
        
        # Profile contains:
        # Thursday block (block-1) and Monday block (block-2)
        mock_state_store.get_user_profile.return_value = {
            "target_calendars": [{"id": "cal-primary", "type": "google", "selected": True, "role": "write"}],
            "scheduled_events": [
                {
                    "id": "block-1",
                    "summary": "Learning: AI Engineering",
                    "start": "2026-07-09T10:00:00-04:00",
                    "end": "2026-07-09T11:00:00-04:00",
                },
                {
                    "id": "block-2",
                    "summary": "Learning: AI Engineering",
                    "start": "2026-07-06T10:00:00-04:00",
                    "end": "2026-07-06T11:00:00-04:00",
                }
            ]
        }
        mock_state_store.get_work_log.return_value = []
        
        # Google Calendar returns:
        # Thursday event A at 09:00 (shifted/fuzzy match for Thursday block)
        # Thursday event B at 10:00 (exact match for Thursday block)
        # Monday event C at 09:00 (shifted/fuzzy match for Monday block)
        # Monday event D at 10:00 (exact match for Monday block)
        mock_free_busy.return_value = [
            {
                "id": "evt-a",
                "summary": "Learning: AI Engineering",
                "start": "2026-07-09T09:00:00-04:00",
                "end": "2026-07-09T10:00:00-04:00"
            },
            {
                "id": "evt-b",
                "summary": "Learning: AI Engineering",
                "start": "2026-07-09T10:00:00-04:00",
                "end": "2026-07-09T11:00:00-04:00"
            },
            {
                "id": "evt-c",
                "summary": "Learning: AI Engineering",
                "start": "2026-07-06T09:00:00-04:00",
                "end": "2026-07-06T10:00:00-04:00"
            },
            {
                "id": "evt-d",
                "summary": "Learning: AI Engineering",
                "start": "2026-07-06T10:00:00-04:00",
                "end": "2026-07-06T11:00:00-04:00"
            }
        ]
        
        events = get_calendar_events(offset=0)
        
        # All 4 events returned from Google Calendar starting with "Learning:" 
        # should be styled as "learning" (indigo).
        # And because they matched, blocks 1 and 2 should be marked found.
        # Thus, no duplicates are appended in Step 3.
        # Total events should be exactly 4.
        self.assertEqual(len(events), 4)
        for e in events:
            self.assertEqual(e["type"], "learning")
            self.assertEqual(e["color"], "#6366f1")
            
        # Verify that Thursday event B is matched to block-1 (exact match)
        evt_b_res = next(e for e in events if e.get("start") == "2026-07-09T10:00:00-04:00")
        self.assertEqual(evt_b_res["id"], "block-1")
        
        # Verify that Monday event D is matched to block-2 (exact match)
        evt_d_res = next(e for e in events if e.get("start") == "2026-07-06T10:00:00-04:00")
        self.assertEqual(evt_d_res["id"], "block-2")

    @patch("app.fast_api_app.datetime.date")
    @patch("app.fast_api_app.state_store")
    @patch("app.fast_api_app.get_calendar_free_busy")
    def test_orphan_learning_events_after_reset(self, mock_free_busy, mock_state_store, mock_date):
        """Google Learning: events without session state are read-only external events."""
        from app.fast_api_app import get_calendar_events

        mock_date.today.return_value = datetime.date(2026, 7, 2)

        mock_state_store.get_user_profile.return_value = {
            "target_calendars": [{"id": "cal-primary", "type": "google", "selected": True, "role": "write"}],
            "scheduled_events": [],
        }
        mock_state_store.get_work_log.return_value = []

        mock_free_busy.return_value = [
            {
                "id": "orphan-google-evt",
                "summary": "Learning: AI Engineering - Task A",
                "start": "2026-07-02T09:00:00-04:00",
                "end": "2026-07-02T10:00:00-04:00",
            },
            {
                "id": "team-sync",
                "summary": "Team Sync",
                "start": "2026-07-02T11:00:00-04:00",
                "end": "2026-07-02T12:00:00-04:00",
            },
        ]

        events = get_calendar_events(offset=0)

        self.assertEqual(len(events), 2)
        orphan = next(e for e in events if e.get("id") == "orphan-google-evt")
        self.assertEqual(orphan["type"], "external")
        self.assertEqual(orphan["color"], "#475569")

    @patch("app.mcp_clients.delete_calendar_event")
    @patch("app.state_store.state_store")
    def test_clear_learning_events_for_day(self, mock_state_store, mock_delete):
        from app.scheduling_utils import clear_learning_events_for_day

        mock_state_store.get_user_profile.return_value = {
            "scheduled_events": [
                {
                    "id": "block-1",
                    "google_event_id": "google-1",
                    "summary": "Learning: AI - Task A",
                    "start": "2026-07-02T09:00:00-04:00",
                    "end": "2026-07-02T10:00:00-04:00",
                },
                {
                    "id": "block-2",
                    "google_event_id": "google-2",
                    "summary": "Learning: AI - Task B",
                    "start": "2026-07-03T09:00:00-04:00",
                    "end": "2026-07-03T10:00:00-04:00",
                },
            ],
            "goals": [],
        }
        mock_state_store.get_work_log.return_value = [
            {
                "transaction_id": "tx-1",
                "action": "scheduled",
                "events": [
                    {
                        "id": "block-1",
                        "google_event_id": "google-1",
                        "summary": "Learning: AI - Task A",
                        "start": "2026-07-02T09:00:00-04:00",
                        "end": "2026-07-02T10:00:00-04:00",
                    },
                    {
                        "id": "block-2",
                        "google_event_id": "google-2",
                        "summary": "Learning: AI - Task B",
                        "start": "2026-07-03T09:00:00-04:00",
                        "end": "2026-07-03T10:00:00-04:00",
                    },
                ],
            }
        ]
        mock_delete.return_value = {"status": "success"}

        result = clear_learning_events_for_day("2026-07-02")

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["deleted_count"], 1)
        self.assertEqual(result["removed_from_state"], 1)
        mock_delete.assert_called_once_with("google-1")
        updated = mock_state_store.update_user_profile.call_args[0][0]
        self.assertEqual(len(updated["scheduled_events"]), 1)
        self.assertEqual(updated["scheduled_events"][0]["id"], "block-2")
        pruned_log = mock_state_store.set_work_log.call_args[0][0]
        self.assertEqual(len(pruned_log), 1)
        self.assertEqual(len(pruned_log[0]["events"]), 1)
        self.assertEqual(pruned_log[0]["events"][0]["id"], "block-2")

    @patch("requests.delete")
    @patch("app.mcp_clients.get_google_credentials")
    @patch("app.mcp_clients.state_store")
    def test_delete_calendar_event_success(self, mock_state_store, mock_get_creds, mock_delete):
        from app.mcp_clients import delete_calendar_event
        
        mock_get_creds.return_value = MagicMock(token="fake-token")
        mock_state_store.get_user_profile.return_value = {
            "target_calendars": [{"id": "cal-primary", "type": "google", "selected": True, "role": "write"}]
        }
        
        mock_response = MagicMock()
        mock_response.status_code = 204
        mock_delete.return_value = mock_response
        
        res = delete_calendar_event("google-evt-1")
        self.assertEqual(res["status"], "success")
        mock_delete.assert_called_once()
        self.assertIn("google-evt-1", mock_delete.call_args[0][0])

    @patch("requests.patch")
    @patch("app.mcp_clients.get_google_credentials")
    @patch("app.mcp_clients.state_store")
    def test_update_calendar_event_success(self, mock_state_store, mock_get_creds, mock_patch):
        from app.mcp_clients import update_calendar_event
        
        mock_get_creds.return_value = MagicMock(token="fake-token")
        mock_state_store.get_user_profile.return_value = {
            "target_calendars": [{"id": "cal-primary", "type": "google", "selected": True, "role": "write"}]
        }
        
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_patch.return_value = mock_response
        
        res = update_calendar_event("google-evt-1", "2026-07-02T11:00:00-04:00", "2026-07-02T12:00:00-04:00")
        self.assertEqual(res["status"], "success")
        mock_patch.assert_called_once()
        body = mock_patch.call_args[1]["json"]
        self.assertEqual(body["start"]["dateTime"], "2026-07-02T11:00:00-04:00")
        self.assertEqual(body["end"]["dateTime"], "2026-07-02T12:00:00-04:00")

