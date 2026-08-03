"""LangGraph-style dispatch engine for Cadre's agent orchestration.

This package provides a LangGraph-compatible dispatch interface that wraps
Cadre's existing deterministic routing and agent selection logic. It exposes
dispatch capabilities via a simple Python API suitable for use by the stdin/
stdout bridge module.

The engine is intentionally decoupled from the bridge: the runtime module
contains the dispatch logic, while bridge.py handles I/O serialization.
"""

from __future__ import annotations

from .runtime import (
    DispatchRequest,
    DispatchResponse,
    build_graph_for_task,
    execute_dispatch,
)

__all__ = [
    "DispatchRequest",
    "DispatchResponse",
    "build_graph_for_task",
    "execute_dispatch",
]
__version__ = "0.1.0"
