import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AGENT_VISIBLE_GITHUB_ENV,
  HARNESS_INTERNAL_GITHUB_ENV,
  buildLocalStdioProbeEnv,
  githubEnvLines,
} from './lib/github-env.mjs';

function canarySourceEnv() {
  return {
    ...process.env,
    GITHUB_CONTROLLER_TOKEN: 'canary-controller-token',
    GITHUB_AGENT_TOKEN: 'canary-agent-token',
    GH_TOKEN: 'canary-gh-token',
    GITHUB_TOKEN: 'canary-github-token',
    GITHUB_PERSONAL_ACCESS_TOKEN: 'canary-personal-access-token',
    GITHUB_TOOLSETS: 'all',
    HARMLESS_TOKEN: 'canary-harmless-token',
  };
}

const childEnv = buildLocalStdioProbeEnv(canarySourceEnv());
const child = spawn('env', [], { env: childEnv, stdio: ['ignore', 'pipe', 'inherit'] });
let stdout = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdout += chunk; });

const code = await new Promise((resolve) => child.on('close', resolve));
if (code !== 0) process.exit(code ?? 1);

const githubLines = githubEnvLines(stdout);
const forbiddenKeys = [
  ...HARNESS_INTERNAL_GITHUB_ENV,
  'GH_TOKEN',
  'GITHUB_TOKEN',
];
const forbidden = githubLines.filter((line) => forbiddenKeys.some((key) => line.startsWith(`${key}=`)));
const expectedInjected = AGENT_VISIBLE_GITHUB_ENV
  .filter((key) => key === 'GITHUB_PERSONAL_ACCESS_TOKEN')
  .every((key) => githubLines.some((line) => line.startsWith(`${key}=`)));
const harmlessTokenSurvived = /\bHARMLESS_TOKEN=/.test(stdout);
const pass = forbidden.length === 0 && expectedInjected && !harmlessTokenSurvived;
const artifact = {
  generatedAt: new Date().toISOString(),
  probe: 'local-stdio-shaped child env',
  command: 'env',
  grepEquivalent: 'github|^gh_',
  pass,
  forbiddenKeys,
  forbiddenSurvivors: forbidden,
  canaryForbiddenKeys: ['HARMLESS_TOKEN'],
  canaryForbiddenSurvivors: harmlessTokenSurvived ? ['HARMLESS_TOKEN=***REDACTED***'] : [],
  expectedInjectedKeys: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
  redactedSurvivingGitHubLines: githubLines,
};

const outDir = join(process.cwd(), 'artifacts', 'spike', 'env-scrub');
await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'local-stdio-env.json'), `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');

console.log(githubLines.length ? githubLines.join('\n') : '(no github-related env survived)');

if (forbidden.length > 0) {
  console.error(`Env scrub probe failed: ${forbidden.length} forbidden key(s) survived.`);
  process.exit(1);
}

if (harmlessTokenSurvived) {
  console.error('Env scrub probe failed: inherited HARMLESS_TOKEN survived outside the task-specific canary trial.');
  process.exit(1);
}

if (!expectedInjected) {
  console.error('Env scrub probe failed: local-stdio agent credential was not re-injected as GITHUB_PERSONAL_ACCESS_TOKEN.');
  process.exit(1);
}

console.log('Env scrub probe passed for local-stdio child env: harness-internal names removed, arm credential re-injected only under GITHUB_PERSONAL_ACCESS_TOKEN.');
