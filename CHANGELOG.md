# Changelog

This changelog tracks **consumer-visible** changes to the packaged plugins:
what installing `cadre@cadre-lifecycle-team` (and its optional companions)
gives you, and how this repository is built and released. Changes to the
roles, skills, routing, and CLI behaviour
*inside* the package are recorded in the register repository's own changelog
([`deagy/cadre`](https://github.com/deagy/cadre/blob/main/CHANGELOG.md)) —
this file does not restate them.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/). The
release convention (see `README.md`'s "Releasing" section) ties git tags
(`vMAJOR.MINOR.PATCH`) to a deliberate, reviewed version bump of
`.claude-plugin/plugin.json` / `.codex-plugin/plugin.json`, checked with
`python3 tools/plugin_version.py --check`/`--set`. Each version heading
below links to its [GitHub Release](https://github.com/deagy/cadre-lifecycle/releases).

## [0.5.0](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.5.0) - 2026-08-04

### Added

Three more skills, from a second recommendation round that reviewed what shipped in `v0.4.0`. Requires `agentic-sdlc` [v0.12.0](https://github.com/deagy/agentic-sdlc/releases/tag/v0.12.0) or later — same caveat pattern as prior releases: `provider.json`'s `kernel_compatibility` range does not by itself guarantee an installed kernel has these commands.

- **`create-github-gate-issues`** (`cadre-lifecycle-github`) — GitHub mirror of `gitlab-gate-tracking`: publishes a tracking issue per gate plus assigned approval-subtask issues per authority. Deliberately scoped narrower than the GitLab original — no issue-linking enhancement (GitHub has no clean equivalent to GitLab's Issue Links API; only the description cross-reference floor exists), and a new repository-visibility pre-flight (`--allow-public-repo` required for public repos) since GitHub issues have no per-issue confidentiality flag.
- **`publish-reviewer-nudge-github`** (`cadre-lifecycle-github`) — posts an advisory PR comment listing who should be asked to review, sourced from `report-gate-reviewers-github`'s existing candidate report. Explicitly not a review request: logins are rendered as `` `code spans` ``, never `@`-mentions, so posting the comment cannot itself notify anyone. This sidesteps the still-unbuilt write-capable reviewer-request path (`Pull requests: write` has no narrower scope and still needs an explicit human decision that was never made) by reusing `publish-gate-status-github`'s already-approved comment-write capability instead.
- **`report-gate-reviewers-gitlab`** (`cadre-lifecycle-gitlab`) — GitLab reviewer-candidate reporting, read-only, targeting the MR `reviewer_ids` field rather than GitLab's heavier, quorum-based approval-rules model. GitLab's approval API exposes no per-approver commit SHA, so there is no equivalent of GitHub's `review-stale` classification — a documented, permanent gap, not a placeholder; the report surfaces the MR's head SHA for manual cross-checking instead.

All three independently security- and code-reviewed (no critical/high findings) before landing.

## [0.4.0](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.4.0) - 2026-08-04

### Added

Six new skills across the two forge plugins, following a recommendation review of what `cadre-lifecycle-github`/`cadre-lifecycle-gitlab` were missing relative to each other and to the underlying kernel's actual command surface. All drive new kernel commands in [`agentic-sdlc` v0.11.0](https://github.com/deagy/agentic-sdlc/releases/tag/v0.11.0) — `cadre-lifecycle-core` requires that version or later for these to work; `provider.json`'s `kernel_compatibility` range does not by itself guarantee it (same caveat pattern as `v0.3.1`/`v0.3.2`).

- **`link-source-issue-github` / `link-source-issue-gitlab`** (`cadre-lifecycle-github`/`cadre-lifecycle-gitlab`) — record a GitHub or GitLab issue as the source for a G1 (Intent) or G2 (Requirements Baseline) gate, via the kernel's `link-intent-from-<forge>-issue`/`link-requirements-from-<forge>-issue`. GitLab already had this kernel-side; GitHub didn't. Neither forge had a conversational skill wrapper for it before now. Deliberately not approval evidence — never touches `human_approvals`/`gate.status`.
- **`publish-gate-status-github` / `publish-gate-status-gitlab`** (`cadre-lifecycle-github`/`cadre-lifecycle-gitlab`) — publish a one-way, read-only gate-status summary comment on a task's PR/MR, updated in place on re-run, via the kernel's `publish-gate-status`. Carries a mandatory non-approval advisory; never derived from anything the kernel itself doesn't already track, and the underlying command was independently security- and code-reviewed before this skill was built on top of it.
- **`report-gate-reviewers-github`** (`cadre-lifecycle-github`) — reports which GitHub logins would be requested as PR reviewers for a task's gates, and their current status, via the kernel's `request-gate-reviewers`. **Read-only in this version** — it never actually requests a review. GitHub has no token scope narrower than `Pull requests: write` for that (which also permits editing/closing PRs and changing labels), and shipping the write-capable version needs an explicit decision on that permission escalation, not an inferred one. This skill is explicit about that limitation rather than implying more capability than exists.

### Changed

- `cadre-lifecycle-core`'s `lifecycle-onboarding` skill now preflight-checks a GitHub/GitLab identity's *shape* (explicit field, or well-formed `gitlab.com/`/`github.com/` URI) as soon as a human provides it for an authority role, instead of only surfacing a binding problem later, the first time a forge-write skill actually runs. Explicitly documented as a shape check only, not live account-existence verification — no kernel command exposes that today, and the skill says so rather than overclaiming.

## [0.3.2](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.3.2) - 2026-08-04

### Fixed

- **`gitlab-gate-tracking`'s kernel-availability caveat updated: `agentic-sdlc create-gate-issues` is now released.**
  `v0.3.1`'s CHANGELOG entry and the Architecture table noted that the
  kernel commit this skill depends on hadn't been cut into a tagged
  `agentic-sdlc` release yet. It has, as
  [v0.10.0](https://github.com/deagy/agentic-sdlc/releases/tag/v0.10.0) —
  both references updated to point at that release instead of the raw
  commit. Also fixed a broken link: the `v0.3.1` entry linked to
  `deagy/agentic-sdlc`'s `CHANGELOG.md`, which doesn't exist in that
  repository (it uses GitHub Releases only, no changelog file) — now
  points at the actual release notes.

## [0.3.1](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.3.1) - 2026-08-04

### Added

- **`cadre-lifecycle-gitlab` gains a second skill, `gitlab-gate-tracking`**,
  the opposite direction from `lifecycle-review-gitlab`: instead of reading
  an existing GitLab MR approval back into the kernel, it publishes a GitLab
  tracking issue per applicable lifecycle gate, plus a linked "approval"
  issue per gate per required authority role, assigned to that authority's
  real GitLab account (resolved via the kernel's existing
  `authority_gitlab_username()`). Drives the new kernel commands
  `agentic-sdlc create-gate-issues`/`list-gate-issues` — see
  [`deagy/agentic-sdlc` v0.10.0's release notes](https://github.com/deagy/agentic-sdlc/releases/tag/v0.10.0)
  for the kernel-side implementation, which was independently
  security-reviewed and code-reviewed before landing. The skill is
  dry-run-first by design and refuses to `--apply` without the human
  explicitly confirming the shown assignments — creating an issue and
  assigning a real person is treated as a mutation requiring human
  confirmation, the same as any other consequential action in this suite.

  **Requires**: an `agentic-sdlc` kernel at
  [v0.10.0](https://github.com/deagy/agentic-sdlc/releases/tag/v0.10.0) or
  later. `provider.json`'s `kernel_compatibility` range (`>=0.3.0,<0.4.0`)
  does not by itself guarantee an installed kernel has this command (the
  kernel's own `VERSION` constant deliberately stayed at `0.3.0` for this
  release, since it's additive with no G1-G10 contract/schema change); the
  skill's own "Before you start" step checks for the command and tells the
  human plainly if it's missing, rather than assuming.

## [0.3.0](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.3.0) - 2026-08-04

### Changed — breaking

- **Lifecycle governance is no longer bundled into the core plugin — it's
  now 3 separate, optional plugins, and the core plugin is renamed.** This
  repository previously shipped one plugin, `cadre-lifecycle`, combining
  Cadre role selection (71 specialist roles, `agents_select`) with Agentic
  SDLC lifecycle governance (G1–G10 gates). It now ships 4 independently
  installable plugins from the same repository:
  - **`cadre`** (renamed from `cadre-lifecycle`) — role selection only:
    the catalog, routing, `agents_select` Cline tool, and orchestration
    skills. No lifecycle governance.
  - **`cadre-lifecycle-core`** (`plugins/lifecycle/`) — forge-agnostic
    lifecycle governance: the `lifecycle-onboarding` and `lifecycle-review`
    skills, plus `plugins/lifecycle/tools/bootstrap_sdlc.py` (moved from
    `tools/bootstrap_sdlc.py`).
  - **`cadre-lifecycle-github`** (`plugins/lifecycle-github/`) — a
    `lifecycle-review-github` skill that records gate decisions from a real
    GitHub PR review (`approve-from-github`/`approve-from-github-pr`).
  - **`cadre-lifecycle-gitlab`** (`plugins/lifecycle-gitlab/`) — the GitLab
    equivalent (`approve-from-gitlab`/`approve-from-gitlab-mr`).

  The marketplace itself is unchanged (`cadre-lifecycle-team`, still at
  this repository) — only the plugin entries within it changed. All 4
  plugins share one version number and release together.

  **Migration**: existing `cadre-lifecycle@cadre-lifecycle-team` installs
  do not automatically become `cadre@cadre-lifecycle-team` — the rename is
  a new install key. Uninstall the old plugin and run:
  ```text
  /plugin install cadre@cadre-lifecycle-team
  ```
  and, only if you use lifecycle governance, also install
  `cadre-lifecycle-core@cadre-lifecycle-team` (plus `-github`/`-gitlab` as
  needed). See README.md's "Installing" section for the full per-plugin
  instructions.

### Fixed

- `lifecycle-review`'s GitHub/GitLab `approve-from-*` preference logic
  moved out to the new forge-specific plugins — the forge-agnostic skill
  now only ever calls `decide`, and points at the matching
  `cadre-lifecycle-github`/`cadre-lifecycle-gitlab` plugin instead of
  trying to cover every forge itself.

## [0.2.5](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.2.5) - 2026-08-04

### Added

- **`.github/workflows/release.yml`.** `tools/plugin_version.py`'s docstring
  and README's "Releasing" section already described a version bump landing
  on `main` as automatically tagging and publishing a GitHub Release — that
  workflow didn't actually exist until now. It verifies both plugin
  manifests agree on a valid semver, skips (idempotently) if `v<version>` is
  already tagged, then tags the commit and creates a GitHub Release titled
  `v<version>` with that version's `CHANGELOG.md` entry as its notes,
  extracted by the new `tools/changelog_entry.py` (and its test suite,
  `tools/test_changelog_entry.py`). Manual `git tag`/`gh release create` is
  no longer the release step for a version bump reaching `main` — this
  workflow's own release (`v0.2.5`) is the first to be cut by it rather than
  by hand, proving it end-to-end.

### Changed

- README's Claude Code and Codex CLI install pins re-pointed from `v0.2.4`
  to `v0.2.5`, this release itself (same reasoning as `v0.2.4`'s own fix:
  pin to the version this change ships as, not the previous latest).

## [0.2.4](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.2.4) - 2026-08-04

### Fixed

- **README's Claude Code and Codex CLI install instructions were pinned to
  `v0.1.0`**, the repository's very first tag, left over from before the
  release-tagging convention existed. Both `/plugin marketplace add
  deagy/cadre-lifecycle@v0.1.0` and `git clone --branch v0.1.0 ...` now
  pin to `v0.2.4`, this release itself.

## [0.2.3](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.2.3) - 2026-08-04

### Added

- **GitHub Release links in README.md and CHANGELOG.md.** `v0.1.0` through
  `v0.2.2` had git tags with no corresponding GitHub Release pages, so the
  release history wasn't browsable from GitHub's UI. Backfilled a Release
  for each existing tag (title, notes from this file's matching entry), and
  linked them: README's "Releasing" section now links the full Releases
  page plus each version, and each version heading in this file links to
  its own Release.

## [0.2.2](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.2.2) - 2026-08-04

### Fixed

- **`agents_select` failed on every call inside a real Cline host** (not
  reproducible in this plugin's own tests). `createTool()` only converts a
  Zod `inputSchema` to JSON Schema via `schema instanceof ZodType`, checked
  against the *host's* bundled `zod`, not the plugin's. A Cline plugin loads
  from a separate installation than its host, so even a version-matching
  `zod` is a different module instance there — the check silently failed,
  conversion was skipped, and the raw `ZodObject` (which carries circular
  internal references) was registered as the tool's declared schema,
  breaking its serialization. `cline/index.ts` now converts the schema to
  JSON Schema with the plugin's own `zod` before registering it, removing
  the dependency on that cross-realm `instanceof` check.

## [0.2.1](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.2.1) - 2026-08-04

### Fixed

- **`cadre generate-plugin --output` was unsafe to run directly against this
  repository.** `deagy/cadre` split its downstream plugin distribution into
  a separate `deagy/cadre-plugin` repository before this repository's
  previously-pinned `cadre-ref.txt` revision, and the register's `README.md`
  template describes that repository — a different three-way
  `cadre`/`cadre-plugin`/`agentic-sdlc` split with its own versioning — not
  this repository's merged Cadre + Agentic SDLC + Cline + LangGraph
  identity. `CLAUDE.md`, `AGENTS.md`, and `README.md` previously instructed
  running that command directly, which would have silently overwritten
  `README.md` with the wrong content. Corrected all three to document the
  actual safe procedure (regenerate into a scratch directory, diff, apply
  everything except `README.md`, which is now explicitly hand-authored
  here) and fixed `cadre-ref.txt`'s claim of CI enforcement that doesn't
  exist in this repository.

### Changed

- **`cadre-ref.txt` bumped to `8511c75`** to pick up
  `run-agent-orchestration`'s broadened proactive trigger (see
  [`deagy/cadre`'s changelog](https://github.com/deagy/cadre/blob/main/CHANGELOG.md)
  for the trigger-description change itself). Applied by hand to
  `skills/run-agent-orchestration/SKILL.md` rather than through the (at the
  time still unsafe) regeneration command, then verified byte-for-byte
  against this revision's actual generated output before the ref bump.

## [0.2.0](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.2.0) - 2026-08-03

### Added

- **`tools/bootstrap_sdlc.py`** — an opt-in, one-command way to install and
  configure the external Agentic SDLC kernel, instead of requiring a
  separate manual `pipx install` plus `agentic-sdlc init` invocation. It
  `pipx install`s the exact version `provider.json`'s
  `kernel_compatibility.minimum` currently declares (never a floating
  "latest", to avoid reintroducing kernel/provider version drift), refuses
  to touch an existing `agentic-sdlc` install that falls outside that
  range rather than silently replacing it, and then runs `agentic-sdlc
  init --provider provider.json` against the target project. Deliberately
  a standalone script under `tools/`, not a `bin/cadre` subcommand:
  `bin/cadre` and everything under `suite/` is fully regenerated by
  `deagy/cadre`'s `cadre generate-plugin` on every sync, so a hand-added
  case there would be silently lost on the next regeneration.

## [0.1.2](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.1.2) - 2026-08-03

### Fixed

- **`cline plugin install` warned `Cannot find module 'vitest'` on every
  install.** Cline's plugin installer scans every non-hidden `.js`/`.ts`
  file under the installed package as a candidate plugin module,
  including `cline/index.test.ts`. That file imports `vitest`, a
  `devDependency` the installer's production-only `npm install` never
  provisions. Renamed to `cline/index.test.mts` — outside the
  installer's `.js`/`.ts` scan, still discovered and run by `vitest`'s
  default include glob.
- **`codex plugin marketplace add` failed with `marketplace 'cadre-team'
  is already added from a different source`.** `.agents/plugins/
  marketplace.json` still declared the pre-merge marketplace/plugin
  names (`cadre-team`/`cadre`) left over from before this repository
  combined the standalone `cadre` and `agentic-sdlc` repos, colliding
  with an older, separately-installed `cadre-team` marketplace pointing
  at the original pre-merge `cadre` repo. Renamed to
  `cadre-lifecycle-team`/`cadre-lifecycle` to match
  `.claude-plugin/marketplace.json`, which already used the correct
  post-merge names.

## [0.1.1](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.1.1) - 2026-08-03

### Fixed

- **The `agents_select` tool's native LangGraph bridge path was silently
  unreachable.** `cline/index.ts` resolved the bridge's file path two
  directories too high (a leftover from before this repository's rename/
  merge), so every call silently fell back to the slower CLI path.
  Fixing that path exposed and required fixing a chain of further,
  previously-dormant bugs before the native path actually worked: Node's
  async `execFile` silently ignoring its `input` option, a
  response-envelope shape mismatch, a validation-message wording
  mismatch, the native adapter hardcoding this repository's own root
  instead of accepting an arbitrary target workspace, and the native
  adapter's changed-file discovery not mirroring the CLI's git-status
  fallback for the default no-args invocation shape. Also fixed: a
  missing `child.stdin` error handler that could crash the host process
  on a broken pipe, and a timer-escalation bug that could orphan a
  scheduled `SIGKILL`.
- **Documentation described a vendored `agentic_sdlc/` kernel and a
  fabricated release history that don't match this checkout.**
  CLAUDE.md/README.md/AGENTS.md corrected to describe the Agentic SDLC
  kernel as an external, separately-installed CLI dependency, not
  vendored; this file's own `[0.1.0]` entry (below) replaced a copied-
  from-a-different-repository entry describing a split/SBOM/provenance
  story that never happened here; `PHASE2_COMPLETION_SUMMARY.md`'s
  status corrected to match its own reported test state.

### Changed

- `cline/package.json`'s version realigned to `0.1.0` to match every
  other manifest in this repository (it had drifted to `0.1.2`
  independently, with no corresponding release).
- Removed root `package.json`'s npm workspace declaration
  (`workspaces: ["cline"]` and its two forwarding scripts). It backed no
  documented or actually-used workflow (every install/test instruction
  in this repository runs `npm ...` from inside `cline/` directly, never
  `npm ... --workspaces` from the root) and was an active footgun: npm
  invoked inside `cline/` auto-detected the ancestor workspace root and
  silently reached for a lockfile/`node_modules` there instead of
  `cline/`'s own, on both `npm install` and `npm ci`.

## [0.1.0](https://github.com/deagy/cadre-lifecycle/releases/tag/v0.1.0) - 2026-08-03

First release from this repository.

### Changed

- **Renamed and merged from `cadre-agentic-sdlc` into `cadre-lifecycle`**,
  combining the Cadre register's generated role-selection assets
  (catalog, routing, orchestration runtime under `suite/roster/`) with the
  Cline plugin (`cline/`), the vendored LangGraph orchestration engine
  (`agentic_sdlc_langgraph/`), and an external dependency on the
  `agentic-sdlc` CLI ([`deagy/agentic-sdlc`](https://github.com/deagy/agentic-sdlc))
  for G1–G10 lifecycle gate execution. See `RENAME_SUMMARY.md` for the file
  and package-name inventory of the rename.
