#!/usr/bin/env python3
"""Tests for agentic_sdlc_langgraph/runtime.py's dispatch adapters and engine.

These specifically target coverage gaps identified in independent review of
the `root`-threading and changed-file-discovery fixes in PR #1: no existing
test exercised the native adapter's default-invocation (no --base/--files)
git-status discovery, its root defaulting/validation, its files-list
dedup parity with select_agents.py's explicit_files(), or DispatchEngine's
native-failure -> CLI-fallback behavior (which the response's `method` field
distinguishes but nothing previously asserted on).

Run with: python3 -m unittest test_runtime -v
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

_MODULE_DIR = Path(__file__).resolve().parent
if str(_MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(_MODULE_DIR))

from runtime import (
    DispatchEngine,
    DispatchRequest,
    DispatchResponse,
    NativeDispatchAdapter,
    PLUGIN_ROOT,
    build_graph_for_task,
)


def _init_git_repo(root: Path) -> None:
    subprocess.run(["git", "init", "-q"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=root, check=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=root, check=True)


class TestNativeDispatchAdapterRoot(unittest.TestCase):
    """Coverage for the `root` field this PR threaded through DispatchRequest."""

    def test_root_defaults_to_plugin_root(self):
        adapter = NativeDispatchAdapter()
        request = DispatchRequest(task="t", files=["README.md"])
        response = adapter.execute(request)
        self.assertTrue(response.success, response.error)
        self.assertEqual(response.plan["inputs"]["repository_root"], str(PLUGIN_ROOT))

    def test_explicit_root_is_used_not_plugin_root(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            _init_git_repo(root)
            adapter = NativeDispatchAdapter()
            request = DispatchRequest(task="t", files=["README.md"], root=str(root))
            response = adapter.execute(request)
            self.assertTrue(response.success, response.error)
            self.assertEqual(response.plan["inputs"]["repository_root"], str(root))
            self.assertNotEqual(response.plan["inputs"]["repository_root"], str(PLUGIN_ROOT))

    def test_nonexistent_root_is_rejected(self):
        adapter = NativeDispatchAdapter()
        request = DispatchRequest(task="t", root="/nonexistent/definitely-not-a-directory")
        response = adapter.execute(request)
        self.assertFalse(response.success)
        self.assertEqual(response.error_code, "INVALID_ROOT")


class TestBuildGraphForTaskRoot(unittest.TestCase):
    """`build_graph_for_task`/`execute_dispatch` are module-level convenience
    wrappers around DispatchEngine whose own docstring calls them "the
    primary public API" mirroring the CLI's inputs. Review found `root` had
    been threaded through DispatchRequest and the adapters but not into
    these wrapper functions' own parameter lists at all — passing root= used
    to be a TypeError, silently defaulting every caller of them to
    PLUGIN_ROOT regardless of intent. The graph shape these wrappers return
    (_plan_to_graph) doesn't surface repository_root directly, so these
    tests confirm root reaches dispatch by its effect (accepted without
    TypeError; a nonexistent root produces an error result) rather than by
    reading it back out of the graph.

    Note: the graph representation itself is dead weight from the shipped
    Cline plugin's perspective — bridge.py calls DispatchEngine.dispatch()
    directly, never these wrappers or their LangGraph-node/edge shape."""

    def test_accepts_root_kwarg_without_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            _init_git_repo(root)
            graph = build_graph_for_task(task="t", files=["README.md"], root=str(root))
            self.assertNotEqual(graph.get("status"), "error", graph.get("error"))

    def test_nonexistent_root_surfaces_as_error(self):
        graph = build_graph_for_task(
            task="t", files=["README.md"], root="/nonexistent/definitely-not-a-directory"
        )
        self.assertEqual(graph.get("status"), "error")


class TestNativeDispatchAdapterChangedFileDiscovery(unittest.TestCase):
    """Coverage for the git-status/git-diff parity fix with select_agents.py."""

    def test_default_invocation_uses_git_status_not_empty_list(self):
        # This is the exact bug this PR fixed: omitting both --base and
        # --files used to silently return ([], "none") instead of the CLI's
        # git-status-based discovery of the dirty working tree.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            _init_git_repo(root)
            (root / "dirty.txt").write_text("uncommitted\n")

            adapter = NativeDispatchAdapter()
            request = DispatchRequest(task="t", root=str(root))
            response = adapter.execute(request)

            self.assertTrue(response.success, response.error)
            inputs = response.plan["inputs"]
            self.assertEqual(inputs["changed_file_source"], "git-status")
            self.assertIn("dirty.txt", inputs["changed_files"])

    def test_base_ref_uses_git_diff(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            _init_git_repo(root)
            (root / "a.txt").write_text("first\n")
            subprocess.run(["git", "add", "a.txt"], cwd=root, check=True)
            subprocess.run(["git", "commit", "-q", "-m", "first"], cwd=root, check=True)
            subprocess.run(["git", "branch", "base"], cwd=root, check=True)

            (root / "b.txt").write_text("second\n")
            subprocess.run(["git", "add", "b.txt"], cwd=root, check=True)
            subprocess.run(["git", "commit", "-q", "-m", "second"], cwd=root, check=True)

            adapter = NativeDispatchAdapter()
            request = DispatchRequest(task="t", root=str(root), base="base")
            response = adapter.execute(request)

            self.assertTrue(response.success, response.error)
            inputs = response.plan["inputs"]
            self.assertEqual(inputs["changed_file_source"], "git-diff:base...HEAD")
            self.assertIn("b.txt", inputs["changed_files"])
            self.assertNotIn("a.txt", inputs["changed_files"])

    def test_git_failure_is_reported_as_adapter_failure_not_empty_plan(self):
        # Non-git directory with no explicit files forces the git-status
        # discovery path to fail. Before this PR's fix, a git failure here
        # was swallowed into an empty-but-successful plan; it must now
        # surface as an adapter failure so DispatchEngine can fall back.
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()  # deliberately not a git repo

            adapter = NativeDispatchAdapter()
            request = DispatchRequest(task="t", root=str(root))
            response = adapter.execute(request)

            self.assertFalse(response.success)
            self.assertEqual(response.error_code, "NATIVE_ERROR")


class TestNativeDispatchAdapterFilesDedup(unittest.TestCase):
    """select_agents.py's explicit_files() dedupes via dict.fromkeys; the
    native adapter must match so callers get identical changed_files
    regardless of which adapter served the request."""

    def test_duplicate_explicit_files_are_deduped(self):
        adapter = NativeDispatchAdapter()
        request = DispatchRequest(task="t", files=["README.md", "README.md", "CLAUDE.md", "README.md"])
        response = adapter.execute(request)
        self.assertTrue(response.success, response.error)
        self.assertEqual(
            response.plan["inputs"]["changed_files"], ["README.md", "CLAUDE.md"]
        )


class _FakeAdapter:
    """Minimal DispatchAdapter stand-in for exercising DispatchEngine's
    priority/fallback logic without depending on real git/subprocess state."""

    def __init__(self, name: str, response: DispatchResponse, available: bool = True):
        self.name = name
        self._response = response
        self._available = available
        self.execute_called = False

    def is_available(self) -> bool:
        return self._available

    def execute(self, request: DispatchRequest) -> DispatchResponse:
        self.execute_called = True
        return self._response


class TestDispatchEngineFallback(unittest.TestCase):
    """Nothing previously asserted on DispatchResponse.method, so a
    regression that broke the native adapter (e.g. reintroducing the fixed
    root-hardcoding or changed-file-discovery bugs) could silently pass
    every test via the CLI-fallback adapter producing an equivalent-looking
    plan. These tests inject fake adapters to assert the engine's
    native-vs-fallback selection explicitly, independent of real git state."""

    def test_uses_native_response_and_method_when_native_succeeds(self):
        native = _FakeAdapter(
            "native", DispatchResponse(success=True, plan={"status": "ready"}, method="native")
        )
        fallback = _FakeAdapter(
            "fallback_cli", DispatchResponse(success=True, plan={"status": "ready"}, method="fallback_cli")
        )
        engine = DispatchEngine(native_adapter=native, fallback_adapter=fallback)

        response = engine.dispatch(DispatchRequest(task="t"))

        self.assertTrue(response.success)
        self.assertEqual(response.method, "native")
        self.assertTrue(native.execute_called)
        self.assertFalse(fallback.execute_called)

    def test_falls_back_to_cli_when_native_fails(self):
        native = _FakeAdapter(
            "native",
            DispatchResponse(success=False, error="native broke", error_code="NATIVE_ERROR", method="native"),
        )
        fallback = _FakeAdapter(
            "fallback_cli", DispatchResponse(success=True, plan={"status": "ready"}, method="fallback_cli")
        )
        engine = DispatchEngine(native_adapter=native, fallback_adapter=fallback)

        response = engine.dispatch(DispatchRequest(task="t"))

        self.assertTrue(response.success)
        self.assertEqual(response.method, "fallback_cli")
        self.assertTrue(native.execute_called)
        self.assertTrue(fallback.execute_called)

    def test_reports_error_when_both_adapters_fail(self):
        native = _FakeAdapter(
            "native",
            DispatchResponse(success=False, error="native broke", error_code="NATIVE_ERROR", method="native"),
        )
        fallback = _FakeAdapter("fallback_cli", DispatchResponse(success=False, error="cli broke", method="fallback_cli"))
        engine = DispatchEngine(native_adapter=native, fallback_adapter=fallback)

        response = engine.dispatch(DispatchRequest(task="t"))

        # The engine returns the fallback adapter's own response verbatim
        # here (dispatch() has no separate "both failed" branch when the
        # fallback is available and ran) — assert the exact response, not
        # just success/failure, so a regression that started synthesizing a
        # different error/method here wouldn't slip through.
        self.assertFalse(response.success)
        self.assertEqual(response.error, "cli broke")
        self.assertEqual(response.method, "fallback_cli")

    def test_reports_no_adapter_available_when_neither_is_available(self):
        # Distinct from "both executed and failed" above: this is dispatch()'s
        # third branch, where is_available() is False for both adapters from
        # the start, so neither execute() ever runs.
        native = _FakeAdapter("native", DispatchResponse(success=True, plan={}, method="native"), available=False)
        fallback = _FakeAdapter(
            "fallback_cli", DispatchResponse(success=True, plan={}, method="fallback_cli"), available=False
        )
        engine = DispatchEngine(native_adapter=native, fallback_adapter=fallback)

        response = engine.dispatch(DispatchRequest(task="t"))

        self.assertFalse(response.success)
        self.assertEqual(response.error_code, "NO_ADAPTER_AVAILABLE")
        self.assertEqual(response.method, "error")
        self.assertFalse(native.execute_called)
        self.assertFalse(fallback.execute_called)


if __name__ == "__main__":
    unittest.main()
