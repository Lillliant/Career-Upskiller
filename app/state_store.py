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


def pace_and_schedule_goals(profile: dict[str, Any], busy_slots: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Paces due dates for active goals, prioritizing higher-urgency projects first.

  Higher-priority projects receive earlier due dates; lower-priority projects are
  pushed back when capacity is contested. Sets per-goal scheduling_warning when the
  weekly hour budget cannot accommodate remaining work.
    """
    import datetime
    from app.scheduling_utils import (
        get_goal_priority,
        normalize_priority,
        task_remaining_hours,
        total_remaining_hours,
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
        [g for g in goals if g.get("status") in ("to-do", "in-progress")],
        key=lambda g: (-get_goal_priority(g), goals.index(g)),
    )

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

    for g in active_goals:
        for m in g.get("sub_projects", []):
            tasks = m.get("tasks", [])
            if tasks:
                task_dates: list[datetime.date] = []
                for t in tasks:
                    if t.get("completed"):
                        continue
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
                    m["dueDate"] = current_date.isoformat()
            elif not m.get("completed"):
                due = allocate_hours(3.0)
                m["dueDate"] = due.isoformat()

    remaining_hours = total_remaining_hours(goals)
    weeks_needed = remaining_hours / hours_per_week if hours_per_week > 0 else float("inf")
    horizon_weeks = 8

    if remaining_hours > 0 and weeks_needed > horizon_weeks:
        warning = (
            f"Your projects need about {remaining_hours:.1f} hours of work "
            f"({weeks_needed:.1f} weeks at {hours_per_week} hrs/week), which exceeds "
            f"the {horizon_weeks}-week planning horizon. Please adjust due dates or "
            f"increase your weekly study hours."
        )
        profile["schedule_capacity_warning"] = warning
        for g in active_goals:
            g["scheduling_warning"] = warning
    else:
        profile.pop("schedule_capacity_warning", None)

    return profile


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

    def update_user_profile(self, profile: dict[str, Any]) -> None:
        current = self.get_user_profile()
        goals_updated = "goals" in profile
        current.update(profile)
        update_tasks_allocated_time(current)
        if goals_updated:
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
                g.update(goal_data)
                if "sub_projects" in g:
                    g["sub_projects"] = adjust_past_due_dates(g["sub_projects"])
                found = True
            updated_goals.append(g)
        if not found:
            goal_data["id"] = goal_id
            updated_goals.append(goal_data)
        profile["goals"] = updated_goals
        update_tasks_allocated_time(profile)
        if "priority" in goal_data:
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
