# Agentic SDLC LangGraph Bridge

This package provides a LangGraph-compatible dispatch interface for Cadre's agent orchestration system, exposed via stdin/stdout for use by Node.js and other external callers.

## Overview

The `agentic_sdlc_langgraph` package wraps Cadre's existing deterministic routing and agent selection logic with a LangGraph-style dispatch interface. It provides two layers:

1. **Runtime** (`runtime.py`): Core dispatch logic with pluggable adapters (native import vs. CLI fallback)
2. **Bridge** (`bridge.py`): Stdin/stdout JSON I/O layer for external consumption

## Quick Start

### From Shell

```bash
echo '{"task": "Implement user authentication"}' | python3 bridge.py
```

### From Node.js

```javascript
const { execFileSync } = require('child_process');
const path = require('path');

const bridgePath = path.join(__dirname, 'agentic_sdlc_langgraph', 'bridge.py');
const input = JSON.stringify({
  task: 'Implement user authentication',
  classification: 'internal',
});

try {
  const result = execFileSync('python3', [bridgePath], {
    input: input,
    encoding: 'utf-8',
    timeout: 30000,
  });
  const response = JSON.parse(result);
  
  if (response.success) {
    console.log('Dispatch plan:', response.plan);
  } else {
    console.error('Dispatch failed:', response.error);
  }
} catch (error) {
  console.error('Bridge execution error:', error.message);
}
```

### From Python

```python
from agentic_sdlc_langgraph.runtime import build_graph_for_task

result = build_graph_for_task(
    task="Implement user authentication",
    classification="internal",
)

if result.get("status") == "error":
    print(f"Error: {result['error']}")
else:
    print(f"Nodes: {len(result['nodes'])}")
    print(f"Edges: {len(result['edges'])}")
    for node in result['nodes']:
        print(f"  - {node['agent_id']} ({node['role']})")
```

## Input Format (stdin)

JSON object with the following fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task` | string | Yes | Task objective used for routing |
| `files` | array/string | No | Changed paths (array) or comma-separated string |
| `base` | string | No | Git base ref for diff-based file discovery |
| `taskId` | string | No | Stable caller-supplied task identifier |
| `classification` | string | No | Authorized knowledge classification (public/internal/confidential/restricted) |
| `requireSdlc` | boolean | No | Fail instead of degrading if Agentic SDLC isn't available |

**Note:** `base` and `files` are mutually exclusive.

## Output Format (stdout)

JSON object with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `success` | boolean | Whether dispatch succeeded |
| `plan` | object | The dispatch plan (only on success) |
| `error` | string | Error message (only on failure) |
| `error_code` | string | Machine-readable error code |
| `method` | string | How dispatch was executed (`native`, `fallback_cli`, `error`) |
| `generated_at` | string | ISO 8601 timestamp |

## Exit Codes

| Code | Description |
|------|-------------|
| 0 | Success (dispatch completed) |
| 1 | Error (invalid input, dispatch failure, or internal error) |

## LangGraph-Style Graph Output

The `build_graph_for_task()` function returns a structured graph representation:

```json
{
  "schema_version": 3,
  "task_id": "local-...",
  "task": "Implement user authentication",
  "workflow": "unclassified",
  "status": "ready",
  "nodes": [
    {"id": "agent:security-reviewer", "type": "reviewer", "agent_id": "security-reviewer", "role": "reviewer"},
    {"id": "agent:product-intent-agent", "type": "support", "agent_id": "product-intent-agent", "role": "support"}
  ],
  "edges": [
    {"source": "agent:security-reviewer", "target": "agent:product-intent-agent"}
  ],
  "teams": [],
  "matched_routes": [],
  "matched_risks": [...],
  "quality_gates": [...],
  "human_gates": [...],
  "dispatch_disposition": {...},
  "lifecycle_tracking": {...},
  "knowledge_context": {...},
  "dispatch_fingerprint": "sha256:..."
}
```

## Architecture

```
agentic_sdlc_langgraph/
├── __init__.py          # Package exports
├── runtime.py           # Core dispatch logic with pluggable adapters
├── bridge.py            # Stdin/stdout JSON I/O layer
├── test_bridge.py       # Test suite
└── README.md            # This file
```

### Adapter Pattern

The runtime uses a pluggable adapter pattern:

1. **NativeDispatchAdapter**: Direct import of Cadre's orchestration modules (preferred, no subprocess overhead)
2. **FallbackDispatchAdapter**: Invokes the existing `cadre select` CLI via subprocess (fallback when native import unavailable)

The `DispatchEngine` tries adapters in priority order and falls back automatically.

## Testing

```bash
# Run all tests
python3 -m unittest agentic_sdlc_langgraph.test_bridge -v

# Run specific test class
python3 -m unittest agentic_sdlc_langgraph.test_bridge.TestParseInput -v
```

## Error Handling

The bridge handles errors at multiple levels:

1. **Input validation**: Missing required fields, invalid types, mutually exclusive fields
2. **JSON parsing**: Malformed JSON input
3. **Dispatch failure**: Both native and fallback adapters can fail
4. **Internal errors**: Unexpected exceptions are caught and returned as structured errors

All errors follow the same output format with `success: false` and descriptive `error`/`error_code` fields.

## Requirements

- Python 3.10+
- No external dependencies (uses only Python standard library)
- Cadre repository with `routing.yaml` and `catalog.yaml`
