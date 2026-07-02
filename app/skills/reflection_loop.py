import datetime
from typing import Any

from app.state_store import state_store


def process_user_reflection(
    user_id: str, learning_block_id: str, reflection_text: str, success_rating: int
) -> dict[str, Any]:
    """Processes user feedback on a learning block.
    Logs the reflection into work_log.json and adjusts the career goal timeline/difficulty in user_profile.json.
    """
    # 1. Log the reflection in work_log.json
    log_entry = {
        "learning_block_id": learning_block_id,
        "reflection_text": reflection_text,
        "success_rating": success_rating,  # Scale of 1-5 (1: struggled, 5: mastered)
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
    }
    state_store.add_work_log_entry(log_entry)

    # 2. Adjust goals/timeline based on performance
    profile = state_store.get_user_profile()
    adjustment_action = "none"

    if success_rating <= 2:
        # User struggled: degrade difficulty or lengthen duration/timeline
        adjustment_action = "degrade_difficulty"
        profile["timeline_buffer_weeks"] = profile.get("timeline_buffer_weeks", 0) + 1
        profile["preferred_difficulty"] = "beginner"
        profile["adjustment_reason"] = (
            "User reported struggle on previous blocks. Adding buffer and lowering complexity."
        )
    elif success_rating >= 4:
        # User mastered: accelerate timeline or increase complexity
        adjustment_action = "accelerate_timeline"
        profile["preferred_difficulty"] = "advanced"
        profile["adjustment_reason"] = (
            "User reported high competence. Increasing complexity."
        )
    else:
        profile["adjustment_reason"] = "No adjustments needed; learning is on track."

    # Update profile in store
    state_store.update_user_profile(profile)

    return {
        "status": "success",
        "logged_entry": log_entry,
        "adjustment_action": adjustment_action,
        "updated_profile": profile,
    }
