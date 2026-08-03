#!/usr/bin/env python3
"""Tests for tools/plugin_version.py.

`set_version()` writes the release version into two independent manifests
(`.claude-plugin/plugin.json` and `.codex-plugin/plugin.json`) that must never
disagree: Claude Code reads one, Codex CLI the other, and a version bump
landing on `main` is what triggers release.yml. A partial write would publish a
package advertising two different versions of itself.

Nothing else can catch that. Both manifests are hand-authored package assets,
deliberately excluded from `cadre generate-plugin`'s generated set, so the
register's drift check never inspects them -- see generate_global_plugin.py's
PACKAGE_ASSETS. This file is the only guard.

    python3 -m unittest discover -s tools -p "test_*.py"
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import plugin_version  # noqa: E402


class SetVersionAtomicityTests(unittest.TestCase):
    def _manifests(self, root: Path, version: str = "0.1.0") -> dict[str, Path]:
        manifests = {"claude": root / "claude.json", "codex": root / "codex.json"}
        for path in manifests.values():
            path.write_text(f'{{\n  "name": "cadre",\n  "version": "{version}"\n}}\n', encoding="utf-8")
        return manifests

    def test_both_manifests_are_written_together(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifests = self._manifests(Path(directory))
            with mock.patch.object(plugin_version, "MANIFESTS", manifests):
                plugin_version.set_version("0.2.0")
                self.assertEqual({"claude": "0.2.0", "codex": "0.2.0"}, plugin_version.read_versions())

    def test_a_failure_on_the_second_manifest_leaves_the_first_untouched(self) -> None:
        """The whole point of the all-or-nothing write: validation happens for
        every manifest before any of them is written to disk.
        """
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifests = self._manifests(root, "0.2.0")
            good = manifests["claude"].read_text(encoding="utf-8")
            # Corrupt only the second manifest, so validation must fail partway.
            broken = '{\n  "name": "cadre",\n  "ver_sion": "0.2.0"\n}\n'
            manifests["codex"].write_text(broken, encoding="utf-8")

            with mock.patch.object(plugin_version, "MANIFESTS", manifests):
                with self.assertRaisesRegex(SystemExit, 'could not locate a "version" line'):
                    plugin_version.set_version("0.3.0")

            self.assertEqual(good, manifests["claude"].read_text(encoding="utf-8"))
            self.assertEqual(broken, manifests["codex"].read_text(encoding="utf-8"))

    def test_non_semver_is_refused_before_anything_is_written(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manifests = self._manifests(Path(directory))
            original = manifests["claude"].read_text(encoding="utf-8")
            with mock.patch.object(plugin_version, "MANIFESTS", manifests):
                with self.assertRaisesRegex(SystemExit, "not MAJOR.MINOR.PATCH semver"):
                    plugin_version.set_version("0.3")
            self.assertEqual(original, manifests["claude"].read_text(encoding="utf-8"))


class CheckVersionsTests(unittest.TestCase):
    def test_disagreeing_manifests_are_reported(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifests = {"claude": root / "claude.json", "codex": root / "codex.json"}
            manifests["claude"].write_text('{"version": "0.2.0"}\n', encoding="utf-8")
            manifests["codex"].write_text('{"version": "0.3.0"}\n', encoding="utf-8")
            with mock.patch.object(plugin_version, "MANIFESTS", manifests):
                problems = plugin_version.check_versions()
            self.assertEqual(1, len(problems), problems)
            self.assertIn("disagree on version", problems[0])

    def test_this_repositorys_own_manifests_agree_on_a_valid_version(self) -> None:
        self.assertEqual([], plugin_version.check_versions())
        versions = plugin_version.read_versions()
        self.assertRegex(versions["claude"], r"^\d+\.\d+\.\d+$")
        self.assertEqual(versions["claude"], versions["codex"])

    def test_advertised_role_count_matches_the_packaged_catalog(self) -> None:
        """Both manifests advertise a role count in their `description`. The
        register's generator copies that prose faithfully, so a stale number
        passes every drift check -- only a comparison against the catalog
        itself catches it.
        """
        import re

        package_root = Path(__file__).resolve().parent.parent
        catalog = json.loads((package_root / "agent-catalog.json").read_text(encoding="utf-8"))
        expected = len(catalog["agents"])
        for name, path in plugin_version.MANIFESTS.items():
            with self.subTest(manifest=name):
                advertised = {
                    int(value)
                    for value in re.findall(r"(\d+) specialist roles", path.read_text(encoding="utf-8"))
                }
                self.assertEqual({expected}, advertised, str(path))


if __name__ == "__main__":
    unittest.main()
