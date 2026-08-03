#!/usr/bin/env python3
"""Stdin/stdout bridge for Cadre's LangGraph dispatch engine.

This module exposes the LangGraph engine's dispatch capabilities via stdin/
stdout, making it suitable for invocation from Node.js (or any other
language) via child_process.

Input format (stdin):
    JSON object with fields:
        - task (required): Task objective used for routing
        - files (optional): Changed paths to scope the plan to
        - base (optional): Git base ref for diff-based file discovery
        - taskId (optional): Stable caller-supplied task identifier
        - classification (optional): Authorized knowledge classification
        - requireSdlc (optional): Fail instead of degrading if Agentic SDLC isn't available

Output format (stdout):
    JSON object with fields:
        - success (boolean): Whether dispatch succeeded
        - plan (object, optional): The dispatch plan (only on success)
        - error (string, optional): Error message (only on failure)
        - error_code (string, optional): Machine-readable error code
        - method (string): How the dispatch was executed ("native", "fallback_cli", "error")
        - generated_at (string): ISO 8601 timestamp of when the response was generated

Exit codes:
    0: Success (dispatch completed, even if plan has no agents)
    1: Error (invalid input, dispatch failure, or internal error)

Example usage from Node.js:
    const { execFileSync } = require('child_process');
    const input = JSON.stringify({ task: 'Implement user authentication' });
    const result = execFileSync('python3', ['bridge.py'], {
        input: input,
        encoding: 'utf-8',
        timeout: 30000
    });
    const plan = JSON.parse(result);

Example usage from shell:
    echo '{"task": "Implement user authentication"}' | python3 bridge.py
"""

from __future__ import annotations

import json
import logging
import sys
from pathlib import Path
from typing import Any

# Ensure the module's parent directory is on sys.path so we can import
# the runtime module even when bridge.py is invoked directly.
_MODULE_DIR = Path(__file__).resolve().parent
if str(_MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(_MODULE_DIR))

from runtime import (
    DispatchRequest,
    DispatchResponse,
    DispatchEngine,
    build_graph_for_task,
)

logger = logging.getLogger("cadre-langgraph-bridge")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

REQUIRED_FIELDS = {"task"}
MAX_INPUT_BYTES = 1 * 1024 * 1024  # 1 MB
DEFAULT_TIMEOUT_SECONDS = 60

# Field name mapping: CLI-style (snake_case) -> bridge-style (camelCase)
FIELD_ALIASES = {
    "taskId": "task_id",
    "requireSdlc": "require_sdlc",
}

# ---------------------------------------------------------------------------
# Input parsing
# ---------------------------------------------------------------------------


def parse_input(raw: str) -> tuple[DispatchRequest, list[str]]:
    """Parse raw JSON input into a DispatchRequest.

    Returns:
        A tuple of (request, errors). If errors is non-empty, the request
        may still be partially populated but should not be used for dispatch.
    """
    errors: list[str] = []

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as error:
        return DispatchRequest(task=""), [f"Invalid JSON input: {error}"]

    if not isinstance(data, dict):
        return DispatchRequest(task=""), ["Input must be a JSON object"]

    # Extract and normalize field names
    task = data.get("task")
    if not task or not isinstance(task, str):
        errors.append("'task' is required and must be a string")
        task = ""

    # Handle camelCase aliases
    files_raw = data.get("files", data.get("files"))
    if files_raw is None:
        files = []
    elif isinstance(files_raw, str):
        # Support comma-separated files
        files = [f.strip() for f in files_raw.split(",") if f.strip()]
    elif isinstance(files_raw, list):
        files = [str(f) for f in files_raw]
    else:
        files = []
        errors.append("'files' must be a string or array of strings")

    base = data.get("base")
    if base is not None and not isinstance(base, str):
        errors.append("'base' must be a string")
        base = None

    task_id = data.get("taskId", data.get("task_id"))
    if task_id is not None and not isinstance(task_id, str):
        errors.append("'taskId' must be a string")
        task_id = None

    classification = data.get("classification")
    if classification is not None and not isinstance(classification, str):
        errors.append("'classification' must be a string")
        classification = None

    require_sdlc = data.get("requireSdlc", data.get("require_sdlc", False))
    if not isinstance(require_sdlc, bool):
        # Accept string "true"/"false" for flexibility
        if isinstance(require_sdlc, str):
            require_sdlc = require_sdlc.lower() in ("true", "1", "yes")
        else:
            require_sdlc = bool(require_sdlc)

    request = DispatchRequest(
        task=task,
        files=files,
        base=base,
        task_id=task_id,
        classification=classification,
        require_sdlc=require_sdlc,
    )

    # Add validation errors from the request itself
    errors.extend(request.validate())

    return request, errors


# ---------------------------------------------------------------------------
# Output formatting
# ---------------------------------------------------------------------------


def format_success(response: DispatchResponse) -> dict[str, Any]:
    """Format a successful dispatch response for stdout."""
    return {
        "success": True,
        "plan": response.plan,
        "method": response.method,
        "generated_at": response.generated_at,
    }


def format_error(
    error_message: str,
    error_code: str = "BRIDGE_ERROR",
    method: str = "error",
) -> dict[str, Any]:
    """Format an error response for stdout."""
    return {
        "success": False,
        "error": error_message,
        "error_code": error_code,
        "method": method,
        "generated_at": _now_iso(),
    }


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Main bridge logic
# ---------------------------------------------------------------------------


def run_bridge(
    stdin_data: str | None = None,
    engine: DispatchEngine | None = None,
) -> tuple[int, dict[str, Any]]:
    """Execute the bridge: read input, dispatch, write output.

    Args:
        stdin_data: Raw JSON string to process. If None, reads from stdin.
        engine: Optional pre-configured DispatchEngine. If None, creates one.

    Returns:
        A tuple of (exit_code, response_dict).
    """
    # Read input
    if stdin_data is None:
        try:
            stdin_data = sys.stdin.read(MAX_INPUT_BYTES)
        except Exception as error:
            logger.exception("Failed to read from stdin")
            return 1, format_error(f"Failed to read from stdin: {error}")

    if not stdin_data.strip():
        return 1, format_error("Empty input: provide a JSON object with at least a 'task' field")

    # Parse input
    request, parse_errors = parse_input(stdin_data)
    if parse_errors:
        return 1, format_error(
            "; ".join(parse_errors),
            error_code="INVALID_INPUT",
        )

    # Dispatch
    if engine is None:
        engine = DispatchEngine()

    response = engine.dispatch(request)

    if response.success:
        return 0, format_success(response)
    else:
        return 1, {
            "success": False,
            "error": response.error,
            "error_code": response.error_code or "DISPATCH_ERROR",
            "method": response.method,
            "generated_at": response.generated_at,
        }


def main() -> int:
    """Entry point for the bridge CLI."""
    # Configure logging
    logging.basicConfig(
        level=logging.WARNING,
        format="%(asctime)s %(name)s %(levelname)s: %(message)s",
        stream=sys.stderr,
    )

    exit_code, response = run_bridge()

    # Write output to stdout
    output = json.dumps(response, indent=2, ensure_ascii=False) + "\n"
    sys.stdout.buffer.write(output.encode("utf-8"))

    return exit_code


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        logger.info("Bridge interrupted by user")
        raise SystemExit(130)
    except Exception as error:  # noqa: BLE001 — unexpected errors
        logger.exception("Unexpected error in bridge")
        error_response = format_error(
            f"Unexpected internal error: {error}",
            error_code="INTERNAL_ERROR",
        )
        output = json.dumps(error_response, indent=2, ensure_ascii=False) + "\n"
        sys.stdout.buffer.write(output.encode("utf-8"))
        raise SystemExit(1) from error
