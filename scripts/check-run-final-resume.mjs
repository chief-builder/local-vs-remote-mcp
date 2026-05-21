import { mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const runName = `resume-check-${process.pid}`;
const arm = 'baseline';
const taskId = 'tier1_repo_inventory';
const runRoot = join(root, 'experiments', 'github', 'runs', runName);
const smokeRunName = `${runName}-latency-smoke`;
const tokenSample = `gho_${'A'.repeat(40)}`;

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

const validResult = {
  experiment: 'github',
  runName,
  arm,
  taskId,
  tier: 1,
  trialN: 1,
  timestamp: '2026-05-20T00:00:00.000Z',
  seed: 'resume-check-seed',
  success: { pass: false, score: 0, notes: 'static resume regression fixture: task failed but artifact is complete' },
  metrics: {
    inputTokens: 1,
    outputTokens: 1,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    toolCallCount: 0,
    turns: 1,
    wallClockMs: 1,
    transportFailures: 0,
    contextWindowPeak: 1,
    totalCostUsd: 0,
    usedIntendedTool: false,
    validToolSurface: true,
    promptInjectionCompliance: null,
    secretInOutput: false,
    perToolCallLatencyMs: [],
    coldStartMs: null,
    toolCalls: [],
    modelsUsed: [],
  },
};

try {
  const resultDir = join(runRoot, 'results', arm, taskId);
  const transcriptDir = join(runRoot, 'transcripts', arm, taskId);
  await mkdir(resultDir, { recursive: true });
  await mkdir(transcriptDir, { recursive: true });
  await writeFile(join(resultDir, '1.json'), `${JSON.stringify(validResult, null, 2)}\n`, 'utf8');
  await writeFile(join(transcriptDir, '1.jsonl'), '{}\n', 'utf8');
  await mkdir(join(resultDir, '1'), { recursive: true });
  await writeFile(join(resultDir, '1', 'task-output.json'), `${JSON.stringify({ leaked: tokenSample })}\n`, 'utf8');
  await writeFile(join(resultDir, '2.json'), `${JSON.stringify({
    ...validResult,
    trialN: 2,
    success: {
      pass: true,
      score: 1.5,
      notes: 'static resume regression fixture: invalid score must rerun',
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(join(transcriptDir, '2.jsonl'), '{}\n', 'utf8');
  await writeFile(join(resultDir, '4.json'), `${JSON.stringify({
    ...validResult,
    trialN: 4,
    success: {
      pass: false,
      score: 0,
      notes: 'static resume regression fixture: empty transcript must rerun',
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(join(transcriptDir, '4.jsonl'), '', 'utf8');
  await writeFile(join(resultDir, '5.json'), `${JSON.stringify({
    ...validResult,
    trialN: 5,
    success: {
      pass: false,
      score: 0,
      notes: 'static resume regression fixture: invalid transcript JSONL must rerun',
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(join(transcriptDir, '5.jsonl'), '{"type":"assistant"}\nnot-json\n', 'utf8');
  await writeFile(join(resultDir, '6.json'), `${JSON.stringify({
    ...validResult,
    trialN: 6,
    success: {
      pass: false,
      score: 0,
      notes: 'static resume regression fixture: token-shaped transcript secret must rerun',
    },
  }, null, 2)}\n`, 'utf8');
  await writeFile(join(transcriptDir, '6.jsonl'), `${JSON.stringify({
    type: 'assistant',
    message: {
      content: [{ type: 'text', text: `leaked ${tokenSample}` }],
    },
  })}\n`, 'utf8');
  await writeFile(join(resultDir, '7.json'), `${JSON.stringify({
    ...validResult,
    trialN: 7,
    seed: 'resume-check-seed-complete',
  }, null, 2)}\n`, 'utf8');
  await writeFile(join(transcriptDir, '7.jsonl'), '{}\n', 'utf8');
  await writeFile(join(resultDir, '8.json'), `${JSON.stringify({
    ...validResult,
    trialN: 8,
    seed: 'resume-check-seed-binary-output',
  }, null, 2)}\n`, 'utf8');
  await writeFile(join(transcriptDir, '8.jsonl'), '{}\n', 'utf8');
  await mkdir(join(resultDir, '8'), { recursive: true });
  await writeFile(join(resultDir, '8', 'binary-output.bin'), Buffer.from([0, 1, 2, 3, 4]));

  const result = await run(process.execPath, [
    '--import', 'tsx',
    'scripts/run-final.mjs',
    '--run', runName,
    '--trials', '8',
    '--dry-run',
    '--resume',
    '--skip-auth-check',
    '--smoke-run', smokeRunName,
  ]);
  assert(result.code === 0, `run-final dry-run failed:\n${result.stderr}\n${result.stdout}`);

  const outputLines = result.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const staticIdx = outputLines.findIndex((line) => line === 'npm run check:static');
  const verifyArmsIdx = outputLines.findIndex((line) => line.includes('verify-arms'));
  assert(staticIdx >= 0, `expected static preflight before live commands:\n${result.stdout}`);
  assert(
    verifyArmsIdx >= 0 && staticIdx < verifyArmsIdx,
    `expected static preflight before verify-arms:\n${result.stdout}`,
  );
  assert(
    outputLines.some((line) => line.includes(`resume: refreshing Phase 2 performance smoke run=${smokeRunName}`)),
    `expected stale/missing Phase 2 smoke to be refreshed:\n${result.stdout}`,
  );
  const smokeRunLines = outputLines.filter((line) =>
    line.includes(`--run ${smokeRunName}`)
    && line.includes('--task tier1_pr_diff_answer')
    && line.includes('--trials 1')
  );
  assert(smokeRunLines.length === 2, `expected local and remote smoke refresh commands, got ${smokeRunLines.length}:\n${result.stdout}`);
  assert(
    smokeRunLines.some((line) => line.includes('--arm local-stdio'))
      && smokeRunLines.some((line) => line.includes('--arm remote-http')),
    `expected both transport smoke refresh commands:\n${smokeRunLines.join('\n')}`,
  );
  const smokeReportLine = outputLines.find((line) =>
    line.includes(`--run ${smokeRunName}`)
    && line.includes('report')
    && line.includes(`experiments/github/runs/${smokeRunName}/report.md`)
  );
  assert(smokeReportLine, `expected smoke report refresh command:\n${result.stdout}`);

  const lines = outputLines.filter((line) =>
    line.includes(`--arm ${arm}`)
    && line.includes(`--task ${taskId}`)
    && line.includes('--trials 8')
  );
  const firstSmokeIdx = outputLines.findIndex((line) => line.includes(`--run ${smokeRunName}`));
  const firstFinalIdx = outputLines.findIndex((line) =>
    line.includes(`--run ${runName}`)
    && line.includes(`--arm ${arm}`)
    && line.includes(`--task ${taskId}`)
  );
  assert(firstSmokeIdx >= 0 && firstFinalIdx >= 0 && firstSmokeIdx < firstFinalIdx, `expected smoke refresh before final refill commands:\n${result.stdout}`);
  assert(lines.length === 6, `expected six resume commands for ${arm}/${taskId}, got ${lines.length}:\n${result.stdout}`);
  assert(lines.some((line) => line.includes('--trial 1')), `expected token-shaped task output trial 1 to rerun:\n${lines.join('\n')}`);
  assert(lines.some((line) => line.includes('--trial 2')), `expected invalid score trial 2 to rerun:\n${lines.join('\n')}`);
  assert(lines.some((line) => line.includes('--trial 3')), `expected missing trial 3 to rerun:\n${lines.join('\n')}`);
  assert(lines.some((line) => line.includes('--trial 4')), `expected empty transcript trial 4 to rerun:\n${lines.join('\n')}`);
  assert(lines.some((line) => line.includes('--trial 5')), `expected invalid transcript JSONL trial 5 to rerun:\n${lines.join('\n')}`);
  assert(lines.some((line) => line.includes('--trial 6')), `expected token-shaped transcript secret trial 6 to rerun:\n${lines.join('\n')}`);
  assert(!lines.some((line) => line.includes('--trial 7')), `partial resume should not rerun complete trial 7:\n${lines.join('\n')}`);
  assert(!lines.some((line) => line.includes('--trial 8')), `partial resume should not rerun complete trial 8 with binary-like output:\n${lines.join('\n')}`);

  console.log('run-final resume regression check passed.');
} finally {
  await rm(runRoot, { recursive: true, force: true });
}
