import json
import os
from abc import ABC, abstractmethod
from typing import Any


class BaseStateStore(ABC):
    @abstractmethod
    def get_user_profile(self) -> dict[str, Any]:
        """Retrieve the user profile containing goals, preferences, and market mapping."""
        pass

    @abstractmethod
    def update_user_profile(self, profile: dict[str, Any]) -> None:
        """Update/save the user profile."""
        pass

    @abstractmethod
    def get_work_log(self) -> list[dict[str, Any]]:
        """Retrieve all work log/reflection entries."""
        pass

    @abstractmethod
    def add_work_log_entry(self, entry: dict[str, Any]) -> None:
        """Add a new reflection or logged learning block entry."""
        pass

    @abstractmethod
    def set_work_log(self, entries: list[dict[str, Any]]) -> None:
        """Replace the full work log."""
        pass

    @abstractmethod
    def get_goals(self) -> list[dict[str, Any]]:
        """Retrieve all goals for the user."""
        pass

    @abstractmethod
    def update_goal(self, goal_id: str, goal_data: dict[str, Any]) -> None:
        """Update a specific goal."""
        pass

    @abstractmethod
    def create_goal(self, goal_data: dict[str, Any]) -> None:
        """Create a new goal."""
        pass

    @abstractmethod
    def get_reflections_for_goal(self, goal_id: str) -> list[dict[str, Any]]:
        """Retrieve all reflections associated with a specific goal."""
        pass

    @abstractmethod
    def reset(self) -> None:
        """Reset the state store (clear user profile and work log)."""
        pass



def adjust_past_due_dates(sub_projects: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Checks all sub-projects/milestones and ensures their due dates are not in the past."""
    import datetime
    today = datetime.date.today()
    for milestone in sub_projects:
        due_date_str = milestone.get("dueDate")
        if due_date_str:
            try:
                due_date = datetime.date.fromisoformat(due_date_str)
                if due_date < today:
                    milestone["dueDate"] = today.isoformat()
            except Exception:
                pass
        
        # Adjust nested tasks if present
        for task in milestone.get("tasks", []):
            task_due_str = task.get("dueDate")
            if task_due_str:
                try:
                    task_due = datetime.date.fromisoformat(task_due_str)
                    if task_due < today:
                        task["dueDate"] = today.isoformat()
                except Exception:
                    pass
    return sub_projects


def _pace_goal_subprojects(
    goal: dict[str, Any],
    allocate_hours: Any,
) -> None:
    """Assign due dates to a single goal's incomplete milestones/tasks."""
    import datetime

    for m in goal.get("sub_projects", []):
        tasks = m.get("tasks", [])
        if tasks:
            task_dates: list[datetime.date] = []
            for t in tasks:
                if t.get("completed"):
                    continue
                from app.scheduling_utils import task_remaining_hours

                remaining_hours = task_remaining_hours(t)
                if remaining_hours > 0:
                    due = allocate_hours(remaining_hours)
                    t["dueDate"] = due.isoformat()
                    task_dates.append(due)
                elif t.get("dueDate"):
                    try:
                        task_dates.append(datetime.date.fromisoformat(t["dueDate"]))
                    except ValueError:
                        pass

            if task_dates:
                m["dueDate"] = max(task_dates).isoformat()
            elif not m.get("completed"):
                m["dueDate"] = allocate_hours(0).isoformat()
        elif not m.get("completed"):
            due = allocate_hours(3.0)
            m["dueDate"] = due.isoformat()


def _snapshot_goal_due_dates(goals: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    """Capture milestone/task due dates keyed by goal id."""
    snapshot: dict[str, dict[str, str]] = {}
    for g in goals:
        goal_id = g.get("id", g.get("title", ""))
        dates: dict[str, str] = {}
        for m_idx, m in enumerate(g.get("sub_projects", [])):
            if m.get("dueDate"):
                dates[f"m:{m_idx}"] = m["dueDate"]
            for t_idx, t in enumerate(m.get("tasks", [])):
                if t.get("dueDate"):
                    dates[f"t:{m_idx}:{t_idx}"] = t["dueDate"]
        snapshot[goal_id] = dates
    return snapshot


def _snapshot_single_goal_due_dates(goal: dict[str, Any]) -> dict[str, str]:
    """Capture due dates for one goal's milestones and tasks."""
    goal_id = goal.get("id", goal.get("title", ""))
    return _snapshot_goal_due_dates([goal]).get(goal_id, {})


def _apply_goal_due_dates_snapshot(goal: dict[str, Any], snapshot: dict[str, str]) -> None:
    """Restore milestone/task due dates from a per-goal snapshot."""
    for m_idx, m in enumerate(goal.get("sub_projects", [])):
        milestone_key = f"m:{m_idx}"
        if milestone_key in snapshot:
            m["dueDate"] = snapshot[milestone_key]
        for t_idx, t in enumerate(m.get("tasks", [])):
            task_key = f"t:{m_idx}:{t_idx}"
            if task_key in snapshot:
                t["dueDate"] = snapshot[task_key]


def _diff_goal_due_dates(
    before: dict[str, dict[str, str]],
    after_goals: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Return a list of due-date changes between snapshots."""
    changes: list[dict[str, Any]] = []
    for g in after_goals:
        goal_id = g.get("id", g.get("title", ""))
        prev = before.get(goal_id, {})
        for m_idx, m in enumerate(g.get("sub_projects", [])):
            key = f"m:{m_idx}"
            new_due = m.get("dueDate")
            if new_due and prev.get(key) != new_due:
                changes.append({
                    "goal_id": goal_id,
                    "goal_title": g.get("title"),
                    "target": "milestone",
                    "milestone_index": m_idx,
                    "milestone_title": m.get("title"),
                    "old_due_date": prev.get(key),
                    "new_due_date": new_due,
                })
            for t_idx, t in enumerate(m.get("tasks", [])):
                key = f"t:{m_idx}:{t_idx}"
                new_due = t.get("dueDate")
                if new_due and prev.get(key) != new_due:
                    changes.append({
                        "goal_id": goal_id,
                        "goal_title": g.get("title"),
                        "target": "task",
                        "milestone_index": m_idx,
                        "task_index": t_idx,
                        "task_title": t.get("title"),
                        "old_due_date": prev.get(key),
                        "new_due_date": new_due,
                    })
    return changes


def pace_and_schedule_goals(
    profile: dict[str, Any],
    busy_slots: list[dict[str, Any]] | None = None,
    *,
    preserve_goal_ids: set[str] | None = None,
) -> dict[str, Any]:
    """Paces due dates for active goals using a two-phase, priority-aware allocator.

    Phase 1 schedules high/medium urgency work from today. Phase 2 schedules
    low-urgency work after phase 1 completes. Capacity warnings focus on
    near-term (high/medium) workload within the planning horizon.
    """
    import datetime
    from app.scheduling_utils import (
        NEAR_TERM_PRIORITY_THRESHOLD,
        compute_schedule_capacity,
        get_goal_priority,
        is_schedulable_goal,
        normalize_priority,
        schedulable_goals,
    )

    today = datetime.date.today()
    base_date = max(today, datetime.date(2026, 7, 2))

    study_days = profile.get("study_days", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"])
    if not study_days:
        study_days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]

    hours_per_week = profile.get("hours_per_week", 5)
    daily_budget = hours_per_week / len(study_days) if len(study_days) > 0 else 1.0

    goals = profile.get("goals", [])
    for g in goals:
        g["priority"] = normalize_priority(g.get("priority", 1))
        g.pop("scheduling_warning", None)

    active_goals = sorted(
        schedulable_goals(goals),
        key=lambda g: (-get_goal_priority(g), goals.index(g)),
    )

    near_term_goals = [g for g in active_goals if get_goal_priority(g) >= NEAR_TERM_PRIORITY_THRESHOLD]
    deferred_goals = [g for g in active_goals if get_goal_priority(g) < NEAR_TERM_PRIORITY_THRESHOLD]

    current_date = base_date
    allocated_hours_today = 0.0

    def is_study_day(date_obj: datetime.date) -> bool:
        return date_obj.strftime("%A") in study_days

    def allocate_hours(hours_needed: float) -> datetime.date:
        nonlocal current_date, allocated_hours_today
        if hours_needed <= 0:
            return current_date
        while hours_needed > 0:
            if not is_study_day(current_date):
                current_date += datetime.timedelta(days=1)
                allocated_hours_today = 0.0
                continue

            available_today = max(0.0, daily_budget - allocated_hours_today)
            if available_today >= hours_needed:
                allocated_hours_today += hours_needed
                hours_needed = 0.0
            else:
                hours_needed -= available_today
                current_date += datetime.timedelta(days=1)
                allocated_hours_today = 0.0
        return current_date

    for g in near_term_goals:
        if preserve_goal_ids and g.get("id") in preserve_goal_ids:
            continue
        _pace_goal_subprojects(g, allocate_hours)

    for g in deferred_goals:
        if preserve_goal_ids and g.get("id") in preserve_goal_ids:
            continue
        _pace_goal_subprojects(g, allocate_hours)

    capacity = compute_schedule_capacity(profile)
    warning = capacity.get("warning")
    warning_type = capacity.get("warning_type")
    deferred_note = capacity.get("deferred_note")

    if warning:
        profile["schedule_capacity_warning"] = warning
        profile["schedule_capacity"] = capacity
        for g in active_goals:
            if not is_schedulable_goal(g):
                continue
            if warning_type == "horizon_overload":
                g["scheduling_warning"] = warning
            elif get_goal_priority(g) >= NEAR_TERM_PRIORITY_THRESHOLD:
                g["scheduling_warning"] = warning
            elif deferred_note:
                g["scheduling_warning"] = deferred_note
    else:
        profile.pop("schedule_capacity_warning", None)
        profile["schedule_capacity"] = capacity
        if deferred_note:
            for g in deferred_goals:
                g["scheduling_deferred_note"] = deferred_note
        else:
            for g in goals:
                g.pop("scheduling_deferred_note", None)

    return profile


def pause_lower_priority_goals(profile: dict[str, Any]) -> list[dict[str, Any]]:
    """Put active lower-priority goals on hold so urgent work can proceed first."""
    from app.scheduling_utils import get_goal_priority, is_schedulable_goal

    goals = profile.get("goals", [])
    active = [g for g in goals if is_schedulable_goal(g)]
    if not active:
        return []

    max_priority = max(get_goal_priority(g) for g in active)
    paused: list[dict[str, Any]] = []
    for g in goals:
        if not is_schedulable_goal(g):
            continue
        if get_goal_priority(g) < max_priority:
            previous_status = g.get("status")
            g["pre_pause_due_dates"] = _snapshot_single_goal_due_dates(g)
            g["status"] = "on-hold"
            g["on_hold_reason"] = "Paused to focus on higher-priority projects"
            paused.append({
                "goal_id": g.get("id"),
                "goal_title": g.get("title"),
                "previous_status": previous_status,
            })
    return paused


def resume_goals_from_hold(
    profile: dict[str, Any],
    goal_ids: list[str] | None = None,
) -> tuple[list[dict[str, Any]], set[str]]:
    """Move on-hold goals back to to-do, restoring pre-pause due dates."""
    from app.scheduling_utils import is_on_hold_goal

    resumed: list[dict[str, Any]] = []
    resumed_ids: set[str] = set()
    for g in profile.get("goals", []):
        if not is_on_hold_goal(g):
            continue
        if goal_ids is not None and g.get("id") not in goal_ids:
            continue
        snapshot = g.pop("pre_pause_due_dates", None)
        if snapshot:
            _apply_goal_due_dates_snapshot(g, snapshot)
        g["status"] = "to-do"
        g.pop("on_hold_reason", None)
        goal_id = g.get("id")
        if goal_id:
            resumed_ids.add(goal_id)
        resumed.append({
            "goal_id": goal_id,
            "goal_title": g.get("title"),
        })
    return resumed, resumed_ids


def apply_resume_goals_from_hold(
    profile: dict[str, Any],
    goal_ids: list[str] | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Resume paused goals and rebalance other projects around restored due dates."""
    resumed, resumed_ids = resume_goals_from_hold(profile, goal_ids=goal_ids)
    if not resumed:
        return profile, []
    paced = pace_and_schedule_goals(profile, preserve_goal_ids=resumed_ids)
    return paced, resumed


def refresh_goals_if_past_due(profile: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    """Re-pace goals when incomplete work has due dates in the past."""
    from app.scheduling_utils import has_past_due_incomplete_work

    if not has_past_due_incomplete_work(profile.get("goals", [])):
        return profile, False
    return pace_and_schedule_goals(profile), True


def attach_capacity_warnings(profile: dict[str, Any]) -> dict[str, Any]:
    """Refresh schedule-capacity warnings on goals without re-pacing due dates."""
    from app.scheduling_utils import (
        NEAR_TERM_PRIORITY_THRESHOLD,
        compute_schedule_capacity,
        get_goal_priority,
        is_schedulable_goal,
    )

    goals = profile.get("goals", [])
    for g in goals:
        g.pop("scheduling_warning", None)
        g.pop("scheduling_deferred_note", None)

    capacity = compute_schedule_capacity(profile)
    warning = capacity.get("warning")
    warning_type = capacity.get("warning_type")
    deferred_note = capacity.get("deferred_note")

    if warning:
        profile["schedule_capacity_warning"] = warning
        profile["schedule_capacity"] = capacity
        for g in goals:
            if not is_schedulable_goal(g):
                continue
            if warning_type == "horizon_overload":
                g["scheduling_warning"] = warning
            elif get_goal_priority(g) >= NEAR_TERM_PRIORITY_THRESHOLD:
                g["scheduling_warning"] = warning
            elif deferred_note:
                g["scheduling_warning"] = deferred_note
    else:
        profile.pop("schedule_capacity_warning", None)
        profile["schedule_capacity"] = capacity
        if deferred_note:
            for g in goals:
                if is_schedulable_goal(g) and get_goal_priority(g) < NEAR_TERM_PRIORITY_THRESHOLD:
                    g["scheduling_deferred_note"] = deferred_note

    return profile


def build_schedule_rebalance_preview(
    profile: dict[str, Any],
    *,
    pause_lower_priority: bool = False,
    hours_per_week: float | None = None,
) -> dict[str, Any]:
    """Preview priority-aware due-date changes without persisting."""
    import copy

    preview = copy.deepcopy(profile)
    if hours_per_week is not None:
        preview["hours_per_week"] = hours_per_week

    before = _snapshot_goal_due_dates(preview.get("goals", []))
    paused: list[dict[str, Any]] = []
    if pause_lower_priority:
        paused = pause_lower_priority_goals(preview)

    paced = pace_and_schedule_goals(preview)
    changes = _diff_goal_due_dates(before, paced.get("goals", []))
    capacity = paced.get("schedule_capacity") or {}

    return {
        "changes": changes,
        "paused_goals": paused,
        "capacity": capacity,
        "schedule_capacity_warning": paced.get("schedule_capacity_warning"),
        "goals": paced.get("goals", []),
        "hours_per_week": paced.get("hours_per_week"),
    }


def apply_schedule_rebalance(
    profile: dict[str, Any],
    *,
    pause_lower_priority: bool = False,
    hours_per_week: float | None = None,
) -> dict[str, Any]:
    """Apply priority-aware pacing and optional lower-priority pause."""
    if hours_per_week is not None:
        profile["hours_per_week"] = hours_per_week

    before = _snapshot_goal_due_dates(profile.get("goals", []))
    paused: list[dict[str, Any]] = []
    if pause_lower_priority:
        paused = pause_lower_priority_goals(profile)

    paced = pace_and_schedule_goals(profile)
    changes = _diff_goal_due_dates(before, paced.get("goals", []))
    paced["schedule_rebalance"] = {
        "changes": changes,
        "paused_goals": paused,
    }
    return paced


def update_tasks_allocated_time(profile: dict[str, Any]) -> None:
    """Updates the 'allocated_time_mins' field for every task in the profile's goals
    based on the currently approved/confirmed events in 'scheduled_events'.
    """
    import datetime
    scheduled_events = profile.get("scheduled_events", [])
    goals = profile.get("goals", [])
    
    # Initialize all tasks' allocated_time_mins to 0 first
    for g in goals:
        for m in g.get("sub_projects", []):
            for t in m.get("tasks", []):
                t["allocated_time_mins"] = 0
                
    for event in scheduled_events:
        summary = event.get("summary", "")
        goal_title = ""
        task_title = ""
        if " - " in summary:
            parts = summary.split(" - ", 1)
            if parts[0].startswith("Learning: "):
                goal_title = parts[0][len("Learning: "):].strip()
            elif parts[0].startswith("Micro-learning: "):
                goal_title = parts[0][len("Micro-learning: "):].strip()
            else:
                goal_title = parts[0].strip()
            task_title = parts[1].strip()
        elif summary.startswith("Learning: "):
            goal_title = summary[len("Learning: "):].strip()
        elif summary.startswith("Micro-learning: "):
            goal_title = summary[len("Micro-learning: "):].strip()
            
        if not goal_title or not task_title:
            continue
            
        # Parse duration of the event
        start_str = event.get("start")
        end_str = event.get("end")
        if not start_str or not end_str:
            continue
        try:
            start_dt = datetime.datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            end_dt = datetime.datetime.fromisoformat(end_str.replace("Z", "+00:00"))
            duration_mins = int((end_dt - start_dt).total_seconds() / 60)
        except Exception:
            duration_mins = 0
            
        if duration_mins <= 0:
            continue
            
        # Find matching task and accumulate
        for g in goals:
            if g.get("title") == goal_title:
                for m in g.get("sub_projects", []):
                    for t in m.get("tasks", []):
                        if t.get("title") == task_title:
                            t["allocated_time_mins"] = t.get("allocated_time_mins", 0) + duration_mins


class LocalJsonStateStore(BaseStateStore):
    def __init__(self, data_dir: str = ".state"):
        self.data_dir = data_dir
        os.makedirs(self.data_dir, exist_ok=True)
        self.profile_path = os.path.join(self.data_dir, "user_profile.json")
        self.work_log_path = os.path.join(self.data_dir, "work_log.json")

        # Initialize files if they don't exist
        if not os.path.exists(self.profile_path):
            self._write_json(self.profile_path, {})
        if not os.path.exists(self.work_log_path):
            self._write_json(self.work_log_path, [])

    def _read_json(self, path: str) -> Any:
        if not os.path.exists(path):
            self._write_json(path, {} if path == self.profile_path else [])
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except json.JSONDecodeError:
            return {} if path == self.profile_path else []

    def _write_json(self, path: str, data: Any) -> None:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

    def get_user_profile(self) -> dict[str, Any]:
        return self._read_json(self.profile_path)

    def update_user_profile(self, profile: dict[str, Any], *, skip_goal_pacing: bool = False) -> None:
        current = self.get_user_profile()
        goals_updated = "goals" in profile
        current.update(profile)
        update_tasks_allocated_time(current)
        if goals_updated and not skip_goal_pacing:
            for g in current.get("goals", []):
                if "sub_projects" in g:
                    g["sub_projects"] = adjust_past_due_dates(g["sub_projects"])
            current = pace_and_schedule_goals(current)
        self._write_json(self.profile_path, current)

    def get_work_log(self) -> list[dict[str, Any]]:
        return self._read_json(self.work_log_path)

    def add_work_log_entry(self, entry: dict[str, Any]) -> None:
        current = self.get_work_log()
        current.append(entry)
        self._write_json(self.work_log_path, current)

    def set_work_log(self, entries: list[dict[str, Any]]) -> None:
        """Replace the full work log (used when pruning scheduled events)."""
        self._write_json(self.work_log_path, entries)

    def get_goals(self) -> list[dict[str, Any]]:
        profile = self.get_user_profile()
        refreshed, changed = refresh_goals_if_past_due(profile)
        if not changed:
            refreshed = attach_capacity_warnings(refreshed)
        if changed or refreshed is not profile:
            self._write_json(self.profile_path, refreshed)
            profile = refreshed
        return profile.get("goals", [])

    def update_goal(self, goal_id: str, goal_data: dict[str, Any]) -> None:
        if "sub_projects" in goal_data:
            goal_data["sub_projects"] = adjust_past_due_dates(goal_data["sub_projects"])
        if "priority" in goal_data:
            from app.scheduling_utils import normalize_priority
            goal_data["priority"] = normalize_priority(goal_data["priority"])
        profile = self.get_user_profile()
        goals = profile.get("goals", [])
        updated_goals = []
        found = False
        for g in goals:
            if g.get("id") == goal_id:
                previous_status = g.get("status")
                g.update(goal_data)
                if (
                    previous_status == "on-hold"
                    and g.get("status") in ("to-do", "in-progress")
                ):
                    g.pop("on_hold_reason", None)
                if "sub_projects" in g:
                    g["sub_projects"] = adjust_past_due_dates(g["sub_projects"])
                found = True
            updated_goals.append(g)
        if not found:
            goal_data["id"] = goal_id
            updated_goals.append(goal_data)
        profile["goals"] = updated_goals
        update_tasks_allocated_time(profile)
        if any(k in goal_data for k in ("sub_projects", "status", "priority")):
            profile = pace_and_schedule_goals(profile)
        self._write_json(self.profile_path, profile)

    def create_goal(self, goal_data: dict[str, Any]) -> None:
        if "sub_projects" in goal_data:
            goal_data["sub_projects"] = adjust_past_due_dates(goal_data["sub_projects"])
        from app.scheduling_utils import normalize_priority
        goal_data["priority"] = normalize_priority(goal_data.get("priority", 1))
        profile = self.get_user_profile()
        goals = profile.get("goals", [])
        # Ensure ID is set
        if "id" not in goal_data:
            import uuid
            goal_data["id"] = f"goal-{uuid.uuid4().hex[:8]}"
        goals.append(goal_data)
        profile["goals"] = goals
        update_tasks_allocated_time(profile)
        profile = pace_and_schedule_goals(profile)
        self._write_json(self.profile_path, profile)

    def get_reflections_for_goal(self, goal_id: str) -> list[dict[str, Any]]:
        logs = self.get_work_log()
        return [log for log in logs if log.get("goal_id") == goal_id]

    def reset(self) -> None:
        self._write_json(self.profile_path, {})
        self._write_json(self.work_log_path, [])


# Global state store instance, easily swappable to FirestoreStateStore later
state_store: BaseStateStore = LocalJsonStateStore()
