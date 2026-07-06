import hashlib
import hmac
import json
import os
import uuid
import datetime
from collections.abc import AsyncGenerator
from typing import Any

from google.adk.agents.context import Context
from google.adk.events.event import Event
from google.adk.events.event_actions import EventActions
from google.adk.events.request_input import RequestInput
from google.adk.workflow import Workflow, node
from google.genai import types

from app.mcp_clients import get_calendar_free_busy, write_calendar_event, delete_calendar_event
from app.skills.onboarding_elicitation import onboarding_interview
from app.state_store import state_store

SECRET_KEY = os.getenv("APPROVAL_SECRET_KEY", "super_secure_zero_trust_key")


def generate_signature(transaction_id: str) -> str:
    """Generates a cryptographic signature/token for stateful confirmation."""
    return hmac.new(
        SECRET_KEY.encode(), transaction_id.encode(), hashlib.sha256
    ).hexdigest()


def parse_duration(est_str: str | None) -> int:
    """Parses a duration string (e.g. '2 hours', '1.5 hours', '30 minutes') and returns duration in minutes.
    Defaults to 60 minutes (1 hour) if empty or invalid.
    """
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
        elif "min" in est_str:
            return int(val)
        return 60
    except Exception:
        return 60


def find_task_due_date_for_event(event: dict[str, Any], goals: list[dict[str, Any]]) -> str | None:
    """Finds the due date of a task associated with an event by inspecting the goals hierarchy."""
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


@node
async def check_onboarding(ctx: Context, node_input: Any) -> Event:
    """Check if the user profile exists in state store."""
    profile = state_store.get_user_profile()
    if not profile or (not profile.get("onboarded") and not profile.get("career_goals")):
        # Not onboarded: route to onboarding node
        return Event(output=node_input, actions=EventActions(route="needs_onboarding"))
    return Event(output=node_input, actions=EventActions(route="onboarded"))


@node
async def onboard_user(ctx: Context, node_input: Any) -> Event:
    """Run onboarding flow: interview user and save profile."""
    # Simulating elicitation step
    career_goals = "AI Engineering"
    hours_per_week = 5
    study_days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]

    strategy = onboarding_interview(
        user_id=ctx.session.id,
        career_goals=career_goals,
        hours_per_week=hours_per_week,
        study_days=study_days,
    )

    # Return content block for user
    message = (
        f"Onboarding complete! I've saved your goal: {career_goals}.\n"
        f"Market insights indicate: {', '.join(strategy['market_insights'][:2])}\n"
        f"We will focus on: {', '.join(strategy['suggested_focus_areas'])}."
    )
    return Event(
        output=strategy,
        content=types.Content(role="model", parts=[types.Part.from_text(text=message)]),
    )


@node(rerun_on_resume=True)
async def stage_schedule(
    ctx: Context, node_input: Any
) -> AsyncGenerator[Event | RequestInput, None]:
    """Stages proposed learning blocks, flags scarcity, and pauses execution (HITL)."""
    # If already resumed and we have confirmation payload, proceed
    if ctx.resume_inputs and "approval_payload" in ctx.resume_inputs:
        # Store approval payload for the next node
        yield Event(
            output=ctx.resume_inputs["approval_payload"],
            actions=EventActions(route="approved"),
        )
        return

    # Check if a proposal is already pending in the loop
    # Retrieve profile
    profile = state_store.get_user_profile()
    if not profile:
        profile = {"career_goals": "AI Engineering", "hours_per_week": 5}

    # Target: weekly_hours_budget
    weekly_hours = profile.get("hours_per_week", 5)
    study_days = profile.get("study_days", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"])

    # Preferred working hours
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

    # Date window: start from today or July 2nd, 2026, whichever is later
    base_date = max(datetime.date.today(), datetime.date(2026, 7, 2))

    # Retrieve goals to alternate
    goals = profile.get("goals", [])

    # Harvest all uncompleted tasks from active goals
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
                        "completed": False
                    },
                    "milestone": {
                        "title": "General"
                    },
                    "goal": g,
                    "is_fallback": True
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
                                    "completed": False
                                },
                                "milestone": m,
                                "goal": g,
                                "is_fallback": True
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
                                        "is_fallback": False
                                    })

    def get_task_due_date(item):
        d_str = item["task"].get("dueDate")
        if d_str:
            try:
                return datetime.date.fromisoformat(d_str)
            except ValueError:
                pass
        return datetime.date.max

    uncompleted_tasks.sort(key=get_task_due_date)

    proposed_blocks = []
    failed_days = []
    scarcity_flag = False
    events_to_delete = []

    # Fetch busy times from Calendar MCP if whitelisted/selected
    target_calendars = profile.get("target_calendars", [])
    google_allowed = any(c.get("selected") and (c.get("type") == "google" or c.get("id") == "cal-work") for c in target_calendars)

    mcp_busy = []
    if google_allowed:
        try:
            start_query_iso = datetime.datetime.combine(base_date, datetime.time.min).isoformat() + "Z"
            end_query_iso = datetime.datetime.combine(base_date + datetime.timedelta(days=7), datetime.time.max).isoformat() + "Z"
            mcp_busy = get_calendar_free_busy(start_query_iso, end_query_iso)
        except Exception:
            mcp_busy = []

    # Also fetch from target iCal feeds
    from app.app_utils.ical_parser import parse_ical
    for cal in target_calendars:
        if cal.get("selected") and cal.get("type") == "ical" and cal.get("url"):
            try:
                mcp_busy.extend(parse_ical(cal["url"]))
            except Exception as e:
                print(f"Error parsing iCal: {e}")

    # Current local time zone of the user is EDT (-04:00) as indicated in their metadata
    tz_local = datetime.timezone(datetime.timedelta(hours=-4))
    now_local = datetime.datetime.now(tz_local)

    weekly_remaining_budget_mins = weekly_hours * 60
    task_idx = 0

    # Build weekly schedule day by day
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

        # Filter external events for this day, skipping any scheduled events currently staged for deletion/displacement
        to_delete_ids = {evt.get("google_event_id") for evt in events_to_delete if evt.get("google_event_id")}
        day_busy_slots = []
        for evt in mcp_busy:
            if evt.get("id") in to_delete_ids:
                continue
            evt_start = evt.get("start", "")
            evt_end = evt.get("end", "")
            if evt_start.startswith(current_day_str):
                try:
                    # Extract time parts: HH:MM
                    shour, smin = map(int, evt_start[11:16].split(":"))
                    ehour, emin = map(int, evt_end[11:16].split(":"))
                    day_busy_slots.append((shour * 60 + smin, ehour * 60 + emin))
                except Exception:
                    pass

        # Retrieve current task
        item = uncompleted_tasks[task_idx]
        task = item["task"]
        milestone = item["milestone"]
        goal = item["goal"]

        # Calculate adjusted duration based on estimated time, remaining tasks, and remaining budget
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

        # Partition working hours into 15-minute slots
        total_slots = int((end_minutes - start_minutes) / 15)
        slot_status = [True] * total_slots

        for busy_start, busy_end in day_busy_slots:
            s_idx = max(0, int((busy_start - start_minutes) / 15))
            e_idx = min(total_slots, int((busy_end - start_minutes) / 15))
            for idx in range(s_idx, e_idx):
                slot_status[idx] = False

        # Attempt to schedule in contiguous slots
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
                        "description": f"Task: {task.get('title')}\nMilestone: {milestone.get('title')}\nProject: {goal.get('title')}\n\nDescription: {task.get('description', '')}"
                    })
                    scheduled = True
                    weekly_remaining_budget_mins -= actual_duration
                    task_idx += 1
                    break
            if scheduled:
                break

        # Displacement logic: if density prevents scheduling, try to displace a future event with a later due date
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
                # Sort candidates by due date descending (latest first)
                candidates.sort(key=lambda x: x[0], reverse=True)
                best_evt = candidates[0][1]

                # Propose moving/deleting this event
                events_to_delete.append(best_evt)

                # Free up the slots occupied by the displaced event
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

                # Add the displaced event's task back to the uncompleted queue to be rescheduled
                found_task_item = None
                goal_title = ""
                task_title = ""
                summary = best_evt.get("summary", "")
                if " - " in summary:
                    parts = summary.split(" - ", 1)
                    goal_title = parts[0][len("Learning: "):].strip() if parts[0].startswith("Learning: ") else parts[0].strip()
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
                                            "is_fallback": False
                                        }
                                        break
                            else:
                                if not m.get("completed"):
                                    found_task_item = {
                                        "task": {
                                            "title": m.get("title"),
                                            "description": m.get("description", ""),
                                            "estimated_time": "1 hour",
                                            "dueDate": m.get("dueDate"),
                                            "completed": False
                                        },
                                        "milestone": m,
                                        "goal": g,
                                        "is_fallback": True
                                    }
                                    break
                        if found_task_item:
                            break

                if found_task_item:
                    uncompleted_tasks.append(found_task_item)
                    uncompleted_tasks[task_idx:] = sorted(uncompleted_tasks[task_idx:], key=get_task_due_date)

                # Retry scheduling the current task in the freed space
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
                                "description": f"Task: {task.get('title')}\nMilestone: {milestone.get('title')}\nProject: {goal.get('title')}\n\nDescription: {task.get('description', '')}"
                            })
                            scheduled = True
                            weekly_remaining_budget_mins -= actual_duration
                            task_idx += 1
                            break
                    if scheduled:
                        break

        # Flag scarcity if still not scheduled
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

    # Formulate reason
    reason_str = ""
    if scarcity_flag:
        reason_str = f"Calendar density in the week of {base_date.isoformat()} restricted full allocation."
        if failed_days:
            reason_str += f" Dropped learning blocks on {', '.join(failed_days)} due to no remaining free slots in working hours."
        else:
            reason_str += " Degraded some blocks to 30-minute micro-learning sessions to fit working hour constraints."
    else:
        reason_str = "Successfully scheduled all weekly upskilling blocks within working hours!"

    # Create unique transaction_id & cryptographic token
    transaction_id = f"tx-{uuid.uuid4().hex[:8]}"
    token = generate_signature(transaction_id)

    proposal_payload = {
        "transaction_id": transaction_id,
        "token": token,
        "proposed_events": proposed_blocks,
        "events_to_delete": events_to_delete,
        "scarcity_flag": scarcity_flag,
        "reason": reason_str,
    }

    # Cache proposal state in profile for REST API access
    profile["proposed_events"] = proposed_blocks
    profile["events_to_delete"] = events_to_delete
    profile["scarcity_flag"] = scarcity_flag
    profile["reason"] = reason_str
    profile["transaction_id"] = transaction_id
    profile["token"] = token
    state_store.update_user_profile(profile)

    # Cache the proposal in workflow context state
    ctx.state[f"proposal_{transaction_id}"] = proposal_payload

    # Yield RequestInput to pause backend execution and send component payload
    component_payload = {
        "component": "InteractiveVibeDiff",
        "transaction_id": transaction_id,
        "data": proposal_payload,
    }

    yield RequestInput(
        interrupt_id="approval_payload", message=json.dumps(component_payload)
    )


@node
async def write_to_calendar(ctx: Context, node_input: Any) -> Event:
    """Verifies client cryptographic signature and executes Calendar write operations."""
    payload = node_input  # Passed from resume_inputs["approval_payload"]
    if not payload:
        return Event(
            content=types.Content(
                role="model",
                parts=[
                    types.Part.from_text(text="Error: No approval payload received.")
                ],
            )
        )

    tx_id = payload.get("transaction_id")
    token = payload.get("token")
    action = payload.get("action")

    # Verify cryptographic signature for stateful integrity
    expected_token = generate_signature(tx_id)
    if not hmac.compare_digest(expected_token, token):
        message = "SECURITY WARNING: Invalid confirmation token. Zero-trust calendar write aborted."
        return Event(
            content=types.Content(
                role="model", parts=[types.Part.from_text(text=message)]
            )
        )

    if action != "approve":
        message = f"Action '{action}' received. Calendar write cancelled."
        return Event(
            content=types.Content(
                role="model", parts=[types.Part.from_text(text=message)]
            )
        )

    # Retrieve proposal details from workflow state
    proposal = ctx.state.get(f"proposal_{tx_id}")
    if not proposal:
        message = "Error: Staged proposal not found or expired."
        return Event(
            content=types.Content(
                role="model", parts=[types.Part.from_text(text=message)]
            )
        )

    # Honor user-modified schedule timings from the client's authorization envelope
    client_events = payload.get("proposed_events")
    if client_events:
        for idx, event in enumerate(proposal["proposed_events"]):
            if idx < len(client_events):
                event["start"] = client_events[idx].get("start", event["start"])
                event["end"] = client_events[idx].get("end", event["end"])

    # Perform Google Calendar Deletions for any displaced/rescheduled events
    events_to_delete = proposal.get("events_to_delete", [])
    for evt in events_to_delete:
        if evt.get("google_event_id"):
            delete_calendar_event(evt["google_event_id"])

    # Execute the Calendar write operation (safe under Zero-Trust)
    write_results = []
    for block in proposal["proposed_events"]:
        result = write_calendar_event(
            summary=block["summary"],
            start_time=block["start"],
            end_time=block["end"],
            description=block["description"],
        )
        write_results.append(result)
        if result.get("status") == "success" and "event" in result:
            evt_data = result["event"]
            if evt_data.get("id"):
                block["google_event_id"] = evt_data["id"]

    # Log the successfully scheduled block to work_log
    state_store.add_work_log_entry(
        {
            "transaction_id": tx_id,
            "action": "scheduled",
            "events": proposal["proposed_events"],
            "timestamp": "2026-07-02T01:43:00Z",
        }
    )

    # Update profile with scheduled events and clear active proposals
    profile = state_store.get_user_profile()
    sched_events = profile.get("scheduled_events", [])
    
    # Remove the deleted/displaced events from profile
    to_delete_ids = {evt.get("id") for evt in events_to_delete if evt.get("id")}
    sched_events = [e for e in sched_events if e.get("id") not in to_delete_ids]

    for block in proposal["proposed_events"]:
        if not any(e.get("start") == block.get("start") and e.get("summary") == block.get("summary") for e in sched_events):
            sched_events.append(block)
            
    profile["scheduled_events"] = sched_events
    profile["proposed_events"] = []
    profile["events_to_delete"] = []
    profile["scarcity_flag"] = False
    profile["reason"] = ""
    profile["transaction_id"] = None
    profile["token"] = None
    state_store.update_user_profile(profile)

    # Clean up staged proposal by setting it to None
    ctx.state[f"proposal_{tx_id}"] = None

    success_msg = f"Zero-Trust Authorization Verified! Scheduled {len(write_results)} block(s) to your calendar."
    return Event(
        output=write_results,
        content=types.Content(
            role="model", parts=[types.Part.from_text(text=success_msg)]
        ),
    )


# Define the DAG Orchestrator Workflow
orchestrator_workflow = Workflow(
    name="career_upskiller_orchestrator",
    edges=[
        ("START", check_onboarding),
        (
            check_onboarding,
            {"needs_onboarding": onboard_user, "onboarded": stage_schedule},
        ),
        (onboard_user, stage_schedule),
        (stage_schedule, {"approved": write_to_calendar}),
    ],
)
