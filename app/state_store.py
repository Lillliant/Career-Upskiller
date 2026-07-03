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
        current.update(profile)
        self._write_json(self.profile_path, current)

    def get_work_log(self) -> list[dict[str, Any]]:
        return self._read_json(self.work_log_path)

    def add_work_log_entry(self, entry: dict[str, Any]) -> None:
        current = self.get_work_log()
        current.append(entry)
        self._write_json(self.work_log_path, current)

    def get_goals(self) -> list[dict[str, Any]]:
        profile = self.get_user_profile()
        return profile.get("goals", [])

    def update_goal(self, goal_id: str, goal_data: dict[str, Any]) -> None:
        profile = self.get_user_profile()
        goals = profile.get("goals", [])
        updated_goals = []
        found = False
        for g in goals:
            if g.get("id") == goal_id:
                g.update(goal_data)
                found = True
            updated_goals.append(g)
        if not found:
            goal_data["id"] = goal_id
            updated_goals.append(goal_data)
        profile["goals"] = updated_goals
        self._write_json(self.profile_path, profile)

    def create_goal(self, goal_data: dict[str, Any]) -> None:
        profile = self.get_user_profile()
        goals = profile.get("goals", [])
        # Ensure ID is set
        if "id" not in goal_data:
            import uuid
            goal_data["id"] = f"goal-{uuid.uuid4().hex[:8]}"
        goals.append(goal_data)
        profile["goals"] = goals
        self._write_json(self.profile_path, profile)

    def get_reflections_for_goal(self, goal_id: str) -> list[dict[str, Any]]:
        logs = self.get_work_log()
        return [log for log in logs if log.get("goal_id") == goal_id]


# Global state store instance, easily swappable to FirestoreStateStore later
state_store: BaseStateStore = LocalJsonStateStore()
