import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { githubExperiment } from '../harness/src/experiments/github.ts';
import { buildChildEnv } from '../harness/src/env.ts';
import { tasks } from '../experiments/github/tasks/index.ts';

const root = process.cwd();
const overlapPath = join(root, 'artifacts', 'spike', 'tools-list', 'overlap.json');
const catalog = JSON.parse(await readFile(overlapPath, 'utf8'));
const localMcpConfig = JSON.parse(await readFile(join(root, '.mcp.github.local.json'), 'utf8'));

const overlap = (catalog.overlap ?? []).map((name) => `mcp__github__${name}`).sort();
const nonOverlap = [...(catalog.localOnly ?? []), ...(catalog.remoteOnly ?? [])]
  .map((name) => `mcp__github__${name}`)
  .sort();

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exitCode = 1;
}

function sorted(values) {
  return [...values].sort();
}

function setEq(actual, expected) {
  const a = sorted(actual);
  const e = sorted(expected);
  return a.length === e.length && a.every((value, index) => value === e[index]);
}

function githubTools(values = []) {
  return values.filter((name) => name.startsWith('mcp__github__'));
}

const arms = githubExperiment.arms;
const baselineAllowed = githubTools(arms.baseline.allowedTools ?? []);
if (baselineAllowed.length !== 0) {
  fail(`baseline allowed ${baselineAllowed.length} GitHub tool(s)`);
}

const baselineDisallowed = githubTools(arms.baseline.disallowedTools);
if (!setEq(baselineDisallowed, [...overlap, ...nonOverlap])) {
  fail('baseline disallowed tools do not cover the full probed GitHub catalog');
}

for (const arm of ['local-stdio', 'remote-http']) {
  const cfg = arms[arm];
  const allowed = githubTools(cfg.allowedTools ?? []);
  const disallowed = githubTools(cfg.disallowedTools);
  if (!setEq(allowed, overlap)) {
    fail(`${arm} allowed GitHub tools do not exactly equal the overlap allow-list`);
  }
  if (!setEq(disallowed, nonOverlap)) {
    fail(`${arm} disallowed GitHub tools do not exactly equal the non-overlap catalog`);
  }
}

const localDockerArgs = localMcpConfig?.mcpServers?.github?.args ?? [];
for (const expectedEnv of ['GITHUB_PERSONAL_ACCESS_TOKEN', 'GITHUB_TOOLSETS', 'GITHUB_HOST', 'HARMLESS_TOKEN']) {
  if (!Array.isArray(localDockerArgs) || !localDockerArgs.includes(expectedEnv)) {
    fail(`local stdio Docker MCP config does not pass ${expectedEnv} through explicitly`);
  }
}
if ('HARMLESS_TOKEN' in buildChildEnv(undefined, {}, { HARMLESS_TOKEN: 'inherited' })) {
  fail('runner does not scrub inherited HARMLESS_TOKEN before task-specific env injection');
}

if ((arms.baseline.timeoutMs ?? 240_000) !== 90_000) {
  fail('baseline timeout must be 90_000ms');
}
if ((arms['local-stdio'].timeoutMs ?? 240_000) !== 240_000) {
  fail('local-stdio timeout must be 240_000ms');
}
if ((arms['remote-http'].timeoutMs ?? 240_000) !== 240_000) {
  fail('remote-http timeout must be 240_000ms');
}

const taskIds = tasks.map((task) => task.id);
if (taskIds.includes('tier1_workflow_status')) {
  fail('default task export includes tier1_workflow_status, which is not overlap-compatible');
}

const summary = {
  baseline: {
    allowedGithub: baselineAllowed.length,
    disallowedGithub: baselineDisallowed.length,
    timeoutMs: arms.baseline.timeoutMs ?? 240_000,
  },
  'local-stdio': {
    allowedGithub: githubTools(arms['local-stdio'].allowedTools ?? []).length,
    disallowedGithub: githubTools(arms['local-stdio'].disallowedTools).length,
    timeoutMs: arms['local-stdio'].timeoutMs ?? 240_000,
  },
  'remote-http': {
    allowedGithub: githubTools(arms['remote-http'].allowedTools ?? []).length,
    disallowedGithub: githubTools(arms['remote-http'].disallowedTools).length,
    timeoutMs: arms['remote-http'].timeoutMs ?? 240_000,
  },
  defaultTaskCount: taskIds.length,
  excludedCoverageGapTask: 'tier1_workflow_status',
};

console.log(JSON.stringify(summary, null, 2));
if (!process.exitCode) console.log('PASS arm config matches overlap policy');
