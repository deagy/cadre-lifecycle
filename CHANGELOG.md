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
