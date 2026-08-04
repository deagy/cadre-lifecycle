# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

**Cadre Lifecycle**: a combined project providing role selection and lifecycle governance. It merges:

- **`cadre/` register** (independent, source of truth for roles) — 71 specialist roles, routing rules, orchestration runtime
- **`agentic-sdlc` kernel** (external dependency, not vendored) — G1–G10 lifecycle gates, run-record validation, gate authority, invoked via `bin/cadre sdlc`
- **Cline plugin** (`cline/`) — `agents_select` tool call for agent dispatch
- **LangGraph engine** (`agentic_sdlc_langgraph/`) — compiled graph orchestration for lifecycle execution

The Cadre register remains independent; assets here are generated from it. The Agentic SDLC kernel is a separately installed CLI (`agentic-sdlc`, from `deagy/agentic-sdlc`); `bin/cadre sdlc` shells out to it and fails with an install pointer if it isn't present.

## Commands

### Cline Plugin (`cline/`)

```sh
cd cline && npm test        # run tests
cd cline && npm run typecheck  # TypeScript type checking
```

### Agentic SDLC Kernel (external)

The kernel's own test suite lives in its source repository, `deagy/agentic-sdlc`, not here.

### LangGraph Engine (`agentic_sdlc_langgraph/`)

```sh
cd agentic_sdlc_langgraph && python3 -m unittest discover -s . -p "test_*.py" -v   # engine tests
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

Changes to role definitions belong in the independent Cadre register (`deagy/cadre`). Do **not** run `cadre generate-plugin --output` directly against this repository — the register split its downstream distribution into a separate `deagy/cadre-plugin` repo and its README template now describes that repository, not this one's merged identity. Regenerate into a scratch directory instead, diff against this repository, and apply everything except `README.md` (hand-authored here). See README.md's "Regenerating Assets" for the exact steps.

Changes to lifecycle gate semantics or contract shape belong in the external `deagy/agentic-sdlc` repository, not here; this repository only shells out to it via `suite/roster/orchestration/src/agentic_sdlc_contracts.py`. Run the LangGraph engine and Cline plugin test suites before considering cross-cutting work here done.
