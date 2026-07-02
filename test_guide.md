# Career Skill Concierge Test & Operations Guide

This guide describes how the secure Agent-to-UI (A2UI) scheduling system works, how to set up and run both backend and frontend components, and the test operations to verify security boundaries, interactive scheduling, and real-time state mirroring.

---

## 1. System Architecture & Zero-Trust Protocol

The system enforces a **Zero-Trust Security Boundary** for calendar writes:
1. **Proactive Elicitation (Onboarding):** The user defines goals and selects allowed target calendars (e.g. whitelist "Work", keep "Personal/Family" isolated/dark).
2. **The HITL Pause:** The agent calculates schedule options based on target calendars and availability. If conflict is detected (Scarcity), it degrades to micro-learning. Before writing to the database, the orchestrator suspends execution and yields a `RequestInput` carrying a `transaction_id` and a cryptographic `token` (HMAC-SHA256 signature).
3. **Interactive Validation (Vibe Diff):** Staged blocks render on a visual timeline matrix. The user can drag-and-drop to reschedule or drag handles to resize. The frontend metrics dashboard recalculates projections in real time.
4. **Stateful Handshake:** The user clicks "Approve". The client packages the modified times, whitelisted scopes, transaction ID, and cryptographic token, then POSTs this envelope back. The backend verifies the HMAC signature. Only upon a cryptographic match will the orchestrator trigger the Calendar MCP write operation.

---

## 2. Setup & Execution Instructions

### Prerequisites
- Node.js (version 18+ recommended)
- Python (version 3.10+ with `uv` package manager installed)

### Step 1: Backend Setup & Execution
1. Install Python dependencies:
   ```bash
   uv sync
   ```
2. Start the FastAPI backend server:
   ```bash
   uv run python app/fast_api_app.py
   ```
   *Note: The backend has been updated to include a credentials fallback, allowing it to start locally and resiliently even if Google Application Default Credentials (ADC) are not configured.*

### Step 2: Frontend Setup & Execution
1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```
2. Install npm packages:
   ```bash
   npm install
   ```
3. Start the Vite React development server:
   ```bash
   npm run dev
   ```
4. Open the link displayed in the terminal (usually `http://localhost:5173`).

---

## 3. Test Scenarios & Expected Results

### Scenario A: Target Calendar Scoping & Isolation
- **Action:** In the Onboarding tab, enter a goal (e.g., "AI Engineering"), and set a time budget. In the Calendar checklist, check "Work Calendar" and leave "Personal/Family Calendar" unchecked.
- **Expected Result:**
  1. The "Personal/Family Calendar" shows a warning badge: `🔒 Strictly Private / Dark`.
  2. The scope column displays `Isolated (Invisible)` for Personal/Family, indicating that the frontend state restricts access.
  3. When finalizing onboarding, the generated cryptographic handshake log packages ONLY the whitelisted calendar IDs (e.g., `["cal-work"]`).

### Scenario B: Time Scarcity & Micro-learning Degradation
- **Action:** Complete onboarding to load the "Proposed Schedule Matrix" tab.
- **Expected Result:**
  1. A prominent Amber warning banner displays: `⚠️ Graceful Degradation Triggered: Calendar is dense with Work meetings. The Concierge gracefully degraded your daily target...`
  2. The visual matrix shows two short 30-minute micro-learning blocks instead of a single long block.

### Scenario C: Interactive Timeline & Real-Time Dashboard Mirroring
- **Action:** Open both the "Proposed Schedule Matrix" tab and the "Dynamic Analytics" tab (or look at metrics changing in the timeline layout).
- **Expected Result:**
  1. **Drag-and-Drop:** Drag a staged block (e.g., the 11:30 block) and drop it onto the 15:30 slot. The block snaps perfectly to the new drop row.
  2. **Duration Resizing:** Hover over the bottom of a block card. Drag the horizontal handle down or click `+15m` to lengthen. The card expands, and its duration badge increments (e.g. `30m` -> `45m` -> `60m`).
  3. **Real-time Mirroring:** Go to the "Dynamic Analytics" tab or watch the total hours. Every drag/resize immediately triggers recalculation:
     - **Daily Allocated Time** updates immediately (e.g. `1.0 hrs` -> `1.5 hrs`).
     - **Certification Projection** recalculates weeks to complete dynamically (e.g. `12.0 weeks` down to `8.0 weeks`).
     - **Weekly Target Achievement Pace** fill-bar updates in real time.

### Scenario D: Cryptographic Handshake Verification
- **Action:** Once satisfied with the schedule adjustments, click the **Approve & Execute (HITL)** button.
- **Expected Result:**
  1. The buttons transition into a green success card: `✅ Handshake Verified! Schedule Dispatched.`
  2. A new entry appears in the **Zero-Trust Handshake Logs & Payload Auditor** panel at the bottom.
  3. Inspect the payload. It must contain the precise transaction ID, cryptographic token, allowed calendar scope whitelists, and the modified event timings array matching the UI state.
