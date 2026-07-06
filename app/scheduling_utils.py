"""Shared helpers for weekly schedule proposal and orchestration."""

from __future__ import annotations

import hashlib
import hmac
import os
import datetime
from typing import Any

SECRET_KEY = os.getenv("APPROVAL_SECRET_KEY", "super_secure_zero_trust_key")


def generate_signature(transaction_id: str) -> str:
    """Generates a cryptographic signature/token for stateful confirmation."""
    return hmac.new(
        SECRET_KEY.encode(), transaction_id.encode(), hashlib.sha256
    ).hexdigest()


def parse_duration(est_str: str | None) -> int:
    """Parse a duration string and return minutes. Defaults to 60 minutes."""
    if not est_str:
        return 60
    est_str = str(est_str).lower().strip()
    try:
        parts = est_str.split()
        if not parts:
            return 60
        val = float(parts[0])
        if "hour" in est_str:
            return int(val * 60)
        if "min" in est_str:
            return int(val)
        return 60
    except Exception:
        return 60


def find_task_due_date_for_event(event: dict[str, Any], goals: list[dict[str, Any]]) -> str | None:
    """Find the due date of a task associated with a calendar event."""
    summary = event.get("summary", "")
    goal_title = ""
    task_title = ""
    if " - " in summary:
        parts = summary.split(" - ", 1)
        if parts[0].startswith("Learning: "):
            goal_title = parts[0][len("Learning: "):].strip()
        else:
            goal_title = parts[0].strip()
        task_title = parts[1].strip()
    elif summary.startswith("Learning: "):
        goal_title = summary[len("Learning: "):].strip()

    for g in goals:
        if g.get("title") == goal_title:
            if task_title:
                for m in g.get("sub_projects", []):
                    for t in m.get("tasks", []):
                        if t.get("title") == task_title:
                            return t.get("dueDate")
            else:
                for m in g.get("sub_projects", []):
                    if not m.get("completed"):
                        return m.get("dueDate")
                return g.get("dueDate")
    return None
