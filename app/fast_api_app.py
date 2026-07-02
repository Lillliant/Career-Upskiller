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
