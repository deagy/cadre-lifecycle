# Plugin Usage Workflow

This example shows how to use the Cadre Lifecycle plugin distribution to adopt role selection and lifecycle governance in a project.

## Scenario

A team wants to adopt Cadre role selection and Agentic SDLC lifecycle governance in their TypeScript/React project.

## Step 1: Install Plugins

```sh
# Install only what you need (plugins are independent)
npm install -D @deagy/cadre-lifecycle-core
npm install -D @deagy/cadre-lifecycle-github   # if using GitHub
# or
npm install -D @deagy/cadre-lifecycle-gitlab   # if using GitLab
```

## Step 2: Bootstrap the Project

```sh
# Initialize the .agentic-sdlc/ overlay
cadre sdlc init --root /path/to/project --profile secure-cloud
```

This creates the project overlay with authorities, routing, and version lock.

## Step 3: Select Roles for a Task

```sh
# Use the agents_select tool call or CLI
cadre select \
  --task "Implement user profile page with React and TypeScript" \
  --files src/components/ProfilePage.tsx \
  --task-id UI-2026-001 \
  --classification internal
```

## Step 4: Plan the Task with Lifecycle Gates

```sh
cadre sdlc plan \
  --task "Implement user profile page" \
  --task-id UI-2026-001
```

This creates a run record with G1-G10 gates tracked.

## Step 5: Progress Through Gates

The lifecycle plugins provide Claude Code / Codex skills for conversational gate management:

- **`lifecycle-onboarding`**: Guide a non-engineer through setting up gates
- **`lifecycle-review`**: Guide a reviewer through approving/rejecting gates
- **`brief-pending-gates`**: Show which gates are pending for a task

## Step 6: Validate the Project

```sh
cadre sdlc validate --root /path/to/project
# Exit 0 = ready, 2 = structurally valid but blocked, 1 = error
```

## Plugin Architecture

The four plugins are independent:

| Plugin | What it provides |
|--------|------------------|
| `cadre` | Role selection from the Cadre catalog |
| `cadre-lifecycle-core` | Forge-agnostic G1-G10 governance UX |
| `cadre-lifecycle-github` | GitHub PR approval evidence adapters |
| `cadre-lifecycle-gitlab` | GitLab MR approval evidence and issue linkage |

Install only what you need. The lifecycle plugins become useful once the external `agentic-sdlc` kernel is installed.

## Regenerating Assets

When role definitions change in the canonical source (`deagy/cadre`):

1. Update `cadre-ref.txt` with the new revision
2. Run the regeneration procedure (see AGENTS.md)
3. Diff and review the generated changes
4. Commit the regenerated content

See the drift-check workflow (`.github/workflows/drift-check.yml`) for automated drift detection.

## See Also

- [README.md](../../README.md) — full plugin distribution documentation
- [AGENTS.md](../../AGENTS.md) — repository structure and regeneration procedures
- [bin/README.md](../../bin/README.md) — CLI dispatch mechanism
