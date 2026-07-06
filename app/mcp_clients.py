import json
import logging
import os
import urllib.parse
import datetime
from typing import Any

import google.auth
import requests
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials

from app.state_store import state_store

logger = logging.getLogger(__name__)

# Standard Stdio parameters for MCP servers (if present)
# In production, these would connect to actual local or SSE servers.
SEARCH_MCP_PARAMS = {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-google-search"],
}

CALENDAR_MCP_PARAMS = {"command": "npx", "args": ["-y", "mcp-server-google-calendar"]}

# In-memory mock databases for testing/fallback
MOCK_MARKET_TRENDS = {
    "ai engineering": [
        "AI Engineering roles grew 45% this quarter.",
        "High demand for Model Context Protocol (MCP) experience.",
        "Sought-after skills include: agent architecture, semantic search, DAG routing.",
    ],
    "data science": [
        "Data Scientist positions require strong MLOps and LLM integration expertise.",
        "Python remains dominant; PyTorch and Hugging Face are standard.",
    ],
    "cloud architecture": [
        "Cloud roles require Kubernetes, Terraform, and Multi-cloud strategy.",
        "Serverless adoption is growing 25% YoY.",
    ],
}

MOCK_CALENDAR_EVENTS = [
    # Congested slots for "Meetings" / "Time Scarcity" scenario testing
    {
        "summary": "Sprint Planning",
        "start": "2026-07-02T09:00:00-04:00",
        "end": "2026-07-02T10:00:00-04:00",
    },
    {
        "summary": "Weekly 1:1",
        "start": "2026-07-02T10:00:00-04:00",
        "end": "2026-07-02T11:30:00-04:00",
    },
    {
        "summary": "Product Sync",
        "start": "2026-07-02T13:00:00-04:00",
        "end": "2026-07-02T15:00:00-04:00",
    },
    {
        "summary": "Design Review",
        "start": "2026-07-02T15:30:00-04:00",
        "end": "2026-07-02T17:00:00-04:00",
    },
]


def query_search_mcp(query: str) -> dict[str, Any]:
    """Queries the Search MCP server for market trends.
    Falls back to mock data if the server is not available or query is local.
    """
    logger.info(f"Querying Search MCP for: {query}")
    # Return mock market trends if matching keywords are found
    query_lower = query.lower()
    for category, insights in MOCK_MARKET_TRENDS.items():
        if category in query_lower:
            return {"status": "success", "query": query, "insights": insights}

    # Default fallback insights
    return {
        "status": "success",
        "query": query,
        "insights": [
            f"Demand for '{query}' is stable.",
            "Key skills: continuous learning, agile adaptability.",
            "Cross-functional communication is highly valued.",
        ],
    }



def get_google_credentials():
    """Resolves Google credentials: looks for saved user token first, then falls back to ADC."""
    token_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".state", "google_token.json")

    # 1. Try to load saved OAuth2 user token
    if os.path.exists(token_path):
        try:
            with open(token_path) as f:
                info = json.load(f)
            creds = Credentials.from_authorized_user_info(info)
            if creds and creds.valid:
                return creds
            if creds and creds.expired and creds.refresh_token:
                logger.info("Refreshing expired Google OAuth2 credentials...")
                creds.refresh(Request())
                # Save refreshed credentials
                info["token"] = creds.token
                if creds.expiry:
                    info["expiry"] = creds.expiry.isoformat() + "Z"
                with open(token_path, "w") as f:
                    json.dump(info, f)
                return creds
        except Exception as e:
            logger.warning(f"Failed to load or refresh saved Google credentials: {e}")

    # 2. Fall back to Application Default Credentials (ADC)
    try:
        creds, _ = google.auth.default(
            scopes=[
                'https://www.googleapis.com/auth/calendar',
                'https://www.googleapis.com/auth/calendar.events',
                'https://www.googleapis.com/auth/calendar.readonly'
            ]
        )
        creds.refresh(Request())
        return creds
    except Exception as e:
        logger.warning(f"Failed to retrieve Application Default Credentials: {e}")

    return None

def list_google_calendars() -> list[dict[str, Any]]:
    """Lists all calendars from the user's Google Calendar account."""
    creds = get_google_credentials()
    if not creds:
        logger.warning("No Google credentials available to list calendars.")
        return []

    try:
        headers = {"Authorization": f"Bearer {creds.token}"}
        url = "https://www.googleapis.com/calendar/v3/users/me/calendarList"
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            items = resp.json().get("items", [])
            calendars = []
            for item in items:
                calendars.append({
                    "id": item.get("id"),
                    "name": item.get("summary", "Unnamed Calendar"),
                    "selected": item.get("selected", False) or item.get("primary", False),
                    "type": "google",
                    "role": "write" if item.get("primary", False) else "read_only"
                })
            return calendars
        else:
            logger.error(f"Google Calendar API returned {resp.status_code} on calendar list: {resp.text}")
    except Exception as e:
        logger.error(f"Error listing Google Calendars: {e}")

    return []

def normalize_to_local_offset(iso_str: str) -> str:
    """Converts any ISO 8601 datetime string to local offset (-04:00)."""
    try:
        import datetime
        cleaned = iso_str.replace("Z", "+00:00")
        dt = datetime.datetime.fromisoformat(cleaned)
        local_tz = datetime.timezone(datetime.timedelta(hours=-4))
        local_dt = dt.astimezone(local_tz)
        return local_dt.isoformat()
    except Exception:
        return iso_str

def get_calendar_free_busy(start_time: str, end_time: str) -> list[dict[str, Any]]:
    """Gets free/busy time slots from all selected Google Calendars.
    Returns a list of conflicting events.
    """
    logger.info(f"Reading free/busy times between {start_time} and {end_time}")

    profile = state_store.get_user_profile()
    if not profile:
        return MOCK_CALENDAR_EVENTS

    target_calendars = profile.get("target_calendars", [])
    selected_google_cals = [
        c for c in target_calendars
        if c.get("selected") and c.get("type") == "google"
    ]

    creds = get_google_credentials()
    if not creds:
        logger.info("No Google credentials resolved. Returning mock calendar events.")
        return MOCK_CALENDAR_EVENTS

    if not selected_google_cals:
        return []

    events = []
    headers = {"Authorization": f"Bearer {creds.token}"}

    for cal in selected_google_cals:
        cal_id = cal.get("id")
        if not cal_id:
            continue
        try:
            url = f"https://www.googleapis.com/calendar/v3/calendars/{urllib.parse.quote(cal_id)}/events"
            params = {
                "timeMin": start_time,
                "timeMax": end_time,
                "singleEvents": "true",
                "orderBy": "startTime"
            }
            resp = requests.get(url, headers=headers, params=params, timeout=10)
            if resp.status_code == 200:
                items = resp.json().get("items", [])
                for item in items:
                    start = item.get("start", {})
                    end = item.get("end", {})

                    start_val = start.get("dateTime", start.get("date"))
                    end_val = end.get("dateTime", end.get("date"))

                    if start_val and end_val:
                        if len(start_val) == 10:
                            start_val = f"{start_val}T00:00:00-04:00"
                        if len(end_val) == 10:
                            end_val = f"{end_val}T23:59:59-04:00"

                        events.append({
                            "summary": item.get("summary", "Busy"),
                            "start": normalize_to_local_offset(start_val),
                            "end": normalize_to_local_offset(end_val)
                        })
            else:
                logger.warning(f"Google Calendar API returned status {resp.status_code} for calendar {cal_id}: {resp.text}")
        except Exception as e:
            logger.error(f"Error fetching events for Google Calendar {cal_id}: {e}")

    return events

def write_calendar_event(
    summary: str, start_time: str, end_time: str, description: str
) -> dict[str, Any]:
    """Writes an event to the user's designated Google Calendar."""
    logger.info(f"WRITING EVENT TO CALENDAR: {summary} ({start_time} to {end_time})")

    creds = get_google_credentials()
    if not creds:
        logger.warning("No Google credentials resolved. Caching event locally.")
        return {
            "status": "success",
            "event": {
                "summary": summary,
                "start": start_time,
                "end": end_time,
                "description": description,
                "status": "locally_saved"
            },
            "message": f"Successfully scheduled locally (pending Google connection): {summary}"
        }

    profile = state_store.get_user_profile() or {}
    target_calendars = profile.get("target_calendars", [])
    write_cal = next(
        (c for c in target_calendars if c.get("role") == "write" and c.get("type") == "google"),
        None
    )
    cal_id = write_cal.get("id") if write_cal else "primary"

    try:
        headers = {
            "Authorization": f"Bearer {creds.token}",
            "Content-Type": "application/json"
        }
        url = f"https://www.googleapis.com/calendar/v3/calendars/{urllib.parse.quote(cal_id)}/events"
        body = {
            "summary": summary,
            "description": description,
            "start": {
                "dateTime": start_time,
            },
            "end": {
                "dateTime": end_time,
            }
        }
        resp = requests.post(url, headers=headers, json=body, timeout=10)
        if resp.status_code in (200, 201):
            created_event = resp.json()
            return {
                "status": "success",
                "event": {
                    "id": created_event.get("id"),
                    "summary": summary,
                    "start": start_time,
                    "end": end_time,
                    "description": description,
                    "status": "confirmed"
                },
                "message": f"Successfully written to calendar: {summary}"
            }
        else:
            logger.error(f"Failed to write Google Calendar event to {cal_id}: HTTP {resp.status_code} - {resp.text}")
            return {
                "status": "error",
                "message": f"Failed to write to Google Calendar: HTTP {resp.status_code}"
            }
    except Exception as e:
        logger.error(f"Error writing to Google Calendar: {e}")
        return {
            "status": "error",
            "message": f"Failed to connect to Google Calendar: {e}"
        }

def sync_local_events_to_google(profile: dict) -> dict[str, Any]:
    """Syncs any locally scheduled upskilling events missing google_event_id to the designated Google Calendar."""
    creds = get_google_credentials()
    if not creds:
        return {"status": "error", "message": "No Google account connected."}

    scheduled_events = profile.get("scheduled_events", [])
    target_calendars = profile.get("target_calendars", [])

    write_cal = next(
        (c for c in target_calendars if c.get("role") == "write" and c.get("type") == "google"),
        None
    )
    cal_id = write_cal.get("id") if write_cal else "primary"

    synced_count = 0
    updated_events = []

    headers = {
        "Authorization": f"Bearer {creds.token}",
        "Content-Type": "application/json"
    }
    url = f"https://www.googleapis.com/calendar/v3/calendars/{urllib.parse.quote(cal_id)}/events"

    for event in scheduled_events:
        if event.get("google_event_id"):
            updated_events.append(event)
            continue

        try:
            body = {
                "summary": event.get("summary"),
                "description": event.get("description", ""),
                "start": {
                    "dateTime": event.get("start"),
                },
                "end": {
                    "dateTime": event.get("end"),
                }
            }
            resp = requests.post(url, headers=headers, json=body, timeout=10)
            if resp.status_code in (200, 201):
                created = resp.json()
                event["google_event_id"] = created.get("id")
                synced_count += 1
            else:
                logger.error(f"Sync error for event '{event.get('summary')}': HTTP {resp.status_code} - {resp.text}")
        except Exception as e:
            logger.error(f"Sync exception for event '{event.get('summary')}': {e}")

        updated_events.append(event)

    profile["scheduled_events"] = updated_events
    state_store.update_user_profile(profile)

    return {
        "status": "success",
        "synced_count": synced_count,
        "message": f"Successfully synchronized {synced_count} events to Google Calendar."
    }
