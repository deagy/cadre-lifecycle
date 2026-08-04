# Cadre Lifecycle

This repository packages **Cadre role selection** and **Agentic SDLC lifecycle governance** as 4 separate, independently-installable plugins from one source: `cadre` (role selection, the only one most projects need) plus 3 optional lifecycle-governance plugins.

## What This Is

This repository merges the role-selection capabilities of [Cadre](https://github.com/deagy/cadre) with the lifecycle governance of [Agentic SDLC](https://github.com/deagy/agentic-sdlc), and packages them as separate plugins rather than one bundle:

- **`cadre`** — **71 specialist agent roles** with deterministic routing, plus the **Cline plugin** (`agents_select` tool call) for agent dispatch. Install this on its own for role selection with no lifecycle governance at all.
- **`cadre-lifecycle-core`** (optional) — forge-agnostic **G1–G10 lifecycle gates** for governed software delivery: conversational onboarding and gate-decision skills, plus a kernel bootstrap script.
- **`cadre-lifecycle-github`** / **`cadre-lifecycle-gitlab`** (optional, require `cadre-lifecycle-core`) — forge-flavored gate governance: record a gate decision from a real PR review/MR approval instead of a generic evidence citation, link a G1/G2 source issue, publish a one-way gate-status summary comment on the task's PR/MR, publish tracking issues for gates and approvals assigned to each gate's authority, and report (read-only) which people would be asked to review. `cadre-lifecycle-github` additionally posts an advisory (never a formal request) reviewer-nudge PR comment.

The **LangGraph orchestration engine** (`agentic_sdlc_langgraph/`) is role-dispatch code used by the Cline plugin, not lifecycle-gate execution — it ships as part of `cadre` despite its name (see "Architecture" below).

## Repository Layout

```
.                               # cadre plugin's own root
├── agentic_sdlc_langgraph/    # LangGraph role-dispatch engine (vendored, used by cline/)
├── cline/                     # Cline plugin (agents_select tool call)
├── bin/cadre                  # CLI dispatcher for role selection (and lifecycle, if installed)
├── agent-catalog.json         # Agent role catalog (generated)
├── provider.json              # Agentic SDLC provider bundle (referenced by plugins/lifecycle/)
├── profiles/                  # Profile definitions
├── extensions/                # Extension definitions
├── skills/                    # cadre plugin's own skills
├── agents/                    # Agent roles and policies
├── codex-agents/              # Codex CLI agent definitions
├── suite/roster/              # Catalog, routing, and orchestration source
│                               # (suite/roster/catalog.yaml, suite/roster/orchestration/src/select_agents.py)
├── tools/                     # Plugin versioning and utilities
├── .claude-plugin/            # cadre's Claude Code plugin manifest
├── .codex-plugin/             # cadre's Codex CLI plugin manifest
├── .agents/                   # Publishable skills
├── plugins/
│   ├── lifecycle/             # cadre-lifecycle-core plugin
│   │   ├── skills/            # lifecycle-onboarding, lifecycle-review (register-generated)
│   │   └── tools/             # bootstrap_sdlc.py (hand-authored)
│   ├── lifecycle-github/      # cadre-lifecycle-github plugin (hand-authored)
│   └── lifecycle-gitlab/      # cadre-lifecycle-gitlab plugin (hand-authored)
└── package.json                # Workspace root
```

The G1–G10 Agentic SDLC kernel (`deagy/agentic-sdlc`) is an external dependency, not vendored in this repository — see "Lifecycle Governance with Agentic SDLC" below.

## Installing

Install `cadre` for role selection. Only add the lifecycle plugins if you actually want G1–G10 governance — most projects don't need them.

### Cline

Cline installs one plugin per repository clone/URL; this repository's Cline component (`agents_select`) belongs entirely to `cadre` (the lifecycle plugins have no Cline tool — they're skill-only), so there's nothing forge- or lifecycle-specific to select here:

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

Add this repository as a marketplace once (pin to a release tag), then install whichever plugins you want:

```text
/plugin marketplace add deagy/cadre-lifecycle@v0.5.0
/plugin install cadre@cadre-lifecycle-team

# Optional — only if you want G1–G10 lifecycle governance:
/plugin install cadre-lifecycle-core@cadre-lifecycle-team

# Optional — only if cadre-lifecycle-core is installed and you want
# forge-specific gate-approval recording:
/plugin install cadre-lifecycle-github@cadre-lifecycle-team
/plugin install cadre-lifecycle-gitlab@cadre-lifecycle-team
```

**Migrating from `cadre-lifecycle@cadre-lifecycle-team`** (the pre-0.3.0 combined plugin): uninstall it and install `cadre@cadre-lifecycle-team` instead — the rename is a new install key, not an automatic migration.

### Codex CLI

Clone at the tag first, add the marketplace once, then install whichever plugins you want:

```sh
git clone --branch v0.5.0 https://github.com/deagy/cadre-lifecycle.git
codex plugin marketplace add /path/to/cadre-lifecycle
codex plugin add cadre@cadre-lifecycle-team

# Optional, same conditions as above:
codex plugin add cadre-lifecycle-core@cadre-lifecycle-team
codex plugin add cadre-lifecycle-github@cadre-lifecycle-team
codex plugin add cadre-lifecycle-gitlab@cadre-lifecycle-team
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

This section applies once `cadre-lifecycle-core` is installed (see "Installing" above) — it's optional, not part of the `cadre` plugin.

For projects adopting the full G1–G10 lifecycle, install and configure the kernel with one opt-in command:

```sh
python3 plugins/lifecycle/tools/bootstrap_sdlc.py                      # install (if needed) + configure the cwd project
python3 plugins/lifecycle/tools/bootstrap_sdlc.py --dry-run              # report what would happen, change nothing
python3 plugins/lifecycle/tools/bootstrap_sdlc.py --root /path/to/project --profile secure-cloud
```

This `pipx install`s the exact kernel version `provider.json`'s `kernel_compatibility.minimum` currently declares, never touches an existing `agentic-sdlc` install that falls outside that range (it reports the mismatch and stops), and then runs `agentic-sdlc init` with this plugin's `provider.json`. It's deliberately a standalone script under `plugins/lifecycle/tools/`, not a `bin/cadre` subcommand — `bin/cadre` is fully regenerated by `deagy/cadre`'s `cadre generate-plugin` and would silently lose a hand-added case on the next sync.

If you have a real GitHub PR review or GitLab MR approval to cite for a gate decision, install `cadre-lifecycle-github`/`cadre-lifecycle-gitlab` too — their `lifecycle-review-github`/`lifecycle-review-gitlab` skills record it via `agentic-sdlc approve-from-github*`/`approve-from-gitlab*` instead of a generic evidence citation. The same two plugins also add `link-source-issue-<forge>` (record a G1/G2 source issue), `publish-gate-status-<forge>` (a one-way gate-status summary comment on the task's PR/MR), `report-gate-reviewers-<forge>` (read-only — which people would be asked to review, without actually requesting anything), and tracking-issue publishing per gate/approval (`gitlab-gate-tracking` on GitLab, `create-github-gate-issues` on GitHub). GitHub additionally gets `publish-reviewer-nudge-github`, an advisory PR comment (never a formal review request) suggesting who to ask.

Or drive the already-installed kernel directly:

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

This project combines two independent upstream systems, packaged here as 4 plugins:

| Component | Source | Responsibility |
|---|---|---|
| **Cadre Register** | [deagy/cadre](https://github.com/deagy/cadre) | Role definitions, catalog, routing (independent, not vendored) |
| **Agentic SDLC Kernel** | [deagy/agentic-sdlc](https://github.com/deagy/agentic-sdlc) | Lifecycle gates, run-record validation, gate authority (external dependency, not vendored) |

| Plugin | Owns |
|---|---|
| **`cadre`** | Role definitions/catalog/routing, the `agents_select` Cline tool call, and the LangGraph role-dispatch engine (`agentic_sdlc_langgraph/` — despite the name, this wraps role *dispatch*, not gate execution; it never talks to the lifecycle kernel). |
| **`cadre-lifecycle-core`** | Forge-agnostic lifecycle governance UX: `lifecycle-onboarding`/`lifecycle-review` skills (conversational wrappers around `bin/cadre sdlc`, itself a thin pass-through to the external kernel) and the kernel bootstrap script. |
| **`cadre-lifecycle-github`** | GitHub-flavored gate governance: `lifecycle-review-github` records decisions (`approve-from-github`/`approve-from-github-pr`); `link-source-issue-github` records a G1/G2 source issue (`link-intent-from-github-issue`/`link-requirements-from-github-issue`); `publish-gate-status-github` publishes a one-way gate-status PR comment (`publish-gate-status`); `report-gate-reviewers-github` reports PR-reviewer candidates, read-only (`request-gate-reviewers`); `create-github-gate-issues` publishes GitHub tracking issues for gates and approvals, assigned to each gate's authority (`create-github-gate-issues`/`list-github-gate-issues`); `publish-reviewer-nudge-github` posts an advisory (not a request) PR comment nudging reviewer candidates (`publish-reviewer-nudge`). Requires `cadre-lifecycle-core` and an `agentic-sdlc` kernel at [v0.12.0](https://github.com/deagy/agentic-sdlc/releases/tag/v0.12.0) or later. |
| **`cadre-lifecycle-gitlab`** | GitLab-flavored gate governance: `lifecycle-review-gitlab` records decisions (`approve-from-gitlab`/`approve-from-gitlab-mr`); `gitlab-gate-tracking` publishes GitLab tracking issues for gates and approvals, assigned to each gate's authority (`create-gate-issues`/`list-gate-issues`); `link-source-issue-gitlab` records a G1/G2 source issue (`link-intent-from-gitlab-issue`/`link-requirements-from-gitlab-issue`); `publish-gate-status-gitlab` publishes a one-way gate-status MR comment (`publish-gate-status`); `report-gate-reviewers-gitlab` reports MR-reviewer candidates, read-only (`request-gate-reviewers-gitlab`). Requires `cadre-lifecycle-core` and an `agentic-sdlc` kernel at [v0.12.0](https://github.com/deagy/agentic-sdlc/releases/tag/v0.12.0) or later. |

The Cadre register remains the source of truth for role definitions, and (as of this split) also generates `cadre-lifecycle-core`'s two skills into `plugins/lifecycle/skills/` — see `cadre-ref.txt`. `cadre-lifecycle-github`/`cadre-lifecycle-gitlab` are entirely hand-authored here; the register has no concept of them. Assets in this repository are generated from the register — see "Regenerating Assets" below for the safe procedure; `cadre generate-plugin --output` cannot be run directly against this repository.

## Development

### Running Tests

```sh
# Cline plugin tests (cadre)
cd cline && npm test

# LangGraph role-dispatch engine tests (cadre)
cd agentic_sdlc_langgraph && python3 -m unittest discover -s . -p "test_*.py" -v

# Plugin versioning/release tooling tests (cadre)
python3 -m unittest discover -s tools -p "test_*.py" -v

# cadre-lifecycle-core's bootstrap script tests
python3 -m unittest discover -s plugins/lifecycle/tools -p "test_*.py" -v
```

### Regenerating Assets

**`cadre generate-plugin --output` is not safe to run directly against this repository.** The register (`deagy/cadre`) split its own downstream plugin distribution out into a separate `deagy/cadre-plugin` repository at some point before this repository's pinned `cadre-ref.txt` revision, and its generator now writes `README.md` from a template (`packaging/plugin-README.md`) that describes *that* repository — a different three-way `cadre`/`cadre-plugin`/`agentic-sdlc` split, with its own versioning and install instructions — not this repository's actual merged Cadre + Agentic SDLC + Cline + LangGraph identity. The register has no concept of `cadre-lifecycle` at all.

Everything else the register generates (`skills/`, `agents/`, `codex-agents/`, `suite/`, `agent-catalog.json`, `bin/cadre`, `profiles/`, `extensions/`, and — as of the plugin split — `plugins/lifecycle/skills/`) is role/routing content, not repository-identity prose, so it stays correct. Hand-authored exceptions, never touched by regeneration:

- `README.md` (despite `cadre-ref.txt` naming a generated-content revision) — the original exception.
- `plugins/lifecycle/.claude-plugin/`, `plugins/lifecycle/.codex-plugin/`, `plugins/lifecycle/tools/` — this sub-plugin's own manifests and bootstrap script; only its `skills/` is register-generated.
- `plugins/lifecycle-github/`, `plugins/lifecycle-gitlab/` entirely — the register has no concept of these plugins at all.

To refresh generated assets from the Cadre register safely:

```sh
git clone https://github.com/deagy/cadre.git
git -C cadre checkout "$(grep -v '^[[:space:]]*#' /path/to/cadre-lifecycle/cadre-ref.txt | grep -v '^[[:space:]]*$' | head -1)"
cadre/bin/cadre generate-plugin --output /tmp/cadre-lifecycle-regen   # a scratch directory, never this checkout directly
diff -rq /tmp/cadre-lifecycle-regen /path/to/cadre-lifecycle          # review the diff
```

Apply everything **except `README.md`** from that diff, bump `cadre-ref.txt` to the new revision, and re-run repository health checks before committing. The diff should never propose changes under `plugins/lifecycle-github/`, `plugins/lifecycle-gitlab/`, or `plugins/lifecycle/{.claude-plugin,.codex-plugin,tools}/` — if it does, something is wrong (the register should never have touched those paths).

## Releasing

Version lives in all 8 plugin manifests (4 plugins × `.claude-plugin/plugin.json` + `.codex-plugin/plugin.json`) and is shared across all of them — one release bumps every plugin together. Bump them together:

```sh
python3 tools/plugin_version.py --set 0.3.0
```

Pushing that bump to `main` triggers [`.github/workflows/release.yml`](.github/workflows/release.yml), which tags the commit (`vMAJOR.MINOR.PATCH`) and publishes a GitHub Release with that version's `CHANGELOG.md` entry as its notes. Don't tag or create the Release by hand for a version bump landing on `main` — the workflow does it (and is idempotent: it checks whether the tag already exists before doing anything, so a re-run or an accidental manual tag is a safe no-op, not a duplicate).

See [Releases](https://github.com/deagy/cadre-lifecycle/releases) for the full history, or jump to a specific version:

- [v0.5.0](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.5.0) — Add 3 skills: GitHub gate-issue tracking, an advisory (non-request) reviewer nudge, and read-only GitLab reviewer-candidate reporting
- [v0.4.0](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.4.0) — Add 6 skills: source-issue linking, gate-status PR/MR comments (both forges), read-only reviewer-candidate reporting (GitHub); onboarding identity preflight
- [v0.3.2](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.3.2) — Update `gitlab-gate-tracking`'s kernel-release caveat now that `agentic-sdlc` v0.10.0 ships `create-gate-issues`
- [v0.3.1](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.3.1) — Add `gitlab-gate-tracking` skill: publish GitLab tracking issues for gates/approvals, assigned to each gate's authority
- [v0.3.0](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.3.0) — Split into 4 plugins: `cadre` (renamed from `cadre-lifecycle`) plus optional `cadre-lifecycle-core`/`-github`/`-gitlab`
- [v0.2.5](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.2.5) — Add `.github/workflows/release.yml` to auto-tag and auto-publish on a version bump
- [v0.2.4](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.2.4) — Fix stale v0.1.0 install pins in Claude Code / Codex CLI instructions
- [v0.2.3](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.2.3) — Link GitHub Releases from README.md and CHANGELOG.md
- [v0.2.2](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.2.2) — Fix `agents_select` tool declaration breaking on every call in real Cline hosts
- [v0.2.1](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.2.1) — Fix unsafe `cadre generate-plugin --output` guidance
- [v0.2.0](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.2.0) — Add `tools/bootstrap_sdlc.py` for one-command kernel install
- [v0.1.2](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.1.2) — Fix Cline install warning and Codex marketplace name collision
- [v0.1.1](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.1.1) — Fix `agents_select` native LangGraph bridge path resolution
- [v0.1.0](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.1.0) — Renamed and merged `cadre-agentic-sdlc` into `cadre-lifecycle`

## License

Apache-2.0 — see [LICENSE](LICENSE) for details.
