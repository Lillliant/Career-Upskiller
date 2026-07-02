# career-upskiller

Simple ReAct agent with a Secure Agent-to-UI (A2UI) graphical user interface.

## A2UI & Zero-Trust Scheduling Architecture

The **Career Skill Concierge** uses a secure graphical front-end (React + Vite) acting as a Zero-Trust human-in-the-loop (HITL) authorization boundary:

1. **Onboarding & Isolated Scoping:** Captures career goals and lets users select allowed target calendars. The frontend restricts visibility and binds selected calendar scopes to the approval envelope, keeping unselected calendars (e.g., personal/family) completely hidden/dark.
2. **Timeline Grid Matrix:** Renders proposed study blocks onto a daily time grid. Users can drag-and-drop to reschedule, drag handles to resize durations, or use mobile-friendly adjusters.
3. **Real-time State Mirroring Dashboard:** Listens natively to modifications on the timeline matrix, instantly recalculating allocated hours, certificate completion projections, and calendar statistics in real time.
4. **Zero-Trust Handshake:** Suspends orchestrator execution with a cryptographic HMAC-SHA256 signature when proposing schedule changes. The UI collects user modifications, attaches scope tokens, packages the transaction ID, and returns a signed envelope to the FastAPI endpoint to safely resume execution and trigger Calendar write operations.

Refer to [test_guide.md](file:///Users/christinewong/GitHub/career-upskiller/test_guide.md) for detailed setup, testing steps, and expected results.

## Project Structure

```
career-upskiller/
├── app/         # Core agent code
│   ├── agent.py               # Main agent logic
│   └── app_utils/             # App utilities and helpers
├── tests/                     # Unit, integration, and load tests
├── GEMINI.md                  # AI-assisted development guide
└── pyproject.toml             # Project dependencies
```

> 💡 **Tip:** Use [Gemini CLI](https://github.com/google-gemini/gemini-cli) for AI-assisted development - project context is pre-configured in `GEMINI.md`.

## Requirements

Before you begin, ensure you have:
- **uv**: Python package manager (used for all dependency management in this project) - [Install](https://docs.astral.sh/uv/getting-started/installation/) ([add packages](https://docs.astral.sh/uv/concepts/dependencies/) with `uv add <package>`)
- **agents-cli**: Agents CLI - Install with `uv tool install google-agents-cli`
- **Google Cloud SDK**: For GCP services - [Install](https://cloud.google.com/sdk/docs/install)


## Quick Start

Install `agents-cli` and its skills if not already installed:

```bash
uvx google-agents-cli setup
```

Install required packages:

```bash
agents-cli install
```

Test the agent with a local web server:

```bash
agents-cli playground
```

You can also use features from the [ADK](https://adk.dev/) CLI with `uv run adk`.

## Commands

| Command              | Description                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `agents-cli install` | Install dependencies using uv                                                         |
| `agents-cli playground` | Launch local development environment                                                  |
| `agents-cli lint`    | Run code quality checks                                                               |
| `agents-cli eval`    | Evaluate agent behavior (generate, grade, analyze, and more — see `agents-cli eval --help`) |
| `uv run pytest tests/unit tests/integration` | Run unit and integration tests                                                        |

## 🛠️ Project Management

| Command | What It Does |
|---------|--------------|
| `agents-cli scaffold enhance` | Add CI/CD pipelines and Terraform infrastructure |
| `agents-cli infra cicd` | One-command setup of entire CI/CD pipeline + infrastructure |
| `agents-cli scaffold upgrade` | Auto-upgrade to latest version while preserving customizations |

---

## Development

Edit your agent logic in `app/agent.py` and test with `agents-cli playground` - it auto-reloads on save.

## Deployment

```bash
gcloud config set project <your-project-id>
agents-cli deploy
```

To add CI/CD and Terraform, run `agents-cli scaffold enhance`.
To set up your production infrastructure, run `agents-cli infra cicd`.

## Observability

Built-in telemetry exports to Cloud Trace, BigQuery, and Cloud Logging.
