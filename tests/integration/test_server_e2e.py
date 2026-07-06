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

import json
import logging
import os
import subprocess
import sys
import threading
import time
from collections.abc import Iterator
from typing import Any

import pytest
import requests
from requests.exceptions import RequestException

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

BASE_URL = "http://127.0.0.1:8000"
STREAM_URL = BASE_URL + "/run_sse"
FEEDBACK_URL = BASE_URL + "/feedback"

HEADERS = {"Content-Type": "application/json"}


def log_output(pipe: Any, log_func: Any) -> None:
    """Log the output from the given pipe."""
    for line in iter(pipe.readline, ""):
        log_func(line.strip())


def start_server() -> subprocess.Popen[str]:
    """Start the FastAPI server using subprocess and log its output."""
    command = [
        sys.executable,
        "-m",
        "uvicorn",
        "app.fast_api_app:app",
        "--host",
        "0.0.0.0",
        "--port",
        "8000",
    ]
    env = os.environ.copy()
    env["INTEGRATION_TEST"] = "TRUE"
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env=env,
    )

    # Start threads to log stdout and stderr in real-time
    threading.Thread(
        target=log_output, args=(process.stdout, logger.info), daemon=True
    ).start()
    threading.Thread(
        target=log_output, args=(process.stderr, logger.error), daemon=True
    ).start()

    return process


def wait_for_server(timeout: int = 90, interval: int = 1) -> bool:
    """Wait for the server to be ready."""
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            response = requests.get("http://127.0.0.1:8000/docs", timeout=10)
            if response.status_code == 200:
                logger.info("Server is ready")
                return True
        except RequestException:
            pass
        time.sleep(interval)
    logger.error(f"Server did not become ready within {timeout} seconds")
    return False


@pytest.fixture(scope="session")
def server_fixture(request: Any) -> Iterator[subprocess.Popen[str]]:
    """Pytest fixture to start and stop the server for testing."""
    logger.info("Starting server process")
    server_process = start_server()
    if not wait_for_server():
        pytest.fail("Server failed to start")
    logger.info("Server process started")

    def stop_server() -> None:
        logger.info("Stopping server process")
        server_process.terminate()
        server_process.wait()
        logger.info("Server process stopped")

    request.addfinalizer(stop_server)
    yield server_process


def test_chat_stream(server_fixture: subprocess.Popen[str]) -> None:
    """Test the chat stream functionality."""
    logger.info("Starting chat stream test")
    import os

    from app.state_store import state_store
    if os.path.exists(state_store.profile_path):
        try:
            os.remove(state_store.profile_path)
        except Exception:
            pass

    # Create session first
    user_id = "test_user_123"
    session_data = {"state": {"preferred_language": "English", "visit_count": 1}}

    session_url = f"{BASE_URL}/apps/app/users/{user_id}/sessions"
    session_response = requests.post(
        session_url,
        headers=HEADERS,
        json=session_data,
        timeout=60,
    )
    assert session_response.status_code == 200
    logger.info(f"Session creation response: {session_response.json()}")
    session_id = session_response.json()["id"]

    # Then send chat message
    data = {
        "app_name": "app",
        "user_id": user_id,
        "session_id": session_id,
        "new_message": {
            "role": "user",
            "parts": [{"text": "Hi!"}],
        },
        "streaming": True,
    }
    response = requests.post(
        STREAM_URL, headers=HEADERS, json=data, stream=True, timeout=60
    )
    assert response.status_code == 200

    # Parse SSE events from response
    events = []
    for line in response.iter_lines():
        if line:
            # SSE format is "data: {json}"
            line_str = line.decode("utf-8")
            if line_str.startswith("data: "):
                event_json = line_str[6:]  # Remove "data: " prefix
                event = json.loads(event_json)
                events.append(event)

    assert events, "No events received from stream"
    # Check for valid content in the response
    has_text_content = False
    for event in events:
        content = event.get("content")
        if (
            content is not None
            and content.get("parts")
            and any(part.get("text") for part in content["parts"])
        ):
            has_text_content = True
            break

    assert has_text_content, "Expected at least one event with text content"


def test_chat_stream_error_handling(server_fixture: subprocess.Popen[str]) -> None:
    """Test the chat stream error handling."""
    logger.info("Starting chat stream error handling test")
    data = {
        "input": {"messages": [{"type": "invalid_type", "content": "Cause an error"}]}
    }
    response = requests.post(
        STREAM_URL, headers=HEADERS, json=data, stream=True, timeout=10
    )

    assert response.status_code == 422, (
        f"Expected status code 422, got {response.status_code}"
    )
    logger.info("Error handling test completed successfully")


def test_collect_feedback(server_fixture: subprocess.Popen[str]) -> None:
    """
    Test the feedback collection endpoint (/feedback) to ensure it properly
    logs the received feedback.
    """
    # Create sample feedback data
    feedback_data = {
        "score": 4,
        "user_id": "test-user-456",
        "session_id": "test-session-456",
        "text": "Great response!",
    }

    response = requests.post(
        FEEDBACK_URL, json=feedback_data, headers=HEADERS, timeout=10
    )
    assert response.status_code == 200


def test_reset_endpoint(server_fixture: subprocess.Popen[str]) -> None:
    """
    Test that calling /api/reset resets the state store profile and work log.
    """
    # 1. Update the profile first
    profile_data = {
        "career_goals": "Advanced AI Architect",
        "hours_per_week": 8,
    }
    update_resp = requests.post(
        f"{BASE_URL}/api/profile", json=profile_data, headers=HEADERS, timeout=10
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["profile"]["career_goals"] == "Advanced AI Architect"

    # 2. Call the reset endpoint
    reset_resp = requests.post(f"{BASE_URL}/api/reset", headers=HEADERS, timeout=10)
    assert reset_resp.status_code == 200
    assert reset_resp.json()["status"] == "success"

    # 3. Verify the profile is cleared
    get_resp = requests.get(f"{BASE_URL}/api/profile", timeout=10)
    assert get_resp.status_code == 200
    # The profile should now be empty or not have the updated career_goals
    assert get_resp.json().get("career_goals") is None


def test_study_days_profile(server_fixture: subprocess.Popen[str]) -> None:
    """
    Test that updating the profile with study_days correctly saves and retrieves it.
    """
    # 1. Reset first
    requests.post(f"{BASE_URL}/api/reset", headers=HEADERS, timeout=10)

    # 2. Update with study_days
    profile_data = {
        "career_goals": "AI Specialist",
        "hours_per_week": 6,
        "study_days": ["Monday", "Wednesday", "Friday"]
    }
    update_resp = requests.post(
        f"{BASE_URL}/api/profile", json=profile_data, headers=HEADERS, timeout=10
    )
    assert update_resp.status_code == 200
    profile_res = update_resp.json()["profile"]
    assert profile_res["study_days"] == ["Monday", "Wednesday", "Friday"]
    assert "excluded_days" not in profile_res

    # 3. Retrieve and verify
    get_resp = requests.get(f"{BASE_URL}/api/profile", timeout=10)
    assert get_resp.status_code == 200
    assert get_resp.json()["study_days"] == ["Monday", "Wednesday", "Friday"]


def test_create_goal_with_skills(server_fixture: subprocess.Popen[str]) -> None:
    """
    Test that creating a goal with skills preserves the skills correctly.
    """
    # 1. Reset first
    requests.post(f"{BASE_URL}/api/reset", headers=HEADERS, timeout=10)

    # 2. Create goal with skills
    goal_data = {
        "title": "Master DAG Orchestration & MCP",
        "description": "Learn Google ADK agent modeling and tool callbacks.",
        "status": "to-do",
        "sub_projects": [
            {"title": "Define a 3-node workflow edge mapping", "completed": False, "dueDate": "2026-07-04"},
        ],
        "skills": [
            {"name": "DAG Orchestration", "category": "AI Engineering"},
            {"name": "Model Context Protocol (MCP)", "category": "AI Engineering"}
        ]
    }

    create_resp = requests.post(
        f"{BASE_URL}/api/goals", json=goal_data, headers=HEADERS, timeout=10
    )
    assert create_resp.status_code == 200
    goals = create_resp.json()["goals"]
    assert len(goals) == 1
    new_goal = goals[0]
    assert new_goal["title"] == "Master DAG Orchestration & MCP"
    assert len(new_goal["skills"]) == 2
    assert new_goal["skills"][0]["name"] == "DAG Orchestration"
    assert new_goal["skills"][1]["name"] == "Model Context Protocol (MCP)"

    # 3. Test updating goal skills
    goal_id = new_goal["id"]
    updated_skills = [
        {"name": "DAG Orchestration", "category": "AI Engineering"},
        {"name": "Model Context Protocol (MCP)", "category": "AI Engineering"},
        {"name": "Advanced Python", "category": "General"}
    ]
    update_resp = requests.put(
        f"{BASE_URL}/api/goals/{goal_id}",
        json={"skills": updated_skills},
        headers=HEADERS,
        timeout=10
    )
    assert update_resp.status_code == 200
    updated_goals = update_resp.json()["goals"]
    assert len(updated_goals) == 1
    updated_goal = updated_goals[0]
    assert len(updated_goal["skills"]) == 3
    assert updated_goal["skills"][2]["name"] == "Advanced Python"


def test_create_goal_and_re_stage_schedule(server_fixture: subprocess.Popen[str]) -> None:
    """
    Test that creating a goal and triggering staging on the backend
    correctly generates proposed events that are saved in the user profile.
    """
    # 1. Reset first
    requests.post(f"{BASE_URL}/api/reset", headers=HEADERS, timeout=10)

    # 2. Update profile onboarding preferences first
    profile_data = {
        "career_goals": "AI Engineer",
        "hours_per_week": 5,
        "study_days": ["Monday", "Wednesday", "Friday"],
    }
    profile_resp = requests.post(
        f"{BASE_URL}/api/profile", json=profile_data, headers=HEADERS, timeout=10
    )
    assert profile_resp.status_code == 200

    # 3. Create goal
    goal_data = {
        "title": "Master LangChain and ADK",
        "description": "Learn agents development",
        "status": "to-do",
    }
    create_resp = requests.post(
        f"{BASE_URL}/api/goals", json=goal_data, headers=HEADERS, timeout=10
    )
    assert create_resp.status_code == 200

    # 4. Trigger schedule staging via /run (similar to frontend trigger)
    # First create session
    user_id = "test_user_123"
    session_url = f"{BASE_URL}/apps/app/users/{user_id}/sessions"
    session_response = requests.post(
        session_url,
        headers=HEADERS,
        json={"state": {}},
        timeout=60,
    )
    assert session_response.status_code == 200
    session_id = session_response.json()["id"]

    run_payload = {
        "app_name": "app",
        "user_id": user_id,
        "session_id": session_id,
        "new_message": {
            "role": "user",
            "parts": [{"text": "Re-stage schedule with new goals."}],
        },
    }
    run_resp = requests.post(
        f"{BASE_URL}/run", json=run_payload, headers=HEADERS, timeout=60
    )
    assert run_resp.status_code == 200

    # 5. Fetch profile and verify that proposed_events are populated
    get_profile_resp = requests.get(f"{BASE_URL}/api/profile", timeout=10)
    assert get_profile_resp.status_code == 200
    profile = get_profile_resp.json()
    
    # Verify that proposed_events is list and contains elements
    assert "proposed_events" in profile
    assert isinstance(profile["proposed_events"], list)
    assert len(profile["proposed_events"]) > 0
    
    # Verify transaction metadata exists
    assert "transaction_id" in profile
    assert profile["transaction_id"] is not None
    assert "token" in profile
    assert profile["token"] is not None




