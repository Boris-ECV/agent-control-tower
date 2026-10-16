# Agent Control Tower

A control tower for AI agents. It reads agent telemetry (traces, spans, token
usage and cost) from an LLM-observability backend through its REST API and
presents cost, quality and governance views for business and operations
managers.

The current milestone is a customer demo around a **cost-runaway** story for a
manufacturing company. All demo data is synthetic.

## Status

Early. What exists today:

| Path | What it is |
|---|---|
| `seed/` | Deterministic generator for the synthetic demo data set (9 agents, 30 days, five cost incidents) plus reconciliation checks against a live backend |
| `docs/` | The SDLC framework documents (00-08) this project is developed with |
| `.claude/`, `config/`, `templates/`, `modules/` | The multi-agent development framework: orchestrator rules, sub-agent definitions, gates, templates |

The Portal and API layer do not exist yet; they are planned as Epics in the
project's Jira board.

## How this repository is developed

Development follows a multi-agent SDLC framework (requirements, design,
development, testing, review) coordinated through Jira. Start with
`docs/00-handover.md` (written for the AI orchestrator) or
`docs/06-operations.md` (written for the human supervisor).

- Jira project: `SDLCCT`
- All three gates (G1, G1b, G2) run in `auto` mode, with two mandatory
  escalations to a human: tickets labelled `needs-human-gate`, and pull
  requests that touch framework or workflow files. See `config/gates.yaml`
  and rule 10 in `.claude/CLAUDE.md`.
- `main` is protected: changes arrive only through pull requests with green
  checks.

## Working with the data generator

```
cd seed
uv sync
uv run python generate.py              # dry run: computes everything, writes nothing to a backend
uv run python generate.py --write      # writes into the backend named by OPIK_BASE_URL
```

The backend address is read from the `OPIK_BASE_URL` environment variable and
has no default. `--write` refuses to run when the agent projects already exist.

## Security

This repository is public. Do not commit host names, IP addresses, keys,
tokens or customer names. See `CONSTITUTION.md`.
