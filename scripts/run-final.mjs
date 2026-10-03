import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tasks } from '../experiments/github/tasks/index.ts';
import { githubExperiment } from '../harness/src/experiments/github.ts';
import { evaluatePerformanceSmoke } from './lib/performance-smoke.mjs';
import { isValidResultArtifact } from './lib/result-invariants.mjs';
import { artifactTreeSecretFree, validTranscriptFile } from './lib/run-artifacts.mjs';

const arms = ['baseline', 'local-stdio', 'remote-http'];
const defaultSmokeRunName = 'latency-smoke';
const smokeTaskId = 'tier1_pr_diff_answer';

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function usage() {
  console.log(
    [
      'Usage: npm run run:final -- --run <name> [--trials 5] [--dry-run] [--resume] [--skip-auth-check]',
      '',
      'Runs the final GitHub N=5 matrix from task metadata, then generates the report and audits.',
      '--dry-run prints commands only.',
      '--resume skips completed trials and runs only missing or invalid arm/task/trial cells.',
    ].join('\n'),
  );
}

function tasksForArm(arm) {
  return tasks.filter((task) => !task.applicableArms || task.applicableArms.includes(arm));
}

function matrix() {
  const cells = [];
  for (const arm of arms) {
    const byTier = new Map();
    for (const task of tasksForArm(arm)) {
      const tierTasks = byTier.get(task.tier) ?? [];
      tierTasks.push(task.id);
      byTier.set(task.tier, tierTasks);
    }
    for (const [tier, taskIds] of [...byTier.entries()].sort(([a], [b]) => a - b)) {
      cells.push({ arm, tier, taskIds });
    }
  }
  return cells;
}

function taskMatrix() {
  const cells = [];
  for (const arm of arms) {
    for (const task of tasksForArm(arm)) {
      cells.push({ arm, tier: task.tier, taskId: task.id });
    }
  }
  return cells;
}

function commandLine(command, args) {
  return [command, ...args]
    .map((part) => {
      if (/^[A-Za-z0-9_./:=@-]+$/.test(part)) return part;
      return JSON.stringify(part);
    })
    .join(' ');
}

function isClaudeAuthCheck(command, args) {
  return command === 'npm' && args[0] === 'run' && args[1] === 'check:claude-auth';
}

function printAuthRecovery({ runName, trials, resume }) {
  console.error('');
  console.error('Claude Code CLI auth is required before live trials can continue.');
  console.error('Run `claude auth login` in a terminal, or `/login` in Claude Code, then resume with:');
  console.error(
    commandLine('npm', ['run', 'run:final', '--', '--run', runName, '--trials', String(trials), ...(resume ? ['--resume'] : [])]),
  );
}

function run(command, args) {
  return new Promise((resolve) => {
    console.log(`\n$ ${commandLine(command, args)}`);
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
    });
    child.on('close', (code, signal) => {
      resolve(code ?? (signal ? 1 : 0));
    });
    child.on('error', (err) => {
      console.error(err.message);
      resolve(1);
    });
  });
}

async function validResultFile(path, { runName, arm, taskId, tier, trialN }) {
  try {
    const result = JSON.parse(await readFile(path, 'utf8'));
    return isValidResultArtifact(result, {
      experiment: 'github',
      runName,
      arm,
      taskId,
      tier,
      trialN,
      intendedMcpPrefix: githubExperiment.classifier.intendedMcpPrefix,
      path,
    });
  } catch {
    return false;
  }
}

async function incompleteTrials({ runName, trials, arm, taskId, tier }) {
  const out = [];
  for (let n = 1; n <= trials; n++) {
    const resultPath = join(process.cwd(), 'experiments', 'github', 'runs', runName, 'results', arm, taskId, `${n}.json`);
    const outputPath = join(process.cwd(), 'experiments', 'github', 'runs', runName, 'results', arm, taskId, `${n}`);
    const transcriptPath = join(process.cwd(), 'experiments', 'github', 'runs', runName, 'transcripts', arm, taskId, `${n}.jsonl`);
    if (
      !(await validResultFile(resultPath, { runName, arm, taskId, tier, trialN: n })) ||
      !(await validTranscriptFile(transcriptPath)) ||
      !(await artifactTreeSecretFree(outputPath))
    ) {
      out.push(n);
    }
  }
  return out;
}

async function main() {
  if (hasFlag('--help') || hasFlag('-h')) {
    usage();
    return;
  }

  const runName = argValue('--run');
  const trials = Number(argValue('--trials') ?? 5);
  const dryRun = hasFlag('--dry-run');
  const resume = hasFlag('--resume');
  const skipAuthCheck = hasFlag('--skip-auth-check');
  const smokeRunName = argValue('--smoke-run') ?? defaultSmokeRunName;

  if (!runName) {
    usage();
    process.exit(2);
  }
  if (!Number.isInteger(trials) || trials <= 0) {
    console.error('--trials must be a positive integer');
    process.exit(2);
  }

  const commands = [['npm', ['run', 'check:static']]];
  if (!skipAuthCheck) {
    commands.push(['npm', ['run', 'check:claude-auth']]);
  }
  commands.push([
    'npm',
    ['run', 'harness', '--', 'verify-arms', '--experiment', 'github', '--output', 'artifacts/verify-arms/github.json'],
  ]);

  const smoke = resume ? await evaluatePerformanceSmoke({ root: process.cwd(), runName: smokeRunName }) : { pass: false };
  if (resume && smoke.pass) {
    console.log(`resume: skipping current Phase 2 performance smoke run=${smokeRunName}`);
  } else {
    if (resume) {
      console.log(`resume: refreshing Phase 2 performance smoke run=${smokeRunName}`);
    }
    for (const arm of ['local-stdio', 'remote-http']) {
      commands.push([
        'npm',
        [
          'run',
          'harness',
          '--',
          'run',
          '--experiment',
          'github',
          '--run',
          smokeRunName,
          '--arm',
          arm,
          '--task',
          smokeTaskId,
          '--trials',
          '1',
        ],
      ]);
    }
    commands.push([
      'npm',
      [
        'run',
        'harness',
        '--',
        'report',
        '--experiment',
        'github',
        '--run',
        smokeRunName,
        '--all-tiers',
        '--crossover-analysis',
        '--include-cost',
        '--output',
        `experiments/github/runs/${smokeRunName}/report.md`,
      ],
    ]);
  }

  if (resume) {
    for (const cell of taskMatrix()) {
      const missing = await incompleteTrials({ runName, trials, ...cell });
      if (missing.length === 0) {
        console.log(`resume: skipping complete task arm=${cell.arm} task=${cell.taskId}`);
        continue;
      }
      if (missing.length === trials) {
        commands.push([
          'npm',
          [
            'run',
            'harness',
            '--',
            'run',
            '--experiment',
            'github',
            '--run',
            runName,
            '--arm',
            cell.arm,
            '--task',
            cell.taskId,
            '--trials',
            String(trials),
          ],
        ]);
      } else {
        for (const trialN of missing) {
          commands.push([
            'npm',
            [
              'run',
              'harness',
              '--',
              'run',
              '--experiment',
              'github',
              '--run',
              runName,
              '--arm',
              cell.arm,
              '--task',
              cell.taskId,
              '--trials',
              String(trials),
              '--trial',
              String(trialN),
            ],
          ]);
        }
      }
    }
  } else {
    for (const cell of matrix()) {
      commands.push([
        'npm',
        [
          'run',
          'harness',
          '--',
          'run',
          '--experiment',
          'github',
          '--run',
          runName,
          '--arm',
          cell.arm,
          '--tier',
          String(cell.tier),
          '--trials',
          String(trials),
        ],
      ]);
    }
  }

  commands.push([
    'npm',
    [
      'run',
      'harness',
      '--',
      'report',
      '--experiment',
      'github',
      '--run',
      runName,
      '--all-tiers',
      '--crossover-analysis',
      '--include-cost',
      '--output',
      `experiments/github/runs/${runName}/report.md`,
    ],
  ]);
  commands.push(['npm', ['run', 'check:run', '--', '--run', runName, '--trials', String(trials)]]);
  commands.push(['npm', ['run', 'scan:secrets', '--', '--path', `experiments/github/runs/${runName}`]]);
  commands.push(['npm', ['run', 'check:completion', '--', '--run', runName, '--trials', String(trials)]]);

  if (dryRun) {
    for (const [command, args] of commands) {
      console.log(commandLine(command, args));
    }
    return;
  }

  for (const [command, args] of commands) {
    const code = await run(command, args);
    if (code !== 0) {
      if (isClaudeAuthCheck(command, args)) {
        printAuthRecovery({ runName, trials, resume });
      }
      process.exit(code);
    }
  }
}

await main();
