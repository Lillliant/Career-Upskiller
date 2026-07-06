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
