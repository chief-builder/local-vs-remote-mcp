import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { tasks } from '../experiments/github/tasks/index.ts';

const root = process.cwd();
const runName = `check-run-audit-${process.pid}`;
const runRoot = join(root, 'experiments', 'github', 'runs', runName);
const arms = ['baseline', 'local-stdio', 'remote-http'];
const emptyTranscriptCell = {
  arm: 'baseline',
  taskId: 'tier1_repo_inventory',
};

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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectedTasksForArm(arm) {
  return tasks.filter((task) => !task.applicableArms || task.applicableArms.includes(arm));
}

function validResult({ arm, task }) {
  const promptInjectionCompliance = task.id === 'tier3_tool_poisoning_resilience' ? false : null;
  const usedIntendedTool = arm !== 'baseline';
  const toolCalls = usedIntendedTool
    ? [{ id: 'toolu_check_run_audit', name: 'mcp__github__get_file_contents', turnIndex: 1 }]
    : [];
  const perToolCallLatencyMs = usedIntendedTool ? [25] : [];
  return {
    experiment: 'github',
    runName,
    arm,
    taskId: task.id,
    tier: task.tier,
    trialN: 1,
    timestamp: '2026-05-20T00:00:00.000Z',
    seed: `check-run-audit-${arm}-${task.id}`,
    success: { pass: true, score: 1, notes: 'static check-run audit fixture' },
    metrics: {
      inputTokens: 1,
      outputTokens: 1,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      toolCallCount: toolCalls.length,
      turns: 1,
      wallClockMs: 1,
      transportFailures: 0,
      contextWindowPeak: 1,
      totalCostUsd: 0,
      usedIntendedTool,
      validToolSurface: true,
      promptInjectionCompliance,
      secretInOutput: false,
      perToolCallLatencyMs,
      coldStartMs: usedIntendedTool ? 0 : null,
      toolCalls,
      modelsUsed: [],
    },
  };
}

async function writeMatrix({ emptyTranscript }) {
  for (const arm of arms) {
    for (const task of expectedTasksForArm(arm)) {
      const resultDir = join(runRoot, 'results', arm, task.id);
      const transcriptDir = join(runRoot, 'transcripts', arm, task.id);
      await mkdir(resultDir, { recursive: true });
      await mkdir(transcriptDir, { recursive: true });
      await writeFile(join(resultDir, '1.json'), `${JSON.stringify(validResult({ arm, task }), null, 2)}\n`, 'utf8');

      const shouldEmpty = emptyTranscript
        && arm === emptyTranscriptCell.arm
        && task.id === emptyTranscriptCell.taskId;
      await writeFile(join(transcriptDir, '1.jsonl'), shouldEmpty ? '' : '{}\n', 'utf8');
    }
  }
}

async function checkRun() {
  return run(process.execPath, [
    '--import', 'tsx',
    'scripts/check-run.mjs',
    '--run', runName,
    '--trials', '1',
  ]);
}

try {
  await writeMatrix({ emptyTranscript: true });
  const failing = await checkRun();
  assert(failing.code === 1, `check-run should fail on an empty transcript:\n${failing.stderr}\n${failing.stdout}`);
  assert(
    failing.stdout.includes('empty transcript')
      && failing.stdout.includes(`${emptyTranscriptCell.arm}/${emptyTranscriptCell.taskId}/1.jsonl`),
    `check-run did not report the empty transcript:\n${failing.stdout}`,
  );

  await writeMatrix({ emptyTranscript: false });
  const passing = await checkRun();
  assert(passing.code === 0, `check-run should pass once the transcript is non-empty:\n${passing.stderr}\n${passing.stdout}`);

  const expectedTranscriptPath = join(
    runRoot,
    'transcripts',
    emptyTranscriptCell.arm,
    emptyTranscriptCell.taskId,
    '1.jsonl',
  );
  await writeFile(expectedTranscriptPath, '{"type":"assistant"}\nnot-json\n', 'utf8');
  const invalidTranscript = await checkRun();
  assert(invalidTranscript.code === 1, `check-run should fail on invalid transcript JSONL:\n${invalidTranscript.stderr}\n${invalidTranscript.stdout}`);
  assert(
    invalidTranscript.stdout.includes('invalid transcript JSONL')
      && invalidTranscript.stdout.includes(`${emptyTranscriptCell.arm}/${emptyTranscriptCell.taskId}/1.jsonl`),
    `check-run did not report invalid transcript JSONL:\n${invalidTranscript.stdout}`,
  );
  await writeFile(expectedTranscriptPath, '{}\n', 'utf8');

  const extraResultPath = join(
    runRoot,
    'results',
    emptyTranscriptCell.arm,
    emptyTranscriptCell.taskId,
    '2.json',
  );
  await writeFile(extraResultPath, '{}\n', 'utf8');
  const extraResult = await checkRun();
  assert(extraResult.code === 1, `check-run should fail on an extra result trial file:\n${extraResult.stderr}\n${extraResult.stdout}`);
  assert(
    extraResult.stdout.includes(`unexpected result trial file: ${emptyTranscriptCell.arm}/${emptyTranscriptCell.taskId}/2.json`),
    `check-run did not report the extra result trial file:\n${extraResult.stdout}`,
  );
  await rm(extraResultPath, { force: true });

  const extraTranscriptPath = join(
    runRoot,
    'transcripts',
    emptyTranscriptCell.arm,
    emptyTranscriptCell.taskId,
    '2.jsonl',
  );
  await writeFile(extraTranscriptPath, '{}\n', 'utf8');
  const extraTranscript = await checkRun();
  assert(extraTranscript.code === 1, `check-run should fail on an extra transcript trial file:\n${extraTranscript.stderr}\n${extraTranscript.stdout}`);
  assert(
    extraTranscript.stdout.includes(`unexpected transcript trial file: ${emptyTranscriptCell.arm}/${emptyTranscriptCell.taskId}/2.jsonl`),
    `check-run did not report the extra transcript trial file:\n${extraTranscript.stdout}`,
  );
  await rm(extraTranscriptPath, { force: true });

  const extraResultNotePath = join(
    runRoot,
    'results',
    emptyTranscriptCell.arm,
    emptyTranscriptCell.taskId,
    'notes.txt',
  );
  await writeFile(extraResultNotePath, 'stray result task file\n', 'utf8');
  const extraResultNote = await checkRun();
  assert(extraResultNote.code === 1, `check-run should fail on a stray result task file:\n${extraResultNote.stderr}\n${extraResultNote.stdout}`);
  assert(
    extraResultNote.stdout.includes(`unexpected result task file: ${emptyTranscriptCell.arm}/${emptyTranscriptCell.taskId}/notes.txt`),
    `check-run did not report the stray result task file:\n${extraResultNote.stdout}`,
  );
  await rm(extraResultNotePath, { force: true });

  const expectedResultOutputDir = join(
    runRoot,
    'results',
    emptyTranscriptCell.arm,
    emptyTranscriptCell.taskId,
    '1',
  );
  await mkdir(expectedResultOutputDir, { recursive: true });
  await writeFile(join(expectedResultOutputDir, 'task-output.json'), '{}\n', 'utf8');
  const allowedResultOutputDir = await checkRun();
  assert(allowedResultOutputDir.code === 0, `check-run should allow an expected per-trial result output directory:\n${allowedResultOutputDir.stderr}\n${allowedResultOutputDir.stdout}`);

  const extraTranscriptDir = join(
    runRoot,
    'transcripts',
    emptyTranscriptCell.arm,
    emptyTranscriptCell.taskId,
    '1',
  );
  await mkdir(extraTranscriptDir, { recursive: true });
  const extraTranscriptDirResult = await checkRun();
  assert(extraTranscriptDirResult.code === 1, `check-run should fail on a stray transcript task directory:\n${extraTranscriptDirResult.stderr}\n${extraTranscriptDirResult.stdout}`);
  assert(
    extraTranscriptDirResult.stdout.includes(`unexpected transcript task directory: ${emptyTranscriptCell.arm}/${emptyTranscriptCell.taskId}/1`),
    `check-run did not report the stray transcript task directory:\n${extraTranscriptDirResult.stdout}`,
  );

  console.log('check-run audit regression passed.');
} finally {
  await rm(runRoot, { recursive: true, force: true });
}
