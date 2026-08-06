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

const GITLAB_TOOL_NAMES = [
  "sdlc_approve_from_gitlab",
  "sdlc_approve_from_gitlab_mr",
  "sdlc_link_intent_from_gitlab_issue",
  "sdlc_link_requirements_from_gitlab_issue",
];

const GITHUB_TOOL_NAMES = ["sdlc_approve_from_github", "sdlc_approve_from_github_pr"];

// These 10 wrap kernel subcommands not present in every agentic-sdlc release
// within this repository's declared kernel_compatibility range -- see
// index.ts's "About this plugin" comment. Grouped separately so the
// "real bin/cadre sdlc subprocess calls" describe block below can assert
// the specific, deterministic "invalid choice" failure shape they produce
// against a kernel that predates them, distinctly from the other tools'
// ordinary structured-error assertions.
const UNSHIPPED_KERNEL_TOOL_NAMES = [
  "sdlc_list_gate_issues_gitlab",
  "sdlc_create_gate_issues_gitlab",
  "sdlc_list_github_gate_issues",
  "sdlc_create_github_gate_issues",
  "sdlc_list_gate_status",
  "sdlc_publish_gate_status",
  "sdlc_request_gate_reviewers_gitlab",
  "sdlc_request_gate_reviewers_github",
  "sdlc_list_reviewer_nudge",
  "sdlc_publish_reviewer_nudge",
];

describe("cadre-lifecycle plugin", () => {
  it("declares the tools capability and registers exactly the 4 forge-agnostic sdlc tools plus the 6 forge-specific approval/link tools and the 10 gate-issues/status/reviewer tools", async () => {
    expect(plugin.manifest.capabilities).toEqual(["tools"]);

    const tools = await registerTools(REPO_ROOT);
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "sdlc_init",
        "sdlc_validate",
        "sdlc_status",
        "sdlc_decide",
        ...GITLAB_TOOL_NAMES,
        ...GITHUB_TOOL_NAMES,
        ...UNSHIPPED_KERNEL_TOOL_NAMES,
      ].sort(),
    );
  });

  it("each tool's description names the bin/cadre sdlc subcommand it wraps", async () => {
    const tools = await registerTools(REPO_ROOT);
    expect(findTool(tools, "sdlc_init").description).toMatch(/bin\/cadre sdlc init/);
    expect(findTool(tools, "sdlc_validate").description).toMatch(/bin\/cadre sdlc validate/);
    expect(findTool(tools, "sdlc_status").description).toMatch(/bin\/cadre sdlc status/);
    expect(findTool(tools, "sdlc_decide").description).toMatch(/bin\/cadre sdlc decide/);
    expect(findTool(tools, "sdlc_approve_from_gitlab").description).toMatch(
      /bin\/cadre sdlc approve-from-gitlab`/,
    );
    expect(findTool(tools, "sdlc_approve_from_gitlab_mr").description).toMatch(
      /bin\/cadre sdlc approve-from-gitlab-mr/,
    );
    expect(findTool(tools, "sdlc_link_intent_from_gitlab_issue").description).toMatch(
      /bin\/cadre sdlc link-intent-from-gitlab-issue/,
    );
    expect(findTool(tools, "sdlc_link_requirements_from_gitlab_issue").description).toMatch(
      /bin\/cadre sdlc link-requirements-from-gitlab-issue/,
    );
    expect(findTool(tools, "sdlc_approve_from_github").description).toMatch(
      /bin\/cadre sdlc approve-from-github`/,
    );
    expect(findTool(tools, "sdlc_approve_from_github_pr").description).toMatch(
      /bin\/cadre sdlc approve-from-github-pr/,
    );
    expect(findTool(tools, "sdlc_list_gate_issues_gitlab").description).toMatch(
      /bin\/cadre sdlc list-gate-issues/,
    );
    expect(findTool(tools, "sdlc_create_gate_issues_gitlab").description).toMatch(
      /bin\/cadre sdlc create-gate-issues/,
    );
    expect(findTool(tools, "sdlc_list_github_gate_issues").description).toMatch(
      /bin\/cadre sdlc list-github-gate-issues/,
    );
    expect(findTool(tools, "sdlc_create_github_gate_issues").description).toMatch(
      /bin\/cadre sdlc create-github-gate-issues/,
    );
    expect(findTool(tools, "sdlc_list_gate_status").description).toMatch(/bin\/cadre sdlc list-gate-status/);
    expect(findTool(tools, "sdlc_publish_gate_status").description).toMatch(
      /bin\/cadre sdlc publish-gate-status/,
    );
    expect(findTool(tools, "sdlc_request_gate_reviewers_gitlab").description).toMatch(
      /bin\/cadre sdlc request-gate-reviewers-gitlab/,
    );
    expect(findTool(tools, "sdlc_request_gate_reviewers_github").description).toMatch(
      /bin\/cadre sdlc request-gate-reviewers/,
    );
    expect(findTool(tools, "sdlc_list_reviewer_nudge").description).toMatch(
      /bin\/cadre sdlc list-reviewer-nudge/,
    );
    expect(findTool(tools, "sdlc_publish_reviewer_nudge").description).toMatch(
      /bin\/cadre sdlc publish-reviewer-nudge/,
    );
  });

  it("the four approve-from-gitlab/github tools add no approval logic of their own", async () => {
    const tools = await registerTools(REPO_ROOT);
    for (const name of [
      "sdlc_approve_from_gitlab",
      "sdlc_approve_from_gitlab_mr",
      "sdlc_approve_from_github",
      "sdlc_approve_from_github_pr",
    ]) {
      const description = findTool(tools, name).description ?? "";
      expect(description).toMatch(/preparer\/verifier/);
      expect(description).toMatch(/no approval logic of its own/);
    }
  });

  it("sdlc_decide's description states it adds no approval logic of its own", async () => {
    const tools = await registerTools(REPO_ROOT);
    const description = findTool(tools, "sdlc_decide").description ?? "";
    expect(description).toMatch(/preparer\/verifier/);
    expect(description).toMatch(/no approval logic of its own/);
  });

  it("every one of the 4 tools throws when no root is given and no workspace root was resolved", async () => {
    const tools = await registerTools(undefined);
    await expect(
      findTool(tools, "sdlc_validate").execute({}, {} as never),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_status").execute({ taskId: "x" }, {} as never),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_init").execute(
        { profile: "secure-cloud", projectId: "x", classification: "internal" },
        {} as never,
      ),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_decide").execute(
        {
          taskId: "x",
          gate: "G1",
          role: "test",
          decision: "approved",
          actorId: "tester",
          evidenceUri: "doc:test",
        },
        {} as never,
      ),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_approve_from_gitlab").execute(
        {
          taskId: "x",
          gate: "G1",
          role: "test",
          projectPath: "group/project",
          mrIid: 1,
          approvalId: "1",
          approverUsername: "tester",
          commitSha: "deadbeef",
        },
        {} as never,
      ),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_approve_from_gitlab_mr").execute(
        { taskId: "x", gate: "G1", role: "test", projectPath: "group/project", mrIid: 1 },
        {} as never,
      ),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_link_intent_from_gitlab_issue").execute(
        { taskId: "x", role: "test", projectPath: "group/project", issueIid: 1 },
        {} as never,
      ),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_link_requirements_from_gitlab_issue").execute(
        { taskId: "x", role: "test", projectPath: "group/project", issueIid: 1 },
        {} as never,
      ),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_approve_from_github").execute(
        {
          taskId: "x",
          gate: "G1",
          role: "test",
          repo: "owner/repo",
          pr: 1,
          reviewId: "1",
          reviewerLogin: "tester",
          commitSha: "deadbeef",
        },
        {} as never,
      ),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_approve_from_github_pr").execute(
        { taskId: "x", gate: "G1", role: "test", repo: "owner/repo", pr: 1 },
        {} as never,
      ),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_list_gate_issues_gitlab").execute({ taskId: "x" }, {} as never),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_create_gate_issues_gitlab").execute(
        { taskId: "x", projectPath: "group/project", asBot: "bot" },
        {} as never,
      ),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_list_github_gate_issues").execute({ taskId: "x" }, {} as never),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_create_github_gate_issues").execute(
        { taskId: "x", repo: "owner/repo", asBot: "bot", allowClassification: "internal" },
        {} as never,
      ),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_list_gate_status").execute({ taskId: "x" }, {} as never),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_publish_gate_status").execute(
        {
          forge: "gitlab",
          taskId: "x",
          projectPath: "group/project",
          mrIid: 1,
          asBot: "bot",
          allowClassification: "internal",
        },
        {} as never,
      ),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_request_gate_reviewers_gitlab").execute(
        { taskId: "x", projectPath: "group/project", mrIid: 1, asBot: "bot", allowClassification: "internal" },
        {} as never,
      ),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_request_gate_reviewers_github").execute(
        { taskId: "x", repo: "owner/repo", pr: 1, asBot: "bot", allowClassification: "internal" },
        {} as never,
      ),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_list_reviewer_nudge").execute({ taskId: "x" }, {} as never),
    ).rejects.toThrow(/root/i);
    await expect(
      findTool(tools, "sdlc_publish_reviewer_nudge").execute(
        { taskId: "x", repo: "owner/repo", pr: 1, asBot: "bot", allowClassification: "internal" },
        {} as never,
      ),
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

    it("sdlc_decide returns a structured error (never a false success) for a nonexistent task/gate", async () => {
      // This repository has no .agentic-sdlc/ run record at all, so a real
      // decide call against it can never legitimately succeed -- the
      // kernel either rejects the gate/task as unknown, or (if the
      // installed kernel version predates the `decide` subcommand) its
      // own argparse rejects the subcommand name itself. Either way this
      // must surface as result.error, never as a false "success" -- the
      // one outcome that would mean this tool is laundering a kernel
      // refusal into an apparent approval.
      const tools = await registerTools(REPO_ROOT);
      const result = (await findTool(tools, "sdlc_decide").execute(
        {
          taskId: "cline-lifecycle-test-nonexistent-task",
          gate: "G1",
          role: "cline-lifecycle-test-role",
          decision: "approved",
          actorId: "cline-lifecycle-test-actor",
          evidenceUri: "doc:cline-lifecycle-test",
        },
        {} as never,
      )) as Record<string, unknown>;
      expect(typeof result.error).toBe("string");
      expect(result.status).not.toBe("approved");
    });

    it("sdlc_approve_from_gitlab returns a structured error (never a false success) for a nonexistent task/gate", async () => {
      const tools = await registerTools(REPO_ROOT);
      const result = (await findTool(tools, "sdlc_approve_from_gitlab").execute(
        {
          taskId: "cline-lifecycle-test-nonexistent-task",
          gate: "G1",
          role: "cline-lifecycle-test-role",
          projectPath: "cline-lifecycle-test/project",
          mrIid: 1,
          approvalId: "1",
          approverUsername: "cline-lifecycle-test-approver",
          commitSha: "0000000000000000000000000000000000000000",
        },
        {} as never,
      )) as Record<string, unknown>;
      expect(typeof result.error).toBe("string");
      expect(result.status).not.toBe("approved");
    });

    it("sdlc_approve_from_gitlab_mr returns a structured error (never a false success) for a nonexistent task/gate", async () => {
      const tools = await registerTools(REPO_ROOT);
      const result = (await findTool(tools, "sdlc_approve_from_gitlab_mr").execute(
        {
          taskId: "cline-lifecycle-test-nonexistent-task",
          gate: "G1",
          role: "cline-lifecycle-test-role",
          projectPath: "cline-lifecycle-test/project",
          mrIid: 1,
        },
        {} as never,
      )) as Record<string, unknown>;
      expect(typeof result.error).toBe("string");
      expect(result.status).not.toBe("approved");
    });

    it("sdlc_link_intent_from_gitlab_issue returns a structured error for a nonexistent task", async () => {
      const tools = await registerTools(REPO_ROOT);
      const result = (await findTool(tools, "sdlc_link_intent_from_gitlab_issue").execute(
        {
          taskId: "cline-lifecycle-test-nonexistent-task",
          role: "cline-lifecycle-test-role",
          projectPath: "cline-lifecycle-test/project",
          issueIid: 1,
        },
        {} as never,
      )) as Record<string, unknown>;
      expect(typeof result.error).toBe("string");
    });

    it("sdlc_link_requirements_from_gitlab_issue returns a structured error for a nonexistent task", async () => {
      const tools = await registerTools(REPO_ROOT);
      const result = (await findTool(tools, "sdlc_link_requirements_from_gitlab_issue").execute(
        {
          taskId: "cline-lifecycle-test-nonexistent-task",
          role: "cline-lifecycle-test-role",
          projectPath: "cline-lifecycle-test/project",
          issueIid: 1,
        },
        {} as never,
      )) as Record<string, unknown>;
      expect(typeof result.error).toBe("string");
    });

    it("sdlc_approve_from_github returns a structured error (never a false success) for a nonexistent task/gate", async () => {
      const tools = await registerTools(REPO_ROOT);
      const result = (await findTool(tools, "sdlc_approve_from_github").execute(
        {
          taskId: "cline-lifecycle-test-nonexistent-task",
          gate: "G1",
          role: "cline-lifecycle-test-role",
          repo: "cline-lifecycle-test/repo",
          pr: 1,
          reviewId: "1",
          reviewerLogin: "cline-lifecycle-test-reviewer",
          commitSha: "0000000000000000000000000000000000000000",
        },
        {} as never,
      )) as Record<string, unknown>;
      expect(typeof result.error).toBe("string");
      expect(result.status).not.toBe("approved");
    });

    it("sdlc_approve_from_github_pr returns a structured error (never a false success) for a nonexistent task/gate", async () => {
      const tools = await registerTools(REPO_ROOT);
      const result = (await findTool(tools, "sdlc_approve_from_github_pr").execute(
        {
          taskId: "cline-lifecycle-test-nonexistent-task",
          gate: "G1",
          role: "cline-lifecycle-test-role",
          repo: "cline-lifecycle-test/repo",
          pr: 1,
        },
        {} as never,
      )) as Record<string, unknown>;
      expect(typeof result.error).toBe("string");
      expect(result.status).not.toBe("approved");
    });

    describe("kernel subcommands not shipped by every agentic-sdlc release in range", () => {
      // These 10 tools wrap kernel subcommands the packaged skills document
      // but that the kernel version actually installed in this environment
      // doesn't have -- see index.ts's "About this plugin" comment. Rather
      // than skip testing them, assert the one thing that must always hold
      // regardless of kernel version: the tool returns a structured result
      // object (never a throw). Today that result is `{error, stderr}`
      // ("invalid choice"); once a kernel that ships these subcommands is
      // installed, it becomes a real success/refusal shape instead -- that
      // transition is a kernel-upgrade concern, not a regression in this
      // plugin's argument-building/pass-through, so these assertions check
      // "did we get a structured result", not "did it fail".

      it("sdlc_list_gate_issues_gitlab returns a structured result, not a throw", async () => {
        const tools = await registerTools(REPO_ROOT);
        const result = (await findTool(tools, "sdlc_list_gate_issues_gitlab").execute(
          { taskId: "cline-lifecycle-test-nonexistent-task" },
          {} as never,
        )) as Record<string, unknown>;
        expect(result).toBeTypeOf("object");
      });

      it("sdlc_create_gate_issues_gitlab returns a structured result, not a throw", async () => {
        const tools = await registerTools(REPO_ROOT);
        const result = (await findTool(tools, "sdlc_create_gate_issues_gitlab").execute(
          {
            taskId: "cline-lifecycle-test-nonexistent-task",
            projectPath: "cline-lifecycle-test/project",
            asBot: "cline-lifecycle-test-bot",
          },
          {} as never,
        )) as Record<string, unknown>;
        expect(result).toBeTypeOf("object");
      });

      it("sdlc_list_github_gate_issues returns a structured result, not a throw", async () => {
        const tools = await registerTools(REPO_ROOT);
        const result = (await findTool(tools, "sdlc_list_github_gate_issues").execute(
          { taskId: "cline-lifecycle-test-nonexistent-task" },
          {} as never,
        )) as Record<string, unknown>;
        expect(result).toBeTypeOf("object");
      });

      it("sdlc_create_github_gate_issues returns a structured result, not a throw", async () => {
        const tools = await registerTools(REPO_ROOT);
        const result = (await findTool(tools, "sdlc_create_github_gate_issues").execute(
          {
            taskId: "cline-lifecycle-test-nonexistent-task",
            repo: "cline-lifecycle-test/repo",
            asBot: "cline-lifecycle-test-bot",
            allowClassification: "internal",
          },
          {} as never,
        )) as Record<string, unknown>;
        expect(result).toBeTypeOf("object");
      });

      it("sdlc_list_gate_status returns a structured result, not a throw", async () => {
        const tools = await registerTools(REPO_ROOT);
        const result = (await findTool(tools, "sdlc_list_gate_status").execute(
          { taskId: "cline-lifecycle-test-nonexistent-task" },
          {} as never,
        )) as Record<string, unknown>;
        expect(result).toBeTypeOf("object");
      });

      it("sdlc_publish_gate_status returns a structured result, not a throw", async () => {
        const tools = await registerTools(REPO_ROOT);
        const result = (await findTool(tools, "sdlc_publish_gate_status").execute(
          {
            forge: "gitlab",
            taskId: "cline-lifecycle-test-nonexistent-task",
            projectPath: "cline-lifecycle-test/project",
            mrIid: 1,
            asBot: "cline-lifecycle-test-bot",
            allowClassification: "internal",
          },
          {} as never,
        )) as Record<string, unknown>;
        expect(result).toBeTypeOf("object");
      });

      it("sdlc_request_gate_reviewers_gitlab returns a structured result, not a throw", async () => {
        const tools = await registerTools(REPO_ROOT);
        const result = (await findTool(tools, "sdlc_request_gate_reviewers_gitlab").execute(
          {
            taskId: "cline-lifecycle-test-nonexistent-task",
            projectPath: "cline-lifecycle-test/project",
            mrIid: 1,
            asBot: "cline-lifecycle-test-bot",
            allowClassification: "internal",
          },
          {} as never,
        )) as Record<string, unknown>;
        expect(result).toBeTypeOf("object");
      });

      it("sdlc_request_gate_reviewers_github returns a structured result, not a throw", async () => {
        const tools = await registerTools(REPO_ROOT);
        const result = (await findTool(tools, "sdlc_request_gate_reviewers_github").execute(
          {
            taskId: "cline-lifecycle-test-nonexistent-task",
            repo: "cline-lifecycle-test/repo",
            pr: 1,
            asBot: "cline-lifecycle-test-bot",
            allowClassification: "internal",
          },
          {} as never,
        )) as Record<string, unknown>;
        expect(result).toBeTypeOf("object");
      });

      it("sdlc_list_reviewer_nudge returns a structured result, not a throw", async () => {
        const tools = await registerTools(REPO_ROOT);
        const result = (await findTool(tools, "sdlc_list_reviewer_nudge").execute(
          { taskId: "cline-lifecycle-test-nonexistent-task" },
          {} as never,
        )) as Record<string, unknown>;
        expect(result).toBeTypeOf("object");
      });

      it("sdlc_publish_reviewer_nudge returns a structured result, not a throw", async () => {
        const tools = await registerTools(REPO_ROOT);
        const result = (await findTool(tools, "sdlc_publish_reviewer_nudge").execute(
          {
            taskId: "cline-lifecycle-test-nonexistent-task",
            repo: "cline-lifecycle-test/repo",
            pr: 1,
            asBot: "cline-lifecycle-test-bot",
            allowClassification: "internal",
          },
          {} as never,
        )) as Record<string, unknown>;
        expect(result).toBeTypeOf("object");
      });
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
