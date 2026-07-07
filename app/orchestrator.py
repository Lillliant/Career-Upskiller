import json
from collections.abc import AsyncGenerator
from typing import Any

from google.adk.agents.context import Context
from google.adk.events.event import Event
from google.adk.events.event_actions import EventActions
from google.adk.events.request_input import RequestInput
from google.adk.workflow import Workflow, node
from google.genai import types

from app.schedule_approval import approve_schedule_proposal
from app.skills.onboarding_elicitation import onboarding_interview
from app.state_store import state_store


@node
async def check_onboarding(ctx: Context, node_input: Any) -> Event:
    """Check if the user profile exists in state store.
    
    IMPLEMENTATION DETAIL:
    Routes the user to either the onboarding interview loop or the main scheduling interface
    based on the presence of a completed profile (onboarded flag or specified career goals).
    """
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


# Rerun on resume is set to True to ensure that when the workflow resumes, 
# this node processes the incoming approval/rejection payload.
@node(rerun_on_resume=True)
async def stage_schedule(
    ctx: Context, node_input: Any
) -> AsyncGenerator[Event | RequestInput, None]:
    """Stages proposed learning blocks, flags scarcity, and pauses execution (HITL).
    
    DESIGN BEHAVIOR:
    This node serves as the primary Zero-Trust Human-In-The-Loop (HITL) gate.
    1. If the workflow has resumed and contains the 'approval_payload' from the client UI,
       it routes directly to 'approved' (which leads to the write_to_calendar node).
    2. Otherwise, it generates a weekly proposal, stores it in context state, 
       and pauses execution by yielding a RequestInput interrupt payload containing 
       the 'InteractiveVibeDiff' component specification.
    """
    if ctx.resume_inputs and "approval_payload" in ctx.resume_inputs:
        yield Event(
            output=ctx.resume_inputs["approval_payload"],
            actions=EventActions(route="approved"),
        )
        return

    from app.schedule_proposal import build_weekly_schedule_proposal

    # Build the initial weekly schedule proposal and generate a unique transaction ID
    proposal_payload = build_weekly_schedule_proposal()
    transaction_id = proposal_payload["transaction_id"]
    ctx.state[f"proposal_{transaction_id}"] = proposal_payload

    # Format the UI payload specifying the InteractiveVibeDiff component.
    # The frontend will interpret this to render the scheduling matrix.
    component_payload = {
        "component": "InteractiveVibeDiff",
        "transaction_id": transaction_id,
        "data": proposal_payload,
    }

    # Suspend orchestrator execution and wait for human authorization.
    yield RequestInput(
        interrupt_id="approval_payload", message=json.dumps(component_payload)
    )


@node
async def write_to_calendar(ctx: Context, node_input: Any) -> Event:
    """Verifies client cryptographic signature and executes Calendar write operations.
    
    SECURITY BEHAVIOR:
    This node acts on the resumed approved input. Under zero-trust architecture:
    1. It delegates validation of the HMAC-SHA256 signature to approve_schedule_proposal.
    2. If the signature is invalid or action is not 'approve', it aborts the calendar write.
    3. If approved, it writes the staged events (possibly modified by the user) to Google Calendar.
    """
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

    result = approve_schedule_proposal(payload)
    message = result.get("message", "Unknown approval result.")
    if result.get("status") != "success":
        return Event(
            content=types.Content(
                role="model", parts=[types.Part.from_text(text=message)]
            )
        )

    tx_id = payload.get("transaction_id")
    if tx_id:
        ctx.state[f"proposal_{tx_id}"] = None

    return Event(
        output=result.get("write_results", []),
        content=types.Content(
            role="model", parts=[types.Part.from_text(text=message)]
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
