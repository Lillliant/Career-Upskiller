"""Execute or reject HITL schedule proposals staged in user profile."""

from __future__ import annotations

import hmac
from typing import Any

from app.mcp_clients import delete_calendar_event, normalize_to_local_offset, write_calendar_event
from app.scheduling_utils import generate_signature
from app.state_store import state_store


def _load_proposal(tx_id: str) -> dict[str, Any] | None:
    profile = state_store.get_user_profile()
    if profile.get("transaction_id") != tx_id:
        return None
    return {
        "transaction_id": tx_id,
        "token": profile.get("token"),
        "proposed_events": profile.get("proposed_events", []),
        "events_to_delete": profile.get("events_to_delete", []),
        "scarcity_flag": profile.get("scarcity_flag", False),
        "reason": profile.get("reason", ""),
    }


def _resolve_approved_events(
    staged_events: list[dict[str, Any]],
    client_events: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Honor client edits: final list, deletions, moves, and resizes."""
    if client_events is None:
        return [dict(event) for event in staged_events]

    staged_by_id = {event["id"]: event for event in staged_events if event.get("id")}

    resolved: list[dict[str, Any]] = []
    for client_event in client_events:
        base = dict(staged_by_id.get(client_event.get("id"), {}))
        merged = {**base, **client_event}

        start = merged.get("start")
        end = merged.get("end")
        summary = merged.get("summary")
        if not start or not end or not summary:
            continue

        merged["start"] = normalize_to_local_offset(start)
        merged["end"] = normalize_to_local_offset(end)
        resolved.append(merged)

    return resolved


def approve_schedule_proposal(payload: dict[str, Any]) -> dict[str, Any]:
    """Verify approval envelope and write staged events to calendar."""
    tx_id = payload.get("transaction_id")
    token = payload.get("token")
    action = payload.get("action")

    if not tx_id or not token:
        return {"status": "error", "message": "Missing transaction_id or token."}

    expected_token = generate_signature(tx_id)
    if not hmac.compare_digest(expected_token, token):
        return {
            "status": "error",
            "message": "SECURITY WARNING: Invalid confirmation token. Zero-trust calendar write aborted.",
        }

    if action != "approve":
        return {
            "status": "error",
            "message": f"Action '{action}' received. Calendar write cancelled.",
        }

    proposal = _load_proposal(tx_id)
    if not proposal:
        return {"status": "error", "message": "Error: Staged proposal not found or expired."}

    proposal["proposed_events"] = _resolve_approved_events(
        proposal["proposed_events"],
        payload.get("proposed_events"),
    )

    for evt in proposal.get("events_to_delete", []):
        if evt.get("google_event_id"):
            delete_calendar_event(evt["google_event_id"])

    write_results = []
    for block in proposal["proposed_events"]:
        result = write_calendar_event(
            summary=block["summary"],
            start_time=block["start"],
            end_time=block["end"],
            description=block.get("description", ""),
        )
        write_results.append(result)
        if result.get("status") == "success" and "event" in result:
            evt_data = result["event"]
            if evt_data.get("id"):
                block["google_event_id"] = evt_data["id"]

    state_store.add_work_log_entry(
        {
            "transaction_id": tx_id,
            "action": "scheduled",
            "events": proposal["proposed_events"],
        }
    )

    profile = state_store.get_user_profile()
    sched_events = profile.get("scheduled_events", [])
    to_delete_ids = {
        evt.get("id") for evt in proposal.get("events_to_delete", []) if evt.get("id")
    }
    sched_events = [e for e in sched_events if e.get("id") not in to_delete_ids]

    for block in proposal["proposed_events"]:
        if not any(
            e.get("start") == block.get("start") and e.get("summary") == block.get("summary")
            for e in sched_events
        ):
            sched_events.append(block)

    profile["scheduled_events"] = sched_events
    profile["proposed_events"] = []
    profile["events_to_delete"] = []
    profile["scarcity_flag"] = False
    profile["reason"] = ""
    profile["transaction_id"] = None
    profile["token"] = None
    state_store.update_user_profile(profile)

    return {
        "status": "success",
        "message": (
            f"Zero-Trust Authorization Verified! Scheduled {len(write_results)} block(s) "
            "to your calendar."
        ),
        "write_results": write_results,
        "scheduled_events": sched_events,
    }


def reject_schedule_proposal(payload: dict[str, Any]) -> dict[str, Any]:
    """Clear a staged proposal without writing to calendar."""
    tx_id = payload.get("transaction_id")
    token = payload.get("token")

    if tx_id and token:
        expected_token = generate_signature(tx_id)
        if not hmac.compare_digest(expected_token, token):
            return {
                "status": "error",
                "message": "SECURITY WARNING: Invalid confirmation token. Rejection aborted.",
            }

    profile = state_store.get_user_profile()
    if tx_id and profile.get("transaction_id") not in (None, tx_id):
        return {"status": "error", "message": "Error: Staged proposal not found or expired."}

    profile["proposed_events"] = []
    profile["events_to_delete"] = []
    profile["scarcity_flag"] = False
    profile["reason"] = ""
    profile["transaction_id"] = None
    profile["token"] = None
    state_store.update_user_profile(profile)

    return {"status": "success", "message": "Schedule proposal rejected."}
