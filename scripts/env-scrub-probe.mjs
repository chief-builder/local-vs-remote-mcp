import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildChildEnv, HARNESS_INTERNAL_GITHUB_ENV } from '../harness/src/env.ts';
import { githubExperiment } from '../harness/src/experiments/github.ts';
import { githubEnvLines } from './lib/github-env.mjs';

// Gate 3: run `env` in a child built exactly like a local-stdio trial child
// (runner.ts: buildChildEnv(arm.extraEnv, experiment.buildAgentEnv(arm))),
// with canaries planted in the parent for every name that must not survive.
const CANARIES = {
  GITHUB_CONTROLLER_TOKEN: 'canary-controller-token',
  GITHUB_AGENT_TOKEN: 'canary-agent-token',
  GH_TOKEN: 'canary-gh-token',
  GITHUB_TOKEN: 'canary-github-token',
  GITHUB_PERSONAL_ACCESS_TOKEN: 'canary-personal-access-token',
  CONTROLLER_FUTURE_TOKEN: 'canary-future-controller-token',
  AGENT_FUTURE_TOKEN: 'canary-future-agent-token',
  GITHUB_TOOLSETS: 'all',
  HARMLESS_TOKEN: 'canary-harmless-token',
};
Object.assign(process.env, CANARIES);

const arm = githubExperiment.arms['local-stdio'];
const agentEnv = githubExperiment.buildAgentEnv ? githubExperiment.buildAgentEnv('local-stdio') : {};
const childEnv = buildChildEnv(arm.extraEnv, agentEnv);

const child = spawn('env', [], { env: childEnv, stdio: ['ignore', 'pipe', 'inherit'] });
let stdout = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => { stdout += chunk; });

const code = await new Promise((resolve) => child.on('close', resolve));
if (code !== 0) process.exit(code ?? 1);

const survivingKeys = new Set(stdout.split(/\r?\n/).map((line) => line.slice(0, line.indexOf('='))).filter(Boolean));
const forbiddenKeys = [
  ...HARNESS_INTERNAL_GITHUB_ENV,
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'CONTROLLER_FUTURE_TOKEN',
  'AGENT_FUTURE_TOKEN',
];
const forbidden = forbiddenKeys.filter((key) => survivingKeys.has(key));
const harmlessTokenSurvived = survivingKeys.has('HARMLESS_TOKEN');
// The arm credential must be re-injected, and it must be the agent token
// (via buildAgentEnv), not an inherited GITHUB_PERSONAL_ACCESS_TOKEN.
const injectedValue = childEnv.GITHUB_PERSONAL_ACCESS_TOKEN;
const expectedInjected = injectedValue === CANARIES.GITHUB_AGENT_TOKEN;
const githubLines = githubEnvLines(stdout);
const pass = forbidden.length === 0 && expectedInjected && !harmlessTokenSurvived;
const artifact = {
  generatedAt: new Date().toISOString(),
  probe: 'local-stdio trial child env (harness/src/env.ts buildChildEnv + github buildAgentEnv)',
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
  console.error(`Env scrub probe failed: forbidden key(s) survived: ${forbidden.join(', ')}.`);
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

console.log('Env scrub probe passed for the local-stdio trial child env: harness-internal and CONTROLLER_*/AGENT_* names removed, arm credential re-injected only under GITHUB_PERSONAL_ACCESS_TOKEN.');
