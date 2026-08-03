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

## [0.13.0] - 2026-07-31

First release from this repository, and the first with build provenance.

### Added

- **SLSA build provenance and an SBOM on every release.** Each release now
  attaches a source tarball and an SPDX SBOM of the Cline plugin's npm
  dependency tree, both attested through GitHub's hosted Sigstore instance.
  Verify with `gh attestation verify <tarball> --repo deagy/cadre-plugin`;
  see README.md's "Verifying a release". The generated Cadre package itself
  carries no third-party dependencies, which is why the SBOM is scoped to
  `cline/`.

### Changed

- **Split out of [`deagy/cadre`](https://github.com/deagy/cadre)** into this
  dedicated repository, so the agent *register* (role definitions, catalog,
  routing) and the plugin *implementations* (this package and the Cline
  plugin) version and release independently. Nothing about the installed
  plugin's contents or behaviour changed in the split itself. The version
  continues the pre-split series rather than resetting, so existing installs
  read it as a continuation.

  Full history for every migrated file was preserved via `git filter-repo`,
  so `git log --follow` and `git blame` still reach pre-split commits. Two
  path changes came with the move: the packaged plugin, previously at
  `plugins/cadre/`, is now this repository's root, and the Cline plugin,
  previously at `plugins/cline/`, is now `cline/`.

  The in-repository generation drift guard became a cross-repository one:
  `.github/workflows/validate.yml` regenerates against the register revision
  pinned in `cadre-ref.txt` and fails on any difference. Picking up register
  changes is now an explicit `cadre-ref.txt` bump committed alongside the
  regenerated diff.

- `cadre version` moved here as `python3 tools/plugin_version.py`, unchanged
  in behaviour. The register repository's `cadre` CLI no longer carries a
  `version` subcommand, since the version it reported belongs to this package.
