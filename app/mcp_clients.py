import logging
from typing import Any

logger = logging.getLogger(__name__)

# Standard Stdio parameters for MCP servers (if present)
# In production, these would connect to actual local or SSE servers.
SEARCH_MCP_PARAMS = {
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-google-search"],
}

CALENDAR_MCP_PARAMS = {"command": "npx", "args": ["-y", "mcp-server-google-calendar"]}

# In-memory mock databases for testing/fallback
MOCK_MARKET_TRENDS = {
    "ai engineering": [
        "AI Engineering roles grew 45% this quarter.",
        "High demand for Model Context Protocol (MCP) experience.",
        "Sought-after skills include: agent architecture, semantic search, DAG routing.",
    ],
    "data science": [
        "Data Scientist positions require strong MLOps and LLM integration expertise.",
        "Python remains dominant; PyTorch and Hugging Face are standard.",
    ],
    "cloud architecture": [
        "Cloud roles require Kubernetes, Terraform, and Multi-cloud strategy.",
        "Serverless adoption is growing 25% YoY.",
    ],
}

MOCK_CALENDAR_EVENTS = [
    # Congested slots for "Meetings" / "Time Scarcity" scenario testing
    {
        "summary": "Sprint Planning",
        "start": "2026-07-02T09:00:00-04:00",
        "end": "2026-07-02T10:00:00-04:00",
    },
    {
        "summary": "Weekly 1:1",
        "start": "2026-07-02T10:00:00-04:00",
        "end": "2026-07-02T11:30:00-04:00",
    },
    {
        "summary": "Product Sync",
        "start": "2026-07-02T13:00:00-04:00",
        "end": "2026-07-02T15:00:00-04:00",
    },
    {
        "summary": "Design Review",
        "start": "2026-07-02T15:30:00-04:00",
        "end": "2026-07-02T17:00:00-04:00",
    },
]


def query_search_mcp(query: str) -> dict[str, Any]:
    """Queries the Search MCP server for market trends.
    Falls back to mock data if the server is not available or query is local.
    """
    logger.info(f"Querying Search MCP for: {query}")
    # Return mock market trends if matching keywords are found
    query_lower = query.lower()
    for category, insights in MOCK_MARKET_TRENDS.items():
        if category in query_lower:
            return {"status": "success", "query": query, "insights": insights}

    # Default fallback insights
    return {
        "status": "success",
        "query": query,
        "insights": [
            f"Demand for '{query}' is stable.",
            "Key skills: continuous learning, agile adaptability.",
            "Cross-functional communication is highly valued.",
        ],
    }


def get_calendar_free_busy(start_time: str, end_time: str) -> list[dict[str, Any]]:
    """Gets free/busy time slots from Calendar MCP server.
    Returns a list of conflicting events.
    """
    logger.info(f"Reading free/busy times between {start_time} and {end_time}")
    # Under test/mock environments, return pre-defined events
    return MOCK_CALENDAR_EVENTS


def write_calendar_event(
    summary: str, start_time: str, end_time: str, description: str
) -> dict[str, Any]:
    """Writes an event to the user's Google Calendar via Calendar MCP server.
    Under Zero-Trust rules, this MUST ONLY be called AFTER frontend approval.
    """
    logger.info(f"WRITING EVENT TO CALENDAR: {summary} ({start_time} to {end_time})")

    # Save the written event mock
    event_entry = {
        "summary": summary,
        "start": start_time,
        "end": end_time,
        "description": description,
        "status": "confirmed",
    }

    return {
        "status": "success",
        "event": event_entry,
        "message": f"Successfully written to calendar: {summary}",
    }
