# Agent-to-UI (A2UI) Protocol Schemas
**Project:** Career Skill Concierge (Kaggle Capstone)

This document defines the structured JSON payloads exchanged between the ADK Orchestrator (Backend) and the Antigravity React Application (Frontend).

## Security & Integrity Guidelines (Zero-Trust)
1. **No Raw Text Parsing:** The frontend must render UI components strictly based on these JSON payloads.
2. **Stateful Integrity:** All staging actions must include a `transaction_id`. The backend will hold execution until a payload with a matching `transaction_id` and a valid `authorization_token` is returned by the client.
3. **Immutability:** The agent stages data; it NEVER writes directly to the MCP Calendar server without the `InteractiveVibeDiff_Response` payload.

---

## 1. Component: `OnboardingWizard`
**Purpose:** Renders the initial chat interface, displaying market trends fetched via the Search MCP and collecting the user's career goals and constraints.

### Payload: Agent -> UI (Render Request)
```json
{
  "component": "OnboardingWizard",
  "data": {
    "market_insights": [
      "AI Engineering roles grew 45% this quarter.",
      "High demand for Model Context Protocol (MCP) experience."
    ],
    "suggested_focus_areas": ["Vibe Coding", "Agentic Security", "DAG Orchestration"],
    "prompt_text": "Based on current trends, which of these areas should we focus your schedule on?"
  }
}