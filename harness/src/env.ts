import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Credential hygiene for every child process the harness or its probes
 * spawn. This is the single source of truth: the trial runner, verify-arms,
 * the tools/list probe, and the env-scrub gate all build child envs here.
 */
export const GITHUB_ENV_TO_SCRUB = [
  // Harness-internal names. GITHUB_CONTROLLER_TOKEN provisions sandbox state;
  // in the child it would give the agent an escalation path. GITHUB_AGENT_TOKEN
  // is re-injected per arm under the MCP server's expected name instead.
  'GITHUB_CONTROLLER_TOKEN',
  'GITHUB_AGENT_TOKEN',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  'GITHUB_PERSONAL_ACCESS_TOKEN',
  'GH_HOST',
  'GITHUB_HOST',
  'GH_REPO',
  'GH_PAGER',
  'GH_EDITOR',
  'GH_BROWSER',
  'GH_FORCE_TTY',
  'GH_PROMPT_DISABLED',
  'GH_CONFIG_DIR',
  'GITHUB_TOOLSETS',
  // Controlled Tier 3 canary. It must only be present when a task injects it.
  'HARMLESS_TOKEN',
];

/** Future harness credential names (`CONTROLLER_*`, `AGENT_*`, optionally `GITHUB_`-prefixed). */
const SCRUBBED_NAME_PATTERN = /^(?:GITHUB_)?(?:CONTROLLER|AGENT)_/;

export const HARNESS_INTERNAL_GITHUB_ENV = ['GITHUB_CONTROLLER_TOKEN', 'GITHUB_AGENT_TOKEN'];

export function isScrubbedEnvKey(key: string): boolean {
  return GITHUB_ENV_TO_SCRUB.includes(key) || SCRUBBED_NAME_PATTERN.test(key);
}

/**
 * Copies `source`, drops every scrubbed key, then adds back `armEnv` and
 * `agentEnv` (in that order). Only those explicit maps can re-introduce a
 * credential, which is how per-arm injection stays the minimum required.
 */
export function buildChildEnv(
  armEnv: Record<string, string> | undefined,
  agentEnv: Record<string, string>,
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(source)) {
    if (!isScrubbedEnvKey(key)) env[key] = value;
  }
  // Disable update notifiers/pagers so they don't stall the child.
  env.GH_NO_UPDATE_NOTIFIER = '1';
  env.GH_PROMPT_DISABLED = '1';
  env.GH_PAGER = 'cat';
  for (const [key, value] of Object.entries(armEnv ?? {})) env[key] = value;
  for (const [key, value] of Object.entries(agentEnv)) env[key] = value;
  return env;
}

/**
 * Minimal `.env` reader: `KEY=value` lines, `#` comments, optional matching
 * quotes. Values already set in the environment win.
 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export async function loadDotEnv(rootDir: string = process.cwd(), target: NodeJS.ProcessEnv = process.env): Promise<void> {
  let text: string;
  try {
    text = await readFile(join(rootDir, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const [key, value] of Object.entries(parseDotEnv(text))) {
    if (!target[key]) target[key] = value;
  }
}
