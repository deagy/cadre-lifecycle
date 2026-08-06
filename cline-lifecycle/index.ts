import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { type AgentPlugin, createTool } from "@cline/sdk";
import { safeJsonStringify } from "@cline/shared";

const execFileAsync = promisify(execFile);

// Same resolution convention as cline/index.ts's CADRE_BIN: relative to this
// plugin module's own location (this plugin sits at cline-lifecycle/, a
// sibling of cline/ and cline-agents/, all at this repository's root), never
// relative to the target workspace.
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const CADRE_BIN = path.resolve(PLUGIN_DIR, "..", "bin", "cadre");

// ---------------------------------------------------------------------------
// About this plugin
// ---------------------------------------------------------------------------
//
// `bin/cadre sdlc` is a thin pass-through to the separately-installed
// `agentic-sdlc` kernel binary (see CLAUDE.md's "Architecture Notes" --
// gate state and transitions live entirely in that external kernel; this
// repository's role selection never executes gates itself). The
// `cadre-lifecycle-core`/`-github`/`-gitlab` plugins already expose G1-G10
// lifecycle governance on Claude Code / Codex, but only as conversational
// skills (lifecycle-onboarding, lifecycle-review, brief-pending-gates) --
// skills are a Claude Code / Codex mechanism with no Cline equivalent (see
// skills/run-agent-orchestration/references/runner-adapters.md's "## Cline"
// section), so none of that is reachable from Cline today. This plugin
// closes that gap the same way `cline/` and `cline-agents/` already do for
// role selection/dispatch: deterministic tool calls wrapping the exact
// `bin/cadre sdlc <subcommand>` invocations those skills already document
// (see plugins/lifecycle/skills/{lifecycle-onboarding,lifecycle-review,
// brief-pending-gates}/SKILL.md), turning a conversational flow into 4
// direct tool calls: sdlc_init, sdlc_validate, sdlc_status, sdlc_decide.
//
// This plugin does no interpretation of its own beyond argument-building and
// JSON pass-through -- in particular sdlc_decide never adds its own
// preparer/verifier separation logic, because the kernel already refuses a
// decision from the same identity as the gate's preparer/verifier
// structurally (see CLAUDE.md's "Human approval invariant"); this tool only
// relays whatever the kernel decides, success or refusal.
//
// The 4 tools above are forge-agnostic. `cadre-lifecycle-gitlab` additionally
// bundles 8 GitLab-specific skills (lifecycle-review-gitlab,
// link-source-issue-gitlab, etc. -- see plugins/lifecycle-gitlab/skills/) for
// Claude Code / Codex, driving GitLab-specific kernel subcommands the 4 tools
// above have no access to. This plugin closes that same gap for the 4
// subcommands that actually touch GitLab (`approve-from-gitlab`,
// `approve-from-gitlab-mr`, `link-intent-from-gitlab-issue`,
// `link-requirements-from-gitlab-issue`) with 4 more tool calls below,
// following the exact same convention: deterministic argument-building and
// JSON pass-through, no approval or linking logic of this plugin's own. The
// remaining GitLab-lifecycle skills (gitlab-gate-tracking,
// publish-gate-status-gitlab, report-gate-reviewers-gitlab,
// brief-pending-gates-gitlab) are read-only/advisory or issue-publishing
// conveniences layered on top of gate state this plugin's existing
// sdlc_status already exposes, not additional kernel subcommands -- they are
// not mirrored here.

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const RootInput = z.string().min(1).describe("Target project root. Defaults to the workspace root.");

const SdlcInitInput = z
  .object({
    root: RootInput.optional(),
    profile: z.string().min(1).describe("Resolved Agentic SDLC profile name (required)."),
    projectId: z.string().min(1).describe("Project identifier slug (required)."),
    classification: z.string().min(1).describe("Resolved data classification (required)."),
    runner: z
      .enum(["claude", "codex", "both"])
      .optional()
      .describe(
        "Write generated Claude Code / Codex subagent wrapper files into the target project. Omit " +
          "for a project that is itself the source of those wrappers rather than a consumer of them.",
      ),
    dryRun: z
      .boolean()
      .optional()
      .describe("Preview what init would create/change without writing anything. Recommended first call."),
  })
  .strict();

const SdlcValidateInput = z.object({ root: RootInput.optional() }).strict();

const SdlcStatusInput = z
  .object({
    root: RootInput.optional(),
    taskId: z.string().min(1).describe("Task ID whose lifecycle gate status to report (required)."),
  })
  .strict();

const SdlcDecideInput = z
  .object({
    root: RootInput.optional(),
    taskId: z.string().min(1).describe("Task ID the decision applies to (required)."),
    gate: z.string().min(1).describe("Gate ID, e.g. G1 (required)."),
    role: z.string().min(1).describe("Authority role deciding this gate (required)."),
    decision: z.string().min(1).describe("Decision verb the kernel accepts for this gate (required)."),
    actorId: z.string().min(1).describe("Identity of the human recording this decision (required)."),
    evidenceUri: z
      .string()
      .min(1)
      .describe("Evidence URI backing this decision, e.g. a PR/issue/doc reference (required)."),
    note: z.string().min(1).optional().describe("Optional rationale note."),
    decidedAt: z.string().min(1).optional().describe("Optional RFC3339 timestamp; defaults to kernel's own clock."),
  })
  .strict();

const SdlcApproveFromGitlabInput = z
  .object({
    root: RootInput.optional(),
    taskId: z.string().min(1).describe("Task ID the approval applies to (required)."),
    gate: z.string().min(1).describe("Gate ID, e.g. G1 (required)."),
    role: z.string().min(1).describe("Authority role recording the approval (required)."),
    projectPath: z.string().min(1).describe("GitLab project path, namespace/project (required)."),
    mrIid: z.number().int().positive().describe("Merge request internal ID, iid (required)."),
    approvalId: z.string().min(1).describe("GitLab approval identifier (required)."),
    approverUsername: z.string().min(1).describe("GitLab username that authored the approval (required)."),
    commitSha: z.string().min(1).describe("Commit SHA reviewed by the GitLab approval (required)."),
    decidedAt: z.string().min(1).optional().describe("Optional RFC3339 approval time; defaults to now."),
  })
  .strict();

const SdlcApproveFromGitlabMrInput = z
  .object({
    root: RootInput.optional(),
    taskId: z.string().min(1).describe("Task ID the approval applies to (required)."),
    gate: z.string().min(1).describe("Gate ID, e.g. G1 (required)."),
    role: z.string().min(1).describe("Authority role recording the approval (required)."),
    projectPath: z.string().min(1).describe("GitLab project path, namespace/project (required)."),
    mrIid: z.number().int().positive().describe("Merge request internal ID, iid (required)."),
    approverUsername: z
      .string()
      .min(1)
      .optional()
      .describe("GitLab username to match; defaults to the authority's GitLab binding."),
    commitSha: z
      .string()
      .min(1)
      .optional()
      .describe("Optional commit SHA to require when selecting an approved approval."),
  })
  .strict();

const GitlabIssueLinkInput = z
  .object({
    root: RootInput.optional(),
    taskId: z.string().min(1).describe("Task ID the link applies to (required)."),
    role: z.string().min(1).describe("Authority role recording the link (required)."),
    projectPath: z.string().min(1).describe("GitLab project path, namespace/project (required)."),
    issueIid: z.number().int().positive().describe("Issue internal ID, iid (required)."),
  })
  .strict();

type SdlcInitInputShape = z.infer<typeof SdlcInitInput>;
type SdlcValidateInputShape = z.infer<typeof SdlcValidateInput>;
type SdlcStatusInputShape = z.infer<typeof SdlcStatusInput>;
type SdlcDecideInputShape = z.infer<typeof SdlcDecideInput>;
type SdlcApproveFromGitlabInputShape = z.infer<typeof SdlcApproveFromGitlabInput>;
type SdlcApproveFromGitlabMrInputShape = z.infer<typeof SdlcApproveFromGitlabMrInput>;
type GitlabIssueLinkInputShape = z.infer<typeof GitlabIssueLinkInput>;

interface SdlcToolError {
  error: string;
  stderr?: string;
}

// ---------------------------------------------------------------------------
// CLI argument builders
// ---------------------------------------------------------------------------

function buildInitArgs(input: SdlcInitInputShape, rootPath: string): string[] {
  const args = [
    "sdlc",
    "init",
    "--root",
    input.root ?? rootPath,
    "--profile",
    input.profile,
    "--project-id",
    input.projectId,
    "--classification",
    input.classification,
  ];
  if (input.runner) args.push("--runner", input.runner);
  if (input.dryRun) args.push("--dry-run");
  return args;
}

function buildValidateArgs(input: SdlcValidateInputShape, rootPath: string): string[] {
  return ["sdlc", "validate", "--root", input.root ?? rootPath];
}

function buildStatusArgs(input: SdlcStatusInputShape, rootPath: string): string[] {
  return ["sdlc", "status", "--root", input.root ?? rootPath, "--task-id", input.taskId];
}

function buildDecideArgs(input: SdlcDecideInputShape, rootPath: string): string[] {
  const args = [
    "sdlc",
    "decide",
    "--root",
    input.root ?? rootPath,
    "--task-id",
    input.taskId,
    "--gate",
    input.gate,
    "--role",
    input.role,
    "--decision",
    input.decision,
    "--actor-id",
    input.actorId,
    "--evidence-uri",
    input.evidenceUri,
  ];
  if (input.note) args.push("--note", input.note);
  if (input.decidedAt) args.push("--decided-at", input.decidedAt);
  return args;
}

function buildApproveFromGitlabArgs(input: SdlcApproveFromGitlabInputShape, rootPath: string): string[] {
  const args = [
    "sdlc",
    "approve-from-gitlab",
    "--root",
    input.root ?? rootPath,
    "--task-id",
    input.taskId,
    "--gate",
    input.gate,
    "--role",
    input.role,
    "--project-path",
    input.projectPath,
    "--mr-iid",
    String(input.mrIid),
    "--approval-id",
    input.approvalId,
    "--approver-username",
    input.approverUsername,
    "--commit-sha",
    input.commitSha,
  ];
  if (input.decidedAt) args.push("--decided-at", input.decidedAt);
  return args;
}

function buildApproveFromGitlabMrArgs(input: SdlcApproveFromGitlabMrInputShape, rootPath: string): string[] {
  const args = [
    "sdlc",
    "approve-from-gitlab-mr",
    "--root",
    input.root ?? rootPath,
    "--task-id",
    input.taskId,
    "--gate",
    input.gate,
    "--role",
    input.role,
    "--project-path",
    input.projectPath,
    "--mr-iid",
    String(input.mrIid),
  ];
  if (input.approverUsername) args.push("--approver-username", input.approverUsername);
  if (input.commitSha) args.push("--commit-sha", input.commitSha);
  return args;
}

function buildLinkIntentFromGitlabIssueArgs(input: GitlabIssueLinkInputShape, rootPath: string): string[] {
  return [
    "sdlc",
    "link-intent-from-gitlab-issue",
    "--root",
    input.root ?? rootPath,
    "--task-id",
    input.taskId,
    "--role",
    input.role,
    "--project-path",
    input.projectPath,
    "--issue-iid",
    String(input.issueIid),
  ];
}

function buildLinkRequirementsFromGitlabIssueArgs(input: GitlabIssueLinkInputShape, rootPath: string): string[] {
  return [
    "sdlc",
    "link-requirements-from-gitlab-issue",
    "--root",
    input.root ?? rootPath,
    "--task-id",
    input.taskId,
    "--role",
    input.role,
    "--project-path",
    input.projectPath,
    "--issue-iid",
    String(input.issueIid),
  ];
}

// ---------------------------------------------------------------------------
// Sanitization (same convention as cline/index.ts's sanitizeToolResult)
// ---------------------------------------------------------------------------

function sanitizeToolResult(input: unknown): Record<string, unknown> | SdlcToolError {
  try {
    return JSON.parse(safeJsonStringify(input)) as Record<string, unknown>;
  } catch {
    return { error: "sdlc tool call failed: result could not be serialized" };
  }
}

async function runCadreSdlc(args: string[], rootPath: string): Promise<Record<string, unknown> | SdlcToolError> {
  try {
    const { stdout } = await execFileAsync(CADRE_BIN, args, { cwd: rootPath });
    return sanitizeToolResult(JSON.parse(stdout));
  } catch (caught) {
    const err = caught as { message?: string; stderr?: string; stdout?: string };
    return sanitizeToolResult({
      error: [err.stderr?.trim(), err.message].filter(Boolean).join("\n") || "sdlc tool call failed",
      stderr: err.stderr,
    }) as SdlcToolError;
  }
}

// ---------------------------------------------------------------------------
// Setup and tool registration
// ---------------------------------------------------------------------------

type SetupFn = NonNullable<AgentPlugin["setup"]>;
export type SetupApi = Parameters<SetupFn>[0];
export type SetupContext = Parameters<SetupFn>[1];
export type {
  SdlcInitInputShape,
  SdlcValidateInputShape,
  SdlcStatusInputShape,
  SdlcDecideInputShape,
  SdlcApproveFromGitlabInputShape,
  SdlcApproveFromGitlabMrInputShape,
  GitlabIssueLinkInputShape,
  SdlcToolError,
};

const setup = (api: SetupApi, ctx: SetupContext) => {
  const rootPath = ctx.workspaceInfo?.rootPath;

  function requireRootPath(explicitRoot: string | undefined): string {
    const resolved = explicitRoot ?? rootPath;
    if (!resolved) {
      throw new Error(
        "Could not resolve a project root: no `root` argument was given and the host session has no " +
          "known workspace root.",
      );
    }
    return resolved;
  }

  api.registerTool(
    createTool({
      name: "sdlc_init",
      description:
        "Initialize Agentic SDLC G1-G10 lifecycle tracking for a project, via `bin/cadre sdlc init` -- " +
        "the same command plugins/lifecycle/skills/lifecycle-onboarding/SKILL.md's Step 3 documents for " +
        "Claude Code / Codex. Requires `agentic-sdlc` to already be installed and resolvable (see this " +
        "repository's bootstrap_sdlc.py; not run by this tool). Pass dryRun: true first and inspect the " +
        "result before writing for real.",
      inputSchema: z.toJSONSchema(SdlcInitInput),
      execute: async (rawInput: unknown): Promise<Record<string, unknown> | SdlcToolError> => {
        const input = SdlcInitInput.parse(rawInput);
        const root = requireRootPath(input.root);
        return runCadreSdlc(buildInitArgs(input, root), root);
      },
    }),
  );

  api.registerTool(
    createTool({
      name: "sdlc_validate",
      description:
        "Validate a project's Agentic SDLC configuration and run-record state, via `bin/cadre sdlc " +
        "validate` -- the same command lifecycle-onboarding's Step 9 documents. Returns errors/blockers " +
        "as JSON; this tool does not translate them into human-facing prose, the caller does.",
      inputSchema: z.toJSONSchema(SdlcValidateInput),
      execute: async (rawInput: unknown): Promise<Record<string, unknown> | SdlcToolError> => {
        const input = SdlcValidateInput.parse(rawInput);
        const root = requireRootPath(input.root);
        return runCadreSdlc(buildValidateArgs(input, root), root);
      },
    }),
  );

  api.registerTool(
    createTool({
      name: "sdlc_status",
      description:
        "Report a task's pending/decided Agentic SDLC lifecycle gates, via `bin/cadre sdlc status` -- " +
        "the same command lifecycle-review's Step 2 and brief-pending-gates document. Read-only: never " +
        "decides or invalidates a gate.",
      inputSchema: z.toJSONSchema(SdlcStatusInput),
      execute: async (rawInput: unknown): Promise<Record<string, unknown> | SdlcToolError> => {
        const input = SdlcStatusInput.parse(rawInput);
        const root = requireRootPath(input.root);
        return runCadreSdlc(buildStatusArgs(input, root), root);
      },
    }),
  );

  api.registerTool(
    createTool({
      name: "sdlc_decide",
      description:
        "Record a lifecycle gate decision, via `bin/cadre sdlc decide` -- the same command " +
        "lifecycle-review's Step 5 documents. This tool adds no approval logic of its own: the " +
        "`agentic-sdlc` kernel itself structurally refuses a decision from the same identity as the " +
        "gate's preparer/verifier (this repository's human-approval invariant), and this tool only " +
        "relays that outcome, success or refusal, as JSON. Never call this on behalf of a human who " +
        "has not actually made the decision being recorded.",
      inputSchema: z.toJSONSchema(SdlcDecideInput),
      execute: async (rawInput: unknown): Promise<Record<string, unknown> | SdlcToolError> => {
        const input = SdlcDecideInput.parse(rawInput);
        const root = requireRootPath(input.root);
        return runCadreSdlc(buildDecideArgs(input, root), root);
      },
    }),
  );

  api.registerTool(
    createTool({
      name: "sdlc_approve_from_gitlab",
      description:
        "Record a human gate approval from prepared GitLab MR-approval evidence, via `bin/cadre sdlc " +
        "approve-from-gitlab` -- the same command lifecycle-review-gitlab's Step 4a documents for " +
        "Claude Code / Codex, for when the human already reported the approval details rather than " +
        "having this tool fetch them live from the MR (use sdlc_approve_from_gitlab_mr for that). This " +
        "tool adds no approval logic of its own: the kernel structurally refuses a decision from the " +
        "same identity as the gate's preparer/verifier. Never call this on behalf of a human who has " +
        "not actually recorded the GitLab approval being cited.",
      inputSchema: z.toJSONSchema(SdlcApproveFromGitlabInput),
      execute: async (rawInput: unknown): Promise<Record<string, unknown> | SdlcToolError> => {
        const input = SdlcApproveFromGitlabInput.parse(rawInput);
        const root = requireRootPath(input.root);
        return runCadreSdlc(buildApproveFromGitlabArgs(input, root), root);
      },
    }),
  );

  api.registerTool(
    createTool({
      name: "sdlc_approve_from_gitlab_mr",
      description:
        "Record a human gate approval by fetching and verifying an actual approved GitLab MR approval " +
        "live, via `bin/cadre sdlc approve-from-gitlab-mr` -- the same command lifecycle-review-gitlab's " +
        "Step 4b documents for Claude Code / Codex. Fails closed if no matching approved approval is " +
        "found on the merge request. This tool adds no approval logic of its own: the kernel " +
        "structurally refuses a decision from the same identity as the gate's preparer/verifier.",
      inputSchema: z.toJSONSchema(SdlcApproveFromGitlabMrInput),
      execute: async (rawInput: unknown): Promise<Record<string, unknown> | SdlcToolError> => {
        const input = SdlcApproveFromGitlabMrInput.parse(rawInput);
        const root = requireRootPath(input.root);
        return runCadreSdlc(buildApproveFromGitlabMrArgs(input, root), root);
      },
    }),
  );

  api.registerTool(
    createTool({
      name: "sdlc_link_intent_from_gitlab_issue",
      description:
        "Record a real GitLab issue as the recorded source for a task's G1 (Intent) gate, via " +
        "`bin/cadre sdlc link-intent-from-gitlab-issue` -- the same command link-source-issue-gitlab's " +
        "Step 4 documents for Claude Code / Codex. Only ever applies to G1: records a source, not an " +
        "approval -- for a GitLab MR approval use sdlc_approve_from_gitlab/sdlc_approve_from_gitlab_mr.",
      inputSchema: z.toJSONSchema(GitlabIssueLinkInput),
      execute: async (rawInput: unknown): Promise<Record<string, unknown> | SdlcToolError> => {
        const input = GitlabIssueLinkInput.parse(rawInput);
        const root = requireRootPath(input.root);
        return runCadreSdlc(buildLinkIntentFromGitlabIssueArgs(input, root), root);
      },
    }),
  );

  api.registerTool(
    createTool({
      name: "sdlc_link_requirements_from_gitlab_issue",
      description:
        "Record a real GitLab issue as the recorded source for a task's G2 (Requirements Baseline) " +
        "gate, via `bin/cadre sdlc link-requirements-from-gitlab-issue` -- the same command " +
        "link-source-issue-gitlab's Step 4 documents for Claude Code / Codex. Only ever applies to G2: " +
        "records a source, not an approval -- for a GitLab MR approval use " +
        "sdlc_approve_from_gitlab/sdlc_approve_from_gitlab_mr.",
      inputSchema: z.toJSONSchema(GitlabIssueLinkInput),
      execute: async (rawInput: unknown): Promise<Record<string, unknown> | SdlcToolError> => {
        const input = GitlabIssueLinkInput.parse(rawInput);
        const root = requireRootPath(input.root);
        return runCadreSdlc(buildLinkRequirementsFromGitlabIssueArgs(input, root), root);
      },
    }),
  );
};

const plugin: AgentPlugin = {
  name: "cadre-lifecycle",
  manifest: { capabilities: ["tools"] },
  setup,
};

export { plugin };
export default plugin;
