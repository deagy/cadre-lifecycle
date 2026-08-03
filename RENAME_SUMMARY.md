# Project Rename Summary

## From: `cadre-agentic-sdlc` → To: `cadre-lifecycle`

**Date**: August 3, 2026

---

## Overview

The project has been renamed from `cadre-agentic-sdlc` to `cadre-lifecycle` to better reflect its combined purpose of providing deterministic agent orchestration with governed software delivery lifecycle.

---

## Files Updated

### Package Manifests

| File | Status |
|------|--------|
| `package.json` | ✅ Updated |
| `cline/package.json` | ✅ Updated |
| `.claude-plugin/plugin.json` | ✅ Updated |
| `.claude-plugin/marketplace.json` | ✅ Updated |
| `.codex-plugin/plugin.json` | ✅ Updated |

### Documentation

| File | Status |
|------|--------|
| `README.md` | ✅ Updated |
| `CLAUDE.md` | ✅ Updated |
| `AGENTS.md` | ✅ Updated |
| `agentic_sdlc_langgraph/README.md` | ✅ Updated |
| `PHASE2_COMPLETION_SUMMARY.md` | ✅ Updated |

### Source Code

| File | Status |
|------|--------|
| `agentic_sdlc_langgraph/runtime.py` | ✅ Updated |

---

## Installation Commands (Updated)

### Cline

```sh
cline plugin install --git https://github.com/deagy/cadre-lifecycle --force
```

Or from a local checkout:

```sh
git clone https://github.com/deagy/cadre-lifecycle.git
cline plugin install /path/to/cadre-lifecycle --force
```

### Claude Code

```text
/plugin marketplace add deagy/cadre-lifecycle@v0.1.0
/plugin install cadre-lifecycle@cadre-team
```

### Codex CLI

```sh
git clone --branch v0.1.0 https://github.com/deagy/cadre-lifecycle.git
codex plugin marketplace add /path/to/cadre-lifecycle
codex plugin add cadre-lifecycle@cadre-team
```

---

## Package Names

| Ecosystem | Package Name |
|-----------|--------------|
| npm (scoped) | `@deagy/cadre-lifecycle-cline-plugin` |
| PyPI | `cadre-lifecycle` |
| GitHub | `deagy/cadre-lifecycle` |
| Cline plugin | `cadre-lifecycle@cadre-team` |

---

## Positioning Statement

> **Cadre Lifecycle**: Deterministic agent orchestration with governed software delivery. Select roles, dispatch work, and enforce G1-G10 governance gates—all in one integrated suite.

---

## Next Steps

1. **Verify name availability**:
   - GitHub: `github.com/deagy/cadre-lifecycle`
   - npm: `@deagy/cadre-lifecycle-cline-plugin`
   - PyPI: `cadre-lifecycle`
   - Cline marketplace

2. **Update external references**:
   - Documentation sites
   - Blog posts
   - Social media
   - Community announcements

3. **Monitor adoption**:
   - Track installation metrics
   - Gather user feedback
   - Monitor for naming conflicts

---

## Rationale

The name `cadre-lifecycle` was selected based on evaluation from three perspectives:

1. **Branding Specialist**: Clear, memorable, and brandable
2. **Developer Experience Advocate**: Excellent CLI usability and ecosystem fit
3. **Strategic Product Thinker**: Supports future growth and enterprise adoption

The name effectively communicates the project's dual purpose:
- **Cadre**: Deterministic agent role selection and orchestration
- **Lifecycle**: Governed software delivery with G1-G10 gates

---

## Conclusion

The project has been successfully renamed from `cadre-agentic-sdlc` to `cadre-lifecycle`. All package manifests, documentation, and source code references have been updated. The new name better reflects the project's combined purpose and provides a stronger foundation for future growth.
