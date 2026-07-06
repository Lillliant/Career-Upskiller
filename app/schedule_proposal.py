"""Build weekly learning-block proposals from project task due dates."""

from __future__ import annotations

import datetime
import uuid
from typing import Any

from app.mcp_clients import get_calendar_free_busy
from app.scheduling_utils import find_task_due_date_for_event, generate_signature, parse_duration
from app.state_store import state_store, update_tasks_allocated_time


def build_weekly_schedule_proposal(profile: dict[str, Any] | None = None) -> dict[str, Any]:
    """Stage proposed learning blocks for the current week, prioritized by task due dates."""
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
    base_date = max(datetime.date.today(), datetime.date(2026, 7, 2))
    goals = profile.get("goals", [])

    uncompleted_tasks = []
    for g in goals:
        if g.get("status") in ["to-do", "in-progress"]:
            sub_projects = g.get("sub_projects", [])
            if not sub_projects:
                uncompleted_tasks.append({
                    "task": {
                        "title": g.get("title"),
                        "description": g.get("description", f"Focused upskilling for goal '{g.get('title')}'."),
                        "estimated_time": "1 hour",
                        "dueDate": (base_date + datetime.timedelta(days=7)).isoformat(),
                        "completed": False,
                    },
                    "milestone": {"title": "General"},
                    "goal": g,
                    "is_fallback": True,
                })
            else:
                for m in sub_projects:
                    tasks = m.get("tasks", [])
                    if not tasks:
                        if not m.get("completed"):
                            uncompleted_tasks.append({
                                "task": {
                                    "title": m.get("title"),
                                    "description": m.get("description", f"Milestone: {m.get('title')}"),
                                    "estimated_time": "1 hour",
                                    "dueDate": m.get("dueDate", (base_date + datetime.timedelta(days=7)).isoformat()),
                                    "completed": False,
                                },
                                "milestone": m,
                                "goal": g,
                                "is_fallback": True,
                            })
                    else:
                        for t in tasks:
                            if not t.get("completed"):
                                task_est = parse_duration(t.get("estimated_time"))
                                task_allocated = t.get("allocated_time_mins", 0)
                                if task_est - task_allocated > 0:
                                    uncompleted_tasks.append({
                                        "task": t,
                                        "milestone": m,
                                        "goal": g,
                                        "is_fallback": False,
                                    })

    def get_task_due_date(item: dict[str, Any]) -> datetime.date:
        d_str = item["task"].get("dueDate")
        if d_str:
            try:
                return datetime.date.fromisoformat(d_str)
            except ValueError:
                pass
        return datetime.date.max

    uncompleted_tasks.sort(key=get_task_due_date)

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
            start_query_iso = datetime.datetime.combine(base_date, datetime.time.min).isoformat() + "Z"
            end_query_iso = (
                datetime.datetime.combine(base_date + datetime.timedelta(days=7), datetime.time.max).isoformat() + "Z"
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
    weekly_remaining_budget_mins = weekly_hours * 60
    task_idx = 0

    for day_offset in range(7):
        current_day = base_date + datetime.timedelta(days=day_offset)
        day_name = current_day.strftime("%A")
        if day_name not in study_days:
            continue
        if task_idx >= len(uncompleted_tasks):
            break
        if weekly_remaining_budget_mins < 30:
            break

        current_day_str = current_day.isoformat()
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

        item = uncompleted_tasks[task_idx]
        task = item["task"]
        milestone = item["milestone"]
        goal = item["goal"]

        task_est_mins = parse_duration(task.get("estimated_time"))
        task_allocated_mins = task.get("allocated_time_mins", 0)
        base_duration_mins = max(0, task_est_mins - task_allocated_mins)
        remaining_tasks_base = sum(
            max(0, parse_duration(t["task"].get("estimated_time")) - t["task"].get("allocated_time_mins", 0))
            for t in uncompleted_tasks[task_idx:]
        )

        if weekly_remaining_budget_mins > 0 and remaining_tasks_base > 0:
            ratio = weekly_remaining_budget_mins / remaining_tasks_base
            adjusted_duration_mins = base_duration_mins * ratio
            if ratio > 1.0:
                adjusted_duration_mins = min(adjusted_duration_mins, base_duration_mins * 1.5, 120)
        else:
            adjusted_duration_mins = base_duration_mins

        adjusted_duration_mins = round(adjusted_duration_mins / 15) * 15
        adjusted_duration_mins = max(30, min(adjusted_duration_mins, weekly_remaining_budget_mins))

        total_slots = int((end_minutes - start_minutes) / 15)
        slot_status = [True] * total_slots
        for busy_start, busy_end in day_busy_slots:
            s_idx = max(0, int((busy_start - start_minutes) / 15))
            e_idx = min(total_slots, int((busy_end - start_minutes) / 15))
            for idx in range(s_idx, e_idx):
                slot_status[idx] = False

        target_slots_needed = int(adjusted_duration_mins / 15)
        scheduled = False

        for current_target in range(target_slots_needed, 1, -1):
            actual_duration = current_target * 15
            for i in range(total_slots - current_target + 1):
                if all(slot_status[i + j] for j in range(current_target)):
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

                    proposed_blocks.append({
                        "id": f"evt-{uuid.uuid4().hex[:6]}",
                        "summary": f"Learning: {goal.get('title')} - {task.get('title')}",
                        "start": proposed_start_str,
                        "end": f"{current_day_str}T{e_hour:02d}:{e_min:02d}:00-04:00",
                        "description": (
                            f"Task: {task.get('title')}\nMilestone: {milestone.get('title')}\n"
                            f"Project: {goal.get('title')}\n\nDescription: {task.get('description', '')}"
                        ),
                    })
                    scheduled = True
                    weekly_remaining_budget_mins -= actual_duration
                    task_idx += 1
                    break
            if scheduled:
                break

        if not scheduled:
            candidates = []
            for evt in profile.get("scheduled_events", []):
                if evt.get("start", "").startswith(current_day_str):
                    due_date_other_str = find_task_due_date_for_event(evt, goals)
                    if due_date_other_str:
                        try:
                            due_date_other = datetime.date.fromisoformat(due_date_other_str)
                            due_date_curr = datetime.date.fromisoformat(task.get("dueDate", ""))
                            if due_date_other > due_date_curr:
                                candidates.append((due_date_other, evt))
                        except Exception:
                            pass

            if candidates:
                candidates.sort(key=lambda x: x[0], reverse=True)
                best_evt = candidates[0][1]
                events_to_delete.append(best_evt)

                evt_start = best_evt.get("start", "")
                evt_end = best_evt.get("end", "")
                try:
                    shour, smin = map(int, evt_start[11:16].split(":"))
                    ehour, emin = map(int, evt_end[11:16].split(":"))
                    s_idx = max(0, int((shour * 60 + smin - start_minutes) / 15))
                    e_idx = min(total_slots, int((ehour * 60 + emin - start_minutes) / 15))
                    for idx in range(s_idx, e_idx):
                        slot_status[idx] = True
                except Exception:
                    pass

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
                    uncompleted_tasks[task_idx:] = sorted(uncompleted_tasks[task_idx:], key=get_task_due_date)

                for current_target in range(target_slots_needed, 1, -1):
                    actual_duration = current_target * 15
                    for i in range(total_slots - current_target + 1):
                        if all(slot_status[i + j] for j in range(current_target)):
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

                            proposed_blocks.append({
                                "id": f"evt-{uuid.uuid4().hex[:6]}",
                                "summary": f"Learning: {goal.get('title')} - {task.get('title')}",
                                "start": proposed_start_str,
                                "end": f"{current_day_str}T{e_hour:02d}:{e_min:02d}:00-04:00",
                                "description": (
                                    f"Task: {task.get('title')}\nMilestone: {milestone.get('title')}\n"
                                    f"Project: {goal.get('title')}\n\nDescription: {task.get('description', '')}"
                                ),
                            })
                            scheduled = True
                            weekly_remaining_budget_mins -= actual_duration
                            task_idx += 1
                            break
                    if scheduled:
                        break

        if not scheduled:
            day_has_future_slots = False
            for i in range(total_slots):
                slot_start_mins = start_minutes + i * 15
                s_hour, s_min = divmod(slot_start_mins, 60)
                proposed_start_str = f"{current_day_str}T{s_hour:02d}:{s_min:02d}:00-04:00"
                try:
                    proposed_start_dt = datetime.datetime.fromisoformat(proposed_start_str)
                    if proposed_start_dt >= now_local:
                        day_has_future_slots = True
                        break
                except Exception:
                    pass
            if day_has_future_slots:
                scarcity_flag = True
                failed_days.append(day_name)

    if not uncompleted_tasks:
        reason_str = "No active tasks found across your projects. Add milestones or tasks before scheduling."
    elif scarcity_flag:
        reason_str = f"Calendar density in the week of {base_date.isoformat()} restricted full allocation."
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
    }

    state_store.update_user_profile({
        "proposed_events": proposed_blocks,
        "events_to_delete": events_to_delete,
        "scarcity_flag": scarcity_flag,
        "reason": reason_str,
        "transaction_id": transaction_id,
        "token": token,
    })

    return proposal_payload
