import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { newestMtimeMs, reportCurrent } from './lib/completion-report.mjs';
import { evaluateWriteup } from './lib/completion-writeup.mjs';
import { evaluatePerformanceSmoke } from './lib/performance-smoke.mjs';
import { tasks } from '../experiments/github/tasks/index.ts';

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const root = process.cwd();
const runName = argValue('--run');
const expectedTrialsRaw = argValue('--trials') ?? '5';
const expectedTrials = Number(expectedTrialsRaw);
const arms = ['baseline', 'local-stdio', 'remote-http'];

if (!Number.isInteger(expectedTrials) || expectedTrials <= 0) {
  console.error('--trials must be a positive integer');
  process.exit(2);
}

function tasksForArm(arm) {
  return tasks.filter((task) => !task.applicableArms || task.applicableArms.includes(arm));
}

function expectedReportRows(trials) {
  const rows = [];
  for (const arm of arms) {
    for (const task of tasksForArm(arm)) {
      rows.push(`| ${task.id} | ${task.tier} | ${arm} | ${trials} |`);
    }
  }
  return rows;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code, signal) => {
      resolve({ code: code ?? (signal ? 1 : 0), stdout, stderr });
    });
    child.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

function briefOutput(result, fallback) {
  const text = `${result.stderr || ''}\n${result.stdout || ''}`.trim();
  if (!text) return fallback;
  const lines = text.split(/\r?\n/);
  if (lines.length <= 30 && text.length <= 4000) return text;
  return `${lines.slice(0, 30).join('\n')}\n... truncated; rerun the evidence command for full output ...`;
}

const checks = [];

function add(name, pass, evidence, blocker = null) {
  checks.push({
    name,
    pass: Boolean(pass),
    evidence,
    ...(pass ? {} : { blocker }),
  });
}

const phase1Path = join(root, 'artifacts', 'spike', 'phase1-status.json');
let phase1Pass = false;
try {
  phase1Pass = (await readJson(phase1Path)).pass === true;
} catch {
  phase1Pass = false;
}
add('Phase 1 gates pass', phase1Pass, phase1Path, 'Run npm run phase1:status -- --strict after regenerating spike artifacts.');

const overlapPath = join(root, 'artifacts', 'spike', 'tools-list', 'overlap.json');
let overlapOk = false;
try {
  const overlap = await readJson(overlapPath);
  overlapOk = overlap.overlapCount === 41 && Array.isArray(overlap.overlap);
} catch {
  overlapOk = false;
}
add('GitHub tool overlap is computed', overlapOk, overlapPath, 'Run local/remote tools/list probes and npm run probe:tools -- --compare.');

const staticCheck = await run('npm', ['run', 'check:static']);
add('Static preflight passes', staticCheck.code === 0, 'npm run check:static', staticCheck.stderr || staticCheck.stdout || 'Static preflight failed.');

const claudeAuthCheck = await run('npm', ['run', 'check:claude-auth']);
const claudeAuthOk = claudeAuthCheck.code === 0;
add(
  'Claude Code CLI auth passes',
  claudeAuthOk,
  'npm run check:claude-auth',
  briefOutput(claudeAuthCheck, 'Claude Code CLI auth check failed.'),
);

const verifyArmsPath = join(root, 'artifacts', 'verify-arms', 'github.json');
let verifyArmsOk = false;
let verifyArmsFresh = false;
try {
  const verifyArms = await readJson(verifyArmsPath);
  // Freshness uses the artifact file's mtime, not its self-reported
  // `generatedAt` field, so a hand-edited timestamp can't pass the gate.
  const verifyArmsMtimeMs = await newestMtimeMs(verifyArmsPath);
  const newestVerifyArmsDependency = Math.max(
    await newestMtimeMs(join(root, 'harness', 'src', 'cli.ts')),
    await newestMtimeMs(join(root, 'harness', 'src', 'runner.ts')),
    await newestMtimeMs(join(root, 'harness', 'src', 'experiments', 'github.ts')),
    await newestMtimeMs(join(root, '.mcp.github.local.json')),
    await newestMtimeMs(join(root, '.mcp.github.remote.json')),
    await newestMtimeMs(overlapPath),
  );
  verifyArmsFresh = verifyArmsMtimeMs > 0
    && verifyArmsMtimeMs + 1000 >= newestVerifyArmsDependency;
  verifyArmsOk = claudeAuthOk
    && verifyArmsFresh
    && verifyArms.pass === true
    && Array.isArray(verifyArms.arms)
    && verifyArms.arms.length === 3
    && verifyArms.arms.every((arm) => arm.pass === true);
} catch {
  verifyArmsOk = false;
}
add(
  'Live verify-arms artifact passes',
  verifyArmsOk,
  verifyArmsPath,
  claudeAuthOk
    ? (verifyArmsFresh
        ? 'Run npm run harness -- verify-arms --experiment github --output artifacts/verify-arms/github.json after Claude Code CLI login.'
        : 'Rerun npm run harness -- verify-arms --experiment github --output artifacts/verify-arms/github.json; the stored verifier artifact predates current arm or MCP configuration sources.')
    : 'Current Claude Code CLI auth is failing; rerun verify-arms after login so the artifact reflects live arm isolation.',
);

const performanceSmoke = await evaluatePerformanceSmoke({ root, runName: 'latency-smoke' });
add(
  'Phase 2 performance smoke passes',
  performanceSmoke.pass,
  performanceSmoke.evidence,
  performanceSmoke.blocker,
);

if (!runName) {
  add('Final run name provided', false, '--run <final-run>', 'Run npm run check:completion -- --run <final-run> after collecting full N=5.');
} else {
  const runRoot = join(root, 'experiments', 'github', 'runs', runName);
  const reportPath = join(root, 'experiments', 'github', 'runs', runName, 'report.md');
  const report = await reportCurrent({
    root,
    reportPath,
    runRoot,
    experiment: 'github',
    runName,
    expectedReportRows: expectedReportRows(expectedTrials),
  });
  add('Final report exists and is current', report.pass, reportPath, report.blocker);

  const runCheck = await run('npm', ['run', 'check:run', '--', '--run', runName, '--trials', String(expectedTrials)]);
  add('Final run matrix passes', runCheck.code === 0, `npm run check:run -- --run ${runName} --trials ${expectedTrials}`, briefOutput(runCheck, 'Final run matrix check failed.'));

  if (await exists(runRoot)) {
    const runSecretScan = await run('npm', ['run', 'scan:secrets', '--', '--path', `experiments/github/runs/${runName}`]);
    add('Final run artifacts have no token-shaped secrets', runSecretScan.code === 0, `npm run scan:secrets -- --path experiments/github/runs/${runName}`, briefOutput(runSecretScan, 'Run artifact secret scan failed.'));
  } else {
    add(
      'Final run artifacts have no token-shaped secrets',
      false,
      `experiments/github/runs/${runName}`,
      'Collect the final run before scanning run artifacts for token-shaped secrets.',
    );
  }
}

for (const [name, kind, path] of [
  ['Visual brief is filled', 'visual', join(root, 'docs', 'writeup', 'visual-brief.md')],
  ['Long-form writeup is filled', 'long-form', join(root, 'docs', 'writeup', 'long-form.md')],
]) {
  const reportEvidencePath = runName ? `experiments/github/runs/${runName}/report.md` : null;
  const reportPath = runName ? join(root, reportEvidencePath) : null;
  const result = await evaluateWriteup({ kind, path, runName, reportPath, reportEvidencePath });
  add(name, result.pass, path, result.blocker);
}

const summary = {
  runName: runName ?? null,
  complete: checks.every((check) => check.pass),
  checks,
};

console.log(JSON.stringify(summary, null, 2));
if (!summary.complete) process.exit(1);
console.log('PASS completion audit');
