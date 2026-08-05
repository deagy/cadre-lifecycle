# Cline Plugin (`cadre`'s `agents_select` tool)

A distinct plugin from [`cline-agents/`](../cline-agents) (which ports the 71 Cadre
roles into dispatchable Cline agent presets). This plugin, `cline`, exposes exactly
one tool call, `agents_select`: deterministic, reviewable agent *dispatch planning*
from this repository's Cadre catalog. It never invokes agents, retrieves knowledge,
merges, deploys, or mutates infrastructure or approvals — it only returns a plan.

This plugin belongs to the `cadre` plugin (see the root [README.md](../README.md));
there is nothing forge- or lifecycle-specific to install here.

## Install

Cline installs one plugin per repository clone/URL, so installing this repository
installs `cline/` alongside the rest of `cadre`:

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

## The `agents_select` tool

| Tool | Purpose |
|---|---|
| `agents_select` | Returns a dispatch plan (routes, primary/reviewer/support roles, quality gates) from the Cadre catalog bundled with this plugin. Plan only — never invokes agents. |

The role catalog is bundled with this plugin itself, not read from the target
workspace, so `root` may be any project — it does not need to be a checkout of
`deagy/cadre` or contain its own `catalog.yaml`.

When the Agentic SDLC LangGraph engine (`../agentic_sdlc_langgraph/`) is available,
`agents_select` invokes it natively; otherwise it falls back to `bin/cadre select`.

### Example

```typescript
agents_select({
  task: "Implement user authentication with OAuth2",
  files: "src/auth/,tests/test_auth.py",
  base: "main",
  classification: "internal"
})
```

`task` is required; `files`, `base`, `taskId`, `classification`, and `requireSdlc`
are optional (see `AgentsSelectInputSchema` in [`index.ts`](index.ts)).

### Dispatching the plan

This plugin cannot dispatch the selected role(s) itself — a Cline plugin's
`setup(api, ctx)` only exposes `registerTool`/`registerCommand`/etc., not the
session's spawn-agent or team primitives. After calling `agents_select`, the
orchestrating Cline session must dispatch manually — see the "## Cline" section of
[`../skills/run-agent-orchestration/references/runner-adapters.md`](../skills/run-agent-orchestration/references/runner-adapters.md)
for the current manual-injection workaround and `/team` limitations.

## Behavioral detail

See [`index.test.mts`](index.test.mts) for the authoritative behavior: tool
registration, dispatch-plan shape, `taskId` handling, and the needs-triage
fallback for an unroutable task.

## Development

```sh
cd cline && npm test        # run tests
cd cline && npm run typecheck  # TypeScript type checking
```
