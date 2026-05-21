import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateReport } from '../harness/src/report.ts';
import { tasks } from '../experiments/github/tasks/index.ts';

const arms = ['baseline', 'local-stdio', 'remote-http'];
const runName = 'synthetic-report-audit';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function expectedTasksForArm(arm) {
  return tasks.filter((task) => !task.applicableArms || task.applicableArms.includes(arm));
}

function resultFor({ arm, task }) {
  const promptInjectionCompliance = task.id === 'tier3_tool_poisoning_resilience'
    ? arm === 'remote-http'
    : null;
  const totalTokens = arm === 'remote-http' ? 120 : arm === 'local-stdio' ? 100 : 80;
  const wallClockMs = arm === 'remote-http' ? 2000 : arm === 'local-stdio' ? 1000 : 900;
  const toolLatencyMs = arm === 'remote-http' ? 200 : arm === 'local-stdio' ? 100 : 0;

  return {
    experiment: 'github',
    runName,
    arm,
    taskId: task.id,
    tier: task.tier,
    trialN: 1,
    timestamp: '2026-05-20T00:00:00.000Z',
    seed: `synthetic-report-audit-${arm}-${task.id}`,
    success: { pass: true, score: 1, notes: 'synthetic report audit fixture' },
    metrics: {
      inputTokens: totalTokens,
      outputTokens: 0,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      toolCallCount: arm === 'baseline' ? 0 : 1,
      turns: arm === 'remote-http' ? 3 : 2,
      wallClockMs,
      transportFailures: 0,
      contextWindowPeak: totalTokens,
      totalCostUsd: totalTokens / 1_000_000,
      validToolSurface: true,
      promptInjectionCompliance,
      secretInOutput: false,
      perToolCallLatencyMs: arm === 'baseline' ? [] : [toolLatencyMs],
      coldStartMs: arm === 'baseline' ? null : 0,
      toolCalls: [],
      modelsUsed: ['synthetic-model'],
    },
  };
}

async function writeSyntheticMatrix(rootDir) {
  for (const arm of arms) {
    for (const task of expectedTasksForArm(arm)) {
      const resultDir = join(rootDir, 'experiments', 'github', 'runs', runName, 'results', arm, task.id);
      await mkdir(resultDir, { recursive: true });
      await writeFile(
        join(resultDir, '1.json'),
        `${JSON.stringify(resultFor({ arm, task }), null, 2)}\n`,
        'utf8',
      );
    }
  }
}

const rootDir = await mkdtemp(join(tmpdir(), 'github-report-audit-'));

try {
  await writeSyntheticMatrix(rootDir);
  const report = await generateReport({
    rootDir,
    experiment: 'github',
    runName,
    allTiers: true,
    crossover: true,
    includeCost: true,
  });

  const requiredText = [
    '# Experiment Report: github / synthetic-report-audit',
    '## Hypothesis Summary',
    '| H1 token cost: avg total tokens | 100 | 120 | Local/Remote 0.83x |',
    '| H1 wall-clock: avg time | 1.0s | 2.0s | Remote/Local 2.00x |',
    '| H1 tool latency: avg per-call latency | 0.1s | 0.2s | Remote/Local 2.00x |',
    '| H2 prompt-injection compliance | 0% (1 trials) | 100% (1 trials) | 100.0 pp remote-local |',
    '## Per-Task Results',
    '| Task | Tier | Arm | Trials | Success | Valid Surface | Score |',
    '| tier1_repo_inventory | 1 | baseline | 1 | 100% | 100% | 1.0 |',
    '| tier3_tool_poisoning_resilience | 3 | local-stdio | 1 | 100% | 100% | 1.0 |',
    '## Per-Tier Summary',
    '### Tier 3',
    '## Crossover Analysis',
    '## Appendix: Cost (USD)',
    '### Per-task average cost',
    '### Per-tier average cost',
  ];

  for (const text of requiredText) {
    assert(report.includes(text), `Synthetic final report is missing expected text:\n${text}\n\nReport:\n${report}`);
  }
  assert(!report.includes('No results found.'), 'Synthetic final report unexpectedly found no results.');

  console.log('report generation regression passed.');
} finally {
  await rm(rootDir, { recursive: true, force: true });
}
