"""LangGraph-style dispatch runtime for Cadre's agent orchestration.

This module provides the core dispatch logic that wraps Cadre's existing
deterministic routing and agent selection. It exposes a clean API suitable
for use by the stdin/stdout bridge module.

The runtime is intentionally decoupled from I/O: it accepts structured
dictionaries and returns structured dictionaries. The bridge.py module
handles JSON serialization/deserialization.

Key design decisions:
- The runtime does NOT import from the mcp package (keeps it testable)
- The runtime does NOT import from the orchestration src/ directly (avoids
  circular dependencies); instead it uses a pluggable dispatch adapter
- The runtime provides both a "native" path (using existing orchestration)
  and a fallback path (using CLI subprocess) for resilience
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Directory layout constants
# ---------------------------------------------------------------------------

MODULE_ROOT = Path(__file__).resolve().parent
PLUGIN_ROOT = MODULE_ROOT.parent  # /home/deagy/sdk/cadre-lifecycle
SUITE_ROOT = PLUGIN_ROOT / "suite"
ORCHESTRATION_SRC = SUITE_ROOT / "roster" / "orchestration" / "src"
ORCHESTRATION_MCP = SUITE_ROOT / "roster" / "orchestration" / "mcp"
ROSTER_ROOT = SUITE_ROOT / "roster"

# ---------------------------------------------------------------------------
# Data classes for structured I/O
# ---------------------------------------------------------------------------


@dataclass
class DispatchRequest:
    """Input to the dispatch engine.

    Mirrors the CLI's argument surface so callers can pass the same inputs
    whether they use the CLI, the bridge, or the runtime directly.
    """

    task: str
    files: list[str] = field(default_factory=list)
    base: Optional[str] = None
    task_id: Optional[str] = None
    classification: Optional[str] = None
    require_sdlc: bool = False
    root: Optional[str] = None
    """Target repository root. Defaults to this plugin's own root (PLUGIN_ROOT)
    when omitted, mirroring the CLI's `--root` (which defaults to the
    caller's cwd) — omission is only correct for callers that mean "this
    repository," not a stand-in for "unknown."""

    def validate(self) -> list[str]:
        """Return a list of validation errors (empty if valid)."""
        errors: list[str] = []
        if not self.task or not self.task.strip():
            errors.append("'task' is required and must be non-empty")
        if self.base and self.files:
            errors.append("--base cannot be combined with --files")
        valid_classifications = {"public", "internal", "confidential", "restricted"}
        if self.classification and self.classification not in valid_classifications:
            errors.append(
                f"'classification' must be one of {sorted(valid_classifications)}, "
                f"got {self.classification!r}"
            )
        return errors


@dataclass
class DispatchResponse:
    """Output from the dispatch engine.

    Wraps the dispatch plan with metadata about how it was produced.
    """

    success: bool
    plan: Optional[dict[str, Any]] = None
    error: Optional[str] = None
    error_code: Optional[str] = None
    method: str = "unknown"  # "native", "fallback_cli", or "error"
    generated_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Dispatch adapter protocol
# ---------------------------------------------------------------------------
# The adapter pattern lets us swap between the native orchestration import
# path and the CLI subprocess fallback without duplicating dispatch logic.


class DispatchAdapter:
    """Protocol for dispatch execution backends."""

    name: str = "base"

    def execute(self, request: DispatchRequest) -> DispatchResponse:
        raise NotImplementedError

    def is_available(self) -> bool:
        """Return True if this adapter can be used in the current environment."""
        return True


# ---------------------------------------------------------------------------
# Native adapter: imports the existing orchestration code directly
# ---------------------------------------------------------------------------


class NativeDispatchAdapter(DispatchAdapter):
    """Dispatch via direct import of the existing orchestration modules.

    This is the preferred path when the orchestration code is importable
    from the bridge's location. It avoids subprocess overhead and gives
    access to the full dispatch plan without JSON round-tripping.
    """

    name = "native"

    def __init__(self) -> None:
        self._config: dict[str, Any] | None = None
        self._catalog: list[str] | None = None
        self._import_error: str | None = None

    def is_available(self) -> bool:
        if self._config is not None:
            return True
        try:
            self._load_dependencies()
            return True
        except Exception as error:  # noqa: BLE001 — we're probing availability
            self._import_error = str(error)
            logger.debug("Native adapter unavailable: %s", error)
            return False

    def _load_dependencies(self) -> None:
        """Load routing config and catalog once, caching the result."""
        if self._config is not None:
            return

        # Ensure the orchestration src/ is on sys.path
        src_str = str(ORCHESTRATION_SRC)
        if src_str not in sys.path:
            sys.path.insert(0, src_str)

        from routing import load_catalog, load_routing  # noqa: E402

        catalog_path = ROSTER_ROOT / "catalog.yaml"
        routing_path = ORCHESTRATION_SRC.parent / "routing.yaml"

        self._config = load_routing(routing_path)
        self._catalog = load_catalog(catalog_path)

    def execute(self, request: DispatchRequest) -> DispatchResponse:
        if not self.is_available():
            return DispatchResponse(
                success=False,
                error=f"Native adapter unavailable: {self._import_error}",
                error_code="NATIVE_UNAVAILABLE",
                method="native",
            )

        try:
            self._load_dependencies()
            assert self._config is not None and self._catalog is not None

            from build_dispatch_plan import build_dispatch_plan  # noqa: E402

            repository_root = (
                Path(request.root).expanduser().resolve() if request.root else PLUGIN_ROOT
            )
            if not repository_root.is_dir():
                return DispatchResponse(
                    success=False,
                    error=f"Repository root is not a directory: {repository_root}",
                    error_code="INVALID_ROOT",
                    method="native",
                )

            # Build the input_data dict expected by build_dispatch_plan
            if request.files:
                changed_files = [f.replace("\\", "/") for f in request.files]
                changed_file_source = "explicit"
            else:
                # Try to discover changed files via git
                changed_files, changed_file_source = self._discover_changed_files(
                    request.base, repository_root
                )

            input_data = {
                "task": request.task,
                "task_id": request.task_id,
                "repository_root": str(repository_root),
                "base": request.base,
                "changed_files": changed_files,
                "changed_file_source": changed_file_source,
                "classification": request.classification,
                "source": self._resolve_knowledge_source(repository_root),
                "top": "5",
            }

            plan = build_dispatch_plan(
                config=self._config,
                catalog=self._catalog,
                input_data=input_data,
                require_sdlc=request.require_sdlc,
                catalog_path=ROSTER_ROOT / "catalog.yaml",
                routing_path=ORCHESTRATION_SRC.parent / "routing.yaml",
            )

            return DispatchResponse(
                success=True,
                plan=plan,
                method="native",
            )
        except Exception as error:  # noqa: BLE001
            logger.exception("Native dispatch failed")
            return DispatchResponse(
                success=False,
                error=str(error),
                error_code="NATIVE_ERROR",
                method="native",
            )

    def _run_git(self, args: list[str], repository_root: Path) -> str:
        # repository_root is caller-controlled (an arbitrary target workspace)
        # and may point at an untrusted checkout; neutralize the
        # config-driven RCE surface (fsmonitor hook, system-wide config,
        # interactive credential prompts) before reading its .git state.
        # Mirrors select_agents.py's _run_git, plus a 10s timeout: this
        # runtime is invoked in-process from a long-lived bridge/plugin
        # session rather than as a one-shot CLI process, so an unbounded git
        # call here would hang the whole session rather than just exiting.
        env = dict(os.environ)
        env["GIT_CONFIG_NOSYSTEM"] = "1"
        env["GIT_TERMINAL_PROMPT"] = "0"
        result = subprocess.run(
            ["git", "-c", "core.fsmonitor=false", "--no-optional-locks", *args],
            cwd=str(repository_root),
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env=env,
            timeout=10,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or f"git {' '.join(args)} failed")
        return result.stdout

    def _discover_changed_files(
        self, base: Optional[str], repository_root: Path
    ) -> tuple[list[str], str]:
        """Discover changed files via git.

        Mirrors select_agents.py's discover_changed_files exactly: with a
        base ref, a diff against it; without one, the dirty working tree
        (not "no files") via `git status`. Git failures propagate as a
        RuntimeError rather than degrading to an empty/incomplete plan —
        the caller (execute()) already catches this and reports it as an
        adapter failure, which DispatchEngine then falls back to the CLI
        adapter for, rather than silently returning a plan built on an
        incomplete change set.
        """
        if base:
            files = [
                line
                for line in self._run_git(
                    ["diff", "--name-only", f"{base}...HEAD"], repository_root
                ).splitlines()
                if line
            ]
            return [f.replace("\\", "/") for f in files], f"git-diff:{base}...HEAD"

        # -z gives NUL-separated, never-quoted paths; git's default --short
        # quotes paths containing non-ASCII/special characters
        # (core.quotePath), which plain line[3:] parsing would leave
        # mangled. Renamed/copied entries add one extra NUL-separated
        # original-path field we don't need and must skip.
        raw = self._run_git(
            ["status", "--short", "-z", "--untracked-files=all"], repository_root
        )
        fields = raw.split("\0")
        files = []
        index = 0
        while index < len(fields):
            entry = fields[index]
            index += 1
            if not entry:
                continue
            status, path = entry[:2], entry[3:]
            files.append(path.replace("\\", "/"))
            if "R" in status or "C" in status:
                index += 1
        return files, "git-status"

    def _resolve_knowledge_source(self, repository_root: Path) -> str:
        """Resolve a knowledge-store source identifier."""
        import hashlib as _hashlib  # noqa: F811
        import re as _re  # noqa: F811

        slug = self._origin_slug(repository_root)
        if slug:
            return slug
        digest = _hashlib.sha256(
            str(repository_root.resolve()).encode("utf-8")
        ).hexdigest()[:12]
        basename = (
            _re.sub(r"[^a-z0-9._-]+", "-", repository_root.name.lower()).strip("-")
            or "repository"
        )
        return f"local-{basename}-{digest}"

    def _origin_slug(self, repository_root: Path) -> str | None:
        """Extract owner/repo slug from git remote origin."""
        import re as _re  # noqa: F811
        from urllib.parse import urlparse as _urlparse  # noqa: F811

        env = dict(os.environ)
        env["GIT_CONFIG_NOSYSTEM"] = "1"
        env["GIT_TERMINAL_PROMPT"] = "0"

        try:
            result = subprocess.run(
                ["git", "-c", "core.fsmonitor=false", "remote", "get-url", "origin"],
                cwd=str(repository_root),
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=5,
            )
            if result.returncode != 0:
                return None
            origin = result.stdout.strip()
            if not origin:
                return None
            path = _urlparse(origin).path if "://" in origin else origin.split(":", 1)[-1]
            parts = [part for part in path.strip("/").split("/") if part]
            if len(parts) < 2:
                return None
            owner, repository = parts[-2], _re.sub(
                r"\.git$", "", parts[-1], flags=_re.IGNORECASE
            )
            if not owner or not repository:
                return None
            slug = f"{owner}/{repository}".lower()
            return slug if _re.fullmatch(r"[a-z0-9._-]+/[a-z0-9._-]+", slug) else None
        except (subprocess.TimeoutExpired, OSError):
            return None


# ---------------------------------------------------------------------------
# Fallback adapter: invokes the existing CLI via subprocess
# ---------------------------------------------------------------------------


class FallbackDispatchAdapter(DispatchAdapter):
    """Dispatch by invoking the existing `cadre select` CLI.

    Used when the native import path is unavailable (e.g., in a constrained
    environment where the orchestration modules can't be imported). This
    adapter spawns a subprocess and parses the JSON output.
    """

    name = "fallback_cli"

    def is_available(self) -> bool:
        cadre_bin = self._resolve_cadre_bin()
        return cadre_bin is not None

    def _resolve_cadre_bin(self) -> str | None:
        """Find the cadre CLI binary."""
        # Check if we're running from within the plugin root
        cadre_script = PLUGIN_ROOT / "bin" / "cadre"
        if cadre_script.is_file() and os.access(str(cadre_script), os.X_OK):
            return str(cadre_script)
        # Try PATH
        found = shutil.which("cadre")
        if found:
            return found
        return None

    def execute(self, request: DispatchRequest) -> DispatchResponse:
        cadre_bin = self._resolve_cadre_bin()
        if not cadre_bin:
            return DispatchResponse(
                success=False,
                error="cadre CLI not found; set CADRE_BIN or install cadre",
                error_code="CADRE_NOT_FOUND",
                method="fallback_cli",
            )

        try:
            args = [cadre_bin, "select", "--task", request.task]

            if request.root:
                args.extend(["--root", request.root])

            if request.files:
                for f in request.files:
                    args.extend(["--files", f])

            if request.base:
                args.extend(["--base", request.base])

            if request.task_id:
                args.extend(["--task-id", request.task_id])

            if request.classification:
                args.extend(["--classification", request.classification])

            if request.require_sdlc:
                args.append("--require-sdlc")

            result = subprocess.run(
                args,
                cwd=str(PLUGIN_ROOT),
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=30,
            )

            if result.returncode != 0:
                return DispatchResponse(
                    success=False,
                    error=result.stderr.strip() or "cadre select failed",
                    error_code="CLI_ERROR",
                    method="fallback_cli",
                )

            try:
                plan = json.loads(result.stdout)
            except json.JSONDecodeError as error:
                return DispatchResponse(
                    success=False,
                    error=f"cadre select returned invalid JSON: {error}",
                    error_code="INVALID_JSON",
                    method="fallback_cli",
                )

            return DispatchResponse(
                success=True,
                plan=plan,
                method="fallback_cli",
            )
        except subprocess.TimeoutExpired:
            return DispatchResponse(
                success=False,
                error="cadre select timed out after 30 seconds",
                error_code="TIMEOUT",
                method="fallback_cli",
            )
        except OSError as error:
            return DispatchResponse(
                success=False,
                error=f"Failed to execute cadre CLI: {error}",
                error_code="OS_ERROR",
                method="fallback_cli",
            )


# ---------------------------------------------------------------------------
# Engine: orchestrates adapter selection and dispatch execution
# ---------------------------------------------------------------------------


class DispatchEngine:
    """High-level dispatch engine that tries adapters in priority order.

    Priority: native import > fallback CLI > error
    """

    def __init__(
        self,
        native_adapter: DispatchAdapter | None = None,
        fallback_adapter: DispatchAdapter | None = None,
    ) -> None:
        self._native = native_adapter or NativeDispatchAdapter()
        self._fallback = fallback_adapter or FallbackDispatchAdapter()

    def dispatch(self, request: DispatchRequest) -> DispatchResponse:
        """Execute dispatch, trying adapters in priority order."""
        # Try native first
        if self._native.is_available():
            logger.debug("Trying native dispatch adapter")
            response = self._native.execute(request)
            if response.success:
                return response
            logger.debug("Native adapter failed: %s", response.error)

        # Fall back to CLI
        if self._fallback.is_available():
            logger.debug("Falling back to CLI dispatch adapter")
            return self._fallback.execute(request)

        # Both failed
        return DispatchResponse(
            success=False,
            error="All dispatch adapters failed; no fallback available",
            error_code="NO_ADAPTER_AVAILABLE",
            method="error",
        )

    def build_graph_for_task(self, request: DispatchRequest) -> dict[str, Any]:
        """Build a LangGraph-style dispatch graph for the given task.

        This is the primary public API that the bridge module calls. It
        returns a structured dictionary suitable for consumption by a
        LangGraph runtime or for inspection by callers.
        """
        response = self.dispatch(request)
        if not response.success:
            return {
                "status": "error",
                "error_code": response.error_code,
                "error": response.error,
                "method": response.method,
                "generated_at": response.generated_at,
            }

        plan = response.plan or {}

        # Transform the dispatch plan into a LangGraph-style graph representation
        graph = self._plan_to_graph(plan, request)
        graph["status"] = "ready" if plan.get("agents", {}).get("primary") else "needs-triage"
        graph["method"] = response.method
        return graph

    def _plan_to_graph(
        self, plan: dict[str, Any], request: DispatchRequest
    ) -> dict[str, Any]:
        """Transform a dispatch plan into a LangGraph-style graph representation."""
        agents = plan.get("agents", {})
        teams = plan.get("teams", [])
        routes = plan.get("matched_routes", [])
        risks = plan.get("matched_risks", [])

        # Build the node list (each agent is a node)
        nodes: list[dict[str, Any]] = []

        # Primary agents
        for agent_id in agents.get("primary", []):
            nodes.append({
                "id": f"agent:{agent_id}",
                "type": "primary",
                "agent_id": agent_id,
                "role": "primary",
            })

        # Reviewer agents
        for agent_id in agents.get("reviewers", []):
            nodes.append({
                "id": f"agent:{agent_id}",
                "type": "reviewer",
                "agent_id": agent_id,
                "role": "reviewer",
            })

        # Support agents
        for agent_id in agents.get("support", []):
            nodes.append({
                "id": f"agent:{agent_id}",
                "type": "support",
                "agent_id": agent_id,
                "role": "support",
            })

        # Build edges (simplified: primary -> reviewers -> support)
        edges: list[dict[str, str]] = []
        primary_ids = agents.get("primary", [])
        reviewer_ids = agents.get("reviewers", [])
        support_ids = agents.get("support", [])

        # Primary to reviewers
        for p in primary_ids:
            for r in reviewer_ids:
                edges.append({"source": f"agent:{p}", "target": f"agent:{r}"})

        # Reviewers to support
        for r in reviewer_ids:
            for s in support_ids:
                edges.append({"source": f"agent:{r}", "target": f"agent:{s}"})

        # Build quality gates
        quality_gates = plan.get("required_quality_gates", [])
        human_gates = plan.get("human_gates", [])

        return {
            "schema_version": 3,
            "task_id": plan.get("task_id"),
            "task": request.task,
            "workflow": plan.get("workflow", "unclassified"),
            "nodes": nodes,
            "edges": edges,
            "teams": teams,
            "matched_routes": routes,
            "matched_risks": risks,
            "quality_gates": quality_gates,
            "human_gates": human_gates,
            "dispatch_disposition": plan.get("dispatch_disposition", {}),
            "lifecycle_tracking": plan.get("lifecycle_tracking", {}),
            "knowledge_context": plan.get("knowledge_context", {}),
            "dispatch_fingerprint": plan.get("dispatch_fingerprint"),
        }


# ---------------------------------------------------------------------------
# Public API functions
# ---------------------------------------------------------------------------

# Module-level engine singleton
_engine: DispatchEngine | None = None


def _get_engine() -> DispatchEngine:
    global _engine
    if _engine is None:
        _engine = DispatchEngine()
    return _engine


def build_graph_for_task(
    task: str,
    files: list[str] | None = None,
    base: str | None = None,
    task_id: str | None = None,
    classification: str | None = None,
    require_sdlc: bool = False,
) -> dict[str, Any]:
    """Build a LangGraph-style dispatch graph for the given task.

    This is the primary public API. It accepts the same inputs as the CLI
    and returns a structured dispatch graph suitable for LangGraph consumption.

    Args:
        task: Task objective used for routing (required).
        files: Changed paths to scope the plan to (optional).
        base: Git base ref for diff-based file discovery (optional).
        task_id: Stable caller-supplied task identifier (optional).
        classification: Authorized knowledge classification (optional).
        require_sdlc: Fail instead of degrading if Agentic SDLC isn't available.

    Returns:
        A dictionary representing the dispatch graph, or an error dict if
        dispatch fails.

    Raises:
        ValueError: If the task is empty or inputs are invalid.
    """
    request = DispatchRequest(
        task=task,
        files=files or [],
        base=base,
        task_id=task_id,
        classification=classification,
        require_sdlc=require_sdlc,
    )

    errors = request.validate()
    if errors:
        return {
            "status": "error",
            "error_code": "VALIDATION_ERROR",
            "error": "; ".join(errors),
            "method": "error",
        }

    engine = _get_engine()
    return engine.build_graph_for_task(request)


def execute_dispatch(
    task: str,
    files: list[str] | None = None,
    base: str | None = None,
    task_id: str | None = None,
    classification: str | None = None,
    require_sdlc: bool = False,
) -> dict[str, Any]:
    """Execute dispatch and return the raw plan (alias for build_graph_for_task).

    Kept for backward compatibility; prefer build_graph_for_task() for new code.
    """
    return build_graph_for_task(
        task=task,
        files=files,
        base=base,
        task_id=task_id,
        classification=classification,
        require_sdlc=require_sdlc,
    )
