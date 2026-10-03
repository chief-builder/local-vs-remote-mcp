import { spawn } from 'node:child_process';
import { tasks } from '../experiments/github/tasks/index.ts';

const runName = `plan-check-${process.pid}`;
const trials = 5;
const arms = ['baseline', 'local-stdio', 'remote-http'];

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code, signal) => {
      resolve({ code: code ?? (signal ? 1 : 0), stdout, stderr });
    });
    child.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: err.message });
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function tasksForArm(arm) {
  return tasks.filter((task) => !task.applicableArms || task.applicableArms.includes(arm));
}

function expectedTierCommands() {
  const commands = [];
  for (const arm of arms) {
    const tiers = [...new Set(tasksForArm(arm).map((task) => task.tier))].sort((a, b) => a - b);
    for (const tier of tiers) {
      commands.push(`npm run harness -- run --experiment github --run ${runName} --arm ${arm} --tier ${tier} --trials ${trials}`);
    }
  }
  return commands;
}

const result = await run(process.execPath, [
  '--import',
  'tsx',
  'scripts/run-final.mjs',
  '--run',
  runName,
  '--trials',
  String(trials),
  '--dry-run',
]);

assert(result.code === 0, `run-final dry-run failed:\n${result.stderr}\n${result.stdout}`);
const lines = result.stdout.split(/\r?\n/).filter((line) => line.startsWith('npm run '));

const expectedPrefix = [
  'npm run check:static',
  'npm run check:claude-auth',
  'npm run harness -- verify-arms --experiment github --output artifacts/verify-arms/github.json',
  'npm run harness -- run --experiment github --run latency-smoke --arm local-stdio --task tier1_pr_diff_answer --trials 1',
  'npm run harness -- run --experiment github --run latency-smoke --arm remote-http --task tier1_pr_diff_answer --trials 1',
  'npm run harness -- report --experiment github --run latency-smoke --all-tiers --crossover-analysis --include-cost --output experiments/github/runs/latency-smoke/report.md',
];
const expectedSuffix = [
  `npm run harness -- report --experiment github --run ${runName} --all-tiers --crossover-analysis --include-cost --output experiments/github/runs/${runName}/report.md`,
  `npm run check:run -- --run ${runName} --trials ${trials}`,
  `npm run scan:secrets -- --path experiments/github/runs/${runName}`,
  `npm run check:completion -- --run ${runName} --trials ${trials}`,
];
const expected = [...expectedPrefix, ...expectedTierCommands(), ...expectedSuffix];

assert(
  lines.join('\n') === expected.join('\n'),
  `run-final dry-run command sequence drifted\nexpected:\n${expected.join('\n')}\nactual:\n${lines.join('\n')}`,
);

console.log('run-final full-plan regression passed.');
