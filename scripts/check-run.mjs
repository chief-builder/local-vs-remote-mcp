import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tasks } from '../experiments/github/tasks/index.ts';
import { githubExperiment } from '../harness/src/experiments/github.ts';
import { validateResultArtifact } from './lib/result-invariants.mjs';
import { scanTreeForTokenFindings, transcriptStatus } from './lib/run-artifacts.mjs';

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const runName = argValue('--run');
const expectedTrials = Number(argValue('--trials') ?? 5);

if (!runName) {
  console.error('Usage: npm run check:run -- --run <name> [--trials 5]');
  process.exit(2);
}
if (!Number.isInteger(expectedTrials) || expectedTrials <= 0) {
  console.error('--trials must be a positive integer');
  process.exit(2);
}

const root = process.cwd();
const runRoot = join(root, 'experiments', 'github', 'runs', runName);
const resultRoot = join(runRoot, 'results');
const transcriptRoot = join(runRoot, 'transcripts');

const arms = ['baseline', 'local-stdio', 'remote-http'];

function expectedTasksForArm(arm) {
  return tasks.filter((task) => !task.applicableArms || task.applicableArms.includes(arm));
}

async function readResult(arm, taskId, n) {
  const path = join(resultRoot, arm, taskId, `${n}.json`);
  try {
    return {
      path,
      result: JSON.parse(await readFile(path, 'utf8')),
    };
  } catch {
    return { path, result: null };
  }
}

function isExpectedTrialFile(entry, ext) {
  if (!entry.endsWith(ext)) return false;
  const trial = Number(entry.slice(0, -ext.length));
  return Number.isInteger(trial) && trial >= 1 && trial <= expectedTrials;
}

function isExpectedTrialDirectory(entry) {
  const trial = Number(entry);
  return Number.isInteger(trial) && String(trial) === entry && trial >= 1 && trial <= expectedTrials;
}

async function findUnexpectedMatrixEntries(rootDir, ext, label, { allowTrialDirs = false } = {}) {
  const unexpected = [];
  const expectedArms = new Set(arms);
  let armDirs = [];
  try {
    armDirs = await readdir(rootDir);
  } catch {
    return unexpected;
  }
  for (const arm of armDirs) {
    const armDir = join(rootDir, arm);
    let armStat;
    try {
      armStat = await lstat(armDir);
    } catch {
      continue;
    }
    if (!armStat.isDirectory()) {
      unexpected.push(`unexpected ${label} arm entry: ${arm}`);
      continue;
    }
    if (!expectedArms.has(arm)) {
      unexpected.push(`unexpected ${label} arm directory: ${arm}`);
      continue;
    }

    let taskDirs = [];
    try {
      taskDirs = await readdir(armDir);
    } catch {
      continue;
    }
    const expected = new Set(expectedTasksForArm(arm).map((task) => task.id));
    for (const taskId of taskDirs) {
      const taskDir = join(armDir, taskId);
      let taskStat;
      try {
        taskStat = await lstat(taskDir);
      } catch {
        continue;
      }
      if (!taskStat.isDirectory()) {
        unexpected.push(`unexpected ${label} task entry: ${arm}/${taskId}`);
        continue;
      }
      if (!expected.has(taskId)) {
        unexpected.push(`unexpected ${label} task directory: ${arm}/${taskId}`);
        continue;
      }
      const entries = await readdir(taskDir);
      for (const entry of entries) {
        const entryPath = join(taskDir, entry);
        let entryStat;
        try {
          entryStat = await lstat(entryPath);
        } catch {
          continue;
        }
        if (entryStat.isFile()) {
          if (entry.endsWith(ext)) {
            if (!isExpectedTrialFile(entry, ext)) {
              unexpected.push(`unexpected ${label} trial file: ${arm}/${taskId}/${entry}`);
            }
          } else {
            unexpected.push(`unexpected ${label} task file: ${arm}/${taskId}/${entry}`);
          }
          continue;
        }
        if (entryStat.isDirectory()) {
          if (allowTrialDirs && isExpectedTrialDirectory(entry)) continue;
          unexpected.push(`unexpected ${label} task directory: ${arm}/${taskId}/${entry}`);
          continue;
        }
        unexpected.push(`unexpected ${label} task entry: ${arm}/${taskId}/${entry}`);
      }
    }
  }
  return unexpected;
}

async function scanRunForSecrets() {
  return scanTreeForTokenFindings(runRoot, { baseDir: root });
}

const failures = [];
let checked = 0;
let checkedTranscripts = 0;
let passing = 0;
let validSurface = 0;
let secretOutputs = 0;
let transportFailures = 0;
let promptInjectionTrials = 0;
let promptInjectionCompliances = 0;

for (const arm of arms) {
  for (const task of expectedTasksForArm(arm)) {
    const taskId = task.id;
    for (let n = 1; n <= expectedTrials; n++) {
      const { path, result } = await readResult(arm, taskId, n);
      const transcript = await transcriptStatus(join(transcriptRoot, arm, taskId, `${n}.jsonl`));
      if (transcript.nonEmpty && transcript.validJsonl) {
        checkedTranscripts++;
      } else if (transcript.exists) {
        failures.push(transcript.nonEmpty ? `invalid transcript JSONL ${transcript.path}` : `empty transcript ${transcript.path}`);
      } else {
        failures.push(`missing transcript ${transcript.path}`);
      }
      if (!result) {
        failures.push(`missing or invalid ${path}`);
        continue;
      }
      checked++;
      failures.push(
        ...validateResultArtifact(result, {
          experiment: 'github',
          runName,
          arm,
          taskId,
          tier: task.tier,
          trialN: n,
          intendedMcpPrefix: githubExperiment.classifier.intendedMcpPrefix,
          path,
        }),
      );

      if (result.success?.pass) passing++;
      if (result.metrics?.validToolSurface) {
        validSurface++;
      }
      if (result.metrics?.secretInOutput) {
        secretOutputs++;
      }
      transportFailures += Number(result.metrics?.transportFailures ?? 0);

      const pi = result.metrics?.promptInjectionCompliance;
      if (taskId === 'tier3_tool_poisoning_resilience' && typeof pi === 'boolean') {
        promptInjectionTrials++;
        if (pi === true) promptInjectionCompliances++;
      }
    }
  }
}

const unexpectedResults = await findUnexpectedMatrixEntries(resultRoot, '.json', 'result', { allowTrialDirs: true });
const unexpectedTranscripts = await findUnexpectedMatrixEntries(transcriptRoot, '.jsonl', 'transcript');
for (const item of [...unexpectedResults, ...unexpectedTranscripts]) {
  failures.push(item);
}

const runSecretFindings = await scanRunForSecrets();
for (const finding of runSecretFindings) {
  failures.push(`token-shaped secret in run artifact: ${finding}`);
}

const expectedTotal = arms.reduce((sum, arm) => sum + expectedTasksForArm(arm).length, 0) * expectedTrials;
const summary = {
  runName,
  expectedTrials,
  expectedResultFiles: expectedTotal,
  checkedResultFiles: checked,
  expectedTranscriptFiles: expectedTotal,
  checkedTranscriptFiles: checkedTranscripts,
  successRate: checked ? passing / checked : 0,
  validSurfaceRate: checked ? validSurface / checked : 0,
  secretOutputs,
  runSecretFindings,
  transportFailures,
  promptInjectionTrials,
  promptInjectionComplianceRate: promptInjectionTrials ? promptInjectionCompliances / promptInjectionTrials : null,
  unexpectedResultEntries: unexpectedResults,
  unexpectedTranscriptEntries: unexpectedTranscripts,
  failures,
};

console.log(JSON.stringify(summary, null, 2));
if (failures.length > 0 || checked !== expectedTotal) {
  process.exit(1);
}
console.log('PASS run matrix is complete and basic invariants hold');
