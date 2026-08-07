
# bin/ — Cadre Lifecycle CLI

This directory contains the CLI entry point for the Cadre Lifecycle plugin distribution.

## Entry points

| File | Purpose |
|------|---------|
| `cadre` | POSIX shell shim — dispatches lifecycle governance commands |

## Dispatch mechanism

`bin/cadre` is a shell shim that routes to the appropriate plugin's tool implementations. The installed plugin distribution includes:

- **Core**: G1-G10 lifecycle governance via the Agentic SDLC kernel
- **GitHub flavor**: GitHub PR approval evidence adapters
- **GitLab flavor**: GitLab MR approval evidence and issue linkage

### Running commands

```sh
./bin/cadre sdlc --help               # Lifecycle subcommand help
./bin/cadre sdlc init                  # Initialize a project overlay
./bin/cadre sdlc plan --task "..."     # Create a dispatch plan with gate tracking
./bin/cadre sdlc status <task-id>      # Check pending gates for a task
./bin/cadre sdlc validate              # Validate project configuration
./bin/cadre select --task "..."        # Role selection from the Cadre catalog
```

## Plugin structure

The lifecycle tools are distributed across four plugins:

| Plugin | Purpose |
|--------|---------|
| `cline/` | Claude Code lifecycle plugin (core governance) |
| `cline-agents/` | Claude Code agent role definitions |
| `cline-lifecycle/` | Claude Code lifecycle skill composition |
| `suite/` | Shared suite assets (roster, skills, docs) |

## See also

- [README.md](../README.md) — full plugin distribution documentation
- [AGENTS.md](../AGENTS.md) — repository structure and regeneration procedures
- [cline/](../cline/) — individual plugin details
