# Cline Lifecycle Plugin (Agentic SDLC G1-G10 tools)

A third distinct plugin, alongside [`cline/`](../cline) (role-selection planning)
and [`cline-agents/`](../cline-agents) (role dispatch). This plugin,
`cline-lifecycle`, exposes G1-G10 Agentic SDLC lifecycle governance as 8
deterministic tool calls, wrapping the exact `bin/cadre sdlc <subcommand>`
invocations the `cadre-lifecycle-core`/`-github`/`-gitlab` plugins' skills
already document for Claude Code / Codex
(`plugins/lifecycle/skills/{lifecycle-onboarding,lifecycle-review,brief-pending-gates}/SKILL.md`
plus `plugins/lifecycle-gitlab/skills/{lifecycle-review-gitlab,link-source-issue-gitlab}/SKILL.md`
for the 4 GitLab-specific tools).

Skills are a Claude Code / Codex mechanism with no Cline equivalent (see
[`../skills/run-agent-orchestration/references/runner-adapters.md`](../skills/run-agent-orchestration/references/runner-adapters.md)'s
"## Cline" section), so none of that governance was previously reachable from
Cline at all — this plugin closes that gap the same way `cline/` and
`cline-agents/` already close the equivalent gap for role selection/dispatch.

The 4 GitLab-specific tools close a further, narrower gap: `cadre-lifecycle-gitlab`
bundles 8 GitLab skills for Claude Code / Codex, but only 4 of them wrap a
GitLab-specific kernel subcommand (`approve-from-gitlab`, `approve-from-gitlab-mr`,
`link-intent-from-gitlab-issue`, `link-requirements-from-gitlab-issue`) — those
4 are mirrored here. The remaining 4 (`gitlab-gate-tracking`,
`publish-gate-status-gitlab`, `report-gate-reviewers-gitlab`,
`brief-pending-gates-gitlab`) are read-only/advisory conveniences layered on
top of gate state `sdlc_status` already exposes, not additional kernel
subcommands, so they are not mirrored as separate tools.

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
| `sdlc_approve_from_gitlab` | `bin/cadre sdlc approve-from-gitlab` | Record a human gate approval from prepared GitLab MR-approval evidence. |
| `sdlc_approve_from_gitlab_mr` | `bin/cadre sdlc approve-from-gitlab-mr` | Record a human gate approval by fetching and verifying an approved GitLab MR approval live. Fails closed if none is found. |
| `sdlc_link_intent_from_gitlab_issue` | `bin/cadre sdlc link-intent-from-gitlab-issue` | Record a GitLab issue as the recorded source for a task's G1 (Intent) gate. |
| `sdlc_link_requirements_from_gitlab_issue` | `bin/cadre sdlc link-requirements-from-gitlab-issue` | Record a GitLab issue as the recorded source for a task's G2 (Requirements Baseline) gate. |

Every tool accepts an optional `root` (defaults to the host session's
workspace root) and otherwise mirrors the exact flags the corresponding
`SKILL.md` documents for its runner-neutral CLI invocation — see
[`index.ts`](index.ts) for the full schemas.

### `sdlc_decide`, `sdlc_approve_from_gitlab`, and `sdlc_approve_from_gitlab_mr` add no approval logic of their own

The `agentic-sdlc` kernel itself structurally refuses a decision from the same
identity as the gate's preparer/verifier (this repository's human-approval
invariant — see root `CLAUDE.md`). All three of these tools only relay
whatever the kernel decides, success or refusal, as JSON; none attempts its
own separation-of-duties check, and none must ever be called on behalf of a
human who has not actually made the decision (or, for the two GitLab tools,
actually recorded/authored the GitLab MR approval) being recorded.

### `sdlc_link_intent_from_gitlab_issue` / `sdlc_link_requirements_from_gitlab_issue` record a source, not an approval

These two only attach a GitLab issue reference to G1/G2 respectively — they
never advance, approve, or invalidate a gate. Use `sdlc_approve_from_gitlab`
or `sdlc_approve_from_gitlab_mr` to actually record an approval.

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
