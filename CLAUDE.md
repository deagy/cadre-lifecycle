# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

**Cadre Lifecycle**: a repository packaging role selection and lifecycle governance as **4 separate, independently-installable plugins** (not one bundle — see README.md's "Installing" section):

- **`cadre`** (this repository's root) — role selection: 71 specialist roles, routing rules, orchestration runtime, the `agents_select` Cline tool call (`cline/`), and the LangGraph role-*dispatch* engine (`agentic_sdlc_langgraph/` — despite the name, this is dispatch/routing code used by `cline/`, not lifecycle-gate execution; it never talks to the Agentic SDLC kernel).
- **`cadre-lifecycle-core`** (`plugins/lifecycle/`, optional) — forge-agnostic G1–G10 lifecycle governance UX: `lifecycle-onboarding`/`lifecycle-review` skills and a kernel bootstrap script, invoking the external `agentic-sdlc` kernel via `bin/cadre sdlc`.
- **`cadre-lifecycle-github`** / **`cadre-lifecycle-gitlab`** (`plugins/lifecycle-github/`, `plugins/lifecycle-gitlab/`, optional, require `cadre-lifecycle-core`) — forge-flavored gate-approval recording (`approve-from-github*`/`approve-from-gitlab*`) instead of the generic evidence-citation flow.

The Cadre register (`deagy/cadre`) remains independent; `cadre`'s assets, and `cadre-lifecycle-core`'s two skills (`plugins/lifecycle/skills/`), are generated from it — see `cadre-ref.txt`. `cadre-lifecycle-github`/`cadre-lifecycle-gitlab` are entirely hand-authored; the register has no concept of them. The Agentic SDLC kernel is a separately installed CLI (`agentic-sdlc`, from `deagy/agentic-sdlc`); `bin/cadre sdlc` shells out to it and fails with an install pointer if it isn't present. That `sdlc` branch ships as part of `cadre` regardless of whether any lifecycle plugin is installed — it's a harmless generic pass-through that only becomes useful once the kernel is installed (typically via `cadre-lifecycle-core`'s bootstrap script).

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
bin/cadre sdlc --help          # lifecycle operations (requires cadre-lifecycle-core's provider.json + the external kernel)
```

### Plugin versioning / release tooling (`tools/`)

```sh
python3 -m unittest discover -s tools -p "test_*.py" -v                    # plugin_version.py, changelog_entry.py
python3 -m unittest discover -s plugins/lifecycle/tools -p "test_*.py" -v  # cadre-lifecycle-core's bootstrap_sdlc.py
```

## Architecture Notes

- **Role selection** (`agents_select` tool call, part of `cadre`) routes tasks to specialist roles from the Cadre catalog. It returns a dispatch plan without invoking agents.
- **Lifecycle governance** (Agentic SDLC, part of the optional `cadre-lifecycle-core`/`-github`/`-gitlab` plugins) provides G1–G10 gates for governed delivery. Gate state and transitions live entirely in the external `agentic-sdlc` kernel — this repository's LangGraph engine (`agentic_sdlc_langgraph/`) does **not** execute gates; it only wraps role *dispatch* with a LangGraph-shaped interface, and (via `build_dispatch_plan.py`) relays gate metadata the kernel already computed so a dispatch plan can be annotated with `required_quality_gates`/`human_gates`. Actual gate decisions are recorded through `bin/cadre sdlc` (a thin pass-through to the kernel), driven conversationally by the lifecycle plugins' skills.
- **Separation of concerns**: role selection (`cadre`) is fully independent of lifecycle gates (`cadre-lifecycle-core` and friends) — installable separately, usable separately. A task can be routed to roles without any lifecycle plugin installed, and vice versa.
- **Human approval invariant**: no agent or automation may approve its own work. This is enforced structurally in both role selection (independent reviewer) and lifecycle gates (separation of duties, checked by the external kernel — `decide`/`approve-from-github*`/`approve-from-gitlab*` all refuse a decision from a preparer or verifier of the same gate).

## Working Across Subsystems

Changes to role definitions belong in the independent Cadre register (`deagy/cadre`). Do **not** run `cadre generate-plugin --output` directly against this repository — the register split its downstream distribution into a separate `deagy/cadre-plugin` repo and its README template now describes that repository, not this one's merged identity. Regenerate into a scratch directory instead, diff against this repository, and apply everything except `README.md` and the hand-authored plugin-split exceptions (`plugins/lifecycle/.claude-plugin/`, `plugins/lifecycle/.codex-plugin/`, `plugins/lifecycle/tools/`, and all of `plugins/lifecycle-github/`, `plugins/lifecycle-gitlab/`). See README.md's "Regenerating Assets" for the exact steps.

This is currently a documentation-only safeguard: the register's `generate_global_plugin.py` guard against overwriting an existing `--output` target only checks for the *presence* of a `.codex-plugin/plugin.json`, and this repo has one (it is itself a packaged plugin) — so the guard does not actually stop `README.md` from being clobbered if the unsafe command above is run anyway. Tracked upstream at [deagy/cadre#97](https://github.com/deagy/cadre/issues/97), tracked here at [deagy/cadre-lifecycle#3](https://github.com/deagy/cadre-lifecycle/issues/3). Once a structural guard lands upstream, revisit whether this paragraph can be simplified.

Changes to lifecycle gate semantics or contract shape belong in the external `deagy/agentic-sdlc` repository, not here; this repository only shells out to it via `suite/roster/orchestration/src/agentic_sdlc_contracts.py`. Run the LangGraph engine, Cline plugin, `tools/`, and `plugins/lifecycle/tools/` test suites before considering cross-cutting work here done.
