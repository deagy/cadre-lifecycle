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

type SdlcInitInputShape = z.infer<typeof SdlcInitInput>;
type SdlcValidateInputShape = z.infer<typeof SdlcValidateInput>;
type SdlcStatusInputShape = z.infer<typeof SdlcStatusInput>;
type SdlcDecideInputShape = z.infer<typeof SdlcDecideInput>;

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
export type { SdlcInitInputShape, SdlcValidateInputShape, SdlcStatusInputShape, SdlcDecideInputShape, SdlcToolError };

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
};

const plugin: AgentPlugin = {
  name: "cadre-lifecycle",
  manifest: { capabilities: ["tools"] },
  setup,
};

export { plugin };
export default plugin;
