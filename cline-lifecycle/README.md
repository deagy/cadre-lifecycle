# Cline Lifecycle Plugin (Agentic SDLC G1-G10 tools)

A third distinct plugin, alongside [`cline/`](../cline) (role-selection planning)
and [`cline-agents/`](../cline-agents) (role dispatch). This plugin,
`cline-lifecycle`, exposes G1-G10 Agentic SDLC lifecycle governance as 4
deterministic tool calls, wrapping the exact `bin/cadre sdlc <subcommand>`
invocations the `cadre-lifecycle-core`/`-github`/`-gitlab` plugins' skills
already document for Claude Code / Codex
(`plugins/lifecycle/skills/{lifecycle-onboarding,lifecycle-review,brief-pending-gates}/SKILL.md`).

Skills are a Claude Code / Codex mechanism with no Cline equivalent (see
[`../skills/run-agent-orchestration/references/runner-adapters.md`](../skills/run-agent-orchestration/references/runner-adapters.md)'s
"## Cline" section), so none of that governance was previously reachable from
Cline at all — this plugin closes that gap the same way `cline/` and
`cline-agents/` already close the equivalent gap for role selection/dispatch.

## Requires the external `agentic-sdlc` kernel

`bin/cadre sdlc` is a thin pass-through to the separately-installed
`agentic-sdlc` kernel binary — gate state and transitions live entirely in that
external kernel, not in this repository (see root `CLAUDE.md`'s "Architecture
Notes"). Install it first via one of the lifecycle plugins' bundled bootstrap
scripts, e.g.:

```sh
python3 plugins/lifecycle/tools/bootstrap_sdlc.py --root /path/to/project --profile secure-cloud
```

Every tool below fails with a structured error (not a throw) if the kernel
isn't resolvable — this plugin does not install it.

## Install

```sh
git clone https://github.com/deagy/cadre-lifecycle.git
cline plugin install /path/to/cadre-lifecycle/cline-lifecycle --force
```

## Tools

| Tool | Wraps | Purpose |
|---|---|---|
| `sdlc_init` | `bin/cadre sdlc init` | Initialize G1-G10 lifecycle tracking for a project. Pass `dryRun: true` first and inspect the result before writing for real. |
| `sdlc_validate` | `bin/cadre sdlc validate` | Validate a project's Agentic SDLC configuration and run-record state. Returns errors/blockers as JSON. |
| `sdlc_status` | `bin/cadre sdlc status` | Report a task's pending/decided lifecycle gates. Read-only. |
| `sdlc_decide` | `bin/cadre sdlc decide` | Record a lifecycle gate decision. |

Every tool accepts an optional `root` (defaults to the host session's
workspace root) and otherwise mirrors the exact flags the corresponding
`SKILL.md` documents for its runner-neutral CLI invocation — see
[`index.ts`](index.ts) for the full schemas.

### `sdlc_decide` adds no approval logic of its own

The `agentic-sdlc` kernel itself structurally refuses a decision from the same
identity as the gate's preparer/verifier (this repository's human-approval
invariant — see root `CLAUDE.md`). `sdlc_decide` only relays whatever the
kernel decides, success or refusal, as JSON; it does not attempt its own
separation-of-duties check, and it must never be called on behalf of a human
who has not actually made the decision being recorded.

## Behavioral detail

See [`index.test.mts`](index.test.mts) for the authoritative behavior: tool
registration, real `bin/cadre sdlc` subprocess outcomes (structured errors for
an un-onboarded project or a nonexistent task, a real dry-run preview for
`sdlc_init`), and the missing-root failure mode.

## Development

```sh
cd cline-lifecycle && npm test        # run tests
cd cline-lifecycle && npm run typecheck  # TypeScript type checking
```
