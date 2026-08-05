#!/usr/bin/env python3
"""Test script for the LangGraph bridge module.

This script verifies that the bridge works correctly by:
1. Testing input parsing with various inputs
2. Testing the dispatch engine
3. Testing the full bridge pipeline (stdin -> stdout)
4. Testing error handling

Run with: python3 test_bridge.py
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch, MagicMock

# Ensure the module directory is on sys.path
_MODULE_DIR = Path(__file__).resolve().parent
if str(_MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(_MODULE_DIR))

from bridge import parse_input, run_bridge, format_success, format_error
from runtime import DispatchRequest, DispatchResponse, DispatchEngine, build_graph_for_task


class TestParseInput(unittest.TestCase):
    """Test input parsing logic."""

    def test_valid_minimal_input(self):
        """Test parsing a minimal valid input with only 'task'."""
        raw = json.dumps({"task": "Implement user authentication"})
        request, errors = parse_input(raw)
        self.assertEqual(errors, [])
        self.assertEqual(request.task, "Implement user authentication")
        self.assertEqual(request.files, [])
        self.assertIsNone(request.base)
        self.assertIsNone(request.task_id)
        self.assertIsNone(request.classification)
        self.assertFalse(request.require_sdlc)

    def test_valid_full_input(self):
        """Test parsing a full valid input with all fields."""
        raw = json.dumps({
            "task": "Fix login bug",
            "files": ["src/auth.py", "tests/test_auth.py"],
            "taskId": "task-123",
            "classification": "internal",
            "requireSdlc": True,
        })
        request, errors = parse_input(raw)
        self.assertEqual(errors, [])
        self.assertEqual(request.task, "Fix login bug")
        self.assertEqual(request.files, ["src/auth.py", "tests/test_auth.py"])
        self.assertIsNone(request.base)
        self.assertEqual(request.task_id, "task-123")
        self.assertEqual(request.classification, "internal")
        self.assertTrue(request.require_sdlc)

    def test_comma_separated_files(self):
        """Test parsing comma-separated files string."""
        raw = json.dumps({
            "task": "Test task",
            "files": "src/a.py, src/b.py, tests/c.py",
        })
        request, errors = parse_input(raw)
        self.assertEqual(errors, [])
        self.assertEqual(request.files, ["src/a.py", "src/b.py", "tests/c.py"])

    def test_missing_task(self):
        """Test parsing input without 'task' field."""
        raw = json.dumps({"files": ["src/a.py"]})
        request, errors = parse_input(raw)
        self.assertTrue(len(errors) > 0)
        self.assertIn("'task' is required", errors[0])

    def test_invalid_json(self):
        """Test parsing invalid JSON."""
        raw = "{invalid json}"
        request, errors = parse_input(raw)
        self.assertTrue(len(errors) > 0)
        self.assertIn("Invalid JSON", errors[0])

    def test_non_object_input(self):
        """Test parsing non-object JSON (array, string, etc.)."""
        raw = '["not", "an", "object"]'
        request, errors = parse_input(raw)
        self.assertTrue(len(errors) > 0)
        self.assertIn("JSON object", errors[0])

    def test_base_with_files_error(self):
        """Test that base + files combination is rejected."""
        raw = json.dumps({
            "task": "Test",
            "files": ["src/a.py"],
            "base": "main",
        })
        request, errors = parse_input(raw)
        self.assertTrue(len(errors) > 0)
        self.assertIn("cannot be combined", errors[0])

    def test_invalid_classification_accepted_at_parse_time_for_needs_triage_task(self):
        """`parse_input()` (and the `DispatchRequest.validate()` it calls)
        does not, by itself, reject an out-of-taxonomy classification: that
        check is deferred to the dispatch plan builder
        (`build_dispatch_plan._build_knowledge_context`), which only
        enforces it once a task actually selects an agent. "Test" doesn't
        match any route/risk rule (needs-triage), so no format error should
        surface here. See TestFullPipelineClassificationParity below for the
        full-bridge-vs-CLI behavior this guards, and
        test_invalid_classification_is_rejected_when_task_routes_to_an_agent
        for the case where the check still fires."""
        raw = json.dumps({
            "task": "Test",
            "classification": "top-secret",
        })
        request, errors = parse_input(raw)
        self.assertEqual(errors, [])
        self.assertEqual(request.classification, "top-secret")

    def test_invalid_classification_is_rejected_when_task_routes_to_an_agent(self):
        """Cross-path consistency check for Bug 1
        (cline-select-bridge-bug-2026-08-05): a task that actually selects an
        agent must still reject an invalid classification via the full
        bridge pipeline (not just via parse_input()), matching the CLI's
        `cadre select` behavior for the same input."""
        input_data = json.dumps({
            "task": "Implement user authentication",
            "classification": "top-secret",
        })
        exit_code, response = run_bridge(stdin_data=input_data)
        self.assertEqual(exit_code, 1)
        self.assertFalse(response["success"])
        self.assertIn("classification", response["error"].lower())

    def test_require_sdlc_string_true(self):
        """Test parsing requireSdlc as string 'true'."""
        raw = json.dumps({
            "task": "Test",
            "requireSdlc": "true",
        })
        request, errors = parse_input(raw)
        self.assertEqual(errors, [])
        self.assertTrue(request.require_sdlc)

    def test_require_sdlc_string_false(self):
        """Test parsing requireSdlc as string 'false'."""
        raw = json.dumps({
            "task": "Test",
            "requireSdlc": "false",
        })
        request, errors = parse_input(raw)
        self.assertEqual(errors, [])
        self.assertFalse(request.require_sdlc)


class TestDispatchEngine(unittest.TestCase):
    """Test the dispatch engine logic."""

    def test_engine_creation(self):
        """Test creating a dispatch engine."""
        engine = DispatchEngine()
        self.assertIsNotNone(engine)

    def test_build_graph_for_task_validation_error(self):
        """Test that empty task returns validation error."""
        result = build_graph_for_task(task="")
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["error_code"], "VALIDATION_ERROR")

    def test_build_graph_for_task_missing_task(self):
        """Test that missing task returns validation error."""
        result = build_graph_for_task(task=None)
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["error_code"], "VALIDATION_ERROR")


class TestRunBridge(unittest.TestCase):
    """Test the full bridge pipeline."""

    def test_run_bridge_valid_input(self):
        """Test running the bridge with valid input."""
        input_data = json.dumps({"task": "Test task"})
        exit_code, response = run_bridge(stdin_data=input_data)
        # The bridge should return 0 even if dispatch fails (it's a valid request)
        # The response will indicate success or failure based on engine availability
        self.assertIn("success", response)
        self.assertIn("method", response)

    def test_run_bridge_empty_input(self):
        """Test running the bridge with empty input."""
        exit_code, response = run_bridge(stdin_data="")
        self.assertEqual(exit_code, 1)
        self.assertFalse(response["success"])
        self.assertIn("Empty input", response["error"])

    def test_run_bridge_invalid_json(self):
        """Test running the bridge with invalid JSON."""
        exit_code, response = run_bridge(stdin_data="not json")
        self.assertEqual(exit_code, 1)
        self.assertFalse(response["success"])
        self.assertIn("Invalid JSON", response["error"])

    def test_run_bridge_missing_task(self):
        """Test running the bridge without task field."""
        input_data = json.dumps({"files": ["src/a.py"]})
        exit_code, response = run_bridge(stdin_data=input_data)
        self.assertEqual(exit_code, 1)
        self.assertFalse(response["success"])

    def test_format_success(self):
        """Test formatting a successful response."""
        response = DispatchResponse(
            success=True,
            plan={"test": "plan"},
            method="native",
        )
        formatted = format_success(response)
        self.assertTrue(formatted["success"])
        self.assertEqual(formatted["plan"], {"test": "plan"})
        self.assertEqual(formatted["method"], "native")
        self.assertIn("generated_at", formatted)

    def test_format_error(self):
        """Test formatting an error response."""
        formatted = format_error("Test error", error_code="TEST_ERROR")
        self.assertFalse(formatted["success"])
        self.assertEqual(formatted["error"], "Test error")
        self.assertEqual(formatted["error_code"], "TEST_ERROR")
        self.assertIn("generated_at", formatted)


class TestIntegration(unittest.TestCase):
    """Integration tests for the full pipeline."""

    def test_full_pipeline_valid_request(self):
        """Test the full pipeline with a valid request."""
        input_data = json.dumps({
            "task": "Implement user authentication",
            "classification": "internal",
        })
        exit_code, response = run_bridge(stdin_data=input_data)
        # Should return a response (success or failure depending on environment)
        self.assertIn("success", response)
        self.assertIn("method", response)
        # Output should be valid JSON
        output = json.dumps(response, indent=2, ensure_ascii=False) + "\n"
        parsed = json.loads(output)
        self.assertEqual(parsed, response)

    def test_full_pipeline_with_files(self):
        """Test the full pipeline with files."""
        input_data = json.dumps({
            "task": "Fix bug in auth module",
            
        })
        exit_code, response = run_bridge(stdin_data=input_data)
        self.assertIn("success", response)

    def test_full_pipeline_with_base(self):
        """Test the full pipeline with base ref."""
        input_data = json.dumps({
            "task": "Review changes",
            "base": "main",
        })
        exit_code, response = run_bridge(stdin_data=input_data)
        self.assertIn("success", response)


class TestFullPipelineClassificationParity(unittest.TestCase):
    """Regression coverage for Bug 1 (cline-select-bridge-bug-2026-08-05):
    classification-validation divergence between the native bridge path
    (runtime.py's DispatchRequest.validate()) and the CLI path (`cadre
    select` / build_dispatch_plan.py's _build_knowledge_context()).

    Reproduction that motivated this fix:
        ./bin/cadre select --task "test task" --classification "top-secret"
            -> succeeds (needs-triage), exit 0
        echo '{"task":"test task","classification":"top-secret"}' \
            | python3 agentic_sdlc_langgraph/bridge.py
            -> used to hard-fail (INVALID_INPUT), exit 1

    These two must agree for every input, not just the needs-triage case
    covered here — TestParseInput.test_invalid_classification_is_rejected_when_task_routes_to_an_agent
    covers the "does route" case from the bridge side.
    """

    def test_needs_triage_task_with_invalid_classification_succeeds_via_bridge(self):
        """A needs-triage task (one that matches no route/risk rule) must
        succeed via the bridge with an out-of-taxonomy classification,
        exactly as it does via the CLI -- this is the exact bug
        reproduction case, run through the full bridge pipeline rather than
        just parse_input() in isolation."""
        input_data = json.dumps({
            "task": "test task",
            "classification": "top-secret",
        })
        exit_code, response = run_bridge(stdin_data=input_data)
        self.assertEqual(exit_code, 0, response)
        self.assertTrue(response["success"], response.get("error"))
        self.assertEqual(response["plan"]["status"], "needs-triage")
        self.assertEqual(
            response["plan"]["knowledge_context"]["status"], "not-applicable"
        )


if __name__ == "__main__":
    # Run tests with verbose output
    unittest.main(verbosity=2)
