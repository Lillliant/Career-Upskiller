"""Shared helpers for weekly schedule proposal and orchestration."""

from __future__ import annotations

import hashlib
import hmac
import os
import datetime
from typing import Any

SECRET_KEY = os.getenv("APPROVAL_SECRET_KEY", "super_secure_zero_trust_key")

PRIORITY_LABELS = {
    0: "Low urgency",
    1: "Medium urgency",
    2: "High urgency",
}

URGENCY_KEYWORDS_HIGH = (
    "critical", "urgent", "asap", "immediately", "top priority", "very important",
    "most important", "highest priority", "deadline soon", "time-sensitive",
)
URGENCY_KEYWORDS_LOW = (
    "low priority", "not urgent", "whenever", "no rush", "eventually",
    "nice to have", "optional", "back burner", "low urgency",
)


def normalize_priority(value: Any) -> int:
    """Clamp priority to 0 (least urgent) through 2 (most urgent). Default 1."""
    try:
        p = int(value)
    except (TypeError, ValueError):
        return 1
    return max(0, min(2, p))


def get_goal_priority(goal: dict[str, Any]) -> int:
    return normalize_priority(goal.get("priority", 1))


def priority_label(priority: int) -> str:
    return PRIORITY_LABELS.get(normalize_priority(priority), PRIORITY_LABELS[1])


def infer_priority_from_messages(messages: list[dict[str, Any]]) -> int:
    """Infer project priority from user chat history. Defaults to 1 (medium)."""
    user_text = " ".join(
        m.get("text", "") for m in messages if m.get("role") == "user"
    ).lower()
    if not user_text.strip():
        return 1
    if any(kw in user_text for kw in URGENCY_KEYWORDS_HIGH):
        return 2
    if any(kw in user_text for kw in URGENCY_KEYWORDS_LOW):
        return 0
    if any(kw in user_text for kw in ("important", "priority", "urgent", "soon")):
        return 2
    return 1


def parse_estimated_hours(est_str: str | None) -> float:
    return parse_duration(est_str) / 60.0


def task_remaining_hours(task: dict[str, Any]) -> float:
    est_hours = parse_estimated_hours(task.get("estimated_time"))
    allocated_hours = task.get("allocated_time_mins", 0) / 60.0
    return max(0.0, est_hours - allocated_hours)


def collect_active_work_items(goals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collect incomplete milestones/tasks in sequential order per goal."""
    items: list[dict[str, Any]] = []
    for g in goals:
        if g.get("status") not in ("to-do", "in-progress"):
            continue
        goal_priority = get_goal_priority(g)
        for m_idx, m in enumerate(g.get("sub_projects", [])):
            tasks = m.get("tasks", [])
            if tasks:
                for t_idx, t in enumerate(tasks):
                    if t.get("completed"):
                        continue
                    remaining = task_remaining_hours(t)
                    if remaining <= 0:
                        continue
                    items.append({
                        "goal": g,
                        "milestone": m,
                        "task": t,
                        "goal_priority": goal_priority,
                        "milestone_idx": m_idx,
                        "task_idx": t_idx,
                    })
            elif not m.get("completed"):
                items.append({
                    "goal": g,
                    "milestone": m,
                    "task": None,
                    "goal_priority": goal_priority,
                    "milestone_idx": m_idx,
                    "task_idx": 0,
                    "flat_milestone_hours": 3.0,
                })
    return items


def total_remaining_hours(goals: list[dict[str, Any]]) -> float:
    total = 0.0
    for item in collect_active_work_items(goals):
        if item.get("task"):
            total += task_remaining_hours(item["task"])
        else:
            total += item.get("flat_milestone_hours", 3.0)
    return total


def get_sequential_schedulable_tasks(
    goals: list[dict[str, Any]],
    *,
    week_start: datetime.date,
    week_end: datetime.date,
) -> list[dict[str, Any]]:
    """Return the next schedulable task per goal/milestone chain, due within the week."""
    schedulable: list[dict[str, Any]] = []
    for g in goals:
        if g.get("status") not in ("to-do", "in-progress"):
            continue
        goal_priority = get_goal_priority(g)
        sub_projects = g.get("sub_projects", [])
        if not sub_projects:
            continue

        for m_idx, m in enumerate(sub_projects):
            if m.get("completed"):
                continue
            tasks = m.get("tasks", [])
            if tasks:
                current_task_found = False
                for t_idx, t in enumerate(tasks):
                    if t.get("completed"):
                        continue
                    remaining_mins = parse_duration(t.get("estimated_time")) - t.get("allocated_time_mins", 0)
                    if remaining_mins <= 0:
                        continue
                    current_task_found = True
                    due_str = t.get("dueDate")
                    if not due_str:
                        break
                    try:
                        due_date = datetime.date.fromisoformat(due_str)
                    except ValueError:
                        break
                    if week_start <= due_date <= week_end:
                        schedulable.append({
                            "task": t,
                            "milestone": m,
                            "goal": g,
                            "goal_priority": goal_priority,
                            "milestone_idx": m_idx,
                            "task_idx": t_idx,
                            "is_fallback": False,
                        })
                    break
                if current_task_found:
                    break
            else:
                due_str = m.get("dueDate")
                if not due_str:
                    break
                try:
                    due_date = datetime.date.fromisoformat(due_str)
                except ValueError:
                    break
                if week_start <= due_date <= week_end:
                    schedulable.append({
                        "task": {
                            "title": m.get("title"),
                            "description": m.get("description", f"Milestone: {m.get('title')}"),
                            "estimated_time": "1 hour",
                            "dueDate": m.get("dueDate"),
                            "completed": False,
                            "allocated_time_mins": 0,
                        },
                        "milestone": m,
                        "goal": g,
                        "goal_priority": goal_priority,
                        "milestone_idx": m_idx,
                        "task_idx": 0,
                        "is_fallback": True,
                    })
                break
    return schedulable


def sort_tasks_for_scheduling(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Order tasks by due date, priority (high first), then milestone/task sequence."""

    def sort_key(item: dict[str, Any]) -> tuple:
        due_str = item["task"].get("dueDate")
        try:
            due_date = datetime.date.fromisoformat(due_str) if due_str else datetime.date.max
        except ValueError:
            due_date = datetime.date.max
        priority = item.get("goal_priority", get_goal_priority(item["goal"]))
        return (
            due_date,
            -priority,
            item.get("milestone_idx", 0),
            item.get("task_idx", 0),
        )

    return sorted(items, key=sort_key)


def event_displacement_key(
    event: dict[str, Any],
    goals: list[dict[str, Any]],
) -> tuple:
    """Lower sort key = more disposable when displacing calendar events."""
    due_date_str = find_task_due_date_for_event(event, goals)
    try:
        due_date = datetime.date.fromisoformat(due_date_str) if due_date_str else datetime.date.max
    except ValueError:
        due_date = datetime.date.max

    goal_priority = 1
    summary = event.get("summary", "")
    goal_title = ""
    if " - " in summary:
        parts = summary.split(" - ", 1)
        goal_title = parts[0].replace("Learning: ", "").replace("Micro-learning: ", "").strip()
    elif summary.startswith("Learning: "):
        goal_title = summary[len("Learning: "):].strip()
    for g in goals:
        if g.get("title") == goal_title:
            goal_priority = get_goal_priority(g)
            break

    return (due_date, goal_priority)


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


def is_agent_learning_summary(summary: str) -> bool:
    """True when a calendar summary was written by the upskilling scheduler."""
    return summary.startswith("Learning:") or summary.startswith("Micro-learning:")


def event_start_date(event: dict[str, Any]) -> datetime.date | None:
    """Extract the calendar date from an event start timestamp."""
    start_str = event.get("start")
    if not start_str:
        return None
    try:
        return datetime.datetime.fromisoformat(start_str.replace("Z", "+00:00")).date()
    except Exception:
        return start_str[:10] if len(start_str) >= 10 else None


def event_on_date(event: dict[str, Any], target_date: datetime.date) -> bool:
    """True when an event's start falls on the target calendar day."""
    evt_date = event_start_date(event)
    if evt_date == target_date:
        return True
    start = event.get("start", "")
    return bool(start and start.startswith(target_date.isoformat()))


def _collect_day_learning_events(
    target_date: datetime.date,
    scheduled_events: list[dict[str, Any]],
    work_log: list[dict[str, Any]],
) -> tuple[set[str], set[str]]:
    """Return local event ids and Google event ids for learning blocks on a day."""
    removed_ids: set[str] = set()
    google_ids: set[str] = set()

    def register(event: dict[str, Any]) -> None:
        if not event_on_date(event, target_date):
            return
        if not is_agent_learning_summary(event.get("summary", "")):
            return
        if event.get("id"):
            removed_ids.add(event["id"])
        google_id = event.get("google_event_id")
        if google_id:
            google_ids.add(google_id)

    for evt in scheduled_events:
        register(evt)

    for log in work_log:
        if log.get("action") != "scheduled":
            continue
        for evt in log.get("events", []):
            register(evt)

    return removed_ids, google_ids


def _prune_work_log_for_day(
    work_log: list[dict[str, Any]],
    target_date: datetime.date,
    removed_ids: set[str],
) -> list[dict[str, Any]]:
    """Drop scheduled work-log events cleared for the target day."""
    pruned: list[dict[str, Any]] = []
    for log in work_log:
        if log.get("action") == "scheduled" and log.get("events"):
            kept = [
                evt
                for evt in log["events"]
                if not event_on_date(evt, target_date) and evt.get("id") not in removed_ids
            ]
            if kept:
                pruned.append({**log, "events": kept})
        else:
            pruned.append(log)
    return pruned


def clear_learning_events_for_day(date_str: str) -> dict[str, Any]:
    """Delete managed learning blocks on a day from Google Calendar, profile, and work log."""
    from app.mcp_clients import delete_calendar_event
    from app.state_store import state_store, update_tasks_allocated_time

    try:
        target_date = datetime.date.fromisoformat(date_str)
    except ValueError:
        return {"status": "error", "message": f"Invalid date: {date_str}"}

    profile = state_store.get_user_profile()
    scheduled_events = profile.get("scheduled_events", [])
    work_log = state_store.get_work_log()

    removed_ids, google_ids_to_delete = _collect_day_learning_events(
        target_date, scheduled_events, work_log
    )
    deleted_google_ids: set[str] = set()

    for google_id in google_ids_to_delete:
        delete_calendar_event(google_id)
        deleted_google_ids.add(google_id)

    profile["scheduled_events"] = [
        evt
        for evt in scheduled_events
        if evt.get("id") not in removed_ids and not event_on_date(evt, target_date)
    ]
    update_tasks_allocated_time(profile)
    state_store.update_user_profile(profile)
    state_store.set_work_log(_prune_work_log_for_day(work_log, target_date, removed_ids))

    return {
        "status": "success",
        "deleted_count": len(deleted_google_ids),
        "removed_from_state": len(removed_ids),
        "date": date_str,
    }


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
