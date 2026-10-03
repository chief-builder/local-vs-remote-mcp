import { buildChildEnv } from '../../harness/src/env.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export { GITHUB_ENV_TO_SCRUB, HARNESS_INTERNAL_GITHUB_ENV, loadDotEnv } from '../../harness/src/env.ts';

export const AGENT_VISIBLE_GITHUB_ENV = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GITHUB_PERSONAL_ACCESS_TOKEN',
];

/** Same scrub the trial runner applies, without any per-arm injection. */
export function buildScrubbedBaseEnv(source = process.env) {
  return buildChildEnv(undefined, {}, source);
}

function localStdioInjection(source, token) {
  return {
    GITHUB_TOOLSETS: source.GITHUB_TOOLSETS || 'all',
    ...(token ? { GITHUB_PERSONAL_ACCESS_TOKEN: token } : {}),
    ...(source.GITHUB_HOST ? { GITHUB_HOST: source.GITHUB_HOST } : {}),
  };
}

export function buildLocalStdioProbeEnv(source = process.env) {
  const token = source.GITHUB_PERSONAL_ACCESS_TOKEN || source.GITHUB_AGENT_TOKEN;
  return buildChildEnv(undefined, localStdioInjection(source, token), source);
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
  const token = await resolveGitHubToken({ source, authSource });
  return buildChildEnv(undefined, localStdioInjection(source, token), source);
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
