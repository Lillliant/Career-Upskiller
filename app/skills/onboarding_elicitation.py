from typing import Any

from app.mcp_clients import query_search_mcp
from app.state_store import state_store


def onboarding_interview(
    user_id: str, career_goals: str, hours_per_week: int, excluded_days: list[str]
) -> dict[str, Any]:
    """Interviews the user to define their career goals and time availability,
    queries Search MCP for market trends, and compiles a personalized strategy.

    Caches the results to the state layer (user_profile.json).
    """
    # 1. Query Search MCP server for market trends relating to the goals
    search_result = query_search_mcp(career_goals)
    market_insights = search_result.get("insights", [])

    # 2. Formulate suggested focus areas based on insights or goals
    suggested_focus_areas = []
    for insight in market_insights:
        # Extract keywords or use default mappings
        if "mcp" in insight.lower() or "model context" in insight.lower():
            suggested_focus_areas.append("Model Context Protocol (MCP)")
        if "agent" in insight.lower():
            suggested_focus_areas.append("Agentic Architectures")
        if "semantic" in insight.lower() or "search" in insight.lower():
            suggested_focus_areas.append("Semantic Search & RAG")

    if not suggested_focus_areas:
        suggested_focus_areas = [
            "Core Theory",
            "Hands-on Projects",
            "Technical Writing",
        ]

    # 3. Formulate the personalized development strategy
    strategy = {
        "career_goals": career_goals,
        "hours_per_week": hours_per_week,
        "excluded_days": excluded_days,
        "market_insights": market_insights,
        "suggested_focus_areas": suggested_focus_areas,
        "created_at": "2026-07-02T01:43:00Z",
    }

    # 4. Cache in Storage (user_profile.json)
    state_store.update_user_profile(strategy)

    return strategy
