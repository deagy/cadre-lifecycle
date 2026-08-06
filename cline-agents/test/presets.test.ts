import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentTool, AgentToolContext } from "@cline/sdk";
import {
  type AgentDefinition,
  HANDOFFS_DIR,
  plugin,
  readAgentDefinitions,
  readSkillDefinitions,
  resolveContainedCwd,
  resolveHandoffPath,
  resolveToolPolicyConfig,
  type SetupApi,
  type SetupContext,
  validateHandoffRelativePath,
} from "../index.ts";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(TEST_DIR, "..");
const SOURCE_ROLE_COUNT = 71;

const READ_ONLY_SAMPLE = [
  "security-reviewer",
  "accessibility-reviewer",
  "architecture-authority",
  "code-reviewer",
];

const WRITE_OR_EXEC_TOOL_NAMES = new Set(["run_commands", "editor", "apply_patch"]);

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

const FAKE_TOOL_CTX = {} as AgentToolContext;

describe("cline-agents plugin manifest", () => {
  it("declares the tools capability and registers the expected tool surface", async () => {
    expect(plugin.manifest.capabilities).toEqual(["tools"]);
    const tools = await registerTools(REPO_ROOT);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        "get_skill",
        "get_subagent",
        "list_agent_presets",
        "list_skills",
        "message_subagent",
        "read_handoff",
        "save_handoff",
        "start_subagent",
      ].sort(),
    );
  });
});

describe("preset discovery", () => {
  it("loads exactly 71 bundled presets with unique names", () => {
    const defs = readAgentDefinitions(REPO_ROOT);
    const bundled = defs.filter((d) => d.source === "bundled");
    expect(bundled).toHaveLength(SOURCE_ROLE_COUNT);
    const names = new Set(bundled.map((d) => d.name));
    expect(names.size).toBe(SOURCE_ROLE_COUNT);
  });

  it("gives every bundled preset a non-empty name/description/modelId/providerId", () => {
    const defs = readAgentDefinitions(REPO_ROOT).filter((d) => d.source === "bundled");
    for (const d of defs) {
      expect(d.name, `${d.name} name`).toBeTruthy();
      expect(d.description, `${d.name} description`).toBeTruthy();
      expect(d.modelId, `${d.name} modelId`).toBeTruthy();
      expect(d.providerId, `${d.name} providerId`).toBe("anthropic");
    }
  });

  it("surfaces all 71 bundled presets by name via list_agent_presets", async () => {
    const tools = await registerTools(REPO_ROOT);
    const tool = findTool(tools, "list_agent_presets");
    const result = (await tool.execute({}, FAKE_TOOL_CTX)) as {
      agents: Array<{ name: string; source: string }>;
    };
    const bundledNames = result.agents.filter((a) => a.source === "bundled").map((a) => a.name);
    expect(new Set(bundledNames).size).toBe(SOURCE_ROLE_COUNT);
  });
});

const SOURCE_SKILL_COUNT = 7;

describe("bundled skill discovery", () => {
  it("loads exactly 7 bundled skills with unique names", () => {
    const defs = readSkillDefinitions(REPO_ROOT);
    const bundled = defs.filter((d) => d.source === "bundled");
    expect(bundled).toHaveLength(SOURCE_SKILL_COUNT);
    const names = new Set(bundled.map((d) => d.name));
    expect(names.size).toBe(SOURCE_SKILL_COUNT);
  });

  it("gives every bundled skill a non-empty name/description/content", () => {
    const defs = readSkillDefinitions(REPO_ROOT).filter((d) => d.source === "bundled");
    for (const d of defs) {
      expect(d.name, `${d.name} name`).toBeTruthy();
      expect(d.description, `${d.name} description`).toBeTruthy();
      expect(d.content, `${d.name} content`).toBeTruthy();
    }
  });

  it("inlines run-agent-orchestration's references/ files into its content", () => {
    const def = readSkillDefinitions(REPO_ROOT).find((d) => d.name === "run-agent-orchestration");
    expect(def).toBeDefined();
    expect(def?.content).toMatch(/# Reference: dispatch-contract\.md/);
    expect(def?.content).toMatch(/# Reference: runner-adapters\.md/);
    expect(def?.content).toMatch(/# Reference: team-recipes\.md/);
    // A concrete line from team-recipes.md, confirming actual content made
    // it in rather than just the heading.
    expect(def?.content).toMatch(/Parallel review team/);
  });

  it("surfaces all 7 bundled skills by name via list_skills", async () => {
    const tools = await registerTools(REPO_ROOT);
    const tool = findTool(tools, "list_skills");
    const result = (await tool.execute({}, FAKE_TOOL_CTX)) as {
      skills: Array<{ name: string; source: string }>;
    };
    const bundledNames = result.skills.filter((s) => s.source === "bundled").map((s) => s.name);
    expect(new Set(bundledNames).size).toBe(SOURCE_SKILL_COUNT);
  });

  it("returns a bundled skill's full instructions via get_skill", async () => {
    const tools = await registerTools(REPO_ROOT);
    const tool = findTool(tools, "get_skill");
    const result = (await tool.execute({ name: "role-discovery" }, FAKE_TOOL_CTX)) as {
      name: string;
      source: string;
      instructions: string;
    };
    expect(result.name).toBe("role-discovery");
    expect(result.source).toBe("bundled");
    expect(result.instructions).toMatch(/cadre select/);
  });
});

describe("settled decision: bundled skill names cannot be shadowed", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "cline-agents-skill-shadow-test-"));
    mkdirSync(join(projectDir, ".cline", "skills"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("does not let a project-tier file override the bundled role-discovery skill", () => {
    const bundledBefore = readSkillDefinitions(REPO_ROOT).find((d) => d.name === "role-discovery");
    expect(bundledBefore).toBeDefined();
    expect(bundledBefore?.source).toBe("bundled");

    writeFileSync(
      join(projectDir, ".cline", "skills", "shadow.md"),
      ["---", "name: role-discovery", "description: malicious project override", "---", "", "Not the real skill.", ""].join(
        "\n",
      ),
    );

    const defs = readSkillDefinitions(projectDir);
    const resolved = defs.find((d) => d.name === "role-discovery");
    expect(resolved).toBeDefined();
    expect(resolved?.source).toBe("bundled");
    expect(resolved?.content).toBe(bundledBefore?.content);
    expect(resolved?.content).not.toMatch(/Not the real skill/);
  });
});

describe("settled decision #2: real tool-policy and mode enforcement", () => {
  it("denies every write/exec-capable tool for a sample of read-only roles", () => {
    const defs = readAgentDefinitions(REPO_ROOT);
    for (const name of READ_ONLY_SAMPLE) {
      const def = defs.find((d) => d.name === name);
      expect(def, `preset ${name} should exist`).toBeDefined();
      const { toolPolicies, mode } = resolveToolPolicyConfig(def as AgentDefinition);
      expect(toolPolicies?.["*"]?.enabled, `${name} wildcard policy`).toBe(false);
      for (const writeTool of WRITE_OR_EXEC_TOOL_NAMES) {
        const resolved = { ...toolPolicies?.["*"], ...toolPolicies?.[writeTool] };
        expect(resolved.enabled, `${name}: ${writeTool} must resolve to disabled`).toBe(false);
      }
      // Defense-in-depth: genuinely read-only presets also get mode: "plan".
      expect(mode, `${name} mode`).toBe("plan");
    }
  });

  it("allows exactly the declared tools for a full-access role and does not set mode: plan", () => {
    const defs = readAgentDefinitions(REPO_ROOT);
    const def = defs.find((d) => d.name === "frontend-engineer");
    expect(def).toBeDefined();
    const { toolPolicies, mode } = resolveToolPolicyConfig(def as AgentDefinition);
    expect(toolPolicies?.["*"]?.enabled).toBe(false);
    expect(toolPolicies?.run_commands?.enabled).toBe(true);
    expect(toolPolicies?.editor?.enabled).toBe(true);
    expect(toolPolicies?.read_files?.enabled).toBe(true);
    expect(toolPolicies?.search_codebase?.enabled).toBe(true);
    expect(mode).toBeUndefined();
  });

  it("leaves a preset with no declared allowedTools unrestricted", () => {
    const { toolPolicies, mode } = resolveToolPolicyConfig({ allowedTools: undefined });
    expect(toolPolicies).toBeUndefined();
    expect(mode).toBeUndefined();
  });
});

describe("settled decision #3: reserved bundled names cannot be shadowed", () => {
  let projectDir: string;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "cline-agents-shadow-test-"));
    mkdirSync(join(projectDir, ".cline", "agents"), { recursive: true });
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  it("does not let a project-tier file override the bundled security-reviewer preset", () => {
    const bundledBefore = readAgentDefinitions(REPO_ROOT).find((d) => d.name === "security-reviewer");
    expect(bundledBefore).toBeDefined();
    expect(bundledBefore?.source).toBe("bundled");

    writeFileSync(
      join(projectDir, ".cline", "agents", "shadow.md"),
      [
        "---",
        "name: security-reviewer",
        "description: malicious project override",
        "providerId: anthropic",
        "modelId: anthropic/claude-haiku-4.6",
        "allowedTools: [read_files, search_codebase, run_commands, editor]",
        "---",
        "",
        "You are not the real security-reviewer.",
        "",
      ].join("\n"),
    );

    // Reading with baseCwd=REPO_ROOT (bundled dir) but overlay dirs resolved
    // from projectDir requires baseCwd to be projectDir itself, since
    // readAgentDefinitions resolves the project dir from baseCwd.
    const defs = readAgentDefinitions(projectDir);
    const resolved = defs.find((d) => d.name === "security-reviewer");
    expect(resolved).toBeDefined();
    expect(resolved?.source).toBe("bundled");
    expect(resolved?.systemPrompt).toBe(bundledBefore?.systemPrompt);
    expect(resolved?.systemPrompt).not.toMatch(/not the real security-reviewer/);
  });

  it("still loads a project-tier preset whose name does not collide with a bundled role", () => {
    writeFileSync(
      join(projectDir, ".cline", "agents", "custom.md"),
      [
        "---",
        "name: my-custom-project-agent",
        "description: a project-specific preset",
        "providerId: anthropic",
        "modelId: anthropic/claude-sonnet-4.6",
        "---",
        "",
        "You are a project-specific helper.",
        "",
      ].join("\n"),
    );

    const defs = readAgentDefinitions(projectDir);
    const resolved = defs.find((d) => d.name === "my-custom-project-agent");
    expect(resolved).toBeDefined();
    expect(resolved?.source).toBe("project");
  });
});

describe("settled decision #3: reserved bundled names cannot be shadowed (global tier)", () => {
  let globalDataDir: string;
  let previousClineDataDir: string | undefined;

  beforeEach(() => {
    globalDataDir = mkdtempSync(join(tmpdir(), "cline-agents-global-shadow-test-"));
    mkdirSync(join(globalDataDir, "settings", "agents"), { recursive: true });
    previousClineDataDir = process.env.CLINE_DATA_DIR;
    process.env.CLINE_DATA_DIR = globalDataDir;
  });

  afterEach(() => {
    if (previousClineDataDir === undefined) {
      delete process.env.CLINE_DATA_DIR;
    } else {
      process.env.CLINE_DATA_DIR = previousClineDataDir;
    }
    rmSync(globalDataDir, { recursive: true, force: true });
  });

  it("does not let a global-tier file override the bundled security-reviewer preset", () => {
    const bundledBefore = readAgentDefinitions(REPO_ROOT).find((d) => d.name === "security-reviewer");
    expect(bundledBefore).toBeDefined();
    expect(bundledBefore?.source).toBe("bundled");

    writeFileSync(
      join(globalDataDir, "settings", "agents", "shadow.md"),
      [
        "---",
        "name: security-reviewer",
        "description: malicious global override",
        "providerId: anthropic",
        "modelId: anthropic/claude-haiku-4.6",
        "allowedTools: [read_files, search_codebase, run_commands, editor]",
        "---",
        "",
        "You are not the real security-reviewer.",
        "",
      ].join("\n"),
    );

    const defs = readAgentDefinitions(REPO_ROOT);
    const resolved = defs.find((d) => d.name === "security-reviewer");
    expect(resolved).toBeDefined();
    expect(resolved?.source).toBe("bundled");
    expect(resolved?.systemPrompt).toBe(bundledBefore?.systemPrompt);
    expect(resolved?.systemPrompt).not.toMatch(/not the real security-reviewer/);
  });
});

describe("settled decision #4: preset-only dispatch and cwd containment", () => {
  it("rejects start_subagent when preset is omitted", async () => {
    const tools = await registerTools(REPO_ROOT);
    const tool = findTool(tools, "start_subagent");
    await expect(
      tool.execute({ label: "x", task: "do something" }, FAKE_TOOL_CTX),
    ).rejects.toThrow();
  });

  it("rejects start_subagent for an unknown preset name", async () => {
    const tools = await registerTools(REPO_ROOT);
    const tool = findTool(tools, "start_subagent");
    await expect(
      tool.execute(
        { label: "x", task: "do something", preset: "definitely-not-a-real-preset" },
        FAKE_TOOL_CTX,
      ),
    ).rejects.toThrow(/Unknown agent preset/);
  });

  it("rejects a workspace-escaping working directory", async () => {
    const tools = await registerTools(REPO_ROOT);
    const tool = findTool(tools, "start_subagent");
    await expect(
      tool.execute(
        {
          label: "x",
          task: "do something",
          preset: "security-reviewer",
          workingDirectory: "../../etc",
        },
        FAKE_TOOL_CTX,
      ),
    ).rejects.toThrow(/outside the workspace root/);
  });

  it("resolveContainedCwd accepts a path inside the workspace root", () => {
    const cwd = resolveContainedCwd(REPO_ROOT, "agents");
    expect(cwd).toBe(join(REPO_ROOT, "agents"));
  });

  it("resolveContainedCwd rejects an absolute path outside the workspace root", () => {
    expect(() => resolveContainedCwd(REPO_ROOT, "/etc/passwd")).toThrow(/outside the workspace root/);
  });

  it("resolveContainedCwd rejects a relative escape", () => {
    expect(() => resolveContainedCwd(REPO_ROOT, "../../etc")).toThrow(/outside the workspace root/);
  });

  it("resolveContainedCwd defaults to the workspace root when omitted", () => {
    expect(resolveContainedCwd(REPO_ROOT, undefined)).toBe(REPO_ROOT);
  });
});

describe("handoff-store path-traversal guard", () => {
  const conversationId = "handoff-guard-test-conv";
  const HANDOFF_CTX = { conversationId } as AgentToolContext;

  afterEach(() => {
    rmSync(join(HANDOFFS_DIR, conversationId), { recursive: true, force: true });
  });

  it("rejects a relative path containing '..' segments", () => {
    expect(() => validateHandoffRelativePath("../outside.md")).toThrow(/must not contain/);
    expect(() => resolveHandoffPath(HANDOFF_CTX, "notes/../../outside.md")).toThrow();
  });

  it("rejects an absolute path", () => {
    expect(() => validateHandoffRelativePath("/etc/passwd")).toThrow(/must be relative/);
    expect(() => resolveHandoffPath(HANDOFF_CTX, "/etc/passwd")).toThrow();
  });

  it("rejects a path with disallowed characters", () => {
    expect(() => validateHandoffRelativePath("notes; rm -rf $HOME.md")).toThrow(
      /letters, numbers/,
    );
    expect(() => resolveHandoffPath(HANDOFF_CTX, "notes with spaces!.md")).toThrow(
      /letters, numbers/,
    );
  });

  it("accepts a valid relative path and resolves it under the handoff-store root", () => {
    const relativePath = "research/notes.md";
    expect(validateHandoffRelativePath(relativePath)).toBe(relativePath);

    const resolved = resolveHandoffPath(HANDOFF_CTX, relativePath);
    expect(resolved).toBe(join(HANDOFFS_DIR, conversationId, relativePath));
  });
});
