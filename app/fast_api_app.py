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
import os
from typing import Any

import google.auth
from fastapi import FastAPI, HTTPException
from google.adk.cli.fast_api import get_fast_api_app
from google.cloud import logging as google_cloud_logging
from pydantic import BaseModel

from app.app_utils.ical_parser import parse_ical
from app.app_utils.project_resolver import setup_gcp_environment

# Initialize project and quota environment variables dynamically
try:
    setup_gcp_environment()
except Exception:
    pass

from app.app_utils.telemetry import setup_telemetry
from app.app_utils.typing import Feedback
from app.mcp_clients import get_calendar_free_busy
from app.skills.reflection_loop import process_user_reflection
from app.state_store import state_store


# Request schemas for new endpoints
class ProfileUpdate(BaseModel):
    career_goals: str | None = None
    hours_per_week: int | None = None
    preferred_start_time: str | None = None
    preferred_end_time: str | None = None
    study_days: list[str] | None = None
    target_calendars: list[dict[str, Any]] | None = None
    available_google_calendars: list[dict[str, Any]] | None = None
    onboarded: bool | None = None

class GoalCreate(BaseModel):
    title: str
    description: str | None = ""
    status: str | None = "to-do"
    sub_projects: list[dict[str, Any]] | None = None
    skills: list[dict[str, Any]] | None = None

class GoalUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    status: str | None = None
    sub_projects: list[dict[str, Any]] | None = None
    skills: list[dict[str, Any]] | None = None
    time_spent_mins: int | None = None
    conversations: list[dict[str, Any]] | None = None

class ReflectionSubmit(BaseModel):
    learning_block_id: str | None = "generic"
    reflection_text: str
    success_rating: int | None = None

class ScheduleApprovalEnvelope(BaseModel):
    transaction_id: str
    token: str
    action: str
    proposed_events: list[dict[str, Any]] | None = None
    calendar_scopes: list[str] | None = None

setup_telemetry()

# Resilient Logger and Credentials Fallback
class LoggerWrapper:
    def __init__(self, fallback_logger=None, gcp_logger=None):
        self.fallback = fallback_logger
        self.gcp = gcp_logger

    def log_struct(self, data, severity="INFO"):
        if self.gcp:
            try:
                self.gcp.log_struct(data, severity=severity)
                return
            except Exception:
                pass
        import json
        msg = f"[{severity}] {json.dumps(data)}"
        if self.fallback:
            self.fallback.info(msg)
        else:
            print(msg)

    def warning(self, msg):
        if self.gcp:
            try:
                self.gcp.log(msg, severity="WARNING")
                return
            except Exception:
                pass
        if self.fallback:
            self.fallback.warning(msg)
        else:
            print(f"[WARNING] {msg}")

    def info(self, msg):
        if self.gcp:
            try:
                self.gcp.log(msg, severity="INFO")
                return
            except Exception:
                pass
        if self.fallback:
            self.fallback.info(msg)
        else:
            print(f"[INFO] {msg}")

project_id = None
logger = None

try:
    _, project_id = google.auth.default()
    if not project_id:
        project_id = os.environ.get("GOOGLE_CLOUD_PROJECT")
    logging_client = google_cloud_logging.Client()
    gcp_logger = logging_client.logger(__name__)
    logger = LoggerWrapper(gcp_logger=gcp_logger)
except Exception as e:
    import logging
    logging.basicConfig(level=logging.INFO)
    fallback = logging.getLogger("career-upskiller-local")
    logger = LoggerWrapper(fallback_logger=fallback)
    logger.warning(f"Google Cloud credentials or Logging client not available. Operating in resilient local mode. Details: {e}")

allow_origins = (
    os.getenv("ALLOW_ORIGINS", "").split(",")
    if os.getenv("ALLOW_ORIGINS")
    else ["http://localhost:5173", "http://127.0.0.1:5173"]
)

# Artifact bucket for ADK (created by Terraform, passed via env var)
logs_bucket_name = os.environ.get("LOGS_BUCKET_NAME")

AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Set default app name for ADK endpoints
os.environ["ADK_DEFAULT_APP_NAME"] = "app"

# In-memory session configuration - no persistent storage
session_service_uri = None

artifact_service_uri = f"gs://{logs_bucket_name}" if logs_bucket_name else None

app: FastAPI = get_fast_api_app(
    agents_dir=AGENT_DIR,
    web=True,
    artifact_service_uri=artifact_service_uri,
    allow_origins=allow_origins,
    session_service_uri=session_service_uri,
    otel_to_cloud=True,
    auto_create_session=True,
)
app.title = "career-upskiller"
app.description = "API for interacting with the Agent career-upskiller"


@app.get("/api/profile")
def get_profile():
    return state_store.get_user_profile()

@app.post("/api/profile")
def update_profile(profile: ProfileUpdate):
    profile_dict = profile.model_dump(exclude_unset=True)
    state_store.update_user_profile(profile_dict)
    return {"status": "success", "profile": state_store.get_user_profile()}

@app.get("/api/goals")
def get_goals():
    return state_store.get_goals()

@app.post("/api/goals")
def create_goal(goal: GoalCreate):
    goal_dict = goal.model_dump()
    if not goal_dict.get("sub_projects"):
        goal_dict["sub_projects"] = []
    if not goal_dict.get("skills"):
        goal_dict["skills"] = []
    goal_dict["time_spent_mins"] = 0
    goal_dict["conversations"] = []
    state_store.create_goal(goal_dict)
    return {"status": "success", "goals": state_store.get_goals()}

@app.put("/api/goals/{goal_id}")
def update_goal(goal_id: str, goal: GoalUpdate):
    goal_dict = goal.model_dump(exclude_unset=True)
    state_store.update_goal(goal_id, goal_dict)
    return {"status": "success", "goals": state_store.get_goals()}

@app.delete("/api/goals/{goal_id}")
def delete_goal(goal_id: str):
    profile = state_store.get_user_profile()
    goals = profile.get("goals", [])
    updated_goals = [g for g in goals if g.get("id") != goal_id]
    profile["goals"] = updated_goals
    state_store.update_user_profile(profile)
    return {"status": "success", "goals": state_store.get_goals()}

@app.post("/api/reset")
def reset_state():
    state_store.reset()
    return {"status": "success", "message": "State store has been reset."}


@app.post("/api/schedule/stage")
def stage_weekly_schedule():
    """Stage this week's learning blocks from task due dates across active projects."""
    from app.schedule_proposal import build_weekly_schedule_proposal

    proposal = build_weekly_schedule_proposal()
    return {"status": "success", **proposal}


@app.post("/api/schedule/approve")
def approve_weekly_schedule(envelope: ScheduleApprovalEnvelope):
    """Verify HITL approval envelope and write staged events to calendar."""
    from app.schedule_approval import approve_schedule_proposal

    result = approve_schedule_proposal(envelope.model_dump())
    if result.get("status") != "success":
        raise HTTPException(status_code=400, detail=result.get("message", "Approval failed."))
    return result


@app.post("/api/schedule/reject")
def reject_weekly_schedule(envelope: ScheduleApprovalEnvelope):
    """Reject a staged schedule proposal without writing to calendar."""
    from app.schedule_approval import reject_schedule_proposal

    result = reject_schedule_proposal(envelope.model_dump())
    if result.get("status") != "success":
        raise HTTPException(status_code=400, detail=result.get("message", "Rejection failed."))
    return result

def get_sunday_week_start(
    reference_date: datetime.date | None = None, week_offset: int = 0
) -> datetime.date:
    """Return the Sunday that starts the week containing reference_date, shifted by week_offset."""
    if reference_date is None:
        reference_date = datetime.date.today()
    days_since_sunday = (reference_date.weekday() + 1) % 7
    return reference_date - datetime.timedelta(days=days_since_sunday) + datetime.timedelta(
        weeks=week_offset
    )


@app.get("/api/calendar/events")
def get_calendar_events(offset: int = 0):
    profile = state_store.get_user_profile()
    events = []

    # Sunday-start week containing today, shifted by offset
    start_of_week = get_sunday_week_start(week_offset=offset)
    end_of_week = start_of_week + datetime.timedelta(days=7)

    start_iso = datetime.datetime.combine(start_of_week, datetime.time.min).isoformat() + "Z"
    end_iso = datetime.datetime.combine(end_of_week, datetime.time.max).isoformat() + "Z"

    # Pre-fetch scheduled upskilling blocks (from profile or work_log) to match and de-duplicate
    scheduled_blocks = profile.get("scheduled_events", [])
    # Filter out pending deletions
    to_delete = {e.get("id") for e in profile.get("events_to_delete", []) if e.get("id")}
    scheduled_blocks = [b for b in scheduled_blocks if b.get("id") not in to_delete]

    # Also fetch from work_log as fallback/sync
    logs = state_store.get_work_log()
    for log in logs:
        if log.get("action") == "scheduled" and log.get("events"):
            for evt in log["events"]:
                if evt.get("id") not in to_delete:
                    if not any(e.get("start") == evt.get("start") and e.get("summary") == evt.get("summary") for e in scheduled_blocks):
                        scheduled_blocks.append(evt)

    # Sets/dicts to track scheduled upskilling blocks found in Google Calendar
    found_block_ids = set()
    found_block_keys = set()

    # We will map each Google Calendar event to its matched block if any
    matched_events = {}

    # 1. Fetch external meetings (read-only/display) from Google Calendar or Mock Calendar
    target_calendars = profile.get("target_calendars", [])
    google_selected = any(c.get("selected") and c.get("type") == "google" for c in target_calendars)

    if google_selected:
        mcp_events = get_calendar_free_busy(start_iso, end_iso)
        mcp_events_indexed = list(enumerate(mcp_events))

        # Pass 1: Exact match by Google Event ID or exact start time + summary
        for idx, evt in mcp_events_indexed:
            for block in scheduled_blocks:
                if block.get("id") in found_block_ids or (block.get("start"), block.get("summary")) in found_block_keys:
                    continue
                
                # Match by Google Event ID
                if evt.get("id") and block.get("google_event_id") == evt.get("id"):
                    matched_events[idx] = block
                    found_block_ids.add(block.get("id"))
                    found_block_keys.add((block.get("start"), block.get("summary")))
                    break
                
                # Match by exact start time and summary
                if block.get("start") == evt.get("start") and block.get("summary") == evt.get("summary"):
                    matched_events[idx] = block
                    if block.get("id"):
                        found_block_ids.add(block.get("id"))
                    found_block_keys.add((block.get("start"), block.get("summary")))
                    break

        # Pass 2: Fuzzy match by same day and summary for remaining unmatched learning events
        for idx, evt in mcp_events_indexed:
            if idx in matched_events:
                continue
                
            evt_summary = evt.get("summary", "")
            if not (evt_summary.startswith("Learning:") or evt_summary.startswith("Micro-learning:")):
                continue
                
            for block in scheduled_blocks:
                if block.get("id") in found_block_ids or (block.get("start"), block.get("summary")) in found_block_keys:
                    continue
                    
                if block.get("summary") == evt_summary:
                    # Check if same day
                    evt_date = evt.get("start", "")[:10]
                    block_date = block.get("start", "")[:10]
                    if evt_date and block_date and evt_date == block_date:
                        matched_events[idx] = block
                        if block.get("id"):
                            found_block_ids.add(block.get("id"))
                        found_block_keys.add((block.get("start"), block.get("summary")))
                        break

        # Process and append events
        for idx, evt in mcp_events_indexed:
            is_mock_fallback = evt.get("start", "").startswith("2026-07-02") and offset != 0
            matched_block = matched_events.get(idx)

            evt_summary = evt.get("summary", "Busy")
            is_learning_type = (
                matched_block is not None or 
                evt_summary.startswith("Learning:") or 
                evt_summary.startswith("Micro-learning:")
            )

            if is_mock_fallback:
                try:
                    # Format: YYYY-MM-DDTHH:MM:SS-04:00
                    orig_start = datetime.datetime.fromisoformat(evt.get("start"))
                    mock_anchor = datetime.date(2026, 7, 2)
                    mock_week_sunday = get_sunday_week_start(mock_anchor)
                    days_diff = (orig_start.date() - mock_week_sunday).days
                    new_start_date = start_of_week + datetime.timedelta(days=days_diff)

                    new_start = datetime.datetime.combine(new_start_date, orig_start.time()).isoformat() + "-04:00"
                    orig_end = datetime.datetime.fromisoformat(evt.get("end"))
                    new_end = datetime.datetime.combine(new_start_date, orig_end.time()).isoformat() + "-04:00"

                    events.append({
                        "id": matched_block.get("id") if matched_block else evt.get("id"),
                        "summary": evt_summary,
                        "start": new_start,
                        "end": new_end,
                        "description": matched_block.get("description") if matched_block else evt.get("description"),
                        "type": "learning" if is_learning_type else "external",
                        "color": "#6366f1" if is_learning_type else "#475569"
                    })
                except Exception:
                    events.append({
                        "id": matched_block.get("id") if matched_block else evt.get("id"),
                        "summary": evt_summary,
                        "start": evt.get("start"),
                        "end": evt.get("end"),
                        "description": matched_block.get("description") if matched_block else evt.get("description"),
                        "type": "learning" if is_learning_type else "external",
                        "color": "#6366f1" if is_learning_type else "#475569"
                    })
            else:
                events.append({
                    "id": matched_block.get("id") if matched_block else evt.get("id"),
                    "summary": evt_summary,
                    "start": evt.get("start"),
                    "end": evt.get("end"),
                    "description": matched_block.get("description") if matched_block else evt.get("description"),
                    "type": "learning" if is_learning_type else "external",
                    "color": "#6366f1" if is_learning_type else "#475569"
                })

    # 2. Fetch external iCal subscription events
    for cal in target_calendars:
        if cal.get("selected") and cal.get("type") == "ical" and cal.get("url"):
            ical_events = parse_ical(cal["url"])
            for evt in ical_events:
                evt_start_str = evt.get("start")
                if evt_start_str:
                    try:
                        # Normalize format to parse timezone
                        normalized = evt_start_str.replace("Z", "+00:00")
                        evt_start = datetime.datetime.fromisoformat(normalized).date()
                        if start_of_week <= evt_start < end_of_week:
                            events.append({
                                "summary": evt.get("summary", "iCal Event"),
                                "start": evt.get("start"),
                                "end": evt.get("end"),
                                "type": "external",
                                "color": "#475569"
                            })
                    except Exception:
                        pass

    # 3. Add scheduled upskilling blocks that were NOT matched/handled via Google Calendar
    for block in scheduled_blocks:
        if block.get("google_event_id") in found_block_ids:
            continue
        if block.get("id") in found_block_ids:
            continue
        if (block.get("start"), block.get("summary")) in found_block_keys:
            continue

        block_start_str = block.get("start")
        if block_start_str:
            try:
                normalized = block_start_str.replace("Z", "+00:00")
                block_date = datetime.datetime.fromisoformat(normalized).date()
                if start_of_week <= block_date < end_of_week:
                    events.append({
                        "id": block.get("id"),
                        "summary": block.get("summary"),
                        "start": block.get("start"),
                        "end": block.get("end"),
                        "description": block.get("description"),
                        "type": "learning",
                        "color": "#6366f1" # Indigo/violet for learning blocks
                    })
            except Exception:
                events.append({
                    "id": block.get("id"),
                    "summary": block.get("summary"),
                    "start": block.get("start"),
                    "end": block.get("end"),
                    "description": block.get("description"),
                    "type": "learning",
                    "color": "#6366f1"
                })

    return events

class CalendarEventUpdate(BaseModel):
    start: str
    end: str
    summary: str | None = None
    description: str | None = None

@app.put("/api/calendar/events/{event_id}")
def update_calendar_event_endpoint(event_id: str, payload: CalendarEventUpdate):
    profile = state_store.get_user_profile()
    scheduled_events = profile.get("scheduled_events", [])
    
    # Find the local event
    event_to_update = None
    for evt in scheduled_events:
        if evt.get("id") == event_id:
            event_to_update = evt
            break
            
    if not event_to_update:
        # Check if the event_id matches google_event_id as fallback
        for evt in scheduled_events:
            if evt.get("google_event_id") == event_id:
                event_to_update = evt
                break

    if not event_to_update:
        raise HTTPException(status_code=404, detail="Scheduled event not found")

    # Update local values
    event_to_update["start"] = payload.start
    event_to_update["end"] = payload.end
    if payload.summary is not None:
        event_to_update["summary"] = payload.summary
    if payload.description is not None:
        event_to_update["description"] = payload.description

    # Sync to external Google Calendar if mapped
    from app.mcp_clients import update_calendar_event
    google_event_id = event_to_update.get("google_event_id")
    google_status = None
    if google_event_id:
        google_status = update_calendar_event(
            google_event_id=google_event_id,
            start_time=payload.start,
            end_time=payload.end,
            summary=payload.summary,
            description=payload.description
        )

    # Save to profile
    state_store.update_user_profile(profile)
    return {"status": "success", "event": event_to_update, "google_status": google_status}

@app.delete("/api/calendar/events/{event_id}")
def delete_calendar_event_endpoint(event_id: str):
    profile = state_store.get_user_profile()
    scheduled_events = profile.get("scheduled_events", [])
    
    # Find the local event to get the google_event_id
    event_to_delete = None
    for evt in scheduled_events:
        if evt.get("id") == event_id:
            event_to_delete = evt
            break
            
    if not event_to_delete:
        # Check by google_event_id as fallback
        for evt in scheduled_events:
            if evt.get("google_event_id") == event_id:
                event_to_delete = evt
                break

    if not event_to_delete:
        raise HTTPException(status_code=404, detail="Scheduled event not found")

    google_event_id = event_to_delete.get("google_event_id")
    google_status = None
    if google_event_id:
        from app.mcp_clients import delete_calendar_event
        google_status = delete_calendar_event(google_event_id)

    # Remove from scheduled_events
    profile["scheduled_events"] = [evt for evt in scheduled_events if evt.get("id") != event_to_delete.get("id")]
    state_store.update_user_profile(profile)
    return {"status": "success", "google_status": google_status}

@app.get("/api/auth/google/login")
def google_login_url():
    import urllib.parse
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    if not client_id:
        return {"status": "error", "message": "GOOGLE_CLIENT_ID not configured in environment."}

    redirect_uri = os.environ.get("GOOGLE_REDIRECT_URI", "http://localhost:5173/oauth-callback")
    scope = "https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly"

    auth_url = (
        "https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={urllib.parse.quote(client_id)}"
        f"&redirect_uri={urllib.parse.quote(redirect_uri)}"
        "&response_type=code"
        f"&scope={urllib.parse.quote(scope)}"
        "&access_type=offline"
        "&prompt=consent"
    )
    return {"status": "success", "url": auth_url}

@app.get("/api/auth/google/callback")
def google_callback(code: str):
    import json

    import requests
    client_id = os.environ.get("GOOGLE_CLIENT_ID")
    client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
    redirect_uri = os.environ.get("GOOGLE_REDIRECT_URI", "http://localhost:5173/oauth-callback")

    if not client_id or not client_secret:
        raise HTTPException(status_code=400, detail="OAuth credentials not configured.")

    # Exchange auth code for tokens
    token_url = "https://oauth2.googleapis.com/token"
    payload = {
        "code": code,
        "client_id": client_id,
        "client_secret": client_secret,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code"
    }
    resp = requests.post(token_url, data=payload, timeout=10)
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail=f"Failed to exchange token: {resp.text}")

    token_info = resp.json()

    # Save tokens locally
    token_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".state", "google_token.json")
    os.makedirs(os.path.dirname(token_path), exist_ok=True)

    info = {
        "token": token_info.get("access_token"),
        "refresh_token": token_info.get("refresh_token"),
        "token_uri": token_url,
        "client_id": client_id,
        "client_secret": client_secret,
        "scopes": token_info.get("scope", "").split(" "),
    }
    if "expires_in" in token_info:
        expiry_dt = datetime.datetime.utcnow() + datetime.timedelta(seconds=token_info["expires_in"])
        info["expiry"] = expiry_dt.isoformat() + "Z"
    with open(token_path, "w") as f:
        json.dump(info, f)

    # Discover Google Calendars and save them to available_google_calendars
    from app.mcp_clients import list_google_calendars, sync_local_events_to_google
    discovered_calendars = list_google_calendars()

    profile = state_store.get_user_profile() or {}
    current_calendars = profile.get("target_calendars", [])
    current_google_ids = {c.get("id") for c in current_calendars if c.get("type") == "google"}

    available_cals = []
    for dc in discovered_calendars:
        if dc.get("id") not in current_google_ids:
            available_cals.append(dc)

    profile["available_google_calendars"] = available_cals
    state_store.update_user_profile(profile)

    # Trigger automatic sync of local cached events
    sync_res = sync_local_events_to_google(profile)

    return {
        "status": "success",
        "calendars": current_calendars,
        "available_calendars": available_cals,
        "sync_result": sync_res
    }

@app.get("/api/auth/google/status")
def google_status():
    from app.mcp_clients import get_google_credentials
    creds = get_google_credentials()
    if creds:
        token_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".state", "google_token.json")
        is_user_oauth = os.path.exists(token_path)
        return {
            "connected": True,
            "type": "oauth" if is_user_oauth else "adc",
            "scopes": creds.scopes
        }
    return {"connected": False}

@app.post("/api/goals/{goal_id}/reflect")
def reflect_on_goal(goal_id: str, reflection: ReflectionSubmit):
    profile = state_store.get_user_profile()
    if not profile:
        raise HTTPException(status_code=400, detail="Profile not onboarded.")

    result = process_user_reflection(
        user_id="test_user_123",
        learning_block_id=reflection.learning_block_id,
        reflection_text=reflection.reflection_text,
        success_rating=reflection.success_rating,
        goal_id=goal_id
    )

    # Re-read the updated profile from process_user_reflection to keep milestone changes
    profile = state_store.get_user_profile()

    # Associate reflection directly with goal
    goals = profile.get("goals", [])
    updated_goals = []
    for g in goals:
        if g.get("id") == goal_id:
            convs = g.get("conversations", [])
            timestamp = result.get("logged_entry", {}).get("timestamp", "2026-07-02T11:38:00Z")

            convs.append({
                "role": "user",
                "text": reflection.reflection_text,
                "timestamp": timestamp
            })

            adj_reason = result["updated_profile"].get("adjustment_reason", "Goal adjusted.")
            feedback = f"Thank you for sharing your reflection. {adj_reason}"
            convs.append({
                "role": "model",
                "text": feedback,
                "timestamp": timestamp
            })

            g["conversations"] = convs
            g["time_spent_mins"] = g.get("time_spent_mins", 0) + 30 # assume 30 minutes added per reflection

        updated_goals.append(g)

    profile["goals"] = updated_goals
    state_store.update_user_profile(profile)

    return {
        "status": "success",
        "result": result,
        "goals": state_store.get_goals()
    }

@app.post("/feedback")
def collect_feedback(feedback: Feedback) -> dict[str, str]:
    """Collect and log feedback.

    Args:
        feedback: The feedback data to log

    Returns:
        Success message
    """
    logger.log_struct(feedback.model_dump(), severity="INFO")
    return {"status": "success"}


class ChatMessage(BaseModel):
    role: str
    text: str

class ChatRequest(BaseModel):
    messages: list[ChatMessage]

@app.post("/api/chat/goals")
def chat_goals(request: ChatRequest):
    user_msgs = [m for m in request.messages if m.role == 'user']
    if not user_msgs:
        return {"text": "Hello! I am your Skill Concierge assistant. Let's discuss your career aspirations and design high-impact learning goals and weekly projects to get you there.", "suggestedGoal": None}

    first_query = user_msgs[0].text
    last_query = user_msgs[-1].text
    today_str = datetime.date.today().isoformat()

    # 1. Attempt to call Gemini Client (Vertex / Gen AI fallback)
    try:
        import json

        from google.genai import Client, types
        client = None
        try:
            client = Client()
        except Exception:
            client = Client(vertexai=True)

        if client:
            system_instruction = f"""
            You are the Career Skill Concierge, an expert career counselor and tutor.
            Your role is to help the user discover their skill goals and design weekly portfolio projects with a structured learning map consisting of Milestones -> Tasks.
            Today's current date is {today_str}. Please space out the tasks and milestones starting from this date.

            Rules:
            1. If this is the FIRST message from the user (i.e. the history contains only 1 user query), you MUST ask 2-3 follow-up questions to understand their current familiarity level (beginner, intermediate, advanced) and their preference for conceptual study vs hands-on building. Do NOT recommend a structured goal block yet.
            2. If the history has 2 or more user messages, summarize their goal, and output a friendly concluding message. At the end of your response, you MUST output a structured JSON upskilling goal object inside markdown code fences (` ```json `), with the following fields:
               - title: Str (the title of the customized goal/project)
               - description: Str (brief project overview)
               - sub_projects: List of Dicts (Milestones), where each dict has:
                 - title: Str (e.g. "Milestone 1: JavaScript Foundations")
                 - description: Str (Milestone description, e.g. "Understand how to write basic instructions and control the flow of a program.")
                 - dueDate: Str (YYYY-MM-DD)
                 - completed: Bool (default False)
                 - tasks: List of Dicts, where each dict has:
                   - title: Str (e.g. "Variables and Data Types")
                   - description: Str (Task description, e.g. "Learn how to store data using let, const, and var. Understand primitive types like strings, numbers, and booleans.")
                   - estimated_time: Str (e.g. "2 hours")
                   - resource: Str (e.g. "The 'JavaScript First Steps' module on MDN Web Docs.")
                   - dueDate: Str (YYYY-MM-DD)
                   - completed: Bool (default False)
               - skills: List of Dicts, where each dict has "name" (Str), "category" (Str)
            """

            contents = []
            for msg in request.messages:
                contents.append(types.Content(
                     role="user" if msg.role == "user" else "model",
                     parts=[types.Part.from_text(text=msg.text)]
                ))

            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=0.7
                )
            )

            response_text = response.text
            suggested_goal = None
            if "```json" in response_text:
                try:
                    parts = response_text.split("```json")
                    json_str = parts[1].split("```")[0].strip()
                    suggested_goal = json.loads(json_str)
                    if suggested_goal and "sub_projects" in suggested_goal:
                        from app.state_store import adjust_past_due_dates, pace_and_schedule_goals, state_store
                        suggested_goal["sub_projects"] = adjust_past_due_dates(suggested_goal["sub_projects"])
                        profile = state_store.get_user_profile()
                        profile["goals"] = [suggested_goal]
                        profile = pace_and_schedule_goals(profile)
                        suggested_goal = profile["goals"][0]
                    response_text = parts[0].strip() + "\n\n" + (parts[1].split("```")[1] if len(parts[1].split("```")) > 1 else "").strip()
                except Exception:
                    pass

            return {
                "text": response_text.strip(),
                "suggestedGoal": suggested_goal
            }
    except Exception as e:
        logger.warning(f"Failed to use live Gemini model for elicitation: {e}. Falling back to rule-based engine.")

    # 2. Rule-based fallback (if client has no credentials or keys)
    if len(user_msgs) == 1:
        reply = (
            f"That sounds like an exciting direction! To make sure I customize this goal perfectly to your lifestyle:\n"
            f"1. What is your current level of familiarity with \"{last_query}\" (e.g. absolute beginner, some experience, advanced)?\n"
            f"2. Do you prefer hands-on building projects or conceptual study blocks?"
        )
        return {"text": reply, "suggestedGoal": None}
    else:
        lower_first = first_query.lower()
        if "ai" in lower_first or "agentic" in lower_first:
            reply = "AI engineering roles are growing at 45% YoY. The most in-demand skill right now is building robust agents using Directed Acyclic Graphs (DAG) and the Model Context Protocol (MCP). Based on your feedback, I recommend starting with the project below:"
            suggestion = {
                "title": "Master DAG Orchestration & MCP",
                "description": "Learn Google ADK agent modeling and tool callbacks.",
                "sub_projects": [
                    {
                        "title": "Milestone 1: Google ADK Basics",
                        "description": "Establish a basic foundation in Google's Agent Development Kit (ADK).",
                        "dueDate": (datetime.date.today() + datetime.timedelta(days=2)).isoformat(),
                        "completed": False,
                        "tasks": [
                            {
                                "title": "Define a 3-node workflow edge mapping",
                                "description": "Configure nodes, routing conditions, and edge relations within the DAG.",
                                "estimated_time": "2 hours",
                                "resource": "Google Agents CLI ADK Code Skill guide",
                                "dueDate": (datetime.date.today() + datetime.timedelta(days=1)).isoformat(),
                                "completed": False
                            }
                        ]
                    },
                    {
                        "title": "Milestone 2: MCP Integration",
                        "description": "Connect agents with Model Context Protocol servers.",
                        "dueDate": (datetime.date.today() + datetime.timedelta(days=4)).isoformat(),
                        "completed": False,
                        "tasks": [
                            {
                                "title": "Build a stdio transport server client",
                                "description": "Implement stdio-based transport client to interact with external tools.",
                                "estimated_time": "3 hours",
                                "resource": "Model Context Protocol specification docs",
                                "dueDate": (datetime.date.today() + datetime.timedelta(days=3)).isoformat(),
                                "completed": False
                            }
                        ]
                    },
                    {
                        "title": "Milestone 3: Advanced Security",
                        "description": "Implement security layer on top of agent routing and execution.",
                        "dueDate": (datetime.date.today() + datetime.timedelta(days=6)).isoformat(),
                        "completed": False,
                        "tasks": [
                            {
                                "title": "Implement Zero-Trust signature checks",
                                "description": "Verify cryptographic signatures before invoking backend tool executions.",
                                "estimated_time": "4 hours",
                                "resource": "Zero-Trust Architecture Guidelines on OWASP",
                                "dueDate": (datetime.date.today() + datetime.timedelta(days=5)).isoformat(),
                                "completed": False
                            }
                        ]
                    }
                ],
                "skills": [
                    {"name": "DAG Orchestration", "category": "AI Engineering"},
                    {"name": "Model Context Protocol (MCP)", "category": "AI Engineering"}
                ]
            }
        elif "mlops" in lower_first or "cloud" in lower_first:
            reply = "MLOps and cloud pipeline automation are essential for shipping models. Recruiters prioritize candidates with hands-on Kubernetes deployment and Terraform orchestration portfolios. Based on your feedback, here is your customized goal:"
            suggestion = {
                "title": "Automate ML Deployment with Cloud GKE",
                "description": "Deploy models on GKE and configure automated CI/CD logs.",
                "sub_projects": [
                    {
                        "title": "Milestone 1: Containerization Foundations",
                        "description": "Understand how to package machine learning applications.",
                        "dueDate": (datetime.date.today() + datetime.timedelta(days=2)).isoformat(),
                        "completed": False,
                        "tasks": [
                            {
                                "title": "Draft a Dockerfile for model endpoint",
                                "description": "Build a Docker container hosting a prediction API with FastAPI.",
                                "estimated_time": "2 hours",
                                "resource": "Official Docker Engine guide",
                                "dueDate": (datetime.date.today() + datetime.timedelta(days=1)).isoformat(),
                                "completed": False
                            }
                        ]
                    },
                    {
                        "title": "Milestone 2: Kubernetes Orchestration",
                        "description": "Deploy containerized models onto Google Kubernetes Engine.",
                        "dueDate": (datetime.date.today() + datetime.timedelta(days=4)).isoformat(),
                        "completed": False,
                        "tasks": [
                            {
                                "title": "Configure Kubernetes staging manifest",
                                "description": "Write deployment and service configurations for the endpoint.",
                                "estimated_time": "3 hours",
                                "resource": "Kubernetes Deployment interactive tutorials",
                                "dueDate": (datetime.date.today() + datetime.timedelta(days=3)).isoformat(),
                                "completed": False
                            }
                        ]
                    },
                    {
                        "title": "Milestone 3: Automated CI/CD Pipelines",
                        "description": "Establish continuous deployment pipeline using GitHub Actions.",
                        "dueDate": (datetime.date.today() + datetime.timedelta(days=6)).isoformat(),
                        "completed": False,
                        "tasks": [
                            {
                                "title": "Setup GitHub Actions trigger on push",
                                "description": "Write a workflow yaml file that runs checks and deploys on git push.",
                                "estimated_time": "4 hours",
                                "resource": "GitHub Actions workflow syntax docs",
                                "dueDate": (datetime.date.today() + datetime.timedelta(days=5)).isoformat(),
                                "completed": False
                            }
                        ]
                    }
                ],
                "skills": [
                    {"name": "GKE Automation", "category": "MLOps"},
                    {"name": "Docker Containerization", "category": "DevOps"}
                ]
            }
        else:
            reply = "That is a great direction! To develop skills in that area, it's best to work on a concrete, structured portfolio project. Based on your feedback, I've created the following development block:"
            suggestion = {
                "title": f"Master {first_query} Fundamentals",
                "description": f"Hands-on projects and milestones to develop competencies in {first_query}.",
                "sub_projects": [
                    {
                        "title": "Milestone 1: Core Syntax",
                        "description": f"Understand core concepts of {first_query}.",
                        "dueDate": (datetime.date.today() + datetime.timedelta(days=2)).isoformat(),
                        "completed": False,
                        "tasks": [
                            {
                                "title": "Research core syntax and references",
                                "description": "Explore the official syntax guide and compile reference sheets.",
                                "estimated_time": "2 hours",
                                "resource": "Official documentation quickstarts",
                                "dueDate": (datetime.date.today() + datetime.timedelta(days=1)).isoformat(),
                                "completed": False
                            }
                        ]
                    },
                    {
                        "title": "Milestone 2: Application Prototype",
                        "description": "Build a CLI or simple GUI prototype using the concepts.",
                        "dueDate": (datetime.date.today() + datetime.timedelta(days=4)).isoformat(),
                        "completed": False,
                        "tasks": [
                            {
                                "title": "Create a simple CLI prototype application",
                                "description": "Design user controls, simple database/file backend storage.",
                                "estimated_time": "3 hours",
                                "resource": "Learn Python/JS standard library guides",
                                "dueDate": (datetime.date.today() + datetime.timedelta(days=3)).isoformat(),
                                "completed": False
                            }
                        ]
                    },
                    {
                        "title": "Milestone 3: Deployment",
                        "description": "Publish the prototype to a cloud staging environment.",
                        "dueDate": (datetime.date.today() + datetime.timedelta(days=6)).isoformat(),
                        "completed": False,
                        "tasks": [
                            {
                                "title": "Deploy demo to cloud staging server",
                                "description": "Use Vercel, Heroku, or GCP Cloud Run for deployment.",
                                "estimated_time": "2 hours",
                                "resource": "Vercel or Cloud Run deployment guides",
                                "dueDate": (datetime.date.today() + datetime.timedelta(days=5)).isoformat(),
                                "completed": False
                            }
                        ]
                    }
                ],
                "skills": [
                    {"name": f"{first_query} Core", "category": "General Development"}
                ]
            }

        if suggestion and "sub_projects" in suggestion:
            from app.state_store import adjust_past_due_dates, pace_and_schedule_goals, state_store
            suggestion["sub_projects"] = adjust_past_due_dates(suggestion["sub_projects"])
            profile = state_store.get_user_profile()
            profile["goals"] = [suggestion]
            profile = pace_and_schedule_goals(profile)
            suggestion = profile["goals"][0]

        return {
            "text": reply,
            "suggestedGoal": suggestion
        }


# Main execution
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
