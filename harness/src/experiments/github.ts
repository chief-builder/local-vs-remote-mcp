import { readFileSync } from 'node:fs';
import type { ExperimentSpec, ExperimentClassifier, ArmConfig, Arm } from '../experiment.js';
import {
  ALWAYS_BLOCKED_TOOLS,
  BASELINE_TIMEOUT_MS,
  COMMON_CLAUDE_FLAGS,
  EXECUTION_TOOLS,
  MCP_TIMEOUT_MS,
  readGithubEnv,
  TASK_TRACKING_TOOLS,
} from '../config.js';

interface CatalogDiff {
  overlap?: string[];
  localOnly?: string[];
  remoteOnly?: string[];
}

function readCatalogDiff(): Required<CatalogDiff> {
  const raw = readFileSync(new URL('../../../artifacts/spike/tools-list/overlap.json', import.meta.url), 'utf8');
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
const NON_OVERLAP_TOOLS = [...CATALOG_DIFF.localOnly, ...CATALOG_DIFF.remoteOnly].map((name) => `mcp__github__${name}`);

const githubClassifier: ExperimentClassifier = {
  intendedMcpPrefix: 'mcp__github__',
};

function buildArms(): Record<Arm, ArmConfig> {
  const mcpAllowedTools = ['ToolSearch', 'Write', ...TASK_TRACKING_TOOLS, ...OVERLAP_TOOLS];
  const mcpDisallowedTools = [...EXECUTION_TOOLS, ...ALWAYS_BLOCKED_TOOLS, ...NON_OVERLAP_TOOLS];

  return {
    baseline: {
      id: 'baseline',
      description: 'No GitHub execution surface: pure reasoning floor against off-host state',
      mcpConfig: '{"mcpServers":{}}',
      allowedTools: ['ToolSearch', 'Read', 'Glob', 'Grep', 'Write', ...TASK_TRACKING_TOOLS],
      disallowedTools: [...EXECUTION_TOOLS, ...ALWAYS_BLOCKED_TOOLS, ...OVERLAP_TOOLS, ...NON_OVERLAP_TOOLS],
      extraFlags: [...COMMON_CLAUDE_FLAGS],
      timeoutMs: BASELINE_TIMEOUT_MS,
    },
    'local-stdio': {
      id: 'local-stdio',
      description: 'GitHub MCP via digest-pinned Docker stdio; restricted to the local/remote overlap allow-list',
      mcpConfig: '.mcp.github.local.json',
      allowedTools: mcpAllowedTools,
      disallowedTools: mcpDisallowedTools,
      extraFlags: [...COMMON_CLAUDE_FLAGS],
      extraEnv: { GITHUB_TOOLSETS: 'all' },
      timeoutMs: MCP_TIMEOUT_MS,
    },
    'remote-http': {
      id: 'remote-http',
      description: 'GitHub hosted MCP via streamable HTTP; restricted to the local/remote overlap allow-list',
      mcpConfig: '.mcp.github.remote.json',
      allowedTools: mcpAllowedTools,
      disallowedTools: mcpDisallowedTools,
      extraFlags: [...COMMON_CLAUDE_FLAGS],
      timeoutMs: MCP_TIMEOUT_MS,
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
  // Validates tokens and sandbox owner before the first trial; throws with every problem listed.
  preflight: async () => {
    readGithubEnv();
  },
};
