#!/usr/bin/env python3
import argparse
import asyncio
import json

from google.adk.runners import InMemoryRunner
from google.genai import types

from app.agent import app
from app.state_store import state_store


async def run_simulation(approve_immediately=False):
    # 1. Clear any existing state for a clean run
    print("Clearing local state for simulation...")
    import os

    if os.path.exists(".state/user_profile.json"):
        os.remove(".state/user_profile.json")
    if os.path.exists(".state/work_log.json"):
        os.remove(".state/work_log.json")

    runner = InMemoryRunner(app=app)
    user_id = "test_user_123"

    # 2. Create the session
    session = await runner.session_service.create_session(
        app_name="app", user_id=user_id
    )
    session_id = session.id
    print(f"\n--- Initializing Session: {session_id} ---")

    # 3. Run the initial step (Onboarding + Staging Schedule)
    # The agent will first run 'check_onboarding' -> 'onboard_user' -> 'stage_schedule' -> pauses!
    print("Running initial flow...")
    initial_message = types.Content(
        role="user",
        parts=[
            types.Part.from_text(text="I want to start my career upskilling journey!")
        ],
    )

    transaction_id = None
    token = None
    interrupt_id = None

    async for event in runner.run_async(
        user_id=user_id, session_id=session_id, new_message=initial_message
    ):
        if event.content:
            # Check if this is an adk_request_input function call
            is_interrupt = False
            for part in event.content.parts or []:
                if (
                    part.function_call
                    and part.function_call.name == "adk_request_input"
                ):
                    is_interrupt = True
                    interrupt_id = part.function_call.id
                    payload_str = part.function_call.args.get("message", "")
                    try:
                        payload = json.loads(payload_str)
                        print("\n==================================================")
                        print("🛑 ZERO-TRUST HITL PAUSE DETECTED")
                        print("==================================================")
                        print(f"Component: {payload.get('component')}")
                        print(f"Transaction ID: {payload['data']['transaction_id']}")
                        print(f"Cryptographic Token: {payload['data']['token']}")
                        print(
                            f"Proposed Blocks: {json.dumps(payload['data']['proposed_events'], indent=2)}"
                        )
                        print(f"Time Scarcity Flag: {payload['data']['scarcity_flag']}")
                        print(f"Reason: {payload['data']['reason']}")

                        transaction_id = payload["data"]["transaction_id"]
                        token = payload["data"]["token"]
                    except Exception as e:
                        print(
                            f"Failed to parse payload: {e}. Raw message: {payload_str}"
                        )

            if not is_interrupt:
                for part in event.content.parts or []:
                    if part.text:
                        print(f"\n[Agent Content]: {part.text}")

    if not transaction_id or not interrupt_id:
        print(
            "Error: Staging did not yield a transaction ID or interrupt ID. Check logic."
        )
        return

    # 4. User Approval Prompt
    approved = False
    if approve_immediately:
        print("\nAuto-approving proposal...")
        approved = True
    else:
        print("\nWould you like to approve these calendar blocks?")
        choice = input(
            "Enter 'y' to Approve (Zero-Trust authorization envelope will be sent) or 'n' to cancel: "
        )
        if choice.lower() == "y":
            approved = True

    if not approved:
        print("\nProcess cancelled by user. Zero-trust calendar write aborted.")
        return

    # 5. Formulate approval envelope (cryptographically secured)
    approval_payload = {
        "transaction_id": transaction_id,
        "token": token,
        "action": "approve",
    }

    # 6. Resume the run with the approval payload passed as a FunctionResponse
    print("\n--- Resuming Session and Verifying Authorization Envelope ---")
    resume_message = types.Content(
        role="user",
        parts=[
            types.Part(
                function_response=types.FunctionResponse(
                    id=interrupt_id, name="adk_request_input", response=approval_payload
                )
            )
        ],
    )

    async for event in runner.run_async(
        user_id=user_id, session_id=session_id, new_message=resume_message
    ):
        if event.content:
            for part in event.content.parts or []:
                if part.text:
                    print(f"\n[Agent Content]: {part.text}")

    # 7. Print resulting state
    print("\n--- Verification: Checking Local State Storage ---")
    profile = state_store.get_user_profile()
    work_log = state_store.get_work_log()
    print(f"User Profile: {json.dumps(profile, indent=2)}")
    print(f"Work Log Entries: {json.dumps(work_log, indent=2)}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Career Skill Concierge HITL simulation tool."
    )
    parser.add_argument(
        "--approve", action="store_true", help="Auto-approve the calendar changes."
    )
    args = parser.parse_args()

    asyncio.run(run_simulation(approve_immediately=args.approve))
