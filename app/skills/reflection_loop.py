import datetime
import json
import uuid
from typing import Any

from app.state_store import state_store

REFLECTION_GREETING = (
    "Hello! I'm your Reflection Agent. Share how your learning is going — I can add "
    "milestones or tasks when concepts feel hard, adjust due dates for incomplete work, "
    "recommend resources for specific questions, or help reorganize your plan. I won't "
    "remove anything unless you explicitly ask."
)

DELETE_CONFIRM_PHRASES = (
    "yes, delete",
    "yes delete",
    "confirm delete",
    "go ahead and delete",
    "please delete it",
    "delete it",
)


def _today() -> datetime.date:
    return datetime.date.today()


def _parse_date(value: str | None) -> datetime.date | None:
    if not value:
        return None
    try:
        return datetime.date.fromisoformat(value)
    except Exception:
        return None


def _infer_day_shift_from_text(reflection_text: str) -> int:
    ref_lower = reflection_text.lower()
    if "two week" in ref_lower or "2 week" in ref_lower or "fortnight" in ref_lower:
        return 14
    if "three week" in ref_lower or "3 week" in ref_lower:
        return 21
    if "month" in ref_lower:
        return 30
    if "few day" in ref_lower or "couple day" in ref_lower or "2 day" in ref_lower or "two day" in ref_lower:
        return 3
    if "three day" in ref_lower or "3 day" in ref_lower:
        return 3
    if "five day" in ref_lower or "5 day" in ref_lower:
        return 5
    if "week" in ref_lower or "7 day" in ref_lower:
        return 7
    if any(w in ref_lower for w in ("later", "delay", "extend", "push", "reschedule", "more time", "buffer")):
        return 7
    return 0


def _shift_incomplete_due_dates(sub_projects: list[dict[str, Any]], day_delta: int) -> None:
    today = _today()
    for milestone in sub_projects:
        if milestone.get("completed"):
            continue
        due = _parse_date(milestone.get("dueDate"))
        if due is not None:
            milestone["dueDate"] = max(today, due + datetime.timedelta(days=day_delta)).isoformat()
        for task in milestone.get("tasks", []):
            if task.get("completed"):
                continue
            task_due = _parse_date(task.get("dueDate"))
            if task_due is not None:
                task["dueDate"] = max(today, task_due + datetime.timedelta(days=day_delta)).isoformat()


def _summarize_goal_for_prompt(goal: dict[str, Any]) -> str:
    lines = [f"Goal: {goal.get('title', 'Untitled')}"]
    for m_idx, milestone in enumerate(goal.get("sub_projects", [])):
        status = "completed" if milestone.get("completed") else "incomplete"
        lines.append(
            f"  Milestone[{m_idx}] ({status}): {milestone.get('title')} "
            f"(due {milestone.get('dueDate', 'n/a')})"
        )
        for t_idx, task in enumerate(milestone.get("tasks", [])):
            t_status = "completed" if task.get("completed") else "incomplete"
            lines.append(
                f"    Task[{m_idx}.{t_idx}] ({t_status}): {task.get('title')} "
                f"(due {task.get('dueDate', 'n/a')}, resource: {task.get('resource', 'none')})"
            )
    return "\n".join(lines)


def _build_reflection_prompt(goal: dict[str, Any], reflection_text: str) -> str:
    return (
        f"Current goal structure:\n{_summarize_goal_for_prompt(goal)}\n\n"
        f"User reflection / instruction:\n{reflection_text}"
    )


def _parse_llm_plan(raw: str) -> dict[str, Any] | None:
    text = raw.strip()
    if text.startswith("```json"):
        text = text[7:]
    if text.startswith("```"):
        text = text[3:]
    if text.endswith("```"):
        text = text[:-3]
    try:
        return json.loads(text.strip())
    except Exception:
        return None


def _infer_plan_heuristic(reflection_text: str, goal: dict[str, Any]) -> dict[str, Any]:
    ref_lower = reflection_text.lower()
    plan: dict[str, Any] = {
        "action": "on_track",
        "feedback": "Thanks for the update — your learning plan looks on track.",
        "new_milestones": [],
        "new_tasks": [],
        "date_adjustments": [],
        "resource_recommendations": [],
        "deletion_request": None,
        "day_shift": 0,
    }

    delete_words = ("delete", "remove", "drop")
    if any(w in ref_lower for w in delete_words):
        plan["action"] = "request_deletion"
        plan["feedback"] = (
            "I can remove items only when you explicitly ask. "
            "Please confirm exactly what to delete (milestone, task, or resource) "
            "and reply with 'confirm delete' to proceed."
        )
        plan["deletion_request"] = {"type": "unspecified", "milestone_index": None, "task_index": None}
        return plan

    struggle_words = (
        "struggle", "hard", "difficult", "fail", "stuck", "confused", "lost",
        "tough", "too hard", "need help", "add a milestone", "add milestone",
        "add a task", "add task", "new milestone", "new task",
    )
    if any(w in ref_lower for w in struggle_words):
        plan["action"] = "add_content"
        title = "Foundational review"
        if "mlops" in ref_lower and "secur" in ref_lower:
            title = "Advanced MLOps model security"
        elif "mcp" in ref_lower:
            title = "Model Context Protocol deep dive"
        plan["new_milestones"] = [{
            "title": title,
            "description": "Added because you found related concepts challenging.",
            "dueDate": (_today() + datetime.timedelta(days=5)).isoformat(),
            "completed": False,
            "tasks": [{
                "title": f"Practice: {title}",
                "description": "Hands-on review to build confidence on this topic.",
                "dueDate": (_today() + datetime.timedelta(days=4)).isoformat(),
                "estimated_time": "2 hours",
                "resource": "Official documentation and guided tutorials.",
                "completed": False,
            }],
        }]
        plan["day_shift"] = 3
        plan["feedback"] = (
            f"I added a focused milestone on '{title}' and pushed incomplete due dates "
            "forward by 3 days so you have room to catch up."
        )
        return plan

    reschedule_words = (
        "reschedule", "extend", "delay", "later", "further date",
        "more time", "due date", "timeline", "buffer", "one week", "two week",
    )
    wants_reschedule = any(w in ref_lower for w in reschedule_words) or (
        "push" in ref_lower and "back" in ref_lower
    )
    if wants_reschedule:
        plan["action"] = "adjust_dates"
        plan["day_shift"] = _infer_day_shift_from_text(reflection_text) or 7
        plan["feedback"] = (
            f"I've pushed incomplete milestone and task due dates forward by "
            f"{plan['day_shift']} days based on your request."
        )
        return plan

    resource_words = ("resource", "recommend", "suggest", "learn more", "where can i", "what should i read")
    if any(w in ref_lower for w in resource_words) or "?" in reflection_text:
        plan["action"] = "recommend_resource"
        topic = reflection_text.strip().rstrip("?")
        plan["resource_recommendations"] = [{
            "task_title": None,
            "resource": (
                f"For '{topic[:80]}', try the official docs, a focused tutorial series, "
                "and a short hands-on lab to reinforce the concept."
            ),
        }]
        plan["feedback"] = (
            "Here are resource suggestions for your question. "
            "I've noted them so you can attach them to the relevant task."
        )
        return plan

    return plan


def _analyze_reflection_with_llm(goal: dict[str, Any], reflection_text: str) -> dict[str, Any] | None:
    try:
        from google.genai import Client, types

        client = None
        try:
            client = Client()
        except Exception:
            client = Client(vertexai=True)

        if not client:
            return None

        today_str = _today().isoformat()
        system_prompt = f"""
You are the Reflection Agent for a career upskilling concierge.
Today's date is {today_str}.

Analyze the user's reflection and current goal structure. Return ONLY valid JSON with:
{{
  "action": "add_content" | "adjust_dates" | "recommend_resource" | "request_deletion" | "on_track",
  "feedback": "Short encouraging reply explaining what you did or will do.",
  "new_milestones": [optional milestone objects with title, description, dueDate, completed, tasks[]],
  "new_tasks": [{{"milestone_index": 0, "task": {{title, description, dueDate, estimated_time, resource, completed}}}}],
  "date_adjustments": [{{"target": "milestone"|"task", "milestone_index": 0, "task_index": null, "new_due_date": "YYYY-MM-DD"}}],
  "resource_recommendations": [{{"task_title": "optional match", "resource": "specific resource suggestion"}}],
  "deletion_request": null | {{"type": "milestone"|"task"|"resource", "milestone_index": 0, "task_index": null}},
  "day_shift": 0
}}

Rules:
1. If the user finds concepts hard or asks to add milestones/tasks, use action "add_content" and create specific milestones/tasks.
2. If the user asks to reschedule or extend timelines, use "adjust_dates" with day_shift (positive = later) or explicit date_adjustments for incomplete items only.
3. If the user asks a learning question, use "recommend_resource" with concrete resource suggestions.
4. NEVER set deletion_request unless the user EXPLICITLY asks to delete/remove/drop a milestone, task, or resource.
5. Do not delete anything in this response — only populate deletion_request when explicitly requested.
6. Only adjust due dates for incomplete milestones and tasks.
7. Make milestone/task titles specific to what the user mentioned — never generic placeholders.
"""
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=_build_reflection_prompt(goal, reflection_text),
            config=types.GenerateContentConfig(
                system_instruction=system_prompt,
                temperature=0.2,
            ),
        )
        return _parse_llm_plan(response.text)
    except Exception as e:
        print(f"[REFLECTION LOOP] LLM generation failed: {e}")
        return None


def _user_confirmed_deletion(reflection_text: str) -> bool:
    ref_lower = reflection_text.lower().strip()
    return any(phrase in ref_lower for phrase in DELETE_CONFIRM_PHRASES)


def _apply_deletion(sub_projects: list[dict[str, Any]], deletion: dict[str, Any]) -> bool:
    dtype = deletion.get("type")
    m_idx = deletion.get("milestone_index")
    t_idx = deletion.get("task_index")

    if dtype == "milestone" and m_idx is not None and 0 <= m_idx < len(sub_projects):
        sub_projects.pop(m_idx)
        return True

    if dtype == "task" and m_idx is not None and t_idx is not None:
        milestone = sub_projects[m_idx] if 0 <= m_idx < len(sub_projects) else None
        if milestone and 0 <= t_idx < len(milestone.get("tasks", [])):
            milestone["tasks"].pop(t_idx)
            return True

    if dtype == "resource" and m_idx is not None and t_idx is not None:
        milestone = sub_projects[m_idx] if 0 <= m_idx < len(sub_projects) else None
        if milestone and 0 <= t_idx < len(milestone.get("tasks", [])):
            milestone["tasks"][t_idx]["resource"] = ""
            return True

    return False


def _apply_resource_recommendations(
    sub_projects: list[dict[str, Any]],
    recommendations: list[dict[str, Any]],
) -> list[str]:
    applied: list[str] = []
    for rec in recommendations:
        resource = rec.get("resource", "").strip()
        if not resource:
            continue
        task_title = (rec.get("task_title") or "").lower().strip()
        matched = False
        if task_title:
            for milestone in sub_projects:
                for task in milestone.get("tasks", []):
                    if task_title in task.get("title", "").lower():
                        task["resource"] = resource
                        matched = True
                        applied.append(f"Updated resource for '{task.get('title')}'.")
                        break
                if matched:
                    break
        if not matched:
            applied.append(resource)
    return applied


def _apply_reflection_plan(
    goal: dict[str, Any],
    plan: dict[str, Any],
    *,
    confirm_deletion: bool,
    reflection_text: str,
) -> tuple[dict[str, Any], str, str, dict[str, Any] | None]:
    sub_projects = list(goal.get("sub_projects", []))
    action = plan.get("action", "on_track")
    feedback = plan.get("feedback", "Thanks for sharing your reflection.")
    adjustment_action = action
    pending_deletion = None

    deletion_request = plan.get("deletion_request")
    if deletion_request and action == "request_deletion":
        if confirm_deletion or _user_confirmed_deletion(reflection_text):
            if _apply_deletion(sub_projects, deletion_request):
                feedback = "Confirmed — I've removed the item you requested."
                adjustment_action = "deleted_item"
            else:
                feedback = (
                    "I couldn't find the exact item to delete. Please specify the milestone "
                    "or task title and ask again with 'confirm delete'."
                )
                adjustment_action = "delete_failed"
        else:
            target = deletion_request.get("type", "item")
            feedback = (
                f"You asked to delete a {target}. Please confirm by replying with "
                "'confirm delete' before I remove anything."
            )
            pending_deletion = deletion_request
            adjustment_action = "pending_deletion"
            goal["sub_projects"] = sub_projects
            goal["pending_deletion"] = pending_deletion
            return goal, feedback, adjustment_action, pending_deletion

    goal.pop("pending_deletion", None)

    for milestone in plan.get("new_milestones", []):
        milestone.setdefault("completed", False)
        milestone.setdefault("tasks", [])
        milestone["dueDate"] = milestone.get("dueDate") or (_today() + datetime.timedelta(days=5)).isoformat()
        sub_projects.append(milestone)
        adjustment_action = "add_content"

    for task_add in plan.get("new_tasks", []):
        m_idx = task_add.get("milestone_index", 0)
        task = task_add.get("task", {})
        if 0 <= m_idx < len(sub_projects):
            task.setdefault("completed", False)
            task.setdefault("dueDate", (_today() + datetime.timedelta(days=3)).isoformat())
            sub_projects[m_idx].setdefault("tasks", []).append(task)
            adjustment_action = "add_content"

    day_shift = int(plan.get("day_shift") or 0)
    if action == "adjust_dates" and day_shift <= 0 and not plan.get("date_adjustments"):
        day_shift = _infer_day_shift_from_text(reflection_text)
    if day_shift:
        _shift_incomplete_due_dates(sub_projects, day_shift)
        if adjustment_action not in ("add_content", "pending_deletion", "deleted_item"):
            adjustment_action = "adjust_dates"

    for adj in plan.get("date_adjustments", []):
        m_idx = adj.get("milestone_index")
        t_idx = adj.get("task_index")
        new_due = adj.get("new_due_date")
        if m_idx is None or not new_due:
            continue
        if adj.get("target") == "task" and t_idx is not None:
            milestone = sub_projects[m_idx] if 0 <= m_idx < len(sub_projects) else None
            if milestone and 0 <= t_idx < len(milestone.get("tasks", [])):
                task = milestone["tasks"][t_idx]
                if not task.get("completed"):
                    task["dueDate"] = new_due
                    adjustment_action = "adjust_dates"
        elif 0 <= m_idx < len(sub_projects):
            milestone = sub_projects[m_idx]
            if not milestone.get("completed"):
                milestone["dueDate"] = new_due
                adjustment_action = "adjust_dates"

    resource_notes = _apply_resource_recommendations(sub_projects, plan.get("resource_recommendations", []))
    if resource_notes:
        adjustment_action = "recommend_resource"
        extra = " ".join(resource_notes)
        if extra not in feedback:
            feedback = f"{feedback}\n\n{extra}"

    goal["sub_projects"] = sub_projects
    return goal, feedback, adjustment_action, pending_deletion


def process_user_reflection(
    user_id: str,
    learning_block_id: str,
    reflection_text: str,
    success_rating: int | None = None,
    goal_id: str | None = None,
    confirm_deletion: bool = False,
) -> dict[str, Any]:
    """Process reflection chat: add milestones/tasks, adjust dates, recommend resources, or confirm deletions."""
    log_entry = {
        "learning_block_id": learning_block_id,
        "goal_id": goal_id,
        "reflection_text": reflection_text,
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
    }
    if success_rating is not None:
        log_entry["success_rating"] = success_rating
    state_store.add_work_log_entry(log_entry)

    profile = state_store.get_user_profile()
    adjustment_action = "none"
    feedback_text = "Thanks for sharing your reflection."
    pending_deletion = None

    if not goal_id:
        profile["adjustment_reason"] = feedback_text
        state_store.update_user_profile(profile)
        return {
            "status": "success",
            "logged_entry": log_entry,
            "adjustment_action": adjustment_action,
            "feedback": feedback_text,
            "pending_deletion": None,
            "updated_profile": profile,
        }

    goals = profile.get("goals", [])
    target_goal = next((g for g in goals if g.get("id") == goal_id), None)
    if not target_goal:
        profile["adjustment_reason"] = "Goal not found."
        state_store.update_user_profile(profile)
        return {
            "status": "success",
            "logged_entry": log_entry,
            "adjustment_action": "none",
            "feedback": "I couldn't find that goal.",
            "pending_deletion": None,
            "updated_profile": profile,
        }

    plan = _analyze_reflection_with_llm(target_goal, reflection_text)
    if not plan:
        plan = _infer_plan_heuristic(reflection_text, target_goal)

    updated_goal, feedback_text, adjustment_action, pending_deletion = _apply_reflection_plan(
        target_goal,
        plan,
        confirm_deletion=confirm_deletion,
        reflection_text=reflection_text,
    )

    goal_patch: dict[str, Any] = {"sub_projects": updated_goal.get("sub_projects", [])}
    if updated_goal.get("pending_deletion"):
        goal_patch["pending_deletion"] = updated_goal["pending_deletion"]
    elif target_goal.get("pending_deletion"):
        goal_patch["pending_deletion"] = None

    state_store.update_goal(goal_id, goal_patch)
    state_store.update_user_profile({"adjustment_reason": feedback_text})

    profile = state_store.get_user_profile()
    profile["goals"] = state_store.get_goals()

    return {
        "status": "success",
        "logged_entry": log_entry,
        "adjustment_action": adjustment_action,
        "feedback": feedback_text,
        "pending_deletion": pending_deletion,
        "updated_profile": profile,
    }


def get_reflection_greeting() -> str:
    return REFLECTION_GREETING


def archive_reflection_conversation(goal_id: str) -> dict[str, Any]:
    profile = state_store.get_user_profile()
    goals = profile.get("goals", [])
    archived_entry = None

    for g in goals:
        if g.get("id") != goal_id:
            continue
        messages = g.get("reflection_messages") or g.get("conversations") or []
        if len(messages) > 1:
            first_user = next((m for m in messages if m.get("role") == "user"), None)
            title = "Reflection"
            if first_user:
                snippet = first_user.get("text", "")[:48]
                title = snippet + ("..." if len(first_user.get("text", "")) > 48 else "")
            archived = g.setdefault("archived_reflection_conversations", [])
            archived_entry = {
                "id": f"arch-{uuid.uuid4().hex[:8]}",
                "title": title,
                "messages": messages,
                "archived_at": datetime.datetime.utcnow().isoformat() + "Z",
            }
            archived.insert(0, archived_entry)
        g["reflection_messages"] = [{"role": "model", "text": REFLECTION_GREETING}]
        g["conversations"] = g["reflection_messages"]
        break

    state_store.update_user_profile(profile)
    return {"status": "success", "archived": archived_entry, "goals": state_store.get_goals()}


def new_reflection_conversation(goal_id: str) -> dict[str, Any]:
    return archive_reflection_conversation(goal_id)


def delete_reflection_archived_conversation(goal_id: str, archive_id: str) -> dict[str, Any]:
    profile = state_store.get_user_profile()
    goals = profile.get("goals", [])

    for g in goals:
        if g.get("id") != goal_id:
            continue
        archived = g.get("archived_reflection_conversations", [])
        filtered = [entry for entry in archived if entry.get("id") != archive_id]
        if len(filtered) == len(archived):
            return {"status": "not_found", "goals": state_store.get_goals()}
        state_store.update_goal(goal_id, {"archived_reflection_conversations": filtered})
        return {"status": "success", "goals": state_store.get_goals()}

    return {"status": "not_found", "goals": state_store.get_goals()}


def delete_builder_archived_conversation(archive_id: str) -> dict[str, Any]:
    profile = state_store.get_user_profile()
    archived = profile.get("builder_archived_conversations", [])
    filtered = [entry for entry in archived if entry.get("id") != archive_id]

    if len(filtered) == len(archived):
        return {
            "status": "not_found",
            "builder_archived_conversations": archived,
        }

    profile["builder_archived_conversations"] = filtered
    state_store.update_user_profile({"builder_archived_conversations": filtered})
    return {
        "status": "success",
        "builder_archived_conversations": filtered,
    }


def archive_builder_conversation() -> dict[str, Any]:
    profile = state_store.get_user_profile()
    messages = profile.get("builder_messages", [])
    archived_entry = None

    if len(messages) > 1:
        first_user = next((m for m in messages if m.get("role") == "user"), None)
        title = "Goal builder chat"
        if first_user:
            snippet = first_user.get("text", "")[:48]
            title = snippet + ("..." if len(first_user.get("text", "")) > 48 else "")
        archived = profile.setdefault("builder_archived_conversations", [])
        archived_entry = {
            "id": f"arch-{uuid.uuid4().hex[:8]}",
            "title": title,
            "messages": messages,
            "archived_at": datetime.datetime.utcnow().isoformat() + "Z",
        }
        archived.insert(0, archived_entry)

    greeting = (
        "Hello! I am your Skill Concierge assistant. Let's discuss your career aspirations "
        "and design high-impact learning goals and weekly projects to get you there."
    )
    profile["builder_messages"] = [{"role": "model", "text": greeting}]
    state_store.update_user_profile(profile)
    return {
        "status": "success",
        "archived": archived_entry,
        "builder_messages": profile["builder_messages"],
        "builder_archived_conversations": profile.get("builder_archived_conversations", []),
    }
