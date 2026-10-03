import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { buildChildEnv } from '../harness/src/env.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function existsFile(path) {
  try {
    const st = await stat(path);
    return st.isFile();
  } catch {
    return false;
  }
}

async function existsDir(path) {
  try {
    const st = await stat(path);
    return st.isDirectory();
  } catch {
    return false;
  }
}

async function findDirsNamed(root, name, out = []) {
  let entries = [];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(root, entry.name);
    if (entry.name === name) out.push(path);
    await findDirsNamed(path, name, out);
  }
  return out;
}

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
assert(packageJson.scripts?.harness === 'node --import tsx harness/src/cli.ts', 'package harness script must use shared harness/src/cli.ts');
assert(packageJson.scripts?.['scan:secrets'] === 'node --import tsx scripts/secret-scan.mjs', 'package scan:secrets script must exist');
assert(packageJson.scripts?.['hooks:install'] === 'node --import tsx scripts/install-pre-push-hook.mjs', 'package hooks:install script must exist');

for (const path of [
  'harness/src/cli.ts',
  'harness/src/experiment.ts',
  'harness/src/experiments/index.ts',
  'harness/src/experiments/github.ts',
  'harness/src/metrics.ts',
  'harness/src/report.ts',
  'harness/src/runner.ts',
  'harness/src/tasks.ts',
  'harness/src/trialState.ts',
  'experiments/github/tasks/index.ts',
  'experiments/github/tasks/tier1.ts',
  'experiments/github/tasks/tier2.ts',
  'experiments/github/tasks/tier3.ts',
]) {
  assert(await existsFile(path), `missing required shared harness/task file ${path}`);
}

const experimentHarnessDirs = (await findDirsNamed('experiments', 'harness'))
  .filter((path) => path !== join('experiments', 'github', 'runs'));
assert(experimentHarnessDirs.length === 0, `experiments must not contain forked harness directories: ${experimentHarnessDirs.join(', ')}`);
assert(!await existsDir('experiments/github/harness'), 'GitHub experiment must not fork harness under experiments/github/harness');

const experimentSource = await readFile('harness/src/experiment.ts', 'utf8');
assert(experimentSource.includes('export interface ExperimentSpec'), 'shared harness must expose ExperimentSpec');
assert(experimentSource.includes('tasksPath'), 'ExperimentSpec must load experiment task definitions by tasksPath');

const registrySource = await readFile('harness/src/experiments/index.ts', 'utf8');
assert(/github:\s*githubExperiment/.test(registrySource), 'experiment registry must include githubExperiment');

const githubExperimentSource = await readFile('harness/src/experiments/github.ts', 'utf8');
assert(githubExperimentSource.includes("tasksPath: 'experiments/github/tasks/index.js'"), 'GitHub experiment must point at experiments/github/tasks/index.js');
assert(githubExperimentSource.includes("intendedMcpPrefix: 'mcp__github__'"), 'GitHub classifier must use mcp__github__ prefix');
assert(githubExperimentSource.includes('OVERLAP_TOOLS'), 'GitHub arms must derive allowed tools from overlap catalog');
assert(githubExperimentSource.includes('NON_OVERLAP_TOOLS'), 'GitHub arms must disallow non-overlap tools');

const trialStateSource = await readFile('harness/src/trialState.ts', 'utf8');
assert(trialStateSource.includes('export function mkPairedSeed'), 'trialState must export mkPairedSeed');
assert(trialStateSource.includes('experiment') && trialStateSource.includes('runName') && trialStateSource.includes('taskId') && trialStateSource.includes('trialN'), 'mkPairedSeed must key seeds by experiment/run/task/trial');

const runnerSource = await readFile('harness/src/runner.ts', 'utf8');
assert(runnerSource.includes("import { mkPairedSeed } from './trialState.js'"), 'runner must import mkPairedSeed from shared trialState');
assert(/mkPairedSeed\(experiment\.name,\s*runName,\s*task\.id,\s*trialN\)/.test(runnerSource), 'runner must use paired seed for every arm/task/trial');
assert(runnerSource.includes('buildChildEnv'), 'runner must centralize child env scrubbing');
const scrubbed = buildChildEnv(undefined, {}, { GITHUB_CONTROLLER_TOKEN: 'x', GITHUB_AGENT_TOKEN: 'x' });
assert(!('GITHUB_CONTROLLER_TOKEN' in scrubbed) && !('GITHUB_AGENT_TOKEN' in scrubbed), 'child env scrub must remove harness-internal GitHub tokens');
assert(runnerSource.includes('parseTranscript(transcriptLines, arm, experiment.classifier)'), 'runner must feed transcript through shared validity/metric parser');

const metricsSource = await readFile('harness/src/metrics.ts', 'utf8');
for (const required of [
  'validToolSurface',
  'escapeToolUsed',
  'escapeToolCalls',
  'secretInOutput',
  'perToolCallLatencyMs',
  'coldStartMs',
  'transportFailures',
  'promptInjectionCompliance',
  'countTransportFailures',
  'parseTranscript',
]) {
  assert(metricsSource.includes(required), `metrics parser must include ${required}`);
}
assert(metricsSource.includes('hasTokenShapedSecret'), 'metrics parser must scan assistant output for token-shaped strings');
assert(metricsSource.includes('classifyToolUse'), 'metrics parser must classify valid tool surface');

const hookSource = await readFile('.githooks/pre-push', 'utf8');
assert(hookSource.includes('npm run scan:secrets'), 'tracked pre-push hook must run npm run scan:secrets');

const gitignore = await readFile('.gitignore', 'utf8');
assert(/(^|\n)\.env(\n|$)/.test(gitignore), '.gitignore must ignore .env');
assert(gitignore.includes('experiments/**/runs/'), '.gitignore must ignore raw run artifacts by default');

console.log('Harness shape check passed.');
