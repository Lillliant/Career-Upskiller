"""Build weekly learning-block proposals from project task due dates."""

from __future__ import annotations

import datetime
import uuid
from typing import Any

from app.mcp_clients import get_calendar_free_busy
from app.scheduling_utils import (
    event_displacement_key,
    explain_no_schedulable_tasks,
    find_task_due_date_for_event,
    generate_signature,
    get_goal_priority,
    get_sequential_schedulable_tasks,
    get_sunday_week_start,
    is_schedulable_goal,
    parse_duration,
    sort_tasks_for_scheduling,
)
from app.state_store import state_store, update_tasks_allocated_time

MAX_BLOCK_MINS = 120  # Each learning block is at most 2 hours


def _split_budget_across_days(total_mins: int, num_days: int) -> list[int]:
    """Split weekly minutes evenly across study days (15-minute granularity)."""
    if num_days <= 0:
        return []
    total_mins = max(0, int(total_mins))
    base = (total_mins // num_days // 15) * 15
    remainder = total_mins - base * num_days
    targets = [base] * num_days
    idx = 0
    while remainder >= 15:
        targets[idx % num_days] += 15
        remainder -= 15
        idx += 1
    return targets


def _mins_scheduled_on_day(proposed_blocks: list[dict[str, Any]], day_str: str) -> int:
    total = 0
    for block in proposed_blocks:
        if not block.get("start", "").startswith(day_str):
            continue
        try:
            start = datetime.datetime.fromisoformat(block["start"])
            end = datetime.datetime.fromisoformat(block["end"])
            total += int((end - start).total_seconds() / 60)
        except Exception:
            pass
    return total


def _task_alloc_key(item: dict[str, Any]) -> str:
    goal = item["goal"]
    task = item["task"]
    return f"{goal.get('id', goal.get('title'))}:{task.get('title')}"


def _task_remaining_mins(item: dict[str, Any], proposed_allocations: dict[str, int]) -> int:
    task = item["task"]
    key = _task_alloc_key(item)
    est_mins = parse_duration(task.get("estimated_time"))
    allocated_mins = task.get("allocated_time_mins", 0) + proposed_allocations.get(key, 0)
    return max(0, est_mins - allocated_mins)


def _compute_adjusted_duration_mins(
    base_duration_mins: int,
    remaining_tasks_base: int,
    weekly_remaining_budget_mins: float,
) -> int:
    if weekly_remaining_budget_mins > 0 and remaining_tasks_base > 0:
        ratio = weekly_remaining_budget_mins / remaining_tasks_base
        adjusted = base_duration_mins if ratio >= 1.0 else base_duration_mins * ratio
    else:
        adjusted = base_duration_mins
    adjusted = round(adjusted / 15) * 15
    return int(max(30, min(adjusted, weekly_remaining_budget_mins, MAX_BLOCK_MINS)))


def _build_day_slot_status(
    *,
    current_day_str: str,
    start_minutes: int,
    end_minutes: int,
    day_busy_slots: list[tuple[int, int]],
    proposed_blocks: list[dict[str, Any]],
) -> tuple[list[bool], int]:
    total_slots = int((end_minutes - start_minutes) / 15)
    slot_status = [True] * total_slots
    for busy_start, busy_end in day_busy_slots:
        s_idx = max(0, int((busy_start - start_minutes) / 15))
        e_idx = min(total_slots, int((busy_end - start_minutes) / 15))
        for idx in range(s_idx, e_idx):
            slot_status[idx] = False
    for block in proposed_blocks:
        if not block.get("start", "").startswith(current_day_str):
            continue
        try:
            shour, smin = map(int, block["start"][11:16].split(":"))
            ehour, emin = map(int, block["end"][11:16].split(":"))
            s_idx = max(0, int((shour * 60 + smin - start_minutes) / 15))
            e_idx = min(total_slots, int((ehour * 60 + emin - start_minutes) / 15))
            for idx in range(s_idx, e_idx):
                slot_status[idx] = False
        except Exception:
            pass
    return slot_status, total_slots


def _try_schedule_block(
    *,
    slot_status: list[bool],
    total_slots: int,
    start_minutes: int,
    current_day_str: str,
    target_slots_needed: int,
    now_local: datetime.datetime,
) -> tuple[bool, int, int]:
    """Return (scheduled, slot_start_index, actual_duration_mins)."""
    for current_target in range(target_slots_needed, 1, -1):
        actual_duration = current_target * 15
        for i in range(total_slots - current_target + 1):
            if not all(slot_status[i + j] for j in range(current_target)):
                continue
            s_mins = start_minutes + i * 15
            e_mins = s_mins + actual_duration
            s_hour, s_min = divmod(s_mins, 60)
            e_hour, e_min = divmod(e_mins, 60)
            proposed_start_str = f"{current_day_str}T{s_hour:02d}:{s_min:02d}:00-04:00"
            try:
                proposed_start_dt = datetime.datetime.fromisoformat(proposed_start_str)
                if proposed_start_dt < now_local:
                    continue
            except Exception:
                pass
            return True, i, actual_duration
    return False, -1, 0


def _day_has_future_slots(
    *,
    current_day_str: str,
    start_minutes: int,
    end_minutes: int,
    day_busy_slots: list[tuple[int, int]],
    proposed_blocks: list[dict[str, Any]],
    now_local: datetime.datetime,
) -> bool:
    slot_status, total_slots = _build_day_slot_status(
        current_day_str=current_day_str,
        start_minutes=start_minutes,
        end_minutes=end_minutes,
        day_busy_slots=day_busy_slots,
        proposed_blocks=proposed_blocks,
    )
    for i in range(total_slots):
        if not slot_status[i]:
            continue
        slot_start_mins = start_minutes + i * 15
        s_hour, s_min = divmod(slot_start_mins, 60)
        proposed_start_str = f"{current_day_str}T{s_hour:02d}:{s_min:02d}:00-04:00"
        try:
            proposed_start_dt = datetime.datetime.fromisoformat(proposed_start_str)
            if proposed_start_dt >= now_local:
                return True
        except Exception:
            return True
    return False


def _collect_day_busy_slots(
    *,
    current_day_str: str,
    mcp_busy: list[dict[str, Any]],
    events_to_delete: list[dict[str, Any]],
) -> list[tuple[int, int]]:
    to_delete_ids = {evt.get("google_event_id") for evt in events_to_delete if evt.get("google_event_id")}
    day_busy_slots: list[tuple[int, int]] = []
    for evt in mcp_busy:
        if evt.get("id") in to_delete_ids:
            continue
        evt_start = evt.get("start", "")
        evt_end = evt.get("end", "")
        if evt_start.startswith(current_day_str):
            try:
                shour, smin = map(int, evt_start[11:16].split(":"))
                ehour, emin = map(int, evt_end[11:16].split(":"))
                day_busy_slots.append((shour * 60 + smin, ehour * 60 + emin))
            except Exception:
                pass
    return day_busy_slots


def _append_proposed_block(
    *,
    proposed_blocks: list[dict[str, Any]],
    current_day_str: str,
    start_minutes: int,
    slot_start: int,
    actual_duration: int,
    goal: dict[str, Any],
    task: dict[str, Any],
    milestone: dict[str, Any],
) -> dict[str, Any]:
    s_mins = start_minutes + slot_start * 15
    e_mins = s_mins + actual_duration
    s_hour, s_min = divmod(s_mins, 60)
    e_hour, e_min = divmod(e_mins, 60)
    proposed_start_str = f"{current_day_str}T{s_hour:02d}:{s_min:02d}:00-04:00"
    block = {
        "id": f"evt-{uuid.uuid4().hex[:6]}",
        "summary": f"Learning: {goal.get('title')} - {task.get('title')}",
        "start": proposed_start_str,
        "end": f"{current_day_str}T{e_hour:02d}:{e_min:02d}:00-04:00",
        "description": (
            f"Task: {task.get('title')}\nMilestone: {milestone.get('title')}\n"
            f"Project: {goal.get('title')}\n\nDescription: {task.get('description', '')}"
        ),
    }
    proposed_blocks.append(block)
    return block


def build_weekly_schedule_proposal(
    profile: dict[str, Any] | None = None,
    *,
    week_offset: int = 0,
) -> dict[str, Any]:
    """Stage proposed learning blocks for the selected week, prioritized by task due dates.
    
    ALGORITHM & DESIGN BEHAVIOR:
    1. Budget Allocation: Splits the user's weekly study hour budget across available study days.
    2. Prioritization & Sorting: Retrieves uncompleted tasks. Priority is given to due dates, 
       then goal urgency (High -> Medium -> Low), and finally sequential project task order.
    3. Calendar Intersect (MCP/iCal): Fetches busy slots from Google Calendar (via Calendar MCP client)
       and public iCal feeds to detect availability conflicts.
    4. Time Scarcity & Graceful Degradation: If calendar density is high, we degrade task durations
       (down to 30-minute micro-learning blocks) to fit slots without failing.
    5. Prioritized Displacement: If slots are still full, the system attempts to displace existing, 
       less-urgent scheduled learning events with more-urgent tasks.
    6. Staging & Transaction ID: Generates a stateful transaction ID and an HMAC validation token
       to enforce Zero-Trust calendar writing.
    """
    if profile is None:
        profile = state_store.get_user_profile()
    if not profile:
        profile = {"career_goals": "AI Engineering", "hours_per_week": 5}

    update_tasks_allocated_time(profile)

    weekly_hours = profile.get("hours_per_week", 5)
    study_days = profile.get("study_days", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"])

    work_start_str = profile.get("preferred_start_time", "09:00")
    work_end_str = profile.get("preferred_end_time", "17:00")
    try:
        sh, sm = map(int, work_start_str.split(":"))
        eh, em = map(int, work_end_str.split(":"))
    except Exception:
        sh, sm = 9, 0
        eh, em = 17, 0

    start_minutes = sh * 60 + sm
    end_minutes = eh * 60 + em
    today = max(datetime.date.today(), datetime.date(2026, 7, 2))
    week_start = get_sunday_week_start(today, week_offset=week_offset)
    week_end = week_start + datetime.timedelta(days=6)
    allow_past_slots = week_start > today
    goals = profile.get("goals", [])

    uncompleted_tasks = get_sequential_schedulable_tasks(
        goals, week_start=week_start, week_end=week_end
    )

    # Include goals without sub_projects as fallback items due this week
    for g in goals:
        if not is_schedulable_goal(g):
            continue
        if g.get("sub_projects"):
            continue
        uncompleted_tasks.append({
            "task": {
                "title": g.get("title"),
                "description": g.get("description", f"Focused upskilling for goal '{g.get('title')}'."),
                "estimated_time": "1 hour",
                "dueDate": week_end.isoformat(),
                "completed": False,
                "allocated_time_mins": 0,
            },
            "milestone": {"title": "General"},
            "goal": g,
            "goal_priority": get_goal_priority(g),
            "milestone_idx": 0,
            "task_idx": 0,
            "is_fallback": True,
        })

    uncompleted_tasks = sort_tasks_for_scheduling(uncompleted_tasks)

    proposed_blocks: list[dict[str, Any]] = []
    failed_days: list[str] = []
    scarcity_flag = False
    events_to_delete: list[dict[str, Any]] = []

    target_calendars = profile.get("target_calendars", [])
    google_allowed = any(
        c.get("selected") and (c.get("type") == "google" or c.get("id") == "cal-work")
        for c in target_calendars
    )

    mcp_busy: list[dict[str, Any]] = []
    if google_allowed:
        try:
            start_query_iso = datetime.datetime.combine(week_start, datetime.time.min).isoformat() + "Z"
            end_query_iso = (
                datetime.datetime.combine(week_start + datetime.timedelta(days=7), datetime.time.max).isoformat() + "Z"
            )
            mcp_busy = get_calendar_free_busy(start_query_iso, end_query_iso)
        except Exception:
            mcp_busy = []

    from app.app_utils.ical_parser import parse_ical

    for cal in target_calendars:
        if cal.get("selected") and cal.get("type") == "ical" and cal.get("url"):
            try:
                mcp_busy.extend(parse_ical(cal["url"]))
            except Exception as e:
                print(f"Error parsing iCal: {e}")

    tz_local = datetime.timezone(datetime.timedelta(hours=-4))
    now_local = datetime.datetime.now(tz_local)
    weekly_budget_mins = int(weekly_hours * 60)
    weekly_remaining_budget_mins = weekly_budget_mins
    task_idx = 0
    proposed_allocations: dict[str, int] = {}

    study_day_dates: list[datetime.date] = []
    for day_offset in range(7):
        candidate = week_start + datetime.timedelta(days=day_offset)
        if candidate.strftime("%A") in study_days:
            study_day_dates.append(candidate)

    day_busy_cache: dict[str, list[tuple[int, int]]] = {}

    def get_day_busy(day_str: str) -> list[tuple[int, int]]:
        if day_str not in day_busy_cache:
            day_busy_cache[day_str] = _collect_day_busy_slots(
                current_day_str=day_str,
                mcp_busy=mcp_busy,
                events_to_delete=events_to_delete,
            )
        return day_busy_cache[day_str]

    eligible_study_days: list[datetime.date] = []
    for current_day in study_day_dates:
        current_day_str = current_day.isoformat()
        if _day_has_future_slots(
            current_day_str=current_day_str,
            start_minutes=start_minutes,
            end_minutes=end_minutes,
            day_busy_slots=get_day_busy(current_day_str),
            proposed_blocks=proposed_blocks,
            now_local=now_local if not allow_past_slots else datetime.datetime.min.replace(tzinfo=now_local.tzinfo),
        ):
            eligible_study_days.append(current_day)

    daily_targets = _split_budget_across_days(weekly_budget_mins, len(eligible_study_days))
    daily_target_by_date = {
        eligible_study_days[i].isoformat(): daily_targets[i]
        for i in range(len(eligible_study_days))
    }

    while weekly_remaining_budget_mins >= 30 and task_idx < len(uncompleted_tasks):
        if not eligible_study_days:
            break

        made_progress = False
        round_failed_days: list[str] = []

        for current_day in eligible_study_days:
            if weekly_remaining_budget_mins < 30 or task_idx >= len(uncompleted_tasks):
                break

            current_day_str = current_day.isoformat()
            day_name = current_day.strftime("%A")
            day_target_mins = daily_target_by_date.get(current_day_str, 0)
            day_used_mins = _mins_scheduled_on_day(proposed_blocks, current_day_str)
            day_quota_remaining = max(0, day_target_mins - day_used_mins)
            if day_quota_remaining < 30:
                continue

            item = uncompleted_tasks[task_idx]
            task = item["task"]
            milestone = item["milestone"]
            goal = item["goal"]

            base_duration_mins = _task_remaining_mins(item, proposed_allocations)
            if base_duration_mins <= 0:
                task_idx += 1
                made_progress = True
                continue

            remaining_tasks_base = sum(
                _task_remaining_mins(t, proposed_allocations)
                for t in uncompleted_tasks[task_idx:]
            )
            adjusted_duration_mins = _compute_adjusted_duration_mins(
                base_duration_mins, remaining_tasks_base, weekly_remaining_budget_mins
            )
            adjusted_duration_mins = int(min(adjusted_duration_mins, day_quota_remaining))
            if adjusted_duration_mins < 30:
                continue

            day_busy_slots = get_day_busy(current_day_str)
            displacement_attempted = False
            scheduled = False
            slot_start = -1
            actual_duration = 0

            while True:
                slot_status, total_slots = _build_day_slot_status(
                    current_day_str=current_day_str,
                    start_minutes=start_minutes,
                    end_minutes=end_minutes,
                    day_busy_slots=day_busy_slots,
                    proposed_blocks=proposed_blocks,
                )
                target_slots_needed = int(adjusted_duration_mins / 15)
                scheduled, slot_start, actual_duration = _try_schedule_block(
                    slot_status=slot_status,
                    total_slots=total_slots,
                    start_minutes=start_minutes,
                    current_day_str=current_day_str,
                    target_slots_needed=target_slots_needed,
                    now_local=now_local if not allow_past_slots else datetime.datetime.min.replace(tzinfo=now_local.tzinfo),
                )
                if scheduled:
                    break

                if displacement_attempted:
                    break
                displacement_attempted = True

                candidates = []
                for evt in profile.get("scheduled_events", []):
                    if evt.get("start", "").startswith(current_day_str):
                        due_date_other_str = find_task_due_date_for_event(evt, goals)
                        if due_date_other_str:
                            try:
                                due_date_other = datetime.date.fromisoformat(due_date_other_str)
                                due_date_curr = datetime.date.fromisoformat(task.get("dueDate", ""))
                                curr_priority = get_goal_priority(goal)
                                other_priority = 1
                                summary = evt.get("summary", "")
                                other_goal_title = ""
                                if " - " in summary:
                                    parts = summary.split(" - ", 1)
                                    other_goal_title = (
                                        parts[0][len("Learning: "):].strip()
                                        if parts[0].startswith("Learning: ")
                                        else parts[0].strip()
                                    )
                                for g in goals:
                                    if g.get("title") == other_goal_title:
                                        other_priority = get_goal_priority(g)
                                        break
                                if (
                                    due_date_other > due_date_curr
                                    or (due_date_other == due_date_curr and other_priority < curr_priority)
                                ):
                                    candidates.append((event_displacement_key(evt, goals), evt))
                            except Exception:
                                pass

                if not candidates:
                    break

                candidates.sort(key=lambda x: x[0], reverse=True)
                best_evt = candidates[0][1]
                events_to_delete.append(best_evt)
                day_busy_cache.pop(current_day_str, None)
                day_busy_slots = get_day_busy(current_day_str)

                found_task_item = None
                goal_title = ""
                task_title = ""
                summary = best_evt.get("summary", "")
                if " - " in summary:
                    parts = summary.split(" - ", 1)
                    goal_title = (
                        parts[0][len("Learning: "):].strip()
                        if parts[0].startswith("Learning: ")
                        else parts[0].strip()
                    )
                    task_title = parts[1].strip()
                elif summary.startswith("Learning: "):
                    goal_title = summary[len("Learning: "):].strip()

                for g in goals:
                    if g.get("title") == goal_title:
                        for m in g.get("sub_projects", []):
                            if task_title:
                                for t in m.get("tasks", []):
                                    if t.get("title") == task_title:
                                        found_task_item = {
                                            "task": t,
                                            "milestone": m,
                                            "goal": g,
                                            "goal_priority": get_goal_priority(g),
                                            "milestone_idx": g.get("sub_projects", []).index(m),
                                            "task_idx": m.get("tasks", []).index(t),
                                            "is_fallback": False,
                                        }
                                        break
                            elif not m.get("completed"):
                                found_task_item = {
                                    "task": {
                                        "title": m.get("title"),
                                        "description": m.get("description", ""),
                                        "estimated_time": "1 hour",
                                        "dueDate": m.get("dueDate"),
                                        "completed": False,
                                    },
                                    "milestone": m,
                                    "goal": g,
                                    "is_fallback": True,
                                }
                                break
                        if found_task_item:
                            break

                if found_task_item:
                    uncompleted_tasks.append(found_task_item)
                    uncompleted_tasks[task_idx:] = sort_tasks_for_scheduling(uncompleted_tasks[task_idx:])

            if scheduled:
                _append_proposed_block(
                    proposed_blocks=proposed_blocks,
                    current_day_str=current_day_str,
                    start_minutes=start_minutes,
                    slot_start=slot_start,
                    actual_duration=actual_duration,
                    goal=goal,
                    task=task,
                    milestone=milestone,
                )
                alloc_key = _task_alloc_key(item)
                proposed_allocations[alloc_key] = proposed_allocations.get(alloc_key, 0) + actual_duration
                weekly_remaining_budget_mins -= actual_duration
                made_progress = True
                if _task_remaining_mins(item, proposed_allocations) <= 0:
                    task_idx += 1
            elif task_idx < len(uncompleted_tasks):
                round_failed_days.append(day_name)

        if not made_progress:
            if round_failed_days:
                scarcity_flag = True
                for day_name in round_failed_days:
                    if day_name not in failed_days:
                        failed_days.append(day_name)
            break

    if not uncompleted_tasks:
        reason_str = explain_no_schedulable_tasks(
            goals,
            week_start=week_start,
            week_end=week_end,
            hours_per_week=weekly_hours,
            scheduled_events=profile.get("scheduled_events", []),
        )
    elif scarcity_flag:
        reason_str = f"Calendar density in the week of {week_start.isoformat()} restricted full allocation."
        if failed_days:
            reason_str += (
                f" Dropped learning blocks on {', '.join(failed_days)} "
                "due to no remaining free slots in working hours."
            )
        else:
            reason_str += " Degraded some blocks to 30-minute micro-learning sessions to fit working hour constraints."
    elif not proposed_blocks:
        reason_str = "No open study slots remain this week within your hours budget."
    else:
        reason_str = "Successfully scheduled all weekly upskilling blocks within working hours!"

    transaction_id = f"tx-{uuid.uuid4().hex[:8]}"
    token = generate_signature(transaction_id)
    proposal_payload = {
        "transaction_id": transaction_id,
        "token": token,
        "proposed_events": proposed_blocks,
        "events_to_delete": events_to_delete,
        "scarcity_flag": scarcity_flag,
        "reason": reason_str,
        "task_count": len(uncompleted_tasks),
        "week_offset": week_offset,
        "week_start": week_start.isoformat(),
        "week_end": week_end.isoformat(),
    }

    state_store.update_user_profile({
        "proposed_events": proposed_blocks,
        "events_to_delete": events_to_delete,
        "scarcity_flag": scarcity_flag,
        "reason": reason_str,
        "transaction_id": transaction_id,
        "token": token,
        "staged_week_offset": week_offset,
    })

    return proposal_payload
