#!/usr/bin/env python3
"""Guard against drift between cadre-lifecycle-core's shared assets and the
byte-for-byte-except-naming copies bundled into cadre-lifecycle-github and
cadre-lifecycle-gitlab (see plugins/lifecycle-{github,gitlab}/tools/ and the
lifecycle-onboarding-*/lifecycle-review-generic-*/brief-pending-gates-*
skills under plugins/lifecycle-{github,gitlab}/skills/).

Those three plugins deliberately duplicate this content instead of sharing a
single source, so each forge plugin is self-sufficient without also
installing cadre-lifecycle-core (see plugins/lifecycle-github/.claude-plugin/
plugin.json and plugins/lifecycle-gitlab/.claude-plugin/plugin.json). Nothing
enforces that the duplicates stay in sync except this test: a future edit to
plugins/lifecycle/tools/bootstrap_sdlc.py (or its test, or one of the three
duplicated skills) that isn't mirrored into both forge plugins would
otherwise only be caught by a human noticing, if ever.

    python3 -m unittest discover -s tools -p "test_*.py"
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

FORGES = ("github", "gitlab")

# tools/bootstrap_sdlc.py's docstring names its own path in four example
# invocation lines; that is the only line expected to differ between the
# core, github, and gitlab copies.
BOOTSTRAP_PATH_PATTERN = re.compile(
    r"plugins/lifecycle(?:-github|-gitlab)?/tools/bootstrap_sdlc\.py"
)

# test_bootstrap_sdlc.py's docstring names its own module path (in the
# opening summary line) and the `unittest discover -s` path in its trailing
# usage line; those are the only expected differences.
TEST_BOOTSTRAP_PATH_PATTERN = re.compile(
    r"plugins/lifecycle(?:-github|-gitlab)?/tools"
)

# The three duplicated skills cross-reference each other and themselves by
# name (e.g. "lifecycle-onboarding's Step 4"); the bundled copies rename
# those references to their own suffixed sibling skill. Normalizing them
# back to the core plugin's bare names makes the bodies comparable. This
# pattern intentionally only matches the CALLER-SUPPLIED forge's own suffix
# (see _normalize_skill_name's `forge` parameter) -- a reference bearing the
# *other* forge's suffix (e.g. a "-gitlab" name inside a github skill,
# likely a copy-paste mistake) must NOT normalize away, so it still shows up
# as a real diff against the core body instead of silently comparing equal.
def _skill_name_pattern(forge: str) -> re.Pattern[str]:
    return re.compile(
        rf"lifecycle-onboarding(?:-{forge})?"
        rf"|lifecycle-review-generic(?:-{forge})?"
        rf"|brief-pending-gates(?:-{forge})?"
    )


def _normalize_skill_name(match: re.Match) -> str:
    text = match.group(0)
    if text.startswith("lifecycle-onboarding"):
        return "lifecycle-onboarding"
    if text.startswith("lifecycle-review-generic"):
        return "lifecycle-review"
    return "brief-pending-gates"


def _skill_body(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise AssertionError(f"{path} does not start with a --- frontmatter delimiter")
    end = text.index("\n---\n", 4)
    return text[end + len("\n---\n") :]


class BootstrapScriptDuplicationTests(unittest.TestCase):
    """plugins/lifecycle*/tools/bootstrap_sdlc.py must stay identical."""

    def _paths(self) -> dict[str, Path]:
        return {
            "core": REPO_ROOT / "plugins/lifecycle/tools/bootstrap_sdlc.py",
            "github": REPO_ROOT / "plugins/lifecycle-github/tools/bootstrap_sdlc.py",
            "gitlab": REPO_ROOT / "plugins/lifecycle-gitlab/tools/bootstrap_sdlc.py",
        }

    def test_all_copies_exist(self) -> None:
        for name, path in self._paths().items():
            self.assertTrue(path.is_file(), f"{name} copy missing at {path}")

    def test_copies_are_identical_except_the_docstring_example_paths(self) -> None:
        paths = self._paths()
        normalized = {
            name: BOOTSTRAP_PATH_PATTERN.sub("PLUGIN_TOOLS_PATH", path.read_text(encoding="utf-8"))
            for name, path in paths.items()
        }
        core = normalized["core"]
        for name in ("github", "gitlab"):
            self.assertEqual(
                core,
                normalized[name],
                f"plugins/lifecycle-{name}/tools/bootstrap_sdlc.py has drifted from "
                "plugins/lifecycle/tools/bootstrap_sdlc.py beyond the docstring's "
                "example invocation paths",
            )

    def test_each_copy_actually_names_its_own_path(self) -> None:
        # Guard against the normalization above silently passing if a copy's
        # docstring was never updated at all (e.g. still says
        # plugins/lifecycle/tools/... verbatim) -- that would also normalize
        # away to the same placeholder and falsely look "in sync".
        for name in ("github", "gitlab"):
            path = self._paths()[name]
            text = path.read_text(encoding="utf-8")
            self.assertIn(f"plugins/lifecycle-{name}/tools/bootstrap_sdlc.py", text)


class TestBootstrapScriptDuplicationTests(unittest.TestCase):
    """plugins/lifecycle*/tools/test_bootstrap_sdlc.py must stay identical."""

    def _paths(self) -> dict[str, Path]:
        return {
            "core": REPO_ROOT / "plugins/lifecycle/tools/test_bootstrap_sdlc.py",
            "github": REPO_ROOT / "plugins/lifecycle-github/tools/test_bootstrap_sdlc.py",
            "gitlab": REPO_ROOT / "plugins/lifecycle-gitlab/tools/test_bootstrap_sdlc.py",
        }

    def test_all_copies_exist(self) -> None:
        for name, path in self._paths().items():
            self.assertTrue(path.is_file(), f"{name} copy missing at {path}")

    def test_copies_are_identical_except_the_docstring_paths(self) -> None:
        paths = self._paths()
        normalized = {
            name: TEST_BOOTSTRAP_PATH_PATTERN.sub("PLUGIN_TOOLS_PATH", path.read_text(encoding="utf-8"))
            for name, path in paths.items()
        }
        core = normalized["core"]
        for name in ("github", "gitlab"):
            self.assertEqual(
                core,
                normalized[name],
                f"plugins/lifecycle-{name}/tools/test_bootstrap_sdlc.py has drifted from "
                "plugins/lifecycle/tools/test_bootstrap_sdlc.py beyond the docstring paths",
            )

    def test_each_copy_actually_names_its_own_path(self) -> None:
        for name in ("github", "gitlab"):
            path = self._paths()[name]
            text = path.read_text(encoding="utf-8")
            self.assertIn(f"plugins/lifecycle-{name}/tools", text)


class DuplicatedSkillBodyTests(unittest.TestCase):
    """The three bundled skills' bodies must match their core source."""

    SKILLS = {
        "lifecycle-onboarding": "lifecycle-onboarding{suffix}",
        "lifecycle-review": "lifecycle-review-generic{suffix}",
        "brief-pending-gates": "brief-pending-gates{suffix}",
    }

    def _core_path(self, skill: str) -> Path:
        return REPO_ROOT / "plugins/lifecycle/skills" / skill / "SKILL.md"

    def _forge_path(self, skill: str, forge: str) -> Path:
        suffix = f"-{forge}"
        dest_name = self.SKILLS[skill].format(suffix=suffix)
        return REPO_ROOT / f"plugins/lifecycle-{forge}/skills" / dest_name / "SKILL.md"

    def test_all_copies_exist(self) -> None:
        for skill in self.SKILLS:
            self.assertTrue(self._core_path(skill).is_file(), f"missing core skill {skill}")
            for forge in FORGES:
                path = self._forge_path(skill, forge)
                self.assertTrue(path.is_file(), f"missing bundled skill copy {path}")

    def test_bodies_match_after_normalizing_cross_reference_renames(self) -> None:
        for skill in self.SKILLS:
            core_body = _skill_body(self._core_path(skill))
            for forge in FORGES:
                forge_body = _skill_body(self._forge_path(skill, forge))
                normalized = _skill_name_pattern(forge).sub(_normalize_skill_name, forge_body)
                self.assertEqual(
                    core_body,
                    normalized,
                    f"{self._forge_path(skill, forge)} body has drifted from "
                    f"{self._core_path(skill)} beyond the expected cross-reference "
                    "renames",
                )

    def test_frontmatter_name_matches_the_suffixed_skill_directory(self) -> None:
        for skill in self.SKILLS:
            for forge in FORGES:
                path = self._forge_path(skill, forge)
                text = path.read_text(encoding="utf-8")
                expected_name = self.SKILLS[skill].format(suffix=f"-{forge}")
                self.assertIn(f"name: {expected_name}\n", text)


if __name__ == "__main__":
    unittest.main()
