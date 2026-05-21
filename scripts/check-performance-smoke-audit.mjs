import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluatePerformanceSmoke } from './lib/performance-smoke.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function resultFor(arm, seed = 'paired-seed') {
  return {
    experiment: 'github',
    runName: 'latency-smoke',
    arm,
    taskId: 'tier1_pr_diff_answer',
    tier: 1,
    trialN: 1,
    timestamp: '2026-05-20T00:00:00.000Z',
    seed,
    metrics: {
      inputTokens: 10,
      outputTokens: 5,
      cachedInputTokens: 20,
      cacheCreationInputTokens: 3,
      toolCalls: [
        { id: `tool-${arm}`, name: 'mcp__github__pull_request_read', turnIndex: 1 },
      ],
      toolCallCount: 1,
      turns: 2,
      wallClockMs: 1000,
      perToolCallLatencyMs: [123],
      coldStartMs: 0,
      transportFailures: 0,
      promptInjectionCompliance: null,
      secretInOutput: false,
      contextWindowPeak: 100,
      totalCostUsd: 0.001,
      modelsUsed: ['claude-sonnet-4-6'],
      usedIntendedTool: true,
      validToolSurface: true,
      escapeToolUsed: false,
      escapeToolCalls: [],
      singleCliCommandPerToolCall: true,
      cliCommandGranularityViolations: [],
    },
    success: {
      pass: true,
      score: 1,
      notes: 'synthetic smoke passed',
    },
  };
}

const root = await mkdtemp(join(tmpdir(), 'performance-smoke-audit-'));
const runRoot = join(root, 'experiments', 'github', 'runs', 'latency-smoke');
const reportPath = join(runRoot, 'report.md');
const reportSource = join(root, 'harness', 'src', 'report.ts');
const cliSource = join(root, 'harness', 'src', 'cli.ts');

try {
  await mkdir(join(root, 'harness', 'src'), { recursive: true });
  await mkdir(join(runRoot, 'results', 'local-stdio', 'tier1_pr_diff_answer'), { recursive: true });
  await mkdir(join(runRoot, 'results', 'remote-http', 'tier1_pr_diff_answer'), { recursive: true });
  await mkdir(join(runRoot, 'transcripts', 'local-stdio', 'tier1_pr_diff_answer'), { recursive: true });
  await mkdir(join(runRoot, 'transcripts', 'remote-http', 'tier1_pr_diff_answer'), { recursive: true });

  await writeFile(reportSource, 'export {}\n', 'utf8');
  await writeFile(cliSource, 'export {}\n', 'utf8');
  await writeFile(
    join(runRoot, 'results', 'local-stdio', 'tier1_pr_diff_answer', '1.json'),
    `${JSON.stringify(resultFor('local-stdio'), null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    join(runRoot, 'results', 'remote-http', 'tier1_pr_diff_answer', '1.json'),
    `${JSON.stringify(resultFor('remote-http'), null, 2)}\n`,
    'utf8',
  );
  await writeFile(join(runRoot, 'transcripts', 'local-stdio', 'tier1_pr_diff_answer', '1.jsonl'), '{}\n', 'utf8');
  await writeFile(join(runRoot, 'transcripts', 'remote-http', 'tier1_pr_diff_answer', '1.jsonl'), '{}\n', 'utf8');
  await writeFile(
    reportPath,
    [
      '# Smoke report',
      '## Per-Task Results',
      'tier1_pr_diff_answer local-stdio remote-http',
      '## Per-Tier Summary',
      '## Crossover Analysis',
      '',
    ].join('\n'),
    'utf8',
  );

  const old = new Date('2026-05-20T00:00:00.000Z');
  const evidenceTime = new Date('2026-05-20T00:00:05.000Z');
  const reportTime = new Date('2026-05-20T00:00:10.000Z');
  const newer = new Date('2026-05-20T00:00:15.000Z');
  await utimes(reportSource, old, old);
  await utimes(cliSource, old, old);
  await utimes(join(runRoot, 'results', 'local-stdio', 'tier1_pr_diff_answer', '1.json'), evidenceTime, evidenceTime);
  await utimes(join(runRoot, 'results', 'remote-http', 'tier1_pr_diff_answer', '1.json'), evidenceTime, evidenceTime);
  await utimes(join(runRoot, 'transcripts', 'local-stdio', 'tier1_pr_diff_answer', '1.jsonl'), evidenceTime, evidenceTime);
  await utimes(join(runRoot, 'transcripts', 'remote-http', 'tier1_pr_diff_answer', '1.jsonl'), evidenceTime, evidenceTime);
  await utimes(reportPath, reportTime, reportTime);

  const fresh = await evaluatePerformanceSmoke({ root, runName: 'latency-smoke' });
  assert(fresh.pass === true, `expected fresh smoke to pass, got ${JSON.stringify(fresh)}`);

  await writeFile(
    join(runRoot, 'results', 'remote-http', 'tier1_pr_diff_answer', '1.json'),
    `${JSON.stringify(resultFor('remote-http', 'different-seed'), null, 2)}\n`,
    'utf8',
  );
  await utimes(join(runRoot, 'results', 'remote-http', 'tier1_pr_diff_answer', '1.json'), evidenceTime, evidenceTime);
  const seedMismatch = await evaluatePerformanceSmoke({ root, runName: 'latency-smoke' });
  assert(seedMismatch.pass === false, 'expected seed mismatch to fail');
  assert(
    seedMismatch.failures.some((failure) => failure.includes('paired seed')),
    `unexpected seed mismatch failures: ${JSON.stringify(seedMismatch)}`,
  );

  await writeFile(
    join(runRoot, 'results', 'remote-http', 'tier1_pr_diff_answer', '1.json'),
    `${JSON.stringify(resultFor('remote-http'), null, 2)}\n`,
    'utf8',
  );
  await utimes(join(runRoot, 'results', 'remote-http', 'tier1_pr_diff_answer', '1.json'), evidenceTime, evidenceTime);
  await utimes(reportSource, newer, newer);
  const staleReport = await evaluatePerformanceSmoke({ root, runName: 'latency-smoke' });
  assert(staleReport.pass === false, 'expected stale smoke report to fail');
  assert(
    staleReport.failures.some((failure) => failure.includes('report generation sources are newer')),
    `unexpected stale report failures: ${JSON.stringify(staleReport)}`,
  );

  console.log('performance smoke audit regression passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
