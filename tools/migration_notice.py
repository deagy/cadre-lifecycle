#!/usr/bin/env python3
"""Tell an already-installed user that this marketplace has moved.

`deagy/cadre-lifecycle` is being archived. The four upstream repositories
(`deagy/cadre`, `deagy/agentic-sdlc`, this one, and
`deagy/cadre-profile-secure-cloud`) are consolidated into a single
monorepo published at `deagy/cadre`.

An archived GitHub repository stays publicly cloneable, so nobody's install
breaks -- but it also stops receiving releases, so every existing install
silently freezes at this version forever with no signal that anything
changed. This notice is that signal.

It has to be a `SessionStart` hook, because that is the only mechanism that
reaches a plugin that is *already installed*. A README change reaches only
people who go looking. A marketplace `renames` entry migrates plugin names
*within* one marketplace and cannot point at a different one. There is no
post-install or on-update hook to use instead.

Deliberately not doing anything beyond printing: no install, no config
write, no network call. A hook that ran on every session start and touched
the user's machine to "help them migrate" would be exactly the kind of
unrequested action a frozen, soon-to-be-archived plugin has no business
taking.

    python3 tools/migration_notice.py            # print the notice
    python3 tools/migration_notice.py --check    # exit 1 if the text is stale
"""

from __future__ import annotations

import argparse
import sys

NEW_REPO = "deagy/cadre"
NEW_MARKETPLACE = "cadre-team"  # the `name` in the monorepo's marketplace.json
OLD_MARKETPLACE = "cadre-lifecycle-team"

NOTICE = f"""\
[cadre-lifecycle] This marketplace has moved and is no longer maintained.

  Cadre, the Agentic SDLC kernel, and this plugin distribution are now one
  repository: https://github.com/{NEW_REPO}

  Your installed plugins keep working, but this marketplace is frozen -- it
  will receive no further releases. To move:

      /plugin marketplace add {NEW_REPO}
      /plugin install cadre@cadre-team
      /plugin marketplace remove {OLD_MARKETPLACE}

  Installed a lifecycle plugin (cadre-lifecycle-core / -github / -gitlab)?
  Reinstall it from the new marketplace under the same name.
"""


def build_notice() -> str:
    return NOTICE


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Verify the notice still names a new marketplace distinct from this one.",
    )
    args = parser.parse_args(argv)

    if args.check:
        if NEW_MARKETPLACE == OLD_MARKETPLACE or not NEW_MARKETPLACE or not NEW_REPO:
            print("migration-notice: NEW_MARKETPLACE is unset or self-referential", file=sys.stderr)
            return 1
        return 0

    # stdout: a SessionStart hook's stdout is surfaced in the session, which
    # is the whole point. Never fail the session over a notice.
    print(build_notice())
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:  # pragma: no cover - a notice must never break a session
        raise SystemExit(0)
