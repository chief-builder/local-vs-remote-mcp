import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const GITHUB_ENV_TO_SCRUB = [
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
  'HARMLESS_TOKEN',
];

export const HARNESS_INTERNAL_GITHUB_ENV = [
  'GITHUB_CONTROLLER_TOKEN',
  'GITHUB_AGENT_TOKEN',
];

export const AGENT_VISIBLE_GITHUB_ENV = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GITHUB_PERSONAL_ACCESS_TOKEN',
];

export async function loadDotEnv(cwd = process.cwd()) {
  let text = '';
  try {
    text = await readFile(join(cwd, '.env'), 'utf8');
  } catch {
    return;
  }
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
    if (!process.env[key]) process.env[key] = value;
  }
}

export function buildScrubbedBaseEnv(source = process.env) {
  const env = { ...source };
  for (const key of GITHUB_ENV_TO_SCRUB) delete env[key];
  env.GH_NO_UPDATE_NOTIFIER = '1';
  env.GH_PROMPT_DISABLED = '1';
  env.GH_PAGER = 'cat';
  return env;
}

export function buildLocalStdioProbeEnv(source = process.env) {
  const env = buildScrubbedBaseEnv(source);
  const token = source.GITHUB_PERSONAL_ACCESS_TOKEN || source.GITHUB_AGENT_TOKEN;
  if (token) env.GITHUB_PERSONAL_ACCESS_TOKEN = token;
  env.GITHUB_TOOLSETS = source.GITHUB_TOOLSETS || 'all';
  if (source.GITHUB_HOST) env.GITHUB_HOST = source.GITHUB_HOST;
  return env;
}

export async function readGhKeychainToken() {
  const result = await execFileAsync('gh', ['auth', 'token'], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024,
  });
  return result.stdout.trim();
}

export async function resolveGitHubToken({ source = process.env, authSource = 'auto' } = {}) {
  const envToken = source.GITHUB_PERSONAL_ACCESS_TOKEN || source.GITHUB_AGENT_TOKEN;
  if (authSource === 'env') return envToken || null;
  if (authSource === 'gh') return await readGhKeychainToken();
  if (envToken) return envToken;
  try {
    return await readGhKeychainToken();
  } catch {
    return null;
  }
}

export async function buildLocalStdioProbeEnvWithToken({ source = process.env, authSource = 'auto' } = {}) {
  const env = buildScrubbedBaseEnv(source);
  const token = await resolveGitHubToken({ source, authSource });
  if (token) env.GITHUB_PERSONAL_ACCESS_TOKEN = token;
  env.GITHUB_TOOLSETS = source.GITHUB_TOOLSETS || 'all';
  if (source.GITHUB_HOST) env.GITHUB_HOST = source.GITHUB_HOST;
  return env;
}

export function redactGithubEnvLine(line) {
  return line.replace(/=.*/, '=***REDACTED***');
}

export function githubEnvLines(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => /github|^gh_/i.test(line))
    .map(redactGithubEnvLine)
    .sort();
}
