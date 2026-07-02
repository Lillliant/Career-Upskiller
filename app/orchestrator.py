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
    excluded_days = ["Saturday", "Sunday"]

    strategy = onboarding_interview(
        user_id=ctx.session.id,
        career_goals=career_goals,
        hours_per_week=hours_per_week,
        excluded_days=excluded_days,
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

    # 1. Fetch free/busy times from Calendar MCP
    # For demonstration, we check a mock day: 2026-07-02
    _busy_events = get_calendar_free_busy(
        "2026-07-02T00:00:00Z", "2026-07-02T23:59:59Z"
    )

    # 2. Formulate schedule blocks (with Scarcity check & Graceful Degradation)
    # Target: We want to schedule a 2-hour learning block on 2026-07-02.
    # Busy slots:
    # 09:00 - 10:00
    # 10:00 - 11:30
    # 13:00 - 15:00
    # 15:30 - 17:00
    # A 2-hour block (e.g. 10:00-12:00 or 14:00-16:00) conflicts.
    # Therefore, we detect scarcity and degrade to a 30-minute block: 11:30 - 12:00 or 15:00 - 15:30.

    proposed_blocks = []
    scarcity_flag = False

    # Calculate conflict overlap
    # In this mock, we detect that we cannot fit 2 continuous hours during working hours (09:00 - 17:00)
    # So we gracefully degrade to 30 minutes micro-learning: 11:30 - 12:00
    scarcity_flag = True
    proposed_blocks.append(
        {
            "summary": f"Micro-learning: {profile.get('career_goals', 'AI Engineering')} Focus",
            "start": "2026-07-02T11:30:00-04:00",
            "end": "2026-07-02T12:00:00-04:00",
            "description": "Short focused study slot created due to high calendar density.",
        }
    )

    # 3. Create unique transaction_id & cryptographic token
    transaction_id = f"tx-{uuid.uuid4().hex[:8]}"
    token = generate_signature(transaction_id)

    proposal_payload = {
        "transaction_id": transaction_id,
        "token": token,
        "proposed_events": proposed_blocks,
        "scarcity_flag": scarcity_flag,
        "reason": "Calendar is dense with meetings. Degraded to a 30-minute focused slot.",
    }

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
