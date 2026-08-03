# Changelog

This changelog tracks **consumer-visible** changes to the packaged plugin:
what installing `cadre@cadre-team` gives you, and how this repository is built
and released. Changes to the roles, skills, routing, and CLI behaviour
*inside* the package are recorded in the register repository's own changelog
([`deagy/cadre`](https://github.com/deagy/cadre/blob/main/CHANGELOG.md)) —
this file does not restate them.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/). The
release convention (see `README.md`'s "Releasing" section) ties git tags
(`vMAJOR.MINOR.PATCH`) to a deliberate, reviewed version bump of
`.claude-plugin/plugin.json` / `.codex-plugin/plugin.json`, checked with
`python3 tools/plugin_version.py --check`/`--set`.

## [Unreleased]

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

## [0.1.0] - 2026-08-03

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
