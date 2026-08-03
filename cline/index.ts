import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { z } from "zod";
import { type AgentPlugin, createTool } from "@cline/sdk";
import { safeJsonStringify } from "@cline/shared";

const execFileAsync = promisify(execFile);

// Resolved from this module's own location, not the target workspace: the
// `cadre` CLI lives at <this repository's root>/bin/cadre regardless of which
// project's rootPath the tool is invoked against. Resolving it relative to
// rootPath instead (as a bare "./bin/cadre" with `cwd: rootPath`) only works
// when rootPath happens to be this repository itself, and fails closed with
// ENOENT in every other consumer project.
//
// One level up, not two: this plugin sits at cline/ in the plugin repository,
// whose root *is* the packaged Cadre plugin, so bin/cadre is its sibling. (It
// was two levels before the split, when this lived at plugins/cline/ in the
// register repository and reached that repository's own source CLI.) The
// packaged wrapper exposes `select` and resolves its suite/ runtime relative
// to itself, so this needs no source checkout.
const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
const CADRE_BIN = path.resolve(PLUGIN_DIR, "..", "bin", "cadre");

// The LangGraph engine is vendored in this repository at
// <repo-root>/agentic_sdlc_langgraph/, one level up from cline/ (same
// one-vs-two-level distinction as CADRE_BIN above — this plugin's root is
// the packaged repository root, not a sibling checkout). bridge.py exposes a
// JSON-over-stdin/stdout interface for the `select` subcommand. We detect its
// presence at setup time and choose the execution path accordingly.
const PYTHON_BRIDGE = path.resolve(PLUGIN_DIR, "..", "agentic_sdlc_langgraph", "bridge.py");

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const AgentsSelectInputSchema = z.object({
  task: z
    .string()
    .describe("Task objective used for deterministic routing (required)."),
  files: z
    .string()
    .optional()
    .describe("Changed path, or comma-separated paths, to scope the plan to."),
  base: z
    .string()
    .optional()
    .describe("Git base ref used with <base>...HEAD for committed changes."),
  taskId: z
    .string()
    .optional()
    .describe("Stable caller-supplied task identifier. Omit to let the selector derive one."),
  classification: z
    .string()
    .optional()
    .describe("Authorized knowledge classification for this task, if known."),
  requireSdlc: z
    .boolean()
    .optional()
    .describe("Fail instead of degrading to standalone mode if Agentic SDLC isn't available."),
});

type AgentsSelectInput = z.infer<typeof AgentsSelectInputSchema>;

interface AgentsSelectError {
  error: string;
  stderr?: string;
}

// ---------------------------------------------------------------------------
// Bridge type definitions
// ---------------------------------------------------------------------------

/**
 * Input shape passed to the Python bridge via stdin as JSON.
 * Mirrors AgentsSelectInput but uses snake_case keys to match Python conventions.
 */
interface BridgeSelectInput {
  task: string;
  files?: string;
  base?: string;
  task_id?: string;
  classification?: string;
  require_sdlc?: boolean;
  root?: string;
}

/**
 * The dispatch plan itself, as returned by `select_agents.py` and wrapped in
 * the bridge's `plan` field. Flat CLI-shaped plan object (status, agents,
 * matched_routes, task_id, inputs, ...).
 */
type DispatchPlan = Record<string, unknown>;

/**
 * Raw envelope produced by bridge.py via stdout as JSON — see bridge.py's
 * module docstring for the authoritative contract. On success the plan is
 * nested under `plan`, not returned flat; on failure there is no `plan`.
 */
interface BridgeEnvelope {
  success: boolean;
  plan?: DispatchPlan;
  error?: string;
  error_code?: string;
  method: string;
  generated_at: string;
}

// ---------------------------------------------------------------------------
// Bridge availability detection
// ---------------------------------------------------------------------------

import { existsSync } from "node:fs";

/**
 * Check whether the Python bridge module is available for native invocation.
 * Returns true if bridge.py exists at the expected location.
 */
function isBridgeAvailable(): boolean {
  return existsSync(PYTHON_BRIDGE);
}

// ---------------------------------------------------------------------------
// CLI argument builder (existing path)
// ---------------------------------------------------------------------------

function buildSelectArgs(input: AgentsSelectInput, rootPath: string): string[] {
  const args = ["select", "--root", rootPath, "--task", input.task];
  if (input.files) args.push("--files", input.files);
  if (input.base) args.push("--base", input.base);
  if (input.taskId) args.push("--task-id", input.taskId);
  if (input.classification) args.push("--classification", input.classification);
  if (input.requireSdlc) args.push("--require-sdlc");
  return args;
}

// ---------------------------------------------------------------------------
// Bridge input mapper
// ---------------------------------------------------------------------------

/**
 * Map AgentsSelectInput to the bridge's expected snake_case JSON format.
 *
 * `rootPath` is passed separately (mirroring `buildSelectArgs`'s CLI-path
 * signature): it comes from the host session's `ctx.workspaceInfo`, not
 * from `AgentsSelectInput` itself, and the bridge defaults to operating on
 * its own repository root when it's omitted — it must always be forwarded
 * explicitly so the native path targets the same workspace the CLI path
 * would.
 */
function mapToBridgeInput(input: AgentsSelectInput, rootPath: string): BridgeSelectInput {
  const bridgeInput: BridgeSelectInput = {
    task: input.task,
    root: rootPath,
  };
  if (input.files) bridgeInput.files = input.files;
  if (input.base) bridgeInput.base = input.base;
  if (input.taskId) bridgeInput.task_id = input.taskId;
  if (input.classification) bridgeInput.classification = input.classification;
  if (input.requireSdlc) bridgeInput.require_sdlc = input.requireSdlc;
  return bridgeInput;
}

// ---------------------------------------------------------------------------
// Native bridge invocation
// ---------------------------------------------------------------------------

/**
 * Invoke the Python bridge directly via child_process.execFile.
 *
 * The bridge reads JSON from stdin, processes the selection request using the
 * LangGraph engine, and writes the JSON result to stdout. This path is faster
 * and more integrated than shelling out to the CLI because it avoids the
 * overhead of spawning a new Python interpreter for argument parsing and
 * instead goes directly to the selection logic.
 *
 * @param bridgeInput - The mapped input for the bridge
 * @param rootPath - The repository root (passed to the bridge for context)
 * @returns The parsed bridge output
 * @throws BridgeInvocationError on Python errors or non-zero exit codes
 */
const BRIDGE_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB buffer for large plans
const BRIDGE_TIMEOUT_MS = 60_000;

/**
 * Run the Python bridge as a child process, writing `input` to its stdin.
 *
 * `child_process.execFile`'s `input` option only exists on the synchronous
 * (`execFileSync`) API — the asynchronous API (and its promisify()-wrapped
 * form used elsewhere in this file for the CLI path) silently ignores an
 * `input` field in its options object. Passing it there does not write
 * anything to the child's stdin, so a child that reads from stdin (as
 * bridge.py does) blocks forever and is only ever unblocked by the `timeout`
 * option's kill — every native-bridge call would silently eat the full
 * timeout on every invocation. `spawn` is used directly here instead so
 * `input` can be written to `child.stdin` explicitly.
 *
 * bridge.py's own contract (see its module docstring) uses exit code 1,
 * not just a non-zero-but-uninspected failure, to signal a *structured*
 * JSON error on stdout (`{success: false, error, error_code, ...}`) — it is
 * not an unexpected/crash exit. This resolves on any exit code so the
 * caller can parse that JSON envelope either way; only a spawn failure,
 * timeout, or buffer overflow (none of which produce a JSON envelope)
 * reject.
 */
function runPythonBridge(
  input: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("python3", [PYTHON_BRIDGE], { cwd });

    let stdout = "";
    let stderr = "";
    let overflowed = false;
    let timedOut = false;

    let killTimer: NodeJS.Timeout | undefined;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      // Escalate if the child ignores SIGTERM (e.g. blocked in an
      // uninterruptible syscall) rather than leaving it to linger forever.
      // Cleared below on 'close'/'error' if the child exits before this
      // fires — otherwise it would outlive a clean exit and could, in the
      // unlikely event the OS reuses the PID within the window, signal an
      // unrelated process.
      killTimer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    }, BRIDGE_TIMEOUT_MS);

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");

    // A write to `child.stdin` after the child has already exited (or
    // refuses the pipe) emits an 'error' event (e.g. EPIPE); with no
    // listener, Node treats that as an uncaught exception and can crash the
    // whole host process. The actual failure is still reported below via
    // the 'close' handler (the process still exits and fires 'close'
    // even after a stdin EPIPE), so this listener only needs to exist.
    child.stdin.on("error", () => {});

    child.stdout.on("data", (chunk: string) => {
      if (overflowed) return;
      stdout += chunk;
      if (stdout.length > BRIDGE_MAX_BUFFER) {
        overflowed = true;
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk: string) => {
      if (overflowed) return;
      stderr += chunk;
    });

    child.on("error", (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      reject(err);
    });

    child.on("close", () => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      if (timedOut) {
        reject(Object.assign(new Error("Bridge invocation timed out"), { stdout, stderr }));
        return;
      }
      if (overflowed) {
        reject(Object.assign(new Error("Bridge output exceeded max buffer size"), { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });

    child.stdin.write(input);
    child.stdin.end();
  });
}

async function invokeNativeBridge(
  bridgeInput: BridgeSelectInput,
  rootPath: string,
): Promise<DispatchPlan> {
  const stdinJson = JSON.stringify(bridgeInput);

  // Log the invocation for debugging
  console.error(
    `[agents_select] Invoking Python bridge: ${PYTHON_BRIDGE}`,
  );
  console.error(
    `[agents_select] Bridge input (truncated): ${stdinJson.slice(0, 200)}${stdinJson.length > 200 ? "..." : ""}`,
  );

  try {
    const { stdout, stderr } = await runPythonBridge(stdinJson, rootPath);

    // Log stderr from the bridge (warnings, etc.)
    if (stderr?.trim()) {
      console.error(`[agents_select] Bridge stderr: ${stderr.trim()}`);
    }

    // Parse the JSON envelope (see bridge.py's module docstring for the
    // contract: {success, plan} on success, {success: false, error,
    // error_code} on failure — the plan is never returned flat).
    let envelope: BridgeEnvelope;
    try {
      envelope = JSON.parse(stdout) as BridgeEnvelope;
    } catch (parseError) {
      throw new BridgeInvocationError(
        "Bridge produced invalid JSON output",
        stdout,
        stderr,
      );
    }

    if (!envelope.success || !envelope.plan) {
      throw new BridgeInvocationError(
        envelope.error || "Bridge reported failure with no error message",
        stdout,
        stderr,
        envelope.error_code,
      );
    }

    console.error(`[agents_select] Bridge invocation successful`);
    return envelope.plan;
  } catch (error) {
    if (error instanceof BridgeInvocationError) {
      throw error;
    }

    // Handle Python execution errors (ENOENT, permission denied, etc.), and
    // timeout/overflow rejections from runPythonBridge, which attach
    // whatever partial stdout/stderr had been captured.
    const err = error as { message?: string; stdout?: string; stderr?: string; code?: string };
    if (err.code === "ENOENT") {
      throw new BridgeInvocationError(
        `Python bridge not found at ${PYTHON_BRIDGE}. Ensure the agentic-sdlc LangGraph engine is installed.`,
        "",
        "",
      );
    }

    throw new BridgeInvocationError(
      err.message || "Bridge invocation failed",
      err.stdout ?? "",
      err.stderr,
    );
  }
}

/**
 * Custom error class for bridge invocation failures.
 */
class BridgeInvocationError extends Error {
  public stdout?: string;
  public stderr?: string;
  public detail?: string;

  constructor(message: string, stdout?: string, stderr?: string, detail?: string) {
    super(message);
    this.name = "BridgeInvocationError";
    this.stdout = stdout;
    this.stderr = stderr;
    this.detail = detail;
  }
}

// ---------------------------------------------------------------------------
// Sanitization
// ---------------------------------------------------------------------------

/**
 * Sanitize a tool result to ensure it is fully JSON-serializable without
 * circular references, hidden properties, or non-JSON values (functions,
 * symbols, undefined). Uses the SDK's safeJsonStringify which detects and
 * replaces cycles with "[Circular]" rather than throwing.
 */
function sanitizeToolResult(input: unknown): Record<string, unknown> | AgentsSelectError {
  try {
    return JSON.parse(safeJsonStringify(input)) as Record<string, unknown>;
  } catch {
    return { error: "agents_select failed: result could not be serialized" };
  }
}

// ---------------------------------------------------------------------------
// Setup and tool registration
// ---------------------------------------------------------------------------

type SetupFn = NonNullable<AgentPlugin["setup"]>;
export type SetupApi = Parameters<SetupFn>[0];
export type SetupContext = Parameters<SetupFn>[1];
export type { AgentsSelectInput, AgentsSelectError };

const setup = (api: SetupApi, ctx: SetupContext) => {
  const rootPath = ctx.workspaceInfo?.rootPath;

  // Detect bridge availability at setup time for logging
  const bridgeAvailable = isBridgeAvailable();
  if (bridgeAvailable) {
    console.error(`[agents_select] Python bridge detected at ${PYTHON_BRIDGE}`);
    console.error(`[agents_select] Will use native LangGraph engine invocation`);
  } else {
    console.error(`[agents_select] Python bridge not found at ${PYTHON_BRIDGE}`);
    console.error(`[agents_select] Will fall back to CLI invocation (bin/cadre select)`);
  }

  api.registerTool(
    createTool({
      name: "agents_select",
      description:
        "Get a deterministic, reviewable agent dispatch plan from this repository's Cadre catalog " +
        "(routes, primary/reviewer/support roles, quality gates). When the Agentic SDLC LangGraph " +
        "engine is available, this tool invokes it natively for faster, more integrated execution; " +
        "otherwise it falls back to the legacy CLI. Plan only: never invokes agents, retrieves " +
        "knowledge, merges, deploys, or mutates infrastructure or approvals. Requires the current " +
        "workspace to be a checkout of the deagy/cadre repository (or a project with its own " +
        "catalog.yaml). This plugin does not (and, with the Cline plugin API as currently published, " +
        "cannot) dispatch the selected role(s) itself — a Cline plugin's setup(api, ctx) only exposes " +
        "registerTool/registerCommand/etc., not the session's spawn-agent or team primitives. After " +
        "calling this tool, the orchestrating Cline session must dispatch manually: see the \"## Cline\" " +
        "section of .agents/skills/run-agent-orchestration/references/runner-adapters.md for the current " +
        "manual-injection workaround and /team limitations.",
      inputSchema: AgentsSelectInputSchema,
      execute: async (input: AgentsSelectInput): Promise<Record<string, unknown> | AgentsSelectError> => {
        if (!rootPath) {
          return {
            error:
              "Could not resolve the workspace root from the host session; agents_select requires a known " +
              "workspace root and will not fall back to the process's current directory.",
          };
        }

        try {
          // Choose execution path based on bridge availability
          if (bridgeAvailable) {
            // Native bridge path: faster, more integrated
            const bridgeInput = mapToBridgeInput(input, rootPath);
            const output = await invokeNativeBridge(bridgeInput, rootPath);
            return sanitizeToolResult(output);
          } else {
            // Fallback CLI path: backward compatible
            console.error(`[agents_select] Using CLI fallback path`);
            const { stdout } = await execFileAsync(
              CADRE_BIN,
              buildSelectArgs(input, rootPath),
              { cwd: rootPath },
            );
            return sanitizeToolResult(JSON.parse(stdout));
          }
        } catch (caught) {
          const err = caught as {
            message?: string;
            stderr?: string;
            stdout?: string;
            detail?: string;
          };

          // For BridgeInvocationError, include detail if available
          if (caught instanceof BridgeInvocationError) {
            const errorMessage = err.detail
              ? `${err.message}: ${err.detail}`
              : err.message;
            return sanitizeToolResult({
              error: errorMessage,
              stderr: err.stderr,
            }) as AgentsSelectError;
          }

          return sanitizeToolResult({
            error: [err.stderr?.trim(), err.message].filter(Boolean).join("\n") || "agents_select failed",
            stderr: err.stderr,
          }) as AgentsSelectError;
        }
      },
    }),
  );
};

const plugin: AgentPlugin = {
  name: "cadre",
  manifest: { capabilities: ["tools"] },
  setup,
};

export { plugin };
export default plugin;
