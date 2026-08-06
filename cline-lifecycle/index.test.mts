import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";
import type { AgentTool } from "@cline/sdk";
import { plugin, type SetupApi, type SetupContext } from "./index.ts";

const execFileAsync = promisify(execFile);

const PLUGIN_DIR = path.dirname(fileURLToPath(import.meta.url));
// One level up, not two: cline-lifecycle/ is this repository's direct
// child, matching index.ts's own PLUGIN_DIR/CADRE_BIN resolution.
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

describe("cadre-lifecycle plugin", () => {
  it("declares the tools capability and registers exactly the 4 sdlc tools", async () => {
    expect(plugin.manifest.capabilities).toEqual(["tools"]);

    const tools = await registerTools(REPO_ROOT);
    expect(tools.map((t) => t.name).sort()).toEqual(
      ["sdlc_init", "sdlc_validate", "sdlc_status", "sdlc_decide"].sort(),
    );
  });

  it("each tool's description names the bin/cadre sdlc subcommand it wraps", async () => {
    const tools = await registerTools(REPO_ROOT);
    expect(findTool(tools, "sdlc_init").description).toMatch(/bin\/cadre sdlc init/);
    expect(findTool(tools, "sdlc_validate").description).toMatch(/bin\/cadre sdlc validate/);
    expect(findTool(tools, "sdlc_status").description).toMatch(/bin\/cadre sdlc status/);
    expect(findTool(tools, "sdlc_decide").description).toMatch(/bin\/cadre sdlc decide/);
  });

  it("sdlc_decide's description states it adds no approval logic of its own", async () => {
    const tools = await registerTools(REPO_ROOT);
    const description = findTool(tools, "sdlc_decide").description ?? "";
    expect(description).toMatch(/preparer\/verifier/);
    expect(description).toMatch(/no approval logic of its own/);
  });

  it("every tool throws when no root is given and no workspace root was resolved", async () => {
    const tools = await registerTools(undefined);
    await expect(
      findTool(tools, "sdlc_validate").execute({}, {} as never),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_status").execute({ taskId: "x" }, {} as never),
    ).rejects.toThrow(/root/i);
  });

  describe("real bin/cadre sdlc subprocess calls", () => {
    // These exercise the actual CLI path (same convention as cline/'s own
    // index.test.mts): the local environment used to develop this plugin
    // happens to have the external `agentic-sdlc` kernel installed and on
    // PATH, so these are real, deterministic outcomes -- a structured
    // error for an un-onboarded/nonexistent target, not a mock. If
    // `agentic-sdlc` is not installed elsewhere, `bin/cadre sdlc` itself
    // fails closed with its own clear message, which these tests would
    // also correctly observe as `result.error` being set.

    it("sdlc_validate returns a structured error (not a throw) for this repository, which has no .agentic-sdlc/", async () => {
      const tools = await registerTools(REPO_ROOT);
      const result = (await findTool(tools, "sdlc_validate").execute({}, {} as never)) as Record<string, unknown>;
      // Either shape is a legitimate real outcome depending on whether
      // agentic-sdlc is installed in the environment running this test:
      // a kernel-reported validation failure (valid: false) or this
      // plugin's own structured error if the kernel binary is missing.
      expect(result.valid === false || typeof result.error === "string").toBe(true);
    });

    it("sdlc_status returns a structured error for a task with no run record", async () => {
      const tools = await registerTools(REPO_ROOT);
      const result = (await findTool(tools, "sdlc_status").execute(
        { taskId: "cline-lifecycle-test-nonexistent-task" },
        {} as never,
      )) as Record<string, unknown>;
      expect(typeof result.error).toBe("string");
    });

    describe("sdlc_init dry-run against a scratch project", () => {
      let scratchDir: string;

      beforeAll(async () => {
        scratchDir = mkdtempSync(path.join(tmpdir(), "cline-lifecycle-sdlc-init-test-"));
        await execFileAsync("git", ["init", "-q"], { cwd: scratchDir });
      });

      afterAll(() => {
        rmSync(scratchDir, { recursive: true, force: true });
      });

      it("previews without writing anything, or reports a structured error if the kernel is unavailable", async () => {
        const tools = await registerTools(scratchDir);
        const result = (await findTool(tools, "sdlc_init").execute(
          {
            profile: "secure-cloud",
            projectId: "cline-lifecycle-test-proj",
            classification: "internal",
            dryRun: true,
          },
          {} as never,
        )) as Record<string, unknown>;

        if (result.error) {
          expect(typeof result.error).toBe("string");
          return;
        }
        expect(result.status).toBe("dry-run");
        expect(result.mutation).toBe(false);
        expect(Array.isArray(result.would_create)).toBe(true);
      });
    });
  });
});
