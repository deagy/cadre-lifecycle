import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentTool } from "@cline/sdk";
import { plugin, runPythonBridge, type SetupApi, type SetupContext } from "./index.ts";

const execFileAsync = promisify(execFile);

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
// One level up, not two: cline/ is this plugin root's direct child, matching
// index.ts's own PLUGIN_DIR/CADRE_BIN resolution. Two levels up used to land
// on the multi-project workspace root (/home/deagy/sdk) rather than this
// repository -- harmless only because every REPO_ROOT-based test below
// happens to pass an explicit `files` argument, bypassing the git-status
// discovery path that would otherwise hit the workspace root's git state.
const REPO_ROOT = path.resolve(PLUGIN_DIR, "..");

async function registerTools(workspaceRootPath: string | undefined) {
  const tools: AgentTool[] = [];
  const api: SetupApi = {
    registerTool: (tool: AgentTool) => {
      tools.push(tool);
    },
    registerCommand: () => {},
    registerRule: () => {},
    registerMessageBuilder: () => {},
    registerProvider: () => {},
    registerAutomationEventType: () => {},
    registerMcpServer: () => {},
  };
  const ctx: SetupContext = {
    workspaceInfo: workspaceRootPath ? { rootPath: workspaceRootPath } : undefined,
  };
  await plugin.setup?.(api, ctx);
  return tools;
}

function findTool(tools: AgentTool[], name: string): AgentTool {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} was not registered`);
  return tool;
}

describe("cadre plugin", () => {
  it("declares the tools capability and registers exactly one tool: agents_select", async () => {
    expect(plugin.manifest.capabilities).toEqual(["tools"]);

    const tools = await registerTools(REPO_ROOT);
    expect(tools.map((t) => t.name)).toEqual(["agents_select"]);
    expect(tools[0].description).toMatch(/plan only/i);
    expect(tools[0].description).toMatch(/never invokes agents/i);
    // The Cline plugin API has no spawn/team primitive available to a
    // registered tool's execute() (see runner-adapters.md's "## Cline"
    // section); the description must say so rather than imply this tool
    // dispatches anything.
    expect(tools[0].description).toMatch(/cannot.*dispatch/i);
    expect(tools[0].description).toMatch(/runner-adapters\.md/);
  });

  it("agents_select returns a real dispatch plan for this repository", async () => {
    const tools = await registerTools(REPO_ROOT);
    const tool = findTool(tools, "agents_select");

    const result = (await tool.execute(
      { task: "Review README changes", files: "README.md", classification: "internal" },
      {} as never,
    )) as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    expect(result).toHaveProperty("status");
    expect(result).toHaveProperty("agents");
    expect(result).toHaveProperty("matched_routes");
  });

  it("agents_select honors an explicit taskId in the returned plan", async () => {
    const tools = await registerTools(REPO_ROOT);
    const tool = findTool(tools, "agents_select");

    const result = (await tool.execute(
      {
        task: "Review README changes",
        files: "README.md",
        classification: "internal",
        taskId: "PLUGIN-TEST-TASK-ID",
      },
      {} as never,
    )) as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    expect(result.task_id).toBe("PLUGIN-TEST-TASK-ID");
  });

  it("agents_select returns needs-triage for a scope with no matching route", async () => {
    const tools = await registerTools(REPO_ROOT);
    const tool = findTool(tools, "agents_select");

    // An explicit file with no keyword/path match in routing.yaml, and task text with
    // no routable keywords either, gives the selector nothing to route on. Pinning
    // --files (rather than omitting it) avoids the selector's own git-status fallback,
    // which would otherwise make this depend on the caller's dirty working tree.
    const result = (await tool.execute(
      { task: "xyzzy plugh", files: "no-such-extension.zzz" },
      {} as never,
    )) as Record<string, unknown>;

    expect(result.error).toBeUndefined();
    expect(result.status).toBe("needs-triage");
  });

  it("agents_select surfaces a real dispatch failure as a structured error, not a throw", async () => {
    const tools = await registerTools(REPO_ROOT);
    const tool = findTool(tools, "agents_select");

    // DispatchRequest.validate() (runtime.py) rejects --base combined with
    // --files with the same wording as the CLI's select_agents.py; since
    // bridge.py is vendored here, this exercises the native bridge's
    // exit-code-1 structured-error path end to end (BridgeInvocationError
    // in invokeNativeBridge, distinct from the JSON.parse-failure branch and
    // the missing-rootPath guard), and incidentally covers the --base flag,
    // which no other test passes. See the CLI-fallback-forced describe
    // block above for the equivalent assertion against the CLI path.
    const result = (await tool.execute(
      { task: "test", files: "README.md", base: "main" },
      {} as never,
    )) as Record<string, unknown>;

    expect(typeof result.error).toBe("string");
    expect(result.error).toMatch(/--base cannot be combined with --files/);
  });

  it("agents_select returns a structured error when the workspace root could not be resolved", async () => {
    const tools = await registerTools(undefined);
    const tool = findTool(tools, "agents_select");

    const result = (await tool.execute({ task: "anything" }, {} as never)) as Record<
      string,
      unknown
    >;

    expect(typeof result.error).toBe("string");
    expect(result.error).toMatch(/workspace root/i);
  });

  it("agents_select result is fully re-serializable (sanitizeToolResult guards against cycles)", async () => {
    const tools = await registerTools(REPO_ROOT);
    const tool = findTool(tools, "agents_select");

    const result = (await tool.execute(
      { task: "Review README changes", files: "README.md", classification: "internal" },
      {} as never,
    )) as Record<string, unknown>;

    // The sanitizeToolResult wrapper must produce a result that can be
    // round-tripped through JSON.stringify without throwing — this is the
    // contract that protects against downstream SDK hooks injecting circular
    // references (e.g., Error objects with e.error === e).
    expect(() => JSON.stringify(result)).not.toThrow();

    // And the round-trip must preserve the data.
    const reparsed = JSON.parse(JSON.stringify(result));
    expect(reparsed).toEqual(result);
  });

  describe("agents_select against a workspace root that is not this checkout", () => {
    // Regression test for the bug found investigating a Cline report of
    // non-deterministic "JSON.stringify cannot serialize cyclic structures"
    // errors: the plugin used to resolve the cadre binary as a bare
    // "./bin/cadre" spawned with `cwd: rootPath`, which only ever worked
    // when rootPath happened to be this repository itself. Any other
    // project (e.g. deagy/agentic-sdlc, which has no bin/cadre of its own)
    // deterministically failed with `spawn ./bin/cadre ENOENT`. This fixture
    // is a throwaway git repo standing in for "some other project" — it has
    // no bin/cadre, matching that failure mode exactly.
    let otherWorkspace: string;

    beforeAll(async () => {
      otherWorkspace = mkdtempSync(path.join(tmpdir(), "cadre-cline-plugin-test-"));
      await execFileAsync("git", ["init", "-q"], { cwd: otherWorkspace });
    });

    afterAll(() => {
      rmSync(otherWorkspace, { recursive: true, force: true });
    });

    it("resolves the native bridge's `root` for a workspace that is not this checkout", async () => {
      // bridge.py is vendored in this repo, so isBridgeAvailable() is true
      // here and this exercises the native path (mapToBridgeInput forwarding
      // rootPath as `root`), not the CLI-fallback path the original
      // ENOENT regression above was about — see the sibling describe block
      // below for a CLI-fallback-forced version of this same assertion.
      const tools = await registerTools(otherWorkspace);
      const tool = findTool(tools, "agents_select");

      const result = (await tool.execute(
        { task: "xyzzy plugh", files: "no-such-extension.zzz" },
        {} as never,
      )) as Record<string, unknown>;

      expect(result.error).toBeUndefined();
      expect(result.status).toBe("needs-triage");
      expect((result.inputs as Record<string, unknown>).repository_root).toBe(otherWorkspace);
    });

    describe("with the native bridge forcibly disabled (CADRE_DISABLE_NATIVE_BRIDGE=1)", () => {
      // Regression test for the bug found investigating a Cline report of
      // non-deterministic "JSON.stringify cannot serialize cyclic structures"
      // errors: the plugin used to resolve the cadre binary as a bare
      // "./bin/cadre" spawned with `cwd: rootPath`, which only ever worked
      // when rootPath happened to be this repository itself — deterministically
      // failing with `spawn ./bin/cadre ENOENT` for any other project. Since
      // bridge.py is vendored in this repo, isBridgeAvailable() is normally
      // always true here, so nothing would otherwise ever exercise CADRE_BIN
      // resolution / buildSelectArgs / the execFileAsync CLI path in this
      // suite. CADRE_DISABLE_NATIVE_BRIDGE forces that path deterministically.
      const originalFlag = process.env.CADRE_DISABLE_NATIVE_BRIDGE;

      beforeAll(() => {
        process.env.CADRE_DISABLE_NATIVE_BRIDGE = "1";
      });

      afterAll(() => {
        if (originalFlag === undefined) delete process.env.CADRE_DISABLE_NATIVE_BRIDGE;
        else process.env.CADRE_DISABLE_NATIVE_BRIDGE = originalFlag;
      });

      it("resolves the cadre binary relative to this plugin, not the target workspace", async () => {
        const tools = await registerTools(otherWorkspace);
        const tool = findTool(tools, "agents_select");

        const result = (await tool.execute(
          { task: "xyzzy plugh", files: "no-such-extension.zzz" },
          {} as never,
        )) as Record<string, unknown>;

        // Before the fix this was `{ error: "spawn ./bin/cadre ENOENT", ... }`.
        expect(result.error).toBeUndefined();
        expect(result.status).toBe("needs-triage");
        expect((result.inputs as Record<string, unknown>).repository_root).toBe(otherWorkspace);
      });
    });
  });

  describe("agents_select default invocation (no files, no base) against the native bridge", () => {
    // Regression test for the bug where NativeDispatchAdapter returned
    // ([], "none") instead of mirroring the CLI's git-status fallback for
    // the default no-args invocation shape — the single most common way
    // this tool is actually called.
    let dirtyWorkspace: string;

    beforeAll(async () => {
      dirtyWorkspace = mkdtempSync(path.join(tmpdir(), "cadre-cline-plugin-git-status-test-"));
      await execFileAsync("git", ["init", "-q"], { cwd: dirtyWorkspace });
      writeFileSync(path.join(dirtyWorkspace, "dirty.txt"), "uncommitted\n");
    });

    afterAll(() => {
      rmSync(dirtyWorkspace, { recursive: true, force: true });
    });

    it("discovers the dirty working tree via git-status, not an empty file list", async () => {
      const tools = await registerTools(dirtyWorkspace);
      const tool = findTool(tools, "agents_select");

      const result = (await tool.execute({ task: "xyzzy plugh" }, {} as never)) as Record<
        string,
        unknown
      >;

      expect(result.error).toBeUndefined();
      const inputs = result.inputs as Record<string, unknown>;
      expect(inputs.changed_file_source).toBe("git-status");
      expect(inputs.changed_files).toContain("dirty.txt");
    });
  });

  it("agents_select result is a plain object with no hidden properties", async () => {
    const tools = await registerTools(REPO_ROOT);
    const tool = findTool(tools, "agents_select");

    const result = (await tool.execute(
      { task: "Review README changes", files: "README.md", classification: "internal" },
      {} as never,
    )) as Record<string, unknown>;

    // sanitizeToolResult re-parses through JSON, which strips functions,
    // symbols, and undefined values. The result must be a plain object.
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });

  it("reports a python3-missing error, not a missing-bridge error, when PATH excludes python3", async () => {
    // Regression test: invokeNativeBridge's ENOENT handler used to blame a
    // missing bridge.py, but that branch is only reachable after
    // isBridgeAvailable() has already confirmed bridge.py exists — an
    // ENOENT from spawning it actually means python3 itself isn't on PATH.
    const originalPath = process.env.PATH;
    process.env.PATH = "";
    try {
      const tools = await registerTools(REPO_ROOT);
      const tool = findTool(tools, "agents_select");

      const result = (await tool.execute(
        { task: "test", files: "README.md" },
        {} as never,
      )) as Record<string, unknown>;

      expect(typeof result.error).toBe("string");
      expect(result.error).toMatch(/python3 not found on PATH/);
      expect(result.error).not.toMatch(/bridge\.py.*not found/i);
    } finally {
      process.env.PATH = originalPath;
    }
  });

  describe("runPythonBridge timeout/SIGKILL-escalation and buffer-overflow handling", () => {
    // These call runPythonBridge directly (bypassing tool.execute()) with a
    // throwaway script and short, test-only timeout/buffer overrides, so
    // the timeout->SIGTERM->SIGKILL escalation and buffer-overflow guard
    // added when fixing the original stdin-blocking bug can be exercised
    // deterministically in milliseconds instead of the real 60s/10MB
    // production limits.
    let scriptDir: string;

    beforeAll(() => {
      scriptDir = mkdtempSync(path.join(tmpdir(), "cadre-cline-plugin-bridge-script-test-"));
    });

    afterAll(() => {
      rmSync(scriptDir, { recursive: true, force: true });
    });

    it("times out and escalates to SIGKILL when the child ignores SIGTERM", async () => {
      const hangingScript = path.join(scriptDir, "hang_ignoring_sigterm.py");
      writeFileSync(
        hangingScript,
        "import signal, time\nsignal.signal(signal.SIGTERM, signal.SIG_IGN)\ntime.sleep(60)\n",
      );

      // timeoutMs is generous enough (300ms) that the interpreter has
      // reliably finished installing the SIGTERM-ignore handler before the
      // timer fires — with a very short timeoutMs (e.g. 100ms) there's a
      // real race where the child could still die from the *plain* SIGTERM
      // if the ignore handler hadn't been installed yet, which would make
      // this pass without ever exercising the SIGKILL escalation it claims
      // to test. Asserting the elapsed time is >= timeoutMs + killGraceMs
      // (not just that it eventually rejects with a "timed out" message)
      // is what actually distinguishes "SIGKILL fired" from "plain SIGTERM
      // happened to work" — the latter would resolve close to timeoutMs
      // alone, never waiting out the full grace period. The upper bound
      // guards against this becoming a slow, non-diagnostic hang instead
      // of a clean rejection if escalation ever stopped working.
      const timeoutMs = 300;
      const killGraceMs = 200;
      const startedAt = Date.now();

      await expect(
        runPythonBridge("{}", scriptDir, { scriptPath: hangingScript, timeoutMs, killGraceMs }),
      ).rejects.toThrow(/timed out/i);

      const elapsedMs = Date.now() - startedAt;
      expect(elapsedMs).toBeGreaterThanOrEqual(timeoutMs + killGraceMs - 20); // small timer-granularity tolerance
      expect(elapsedMs).toBeLessThan(timeoutMs + killGraceMs + 2_000); // generous ceiling against a true hang
    });

    it("rejects and kills the child when output exceeds the buffer limit", async () => {
      const verboseScript = path.join(scriptDir, "print_forever.py");
      writeFileSync(
        verboseScript,
        "import sys\nwhile True:\n    sys.stdout.write('x' * 1000)\n    sys.stdout.flush()\n",
      );

      // timeoutMs here is this test's own internal fallback, not the thing
      // under test (the overflow guard should reject long before it), but
      // it must sit comfortably below vitest's own default per-test
      // timeout (5000ms, unconfigured in this repo) or a slower-than-
      // expected overflow detection would hit that opaque outer timeout
      // instead of this precise rejection assertion.
      await expect(
        runPythonBridge("{}", scriptDir, { scriptPath: verboseScript, maxBuffer: 100, timeoutMs: 2_000 }),
      ).rejects.toThrow(/exceeded max buffer size/i);
    });

    it("does not crash on an EPIPE-style stdin write after the child has already closed its read end", async () => {
      // Regression test for the original bug: an unguarded 'error' event on
      // child.stdin (e.g. EPIPE from writing after the child closed fd 0)
      // is an uncaught exception in Node and can crash the whole host
      // process. Reliably forcing that exact race from outside
      // runPythonBridge isn't possible without instrumenting it further
      // (the write happens synchronously right after spawn(), before the
      // child has necessarily even started) — this is a best-effort trigger
      // (a large payload against a script that closes its stdin fd
      // immediately) rather than a guaranteed reproduction. Its value is
      // structural: if the `child.stdin.on("error", ...)` guard were ever
      // removed, a triggered race here would crash this test file's whole
      // process instead of failing this one assertion.
      const closesStdinScript = path.join(scriptDir, "close_stdin_immediately.py");
      writeFileSync(closesStdinScript, "import os\nos.close(0)\n");
      const largePayload = "x".repeat(256 * 1024); // past typical OS pipe buffer sizes

      await expect(
        runPythonBridge(largePayload, scriptDir, { scriptPath: closesStdinScript, timeoutMs: 2_000 }),
      ).resolves.toBeDefined();
    });
  });
});
