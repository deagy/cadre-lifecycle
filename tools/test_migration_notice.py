#!/usr/bin/env python3
"""Bind the four SessionStart hooks to the one canonical notice text.

The migration notice is inlined into each plugin's `hooks/hooks.json` rather
than shelling out to `tools/migration_notice.py`. That is deliberate: this
is a terminal release for a marketplace about to be archived, and a hook
with zero file dependencies cannot fail because something did not get
packaged into one of the four plugin roots. The cost is four copies of the
text, which is what this module exists to police.

It also asserts the properties that make the notice *reachable and
harmless*, since nobody will be around to notice a regression after the
archive:

  - every plugin manifest actually declares the hook (an undeclared
    hooks.json is dead weight -- the whole release does nothing)
  - the command renders to the exact canonical text when run through a real
    shell (`printf '%s'` silently emits literal backslash-n instead of
    newlines; `%b` is required, and this is how that was caught)
  - the hook only prints -- no install, no config write, no network

    python3 -m unittest discover -s tools -p "test_*.py"
"""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "tools"))

from migration_notice import build_notice  # noqa: E402

PLUGIN_ROOTS = (
    Path("."),
    Path("plugins/lifecycle"),
    Path("plugins/lifecycle-github"),
    Path("plugins/lifecycle-gitlab"),
)

MANIFESTS = (
    ".claude-plugin/plugin.json",
    ".codex-plugin/plugin.json",
    "plugins/lifecycle/.claude-plugin/plugin.json",
    "plugins/lifecycle/.codex-plugin/plugin.json",
    "plugins/lifecycle-github/.claude-plugin/plugin.json",
    "plugins/lifecycle-github/.codex-plugin/plugin.json",
    "plugins/lifecycle-gitlab/.claude-plugin/plugin.json",
    "plugins/lifecycle-gitlab/.codex-plugin/plugin.json",
)

# Anything that would make this hook do more than inform. A frozen,
# soon-to-be-archived plugin running on every session start has no business
# touching the user's machine.
FORBIDDEN_IN_COMMAND = (
    "pip", "pipx", "npm", "curl", "wget", "git ", "rm ", "mv ",
    ">", "install", "claude plugin",
)


def _hook_command(plugin_root: Path) -> str:
    payload = json.loads(
        (REPO_ROOT / plugin_root / "hooks" / "hooks.json").read_text(encoding="utf-8")
    )
    entries = payload["hooks"]["SessionStart"]
    assert len(entries) == 1, entries
    inner = entries[0]["hooks"]
    assert len(inner) == 1, inner
    return inner[0]["command"]


class TestEveryPluginShipsTheNotice(unittest.TestCase):
    def test_each_plugin_has_a_session_start_hook(self) -> None:
        for plugin_root in PLUGIN_ROOTS:
            with self.subTest(plugin=str(plugin_root)):
                self.assertTrue((REPO_ROOT / plugin_root / "hooks" / "hooks.json").is_file())

    def test_each_manifest_declares_the_hook(self) -> None:
        """An undeclared hooks.json is inert -- the release would do nothing."""
        for relative in MANIFESTS:
            with self.subTest(manifest=relative):
                manifest = json.loads((REPO_ROOT / relative).read_text(encoding="utf-8"))
                self.assertEqual("./hooks/hooks.json", manifest.get("hooks"))

    def test_all_four_copies_are_identical(self) -> None:
        commands = {str(root): _hook_command(root) for root in PLUGIN_ROOTS}
        self.assertEqual(
            1,
            len(set(commands.values())),
            f"the four inlined notices have diverged: {commands}",
        )


class TestNoticeRendersCorrectly(unittest.TestCase):
    def test_command_renders_to_the_canonical_text(self) -> None:
        """Run it through a real shell, not a string comparison.

        `printf '%s\\n'` emits literal backslash-n rather than newlines,
        which looks fine in the JSON and is only visible once executed.
        """
        for plugin_root in PLUGIN_ROOTS:
            with self.subTest(plugin=str(plugin_root)):
                result = subprocess.run(
                    ["sh", "-c", _hook_command(plugin_root)],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(0, result.returncode, result.stderr)
                self.assertEqual(build_notice().rstrip("\n"), result.stdout.rstrip("\n"))
                self.assertNotIn("\\n", result.stdout)

    def test_notice_names_the_new_marketplace(self) -> None:
        notice = build_notice()
        self.assertIn("deagy/cadre", notice)
        self.assertIn("/plugin marketplace add", notice)
        # ...and says plainly that staying put means never updating again.
        self.assertIn("frozen", notice)


class TestNoticeOnlyInforms(unittest.TestCase):
    def test_hook_command_takes_no_action(self) -> None:
        for plugin_root in PLUGIN_ROOTS:
            command = _hook_command(plugin_root)
            # Strip the quoted notice body; only the executed prefix matters.
            executable_part = command.split("'", 1)[0]
            for forbidden in FORBIDDEN_IN_COMMAND:
                with self.subTest(plugin=str(plugin_root), forbidden=forbidden):
                    self.assertNotIn(forbidden, executable_part)
            self.assertTrue(executable_part.strip().startswith("printf"), command[:60])

    def test_hook_has_a_timeout(self) -> None:
        """A hook that hangs would block every session start."""
        for plugin_root in PLUGIN_ROOTS:
            payload = json.loads(
                (REPO_ROOT / plugin_root / "hooks" / "hooks.json").read_text(encoding="utf-8")
            )
            entry = payload["hooks"]["SessionStart"][0]["hooks"][0]
            with self.subTest(plugin=str(plugin_root)):
                self.assertIn("timeout", entry)
                self.assertLessEqual(entry["timeout"], 10)


if __name__ == "__main__":
    unittest.main()
