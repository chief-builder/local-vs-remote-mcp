import { readFileSync } from 'node:fs';
import type { ExperimentSpec, ExperimentClassifier, ArmConfig, Arm } from '../experiment.js';

const ALWAYS_BLOCKED = ['WebFetch', 'WebSearch', 'Monitor', 'CronCreate', 'RemoteTrigger'];
const COMMON_FLAGS = ['--setting-sources', 'project,local', '--permission-mode', 'bypassPermissions'];

interface CatalogDiff {
  overlap?: string[];
  localOnly?: string[];
  remoteOnly?: string[];
}

function readCatalogDiff(): Required<CatalogDiff> {
  const raw = readFileSync('artifacts/spike/tools-list/overlap.json', 'utf8');
  const parsed = JSON.parse(raw) as CatalogDiff;
  if (!Array.isArray(parsed.overlap) || parsed.overlap.length === 0) {
    throw new Error('artifacts/spike/tools-list/overlap.json is missing a non-empty overlap array');
  }
  return {
    overlap: parsed.overlap,
    localOnly: Array.isArray(parsed.localOnly) ? parsed.localOnly : [],
    remoteOnly: Array.isArray(parsed.remoteOnly) ? parsed.remoteOnly : [],
  };
}

const CATALOG_DIFF = readCatalogDiff();
const OVERLAP_TOOLS = CATALOG_DIFF.overlap.map((name) => `mcp__github__${name}`);
const NON_OVERLAP_TOOLS = [...CATALOG_DIFF.localOnly, ...CATALOG_DIFF.remoteOnly]
  .map((name) => `mcp__github__${name}`);

const githubClassifier: ExperimentClassifier = {
  intendedMcpPrefix: 'mcp__github__',
};

function buildArms(): Record<Arm, ArmConfig> {
  const mcpAllowedTools = ['ToolSearch', 'Write', 'TodoWrite', ...OVERLAP_TOOLS];
  const mcpDisallowedTools = ['Skill', 'Bash', 'Task', 'Agent', ...ALWAYS_BLOCKED, ...NON_OVERLAP_TOOLS];

  return {
    baseline: {
      id: 'baseline',
      description: 'No GitHub execution surface: pure reasoning floor against off-host state',
      mcpConfig: '{"mcpServers":{}}',
      allowedTools: ['ToolSearch', 'Read', 'Glob', 'Grep', 'Write', 'TodoWrite'],
      disallowedTools: ['Skill', 'Bash', 'Task', 'Agent', ...ALWAYS_BLOCKED, ...OVERLAP_TOOLS, ...NON_OVERLAP_TOOLS],
      extraFlags: [...COMMON_FLAGS],
      timeoutMs: 90_000,
    },
    'local-stdio': {
      id: 'local-stdio',
      description: 'GitHub MCP via digest-pinned Docker stdio; restricted to the local/remote overlap allow-list',
      mcpConfig: '.mcp.github.local.json',
      allowedTools: mcpAllowedTools,
      disallowedTools: mcpDisallowedTools,
      extraFlags: [...COMMON_FLAGS],
      extraEnv: { GITHUB_TOOLSETS: 'all' },
      timeoutMs: 240_000,
    },
    'remote-http': {
      id: 'remote-http',
      description: 'GitHub hosted MCP via streamable HTTP; restricted to the local/remote overlap allow-list',
      mcpConfig: '.mcp.github.remote.json',
      allowedTools: mcpAllowedTools,
      disallowedTools: mcpDisallowedTools,
      extraFlags: [...COMMON_FLAGS],
      timeoutMs: 240_000,
    },
  };
}

function buildGithubAgentEnv(arm: Arm): Record<string, string> {
  if (arm === 'baseline') return {};
  const agentToken = process.env.GITHUB_AGENT_TOKEN || process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '';
  const host = process.env.GITHUB_HOST ?? '';
  return {
    GITHUB_PERSONAL_ACCESS_TOKEN: agentToken,
    ...(host ? { GITHUB_HOST: host } : {}),
  };
}

export const githubExperiment: ExperimentSpec = {
  name: 'github',
  description: 'GitHub MCP transport comparison: local stdio vs remote streamable HTTP.',
  arms: buildArms(),
  classifier: githubClassifier,
  tasksPath: 'experiments/github/tasks/index.js',
  buildAgentEnv: buildGithubAgentEnv,
  preflight: async () => {
    const missing: string[] = [];
    if (!process.env.GITHUB_AGENT_TOKEN && !process.env.GITHUB_PERSONAL_ACCESS_TOKEN) {
      missing.push('GITHUB_AGENT_TOKEN or GITHUB_PERSONAL_ACCESS_TOKEN');
    }
    if (!process.env.GITHUB_CONTROLLER_TOKEN) missing.push('GITHUB_CONTROLLER_TOKEN');
    if (!process.env.GITHUB_SANDBOX_OWNER) missing.push('GITHUB_SANDBOX_OWNER');
    if (missing.length > 0) {
      throw new Error(
        `GitHub transport experiment requires env vars: ${missing.join(', ')}.\n` +
          'Tokens must be scoped to the sandbox owner only.',
      );
    }
  },
};
