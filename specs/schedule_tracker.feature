Feature: Career Skill Concierge Scheduling and Orchestration
  As a user aiming to develop career skills
  I want a zero-trust, proactive AI agent to manage my schedule
  So that I can balance skill development with my existing life without autonomous errors.

  Scenario: Phase 1 - Proactive Elicitation and Market Mapping (Onboarding)
    Given a new user initiates a chat session for the first time
    When the ADK Orchestrator loads the "onboarding_elicitation" skill
    Then the agent interviews the user to define their career goals
    And the agent autonomously queries the Search MCP server to analyze real-time market trends
    And the agent compiles a personalized development strategy
    And the agent strictly caches this profile in Storage (Firestore) so it never asks redundant questions.

  Scenario: Phase 2 - Contextual Scheduling and Human-In-The-Loop (HITL) Pause
    Given the agent needs to schedule a development block based on the cached user profile
    When the ADK Orchestrator reads free/busy times via the Calendar MCP server
    And the agent formulates a proposed schedule honoring user constraints
    Then the ADK Orchestrator MUST pause backend execution
    And the system MUST NOT write any events to the Calendar MCP autonomously
    And the agent stages the events and sends a payload to the Antigravity frontend to render the InteractiveVibeDiff component.

  Scenario: Phase 2b - Graceful Degradation under Time Scarcity (The Bulletproof Run)
    Given the user's calendar is pre-filled with dense "Meetings" creating a time conflict
    When the agent calculates availability via the Calendar MCP server
    Then the agent detects that the requested development block cannot fit
    And the agent gracefully degrades the goal by proposing highly-focused, shorter time blocks
    And the agent flags this scarcity adjustment visibly within the InteractiveVibeDiff UI for user review.

  Scenario: Phase 3 - Zero-Trust Execution and Reflection Memory
    Given the Antigravity UI is displaying the proposed schedule via InteractiveVibeDiff
    When the user explicitly confirms the schedule via a cryptographic or stateful "Approve" signal
    Then the ADK Orchestrator resumes execution
    And the ADK Orchestrator instructs the Calendar MCP server to execute the "write" function
    And the agent logs the scheduled block and subsequent user reflections into the work_log.json (Storage) for continuous goal adjustment.