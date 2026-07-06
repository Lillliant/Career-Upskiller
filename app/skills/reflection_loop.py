import datetime
from typing import Any

from app.state_store import state_store


def process_user_reflection(
    user_id: str, learning_block_id: str, reflection_text: str, success_rating: int | None = None, goal_id: str | None = None
) -> dict[str, Any]:
    """Processes user feedback on a learning block.
    Logs the reflection into work_log.json, inserts prerequisite milestones, and adjusts upcoming due dates.
    """
    # 1. Log the reflection in work_log.json
    log_entry = {
        "learning_block_id": learning_block_id,
        "goal_id": goal_id,
        "reflection_text": reflection_text,
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
    }
    if success_rating is not None:
        log_entry["success_rating"] = success_rating
    state_store.add_work_log_entry(log_entry)

    # 2. Adjust goals/timeline based on performance
    profile = state_store.get_user_profile()
    adjustment_action = "none"
    adjustment_reason = ""
    feedback_text = ""

    # Attempt to analyze text using Gemini
    inferred_action = None
    custom_prereq = None

    try:
        import json

        from google.genai import Client, types
        client = None
        try:
            client = Client()
        except Exception:
            client = Client(vertexai=True)

        if client:
            system_prompt = """
            Analyze this user's learning reflection text.
            Determine if the user is struggling (needs more time/prerequisites), has explicitly requested a task or review block to be added, is mastering the content easily (can accelerate), or pacing normally.

            Rules for Classification:
            1. Classify action as "struggled" if they express confusion, ask for help, or explicitly request to add a task, practice, or review a specific topic.
            2. Classify action as "mastered" if they express ease or fast progress.
            3. Otherwise, classify action as "on_track".

            Rules for Prerequisite Task Generation (prereq_task):
            1. If the action is "struggled", generate a highly specific, concrete, and helpful milestone/task title starting with an action verb (e.g., 'Review Google ADK workflow edge mapping configurations', 'Practice Model Context Protocol stdio transport setup').
            2. NEVER return a generic title like 'Prerequisite Review', 'Review foundations', or 'Review topic'. Make it highly relevant to the concepts the user mentioned or struggled with.
            3. If action is NOT "struggled", set "prereq_task" to null.

            Return a JSON object in this format:
            {
              "action": "struggled" | "mastered" | "on_track",
              "feedback": "A short, encouraging and personalized feedback sentence addressing their text.",
              "prereq_task": "A short specific prerequisite topic/task title or null"
            }
            """
            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=f"Reflection text: {reflection_text}",
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.2
                )
            )
            resp_str = response.text.strip()
            if resp_str.startswith("```json"):
                resp_str = resp_str[7:]
            if resp_str.endswith("```"):
                resp_str = resp_str[:-3]
            data = json.loads(resp_str.strip())
            inferred_action = data.get("action")
            feedback_text = data.get("feedback")
            custom_prereq = data.get("prereq_task")
    except Exception as e:
        print(f"[REFLECTION LOOP] LLM generation failed: {e}")

    # Heuristic fallback if LLM client is unavailable or failed
    if not inferred_action:
        ref_lower = reflection_text.lower()
        struggle_words = ["struggle", "hard", "difficult", "fail", "stuck", "confused", "lost", "tough", "error", "bug", "issue", "could not", "help", "need help", "add a task", "add task", "please help"]
        mastery_words = ["master", "easy", "breeze", "quick", "simple", "fluent", "fast", "perfect", "excellent", "confident", "easy peasy"]

        if any(w in ref_lower for w in struggle_words):
            inferred_action = "struggled"
            # Try to extract a specific topic from reflection_text to make fallback less vague
            custom_prereq = None
            if "edge mapping" in ref_lower:
                custom_prereq = "Review workflow edge mapping configurations"
            elif "mcp" in ref_lower or "model context" in ref_lower:
                custom_prereq = "Review Model Context Protocol (MCP) transport setup"
            elif "zero-trust" in ref_lower or "signature" in ref_lower:
                custom_prereq = "Practice Zero-Trust signature verification"
        elif any(w in ref_lower for w in mastery_words):
            inferred_action = "mastered"
        else:
            inferred_action = "on_track"

    if goal_id:
        goals = profile.get("goals", [])
        updated_goals = []
        for g in goals:
            if g.get("id") == goal_id:
                sub_projects = g.get("sub_projects", [])

                if inferred_action == "struggled":
                    adjustment_action = "insert_prerequisite_and_delay"
                    profile["preferred_difficulty"] = "beginner"

                    prereq_title = custom_prereq or f"Prerequisite Review: {g.get('title')} foundations"
                    adjustment_reason = f"Struggled with tasks. Added prerequisite task: '{prereq_title}' and shifted remaining due dates."
                    if not feedback_text:
                        feedback_text = f"I noticed you found this task challenging. I've added a prerequisite task ('{prereq_title}') and extended your milestone deadlines by 3 days to give you some room."

                    # Create prerequisite task
                    prereq = {
                        "title": f"Review: {prereq_title}",
                        "description": f"Targeted review block based on reflection.",
                        "dueDate": (datetime.date.today() + datetime.timedelta(days=2)).isoformat(),
                        "completed": False,
                        "tasks": [
                            {
                                "title": prereq_title,
                                "description": f"Review topic: {prereq_title} to build foundational understanding.",
                                "dueDate": (datetime.date.today() + datetime.timedelta(days=2)).isoformat(),
                                "estimated_time": "2 hours",
                                "resource": "Review workspace documents and guides.",
                                "completed": False
                            }
                        ]
                    }
                    sub_projects.insert(0, prereq)

                    # Shift due dates of all uncompleted milestones and nested tasks forward by 3 days
                    for milestone in sub_projects:
                        if milestone == prereq:
                            continue
                        if not milestone.get("completed") and milestone.get("dueDate"):
                            try:
                                d = datetime.date.fromisoformat(milestone["dueDate"])
                                new_date = max(datetime.date.today(), d + datetime.timedelta(days=3))
                                milestone["dueDate"] = new_date.isoformat()
                            except Exception:
                                pass
                        
                        for task in milestone.get("tasks", []):
                            if not task.get("completed") and task.get("dueDate"):
                                try:
                                    dt = datetime.date.fromisoformat(task["dueDate"])
                                    new_dt = max(datetime.date.today(), dt + datetime.timedelta(days=3))
                                    task["dueDate"] = new_dt.isoformat()
                                except Exception:
                                    pass

                elif inferred_action == "mastered":
                    adjustment_action = "accelerate_due_dates"
                    profile["preferred_difficulty"] = "advanced"
                    adjustment_reason = "Mastered tasks quickly. Shortened remaining due dates by 2 days."
                    if not feedback_text:
                        feedback_text = "Fantastic job mastering this so quickly! I've accelerated your remaining milestone due dates by 2 days."

                    # Shift due dates of all uncompleted milestones backward by 2 days
                    for milestone in sub_projects:
                        if not milestone.get("completed") and milestone.get("dueDate"):
                            try:
                                d = datetime.date.fromisoformat(milestone["dueDate"])
                                new_date = max(datetime.date.today(), d - datetime.timedelta(days=2))
                                milestone["dueDate"] = new_date.isoformat()
                            except Exception:
                                pass
                        
                        for task in milestone.get("tasks", []):
                            if not task.get("completed") and task.get("dueDate"):
                                try:
                                    dt = datetime.date.fromisoformat(task["dueDate"])
                                    new_dt = max(datetime.date.today(), dt - datetime.timedelta(days=2))
                                    task["dueDate"] = new_dt.isoformat()
                                except Exception:
                                    pass
                else:
                    adjustment_reason = "Learning is on track. No milestones adjusted."
                    if not feedback_text:
                        feedback_text = "Solid progress! Your learning pacing remains stable and on track."

                g["sub_projects"] = sub_projects
            updated_goals.append(g)
        profile["goals"] = updated_goals

    profile["adjustment_reason"] = feedback_text or adjustment_reason
    state_store.update_user_profile(profile)

    return {
        "status": "success",
        "logged_entry": log_entry,
        "adjustment_action": adjustment_action,
        "updated_profile": profile,
    }
