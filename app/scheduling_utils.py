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

SCHEDULABLE_GOAL_STATUSES = ("to-do", "in-progress")
NEAR_TERM_PRIORITY_THRESHOLD = 1  # priority >= this counts toward the planning horizon
DEFAULT_HORIZON_WEEKS = 8


def get_sunday_week_start(
    reference_date: datetime.date | None = None,
    *,
    week_offset: int = 0,
) -> datetime.date:
    """Return the Sunday that starts the week containing reference_date, shifted by week_offset."""
    if reference_date is None:
        reference_date = datetime.date.today()
    days_since_sunday = (reference_date.weekday() + 1) % 7
    return reference_date - datetime.timedelta(days=days_since_sunday) + datetime.timedelta(
        weeks=week_offset
    )

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


def is_schedulable_goal(goal: dict[str, Any]) -> bool:
    return goal.get("status") in SCHEDULABLE_GOAL_STATUSES


def is_on_hold_goal(goal: dict[str, Any]) -> bool:
    return goal.get("status") == "on-hold"


def schedulable_goals(goals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [g for g in goals if is_schedulable_goal(g)]


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


def collect_active_work_items(
    goals: list[dict[str, Any]],
    *,
    min_priority: int | None = None,
    statuses: tuple[str, ...] | None = SCHEDULABLE_GOAL_STATUSES,
) -> list[dict[str, Any]]:
    """Collect incomplete milestones/tasks in sequential order per goal."""
    items: list[dict[str, Any]] = []
    for g in goals:
        if statuses is not None and g.get("status") not in statuses:
            continue
        goal_priority = get_goal_priority(g)
        if min_priority is not None and goal_priority < min_priority:
            continue
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


def total_remaining_hours(
    goals: list[dict[str, Any]],
    *,
    min_priority: int | None = None,
    statuses: tuple[str, ...] | None = SCHEDULABLE_GOAL_STATUSES,
) -> float:
    total = 0.0
    for item in collect_active_work_items(
        goals, min_priority=min_priority, statuses=statuses
    ):
        if item.get("task"):
            total += task_remaining_hours(item["task"])
        else:
            total += item.get("flat_milestone_hours", 3.0)
    return total


def _item_due_date(
    item: dict[str, Any],
    *,
    reference_date: datetime.date,
) -> datetime.date | None:
    """Return the due date for a work item, or None if unset."""
    task = item.get("task")
    due_str = task.get("dueDate") if task else item["milestone"].get("dueDate")
    if not due_str:
        return None
    try:
        return datetime.date.fromisoformat(due_str)
    except ValueError:
        return reference_date


def hours_due_within_horizon(
    goals: list[dict[str, Any]],
    *,
    horizon_weeks: int = DEFAULT_HORIZON_WEEKS,
    reference_date: datetime.date | None = None,
    statuses: tuple[str, ...] | None = SCHEDULABLE_GOAL_STATUSES,
) -> float:
    """Sum remaining hours for incomplete work due on or before the planning horizon."""
    today = reference_date or datetime.date.today()
    horizon_end = today + datetime.timedelta(weeks=horizon_weeks)
    total = 0.0
    for item in collect_active_work_items(goals, statuses=statuses):
        due_date = _item_due_date(item, reference_date=today)
        if due_date is not None and due_date > horizon_end:
            continue
        if item.get("task"):
            total += task_remaining_hours(item["task"])
        else:
            total += item.get("flat_milestone_hours", 3.0)
    return total


def has_past_due_incomplete_work(
    goals: list[dict[str, Any]],
    *,
    reference_date: datetime.date | None = None,
) -> bool:
    """True when any schedulable goal has incomplete milestones/tasks due before today."""
    today = reference_date or datetime.date.today()
    for item in collect_active_work_items(goals):
        due_date = _item_due_date(item, reference_date=today)
        if due_date is not None and due_date < today:
            return True
    return False


def compute_schedule_capacity(
    profile: dict[str, Any],
    *,
    horizon_weeks: int = DEFAULT_HORIZON_WEEKS,
) -> dict[str, Any]:
    """Summarize workload vs the planning horizon (default 8 weeks)."""
    goals = profile.get("goals", [])
    hours_per_week = profile.get("hours_per_week", 5) or 5

    horizon_hours = hours_due_within_horizon(goals, horizon_weeks=horizon_weeks)
    horizon_capacity = hours_per_week * horizon_weeks

    near_term_hours = total_remaining_hours(
        goals, min_priority=NEAR_TERM_PRIORITY_THRESHOLD
    )
    low_priority_hours = total_remaining_hours(goals, min_priority=0) - near_term_hours
    low_priority_hours = max(0.0, low_priority_hours)
    on_hold_hours = total_remaining_hours(
        goals, statuses=("on-hold",)
    )
    portfolio_hours = total_remaining_hours(goals)

    weeks_needed = (
        horizon_hours / hours_per_week if hours_per_week > 0 else float("inf")
    )
    suggested_hours = (
        horizon_hours / horizon_weeks if horizon_weeks > 0 else hours_per_week
    )
    suggested_hours_per_week = max(hours_per_week, round(suggested_hours + 0.4, 1))

    warning = None
    warning_type = None
    if horizon_hours > 0 and horizon_hours > horizon_capacity:
        warning_type = "horizon_overload"
        warning = (
            f"Tasks due in the next {horizon_weeks} weeks need about {horizon_hours:.1f} hours, "
            f"which exceeds your {horizon_weeks}-week allocation ({horizon_capacity:.0f} hrs at "
            f"{hours_per_week} hrs/week). Pause lower-priority projects, rebalance due dates, "
            f"or increase weekly study hours to at least {suggested_hours_per_week:.1f} hrs/week."
        )
    elif portfolio_hours > 0 and (portfolio_hours / hours_per_week) > horizon_weeks:
        warning_type = "portfolio_info"
        warning = (
            f"Your full portfolio needs about {portfolio_hours:.1f} hours "
            f"({portfolio_hours / hours_per_week:.1f} weeks at {hours_per_week} hrs/week). "
            f"Lower-priority work is scheduled after urgent projects complete."
        )

    deferred_note = None
    if low_priority_hours > 0 and warning_type != "horizon_overload":
        deferred_note = (
            f"{low_priority_hours:.1f} hours of low-priority work will start after "
            f"urgent projects finish."
        )

    return {
        "horizon_hours": horizon_hours,
        "horizon_capacity": horizon_capacity,
        "near_term_hours": near_term_hours,
        "low_priority_hours": low_priority_hours,
        "on_hold_hours": on_hold_hours,
        "portfolio_hours": portfolio_hours,
        "hours_per_week": hours_per_week,
        "horizon_weeks": horizon_weeks,
        "weeks_needed": weeks_needed,
        "suggested_hours_per_week": suggested_hours_per_week,
        "warning": warning,
        "warning_type": warning_type,
        "deferred_note": deferred_note,
    }


def get_sequential_schedulable_tasks(
    goals: list[dict[str, Any]],
    *,
    week_start: datetime.date,
    week_end: datetime.date,
) -> list[dict[str, Any]]:
    """Return the next schedulable task per goal/milestone chain, due within the week."""
    schedulable: list[dict[str, Any]] = []
    for g in goals:
        if not is_schedulable_goal(g):
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


def scheduled_mins_in_week(
    scheduled_events: list[dict[str, Any]],
    *,
    week_start: datetime.date,
    week_end: datetime.date,
) -> int:
    """Sum minutes of scheduled learning events that fall within the week window."""
    total = 0
    for event in scheduled_events:
        start_str = event.get("start")
        end_str = event.get("end")
        if not start_str or not end_str:
            continue
        try:
            start_dt = datetime.datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            end_dt = datetime.datetime.fromisoformat(end_str.replace("Z", "+00:00"))
            event_date = start_dt.date()
            if week_start <= event_date <= week_end:
                total += int((end_dt - start_dt).total_seconds() / 60)
        except Exception:
            pass
    return total


def explain_no_schedulable_tasks(
    goals: list[dict[str, Any]],
    *,
    week_start: datetime.date,
    week_end: datetime.date,
    hours_per_week: float,
    scheduled_events: list[dict[str, Any]] | None = None,
) -> str:
    """Explain why no tasks were eligible for this week's schedule proposal."""
    active = collect_active_work_items(goals)
    if not active:
        return (
            "No active tasks found across your projects. "
            "Add milestones or tasks before scheduling."
        )

    weekly_budget_mins = int((hours_per_week or 5) * 60)
    scheduled_mins = scheduled_mins_in_week(
        scheduled_events or [],
        week_start=week_start,
        week_end=week_end,
    )
    if scheduled_mins >= weekly_budget_mins:
        hours = weekly_budget_mins / 60
        return (
            f"Your weekly study budget ({hours:g} hrs) is already allocated for the week of "
            f"{week_start.isoformat()}. Existing calendar blocks cover this week's learning time."
        )

    due_this_week: list[tuple[datetime.date, int]] = []
    for item in active:
        task = item["task"]
        due_str = task.get("dueDate")
        if not due_str:
            continue
        try:
            due_date = datetime.date.fromisoformat(due_str)
        except ValueError:
            continue
        if week_start <= due_date <= week_end:
            remaining_mins = parse_duration(task.get("estimated_time")) - task.get(
                "allocated_time_mins", 0
            )
            due_this_week.append((due_date, remaining_mins))

    if due_this_week and all(remaining <= 0 for _, remaining in due_this_week):
        return (
            f"Tasks due this week (through {week_end.isoformat()}) are already fully scheduled. "
            "Increase your weekly study hours or wait for next week's tasks to become due."
        )

    next_due: datetime.date | None = None
    for item in active:
        task = item["task"]
        due_str = task.get("dueDate")
        if not due_str:
            continue
        try:
            due_date = datetime.date.fromisoformat(due_str)
        except ValueError:
            continue
        if due_date > week_end and (next_due is None or due_date < next_due):
            next_due = due_date

    if next_due:
        return (
            f"No tasks are due this week (through {week_end.isoformat()}). "
            f"Your next task is due {next_due.isoformat()}."
        )

    return (
        "No tasks are due this week. Check due dates on your milestones and tasks, "
        "or add new work before scheduling."
    )


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
