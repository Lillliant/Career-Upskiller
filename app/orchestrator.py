import hashlib
import hmac
import json
import os
import uuid
from collections.abc import AsyncGenerator
from typing import Any

from google.adk.agents.context import Context
from google.adk.events.event import Event
from google.adk.events.event_actions import EventActions
from google.adk.events.request_input import RequestInput
from google.adk.workflow import Workflow, node
from google.genai import types

from app.mcp_clients import get_calendar_free_busy, write_calendar_event
from app.skills.onboarding_elicitation import onboarding_interview
from app.state_store import state_store

SECRET_KEY = os.getenv("APPROVAL_SECRET_KEY", "super_secure_zero_trust_key")


def generate_signature(transaction_id: str) -> str:
    """Generates a cryptographic signature/token for stateful confirmation."""
    return hmac.new(
        SECRET_KEY.encode(), transaction_id.encode(), hashlib.sha256
    ).hexdigest()


@node
async def check_onboarding(ctx: Context, node_input: Any) -> Event:
    """Check if the user profile exists in state store."""
    profile = state_store.get_user_profile()
    if not profile or not profile.get("career_goals"):
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

    import datetime

    # Target: weekly_hours_budget, divided by active days
    weekly_hours = profile.get("hours_per_week", 5)
    study_days = profile.get("study_days", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"])
    active_days_count = max(1, len(study_days))
    target_daily_mins = int((weekly_hours * 60) / active_days_count)

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

    # Retrieve goals to alternate
    goals = profile.get("goals", [])
    goal_titles = [g.get("title") for g in goals] if goals else []
    if not goal_titles:
        goal_titles = [profile.get("career_goals", "AI Engineering")]

    proposed_blocks = []
    failed_days = []
    scarcity_flag = False

    # Date window: start from 2026-07-02 (Thursday) for 7 days
    base_date = datetime.date(2026, 7, 2)

    # Fetch busy times from Calendar MCP if whitelisted/selected
    target_calendars = profile.get("target_calendars", [])
    google_allowed = any(c.get("selected") and (c.get("type") == "google" or c.get("id") == "cal-work") for c in target_calendars)

    mcp_busy = []
    if google_allowed:
        try:
            mcp_busy = get_calendar_free_busy(
                "2026-07-02T00:00:00Z", "2026-07-08T23:59:59Z"
            )
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

    # Build weekly schedule day by day
    for day_offset in range(7):
        current_day = base_date + datetime.timedelta(days=day_offset)
        day_name = current_day.strftime("%A")
        if day_name not in study_days:
            continue

        current_day_str = current_day.isoformat()

        # Filter external events for this day
        day_busy_slots = []
        for evt in mcp_busy:
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

        # Pick goal for this day
        goal_title = goal_titles[day_offset % len(goal_titles)]

        # Partition working hours into 15-minute slots
        total_slots = int((end_minutes - start_minutes) / 15)
        slot_status = [True] * total_slots

        for busy_start, busy_end in day_busy_slots:
            s_idx = max(0, int((busy_start - start_minutes) / 15))
            e_idx = min(total_slots, int((busy_end - start_minutes) / 15))
            for idx in range(s_idx, e_idx):
                slot_status[idx] = False

        # Try to schedule target_daily_mins
        target_slots_needed = int(target_daily_mins / 15)

        # 1. First attempt: Find contiguous free slots of target size
        scheduled = False
        for i in range(total_slots - target_slots_needed + 1):
            if all(slot_status[i + j] for j in range(target_slots_needed)):
                s_mins = start_minutes + i * 15
                e_mins = s_mins + target_daily_mins

                s_hour, s_min = divmod(s_mins, 60)
                e_hour, e_min = divmod(e_mins, 60)

                proposed_blocks.append({
                    "id": f"evt-{uuid.uuid4().hex[:6]}",
                    "summary": f"Learning: {goal_title}",
                    "start": f"{current_day_str}T{s_hour:02d}:{s_min:02d}:00-04:00",
                    "end": f"{current_day_str}T{e_hour:02d}:{e_min:02d}:00-04:00",
                    "description": f"Focused upskilling block for goal '{goal_title}'."
                })
                scheduled = True
                break

        # 2. Second attempt (Graceful Degradation): If it failed, try to fit a 30-minute block (2 slots)
        if not scheduled and target_daily_mins > 30:
            scarcity_flag = True
            degraded_slots_needed = 2
            for i in range(total_slots - degraded_slots_needed + 1):
                if all(slot_status[i + j] for j in range(degraded_slots_needed)):
                    s_mins = start_minutes + i * 15
                    e_mins = s_mins + 30

                    s_hour, s_min = divmod(s_mins, 60)
                    e_hour, e_min = divmod(e_mins, 60)

                    proposed_blocks.append({
                        "id": f"evt-{uuid.uuid4().hex[:6]}",
                        "summary": f"Micro-learning: {goal_title} (Reduced)",
                        "start": f"{current_day_str}T{s_hour:02d}:{s_min:02d}:00-04:00",
                        "end": f"{current_day_str}T{e_hour:02d}:{e_min:02d}:00-04:00",
                        "description": f"Micro learning session for '{goal_title}' scheduled due to time scarcity."
                    })
                    scheduled = True
                    break

        # 3. Third attempt: If still not scheduled, we drop this day's block and notify user
        if not scheduled:
            scarcity_flag = True
            failed_days.append(day_name)

    # Formulate reason
    reason_str = ""
    if scarcity_flag:
        reason_str = "Calendar density in the week of 2026-07-02 restricted full allocation."
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
        "scarcity_flag": scarcity_flag,
        "reason": reason_str,
    }

    # Cache proposal state in profile for REST API access
    profile["proposed_events"] = proposed_blocks
    profile["scarcity_flag"] = scarcity_flag
    profile["reason"] = reason_str
    profile["transaction_id"] = transaction_id
    profile["token"] = token
    state_store.update_user_profile(profile)

    # Cache the proposal in workflow context state
    ctx.state[f"proposal_{transaction_id}"] = proposal_payload

    # 4. Yield RequestInput to pause backend execution and send component payload
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
    for block in proposal["proposed_events"]:
        if not any(e.get("start") == block.get("start") and e.get("summary") == block.get("summary") for e in sched_events):
            sched_events.append(block)
    profile["scheduled_events"] = sched_events
    profile["proposed_events"] = []
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
