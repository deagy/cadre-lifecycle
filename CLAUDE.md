# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

**Cadre Lifecycle**: a combined project providing role selection and lifecycle governance. It merges:

- **`cadre/` register** (independent, source of truth for roles) — 71 specialist roles, routing rules, orchestration runtime
- **`agentic-sdlc/` kernel** (vendored here) — G1–G10 lifecycle gates, run-record validation, gate authority
- **Cline plugin** (`cline/`) — `agents_select` tool call for agent dispatch
- **LangGraph engine** (`agentic_sdlc_langgraph/`) — compiled graph orchestration for lifecycle execution

The Cadre register remains independent; assets here are generated from it. The Agentic SDLC kernel is vendored for single-project deployment.

## Commands

### Cline Plugin (`cline/`)

```sh
cd cline && npm test        # run tests
cd cline && npm run typecheck  # TypeScript type checking
```

### Agentic SDLC Kernel (`agentic_sdlc/`)

```sh
python3 -B -m unittest discover -s agentic_sdlc/test -p "test_*.py"   # kernel tests
```

### LangGraph Engine (`agentic_sdlc_langgraph/`)

```sh
cd agentic_sdlc_langgraph && uv sync && uv run pytest                  # engine tests
```

### CLI Tools (`bin/cadre`)

```sh
bin/cadre select --help        # role selection
bin/cadre knowledge --help     # knowledge store
bin/cadre sdlc --help          # lifecycle operations
```

## Architecture Notes

- **Role selection** (`agents_select` tool call) routes tasks to specialist roles from the Cadre catalog. It returns a dispatch plan without invoking agents.
- **Lifecycle governance** (Agentic SDLC) provides G1–G10 gates for governed delivery. The LangGraph engine executes these as a compiled graph.
- **Separation of concerns**: role selection is independent of lifecycle gates. A task can be routed to roles without going through the full G1–G10 lifecycle, and vice versa.
- **Human approval invariant**: no agent or automation may approve its own work. This is enforced structurally in both the role selection (independent reviewer) and lifecycle gates (separation of duties).

## Working Across Subsystems

Changes to role definitions belong in the independent Cadre register (`deagy/cadre`). Regenerate assets here with `cadre generate-plugin --output /path/to/cadre-lifecycle`.

Changes to lifecycle gate semantics or contract shape belong in `agentic_sdlc/contracts/`. Run both test suites before considering cross-cutting work done.
