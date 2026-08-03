# Cadre Lifecycle

A combined project providing **Cadre role selection** and **Agentic SDLC lifecycle governance** in a single installable unit.

## What This Is

This repository merges the role-selection capabilities of [Cadre](https://github.com/deagy/cadre) with the lifecycle governance of [Agentic SDLC](https://github.com/deagy/agentic-sdlc). It provides:

- **71 specialist agent roles** with deterministic routing
- **G1–G10 lifecycle gates** for governed software delivery
- **Cline plugin** (`agents_select` tool call) for agent dispatch
- **LangGraph orchestration engine** for lifecycle execution

## Repository Layout

```
.
├── agentic_sdlc_langgraph/    # LangGraph orchestration engine (vendored)
├── cline/                     # Cline plugin (agents_select tool call)
├── bin/cadre                  # CLI dispatcher for role selection
├── agent-catalog.json         # Agent role catalog (generated)
├── provider.json              # Agentic SDLC provider bundle
├── profiles/                  # Profile definitions
├── extensions/                # Extension definitions
├── skills/                    # Suite skills
├── agents/                    # Agent roles and policies
├── codex-agents/              # Codex CLI agent definitions
├── suite/roster/              # Catalog, routing, and orchestration source
│                               # (suite/roster/catalog.yaml, suite/roster/orchestration/src/select_agents.py)
├── tools/                     # Plugin versioning and utilities
├── .claude-plugin/            # Claude Code plugin manifest
├── .codex-plugin/             # Codex CLI plugin manifest
├── .agents/                   # Publishable skills
└── package.json               # Workspace root
```

The G1–G10 Agentic SDLC kernel (`deagy/agentic-sdlc`) is an external dependency, not vendored in this repository — see "Lifecycle Governance with Agentic SDLC" below.

## Installing

### Cline

Install the Cline plugin from this repository:

```sh
cline plugin install --git https://github.com/deagy/cadre-lifecycle --force
```

Or from a local checkout:

```sh
git clone https://github.com/deagy/cadre-lifecycle.git
cline plugin install /path/to/cadre-lifecycle --force
```

If `agents_select` doesn't show up after installing, restart the Cline hub daemon:

```sh
cline doctor fix
```

### Claude Code

Add this as a marketplace plugin (pin to a release tag):

```text
/plugin marketplace add deagy/cadre-lifecycle@v0.1.0
/plugin install cadre-lifecycle@cadre-team
```

### Codex CLI

Clone at the tag first, then install:

```sh
git clone --branch v0.1.0 https://github.com/deagy/cadre-lifecycle.git
codex plugin marketplace add /path/to/cadre-lifecycle
codex plugin add cadre-lifecycle@cadre-team
```

## Using the `agents_select` Tool Call

The `agents_select` tool call provides deterministic agent dispatch from the Cadre catalog. It returns a plan (routes, primary/reviewer/support roles, quality gates) without invoking agents or mutating state.

```typescript
// Example tool call
agents_select({
  task: "Implement user authentication with OAuth2",
  files: "src/auth/,tests/test_auth.py",
  base: "main",
  classification: "internal"
})
```

The tool call:
- Routes the task to appropriate specialist roles
- Identifies primary authors, independent reviewers, and support roles
- Defines quality gates and approval requirements
- Never invokes agents or makes lifecycle decisions

## Lifecycle Governance with Agentic SDLC

For projects adopting the full G1–G10 lifecycle, use the Agentic SDLC kernel:

```sh
# Initialize a project with the secure-cloud profile
agentic-sdlc init --root /path/to/project --profile secure-cloud

# Plan a task through the lifecycle
agentic-sdlc plan --task "Implement user authentication" --profile secure-cloud

# Validate gate readiness
agentic-sdlc validate --task <task-id>
```

The LangGraph engine drives tasks through the lifecycle as a compiled graph, with author/reviewer dispatch, gate sequencing, and separation-of-duties enforcement as graph control flow.

## Architecture

This project combines two independent systems:

| Component | Source | Responsibility |
|---|---|---|
| **Cadre Register** | [deagy/cadre](https://github.com/deagy/cadre) | Role definitions, catalog, routing (independent, not vendored) |
| **Agentic SDLC Kernel** | [deagy/agentic-sdlc](https://github.com/deagy/agentic-sdlc) | Lifecycle gates, run-record validation, gate authority (external dependency, not vendored) |
| **Cline Plugin** | This repository | `agents_select` tool call for agent dispatch |

The Cadre register remains the source of truth for role definitions. Assets in this repository are generated from the register and can be refreshed by running `cadre generate-plugin` against an independent register checkout.

## Development

### Running Tests

```sh
# Cline plugin tests
cd cline && npm test

# LangGraph engine tests
cd agentic_sdlc_langgraph && python3 -m unittest test_bridge -v
```

### Regenerating Assets

To refresh generated assets from the Cadre register:

```sh
git clone https://github.com/deagy/cadre.git
cadre/bin/cadre generate-plugin --output /path/to/cadre-lifecycle
```

## Releasing

Version lives in both plugin manifests (`.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`). Bump them together:

```sh
python3 tools/plugin_version.py --set 0.1.0
```

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
