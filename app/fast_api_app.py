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
import os

import google.auth
from fastapi import FastAPI
from google.adk.cli.fast_api import get_fast_api_app
from google.cloud import logging as google_cloud_logging

from app.app_utils.telemetry import setup_telemetry
from app.app_utils.typing import Feedback
from pydantic import BaseModel
from typing import Any, Optional
from fastapi import HTTPException
from app.state_store import state_store
from app.app_utils.ical_parser import parse_ical
from app.mcp_clients import get_calendar_free_busy
from app.skills.reflection_loop import process_user_reflection

# Request schemas for new endpoints
class ProfileUpdate(BaseModel):
    career_goals: Optional[str] = None
    hours_per_week: Optional[int] = None
    preferred_start_time: Optional[str] = None
    preferred_end_time: Optional[str] = None
    excluded_days: Optional[list[str]] = None
    target_calendars: Optional[list[dict[str, Any]]] = None

class GoalCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    status: Optional[str] = "to-do"
    sub_projects: Optional[list[dict[str, Any]]] = None

class GoalUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    sub_projects: Optional[list[dict[str, Any]]] = None
    time_spent_mins: Optional[int] = None
    conversations: Optional[list[dict[str, Any]]] = None

class ReflectionSubmit(BaseModel):
    learning_block_id: Optional[str] = "generic"
    reflection_text: str
    success_rating: int  # 1-5

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
    os.getenv("ALLOW_ORIGINS", "").split(",") if os.getenv("ALLOW_ORIGINS") else None
)

# Artifact bucket for ADK (created by Terraform, passed via env var)
logs_bucket_name = os.environ.get("LOGS_BUCKET_NAME")

AGENT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
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

@app.get("/api/calendar/events")
def get_calendar_events():
    profile = state_store.get_user_profile()
    events = []
    
    # 1. Fetch external meetings (read-only/display) from Google Calendar or Mock Calendar
    # Respect isolation: only pull if the calendar is selected and NOT isolated
    target_calendars = profile.get("target_calendars", [])
    google_allowed = any(c.get("id") == "cal-work" and c.get("selected") for c in target_calendars)
    
    if google_allowed:
        # Load mock events
        mcp_events = get_calendar_free_busy("2026-07-02T00:00:00Z", "2026-07-02T23:59:59Z")
        for evt in mcp_events:
            events.append({
                "summary": evt.get("summary", "Busy"),
                "start": evt.get("start"),
                "end": evt.get("end"),
                "type": "external",
                "color": "#475569" # Gray for external read-only
            })
            
    # 2. Fetch external iCal subscription events
    for cal in target_calendars:
        if cal.get("selected") and cal.get("type") == "ical" and cal.get("url"):
            ical_events = parse_ical(cal["url"])
            for evt in ical_events:
                events.append({
                    "summary": evt.get("summary", "iCal Event"),
                    "start": evt.get("start"),
                    "end": evt.get("end"),
                    "type": "external",
                    "color": "#475569"
                })
                
    # 3. Fetch scheduled upskilling blocks (from profile or work_log)
    scheduled_blocks = profile.get("scheduled_events", [])
    # Also fetch from work_log as fallback/sync
    logs = state_store.get_work_log()
    for log in logs:
        if log.get("action") == "scheduled" and log.get("events"):
            for evt in log["events"]:
                if not any(e.get("start") == evt.get("start") and e.get("summary") == evt.get("summary") for e in scheduled_blocks):
                    scheduled_blocks.append(evt)
                    
    for block in scheduled_blocks:
        events.append({
            "id": block.get("id"),
            "summary": block.get("summary"),
            "start": block.get("start"),
            "end": block.get("end"),
            "description": block.get("description"),
            "type": "learning",
            "color": "#6366f1" # Indigo/violet for learning blocks
        })
        
    return events

@app.post("/api/goals/{goal_id}/reflect")
def reflect_on_goal(goal_id: str, reflection: ReflectionSubmit):
    profile = state_store.get_user_profile()
    if not profile:
        raise HTTPException(status_code=400, detail="Profile not onboarded.")
        
    result = process_user_reflection(
        user_id="test_user_123",
        learning_block_id=reflection.learning_block_id,
        reflection_text=reflection.reflection_text,
        success_rating=reflection.success_rating
    )
    
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
                "rating": reflection.success_rating,
                "timestamp": timestamp
            })
            
            adj_reason = result["updated_profile"].get("adjustment_reason", "Goal adjusted.")
            feedback = f"Thank you for sharing your reflection. Success rating: {reflection.success_rating}/5. {adj_reason}"
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


# Main execution
if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
