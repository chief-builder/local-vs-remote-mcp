import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TrialResult } from './runner.js';
import type { Arm } from './experiment.js';

const ARMS: Arm[] = ['baseline', 'local-stdio', 'remote-http'];

async function loadResults(
  rootDir: string,
  experiment: string,
  runName: string,
  arm: Arm,
  tier?: number,
): Promise<TrialResult[]> {
  const base = join(rootDir, 'experiments', experiment, 'runs', runName, 'results', arm);
  let taskDirs: string[];
  try {
    taskDirs = await readdir(base);
  } catch {
    return [];
  }

  const results: TrialResult[] = [];
  for (const taskDir of taskDirs) {
    let files: string[];
    try {
      files = await readdir(join(base, taskDir));
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await readFile(join(base, taskDir, file), 'utf-8');
        const r = JSON.parse(raw) as TrialResult;
        if (tier !== undefined && r.tier !== tier) continue;
        results.push(r);
      } catch {
        // skip malformed
      }
    }
  }
  return results;
}

interface TaskSummary {
  taskId: string;
  tier: number;
  arm: Arm;
  trials: number;
  successRate: number;
  validSurfaceRate: number;
  avgScore: number;
  avgInputTokens: number;
  avgCachedTokens: number;
  avgCacheCreationTokens: number;
  avgOutputTokens: number;
  avgTotalTokens: number;
  avgToolCalls: number;
  avgPerToolCallLatencyMs: number;
  avgTurns: number;
  avgWallClockMs: number;
  avgColdStartMs: number;
  avgTransportFailures: number;
  promptInjectionComplianceRate: number;
  promptInjectionComplianceTrials: number;
  secretInOutputRate: number;
  avgCostUsd: number;
}

function avg(items: TrialResult[], fn: (r: TrialResult) => number): number {
  if (items.length === 0) return 0;
  return items.reduce((sum, r) => sum + fn(r), 0) / items.length;
}

function isValidSurface(r: TrialResult): boolean {
  return r.metrics.validToolSurface ?? true;
}

function totalTokens(r: TrialResult): number {
  return (
    r.metrics.inputTokens
    + r.metrics.cachedInputTokens
    + (r.metrics.cacheCreationInputTokens ?? 0)
    + r.metrics.outputTokens
  );
}

function avgArray(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function promptInjectionComplianceStats(results: TrialResult[]): { rate: number; trials: number } {
  const applicable = results.filter((r) => r.metrics.promptInjectionCompliance !== null);
  if (applicable.length === 0) return { rate: 0, trials: 0 };
  return {
    rate: applicable.reduce((sum, r) => sum + (r.metrics.promptInjectionCompliance ? 1 : 0), 0) / applicable.length,
    trials: applicable.length,
  };
}

function summarize(
  results: TrialResult[],
  filter?: (r: TrialResult) => boolean,
): TaskSummary[] {
  const groups = new Map<string, TrialResult[]>();
  for (const r of results) {
    const key = `${r.taskId}::${r.arm}`;
    const g = groups.get(key) ?? [];
    g.push(r);
    groups.set(key, g);
  }

  return [...groups.values()].flatMap(group => {
    const filtered = filter ? group.filter(filter) : group;
    if (filtered.length === 0) return [];
    const first = filtered[0]!;
    const pi = promptInjectionComplianceStats(filtered);
    return [{
      taskId: first.taskId,
      tier: first.tier,
      arm: first.arm,
      trials: filtered.length,
      successRate: avg(filtered, r => (r.success.pass ? 1 : 0)),
      validSurfaceRate: avg(filtered, r => (isValidSurface(r) ? 1 : 0)),
      avgScore: avg(filtered, r => r.success.score),
      avgInputTokens: avg(filtered, r => r.metrics.inputTokens),
      avgCachedTokens: avg(filtered, r => r.metrics.cachedInputTokens),
      avgCacheCreationTokens: avg(filtered, r => r.metrics.cacheCreationInputTokens ?? 0),
      avgOutputTokens: avg(filtered, r => r.metrics.outputTokens),
      avgTotalTokens: avg(filtered, totalTokens),
      avgToolCalls: avg(filtered, r => r.metrics.toolCallCount),
      avgPerToolCallLatencyMs: avg(filtered, r => avgArray(r.metrics.perToolCallLatencyMs ?? [])),
      avgTurns: avg(filtered, r => r.metrics.turns),
      avgWallClockMs: avg(filtered, r => r.metrics.wallClockMs),
      avgColdStartMs: avg(filtered, r => r.metrics.coldStartMs ?? 0),
      avgTransportFailures: avg(filtered, r => r.metrics.transportFailures ?? 0),
      promptInjectionComplianceRate: pi.rate,
      promptInjectionComplianceTrials: pi.trials,
      secretInOutputRate: avg(filtered, r => (r.metrics.secretInOutput ? 1 : 0)),
      avgCostUsd: avg(filtered, r => r.metrics.totalCostUsd),
    }];
  }).sort((a, b) => a.tier - b.tier || a.taskId.localeCompare(b.taskId) || ARMS.indexOf(a.arm) - ARMS.indexOf(b.arm));
}

const pct = (v: number) => `${(v * 100).toFixed(0)}%`;
const pctOrNa = (v: number, count: number) => count > 0 ? pct(v) : 'n/a';
const n1 = (v: number) => v.toFixed(1);
const sec = (v: number) => `${(v / 1000).toFixed(1)}s`;
const usd = (v: number) => `$${v.toFixed(4)}`;

function aggregatePromptInjectionCell(summaries: TaskSummary[]): string {
  const trials = summaries.reduce((sum, s) => sum + s.promptInjectionComplianceTrials, 0);
  if (trials === 0) return 'n/a';
  const complying = summaries.reduce(
    (sum, s) => sum + (s.promptInjectionComplianceRate * s.promptInjectionComplianceTrials),
    0,
  );
  return pct(complying / trials);
}

function perTaskTable(summaries: TaskSummary[]): string {
  const taskIds = [...new Set(summaries.map(s => s.taskId))];
  const validLabel = 'Valid Surface';
  const rows = [
    `| Task | Tier | Arm | Trials | Success | ${validLabel} | Score | Input Tok | Cached Tok | Cache Create Tok | Output Tok | Total Tok | Tool Calls | Tool Lat | Turns | Time | Cold Start | Transport Fail | PI Comply | Secret Out |`,
    '|------|------|-----|--------|---------|---------------|-------|-----------|------------|------------------|------------|-----------|------------|----------|-------|------|------------|----------------|-----------|------------|',
  ];
  for (const taskId of taskIds) {
    for (const arm of ARMS) {
      const s = summaries.find(x => x.taskId === taskId && x.arm === arm);
      if (!s) continue;
      rows.push(
        `| ${s.taskId} | ${s.tier} | ${s.arm} | ${s.trials} | ${pct(s.successRate)} | ${pct(s.validSurfaceRate)} | ${n1(s.avgScore)} | ${Math.round(s.avgInputTokens)} | ${Math.round(s.avgCachedTokens)} | ${Math.round(s.avgCacheCreationTokens)} | ${Math.round(s.avgOutputTokens)} | ${Math.round(s.avgTotalTokens)} | ${n1(s.avgToolCalls)} | ${sec(s.avgPerToolCallLatencyMs)} | ${n1(s.avgTurns)} | ${sec(s.avgWallClockMs)} | ${sec(s.avgColdStartMs)} | ${n1(s.avgTransportFailures)} | ${pctOrNa(s.promptInjectionComplianceRate, s.promptInjectionComplianceTrials)} | ${pct(s.secretInOutputRate)} |`,
      );
    }
  }
  return rows.join('\n');
}

function tierSummary(summaries: TaskSummary[]): string {
  const tiers = [...new Set(summaries.map(s => s.tier))].sort();
  const validLabel = 'Avg Valid Surface';
  const lines: string[] = [
    '## Per-Tier Summary',
    '',
    '_Token columns are averaged over valid-surface trials only (apples-to-apples). Trial counts reflect valid trials; the per-task table above shows the unfiltered view._',
    '',
  ];
  for (const tier of tiers) {
    const tierData = summaries.filter(s => s.tier === tier);
    lines.push(`### Tier ${tier}`, '');
    lines.push(`| Arm | Tasks | Trials (valid) | Avg Success | ${validLabel} | Avg Input Tok | Avg Cached Tok | Avg Cache Create Tok | Avg Output Tok | Avg Total Tok | Avg Tool Lat | Avg Turns | Avg Time | Avg Transport Fail | PI Comply | Secret Out |`);
    lines.push('|-----|-------|----------------|-------------|-------------------|---------------|----------------|----------------------|----------------|---------------|--------------|-----------|----------|--------------------|-----------|------------|');
    for (const arm of ARMS) {
      const armData = tierData.filter(s => s.arm === arm);
      if (armData.length === 0) continue;
      const a = (fn: (s: TaskSummary) => number) => armData.reduce((sum, s) => sum + fn(s), 0) / armData.length;
      const totalTrials = armData.reduce((sum, s) => sum + s.trials, 0);
      lines.push(`| ${arm} | ${armData.length} | ${totalTrials} | ${pct(a(s => s.successRate))} | ${pct(a(s => s.validSurfaceRate))} | ${Math.round(a(s => s.avgInputTokens))} | ${Math.round(a(s => s.avgCachedTokens))} | ${Math.round(a(s => s.avgCacheCreationTokens))} | ${Math.round(a(s => s.avgOutputTokens))} | ${Math.round(a(s => s.avgTotalTokens))} | ${sec(a(s => s.avgPerToolCallLatencyMs))} | ${n1(a(s => s.avgTurns))} | ${sec(a(s => s.avgWallClockMs))} | ${n1(a(s => s.avgTransportFailures))} | ${aggregatePromptInjectionCell(armData)} | ${pct(a(s => s.secretInOutputRate))} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function crossoverAnalysis(summaries: TaskSummary[]): string {
  const tiers = [...new Set(summaries.map(s => s.tier))].sort();
  const lines = [
    '## Crossover Analysis',
    '',
    'Per-tier comparison restricted to **valid-surface trials only**. Turns is a proxy for task complexity; Total Tok is the load-bearing cost measurement.',
    '',
    '| Tier | Turns (Local) | Turns (Remote) | Total Tok (Local) | Total Tok (Remote) | Tok Local/Remote | Time (Local) | Time (Remote) | Success (Local) | Success (Remote) | Remote ≥ Local (success)? |',
    '|------|---------------|----------------|-------------------|--------------------|------------------|--------------|---------------|-----------------|------------------|---------------------------|',
  ];

  for (const tier of tiers) {
    const local = summaries.filter(s => s.tier === tier && s.arm === 'local-stdio');
    const remote = summaries.filter(s => s.tier === tier && s.arm === 'remote-http');
    if (local.length === 0 || remote.length === 0) continue;

    const aLocal = (fn: (s: TaskSummary) => number) => local.reduce((sum, s) => sum + fn(s), 0) / local.length;
    const aRemote = (fn: (s: TaskSummary) => number) => remote.reduce((sum, s) => sum + fn(s), 0) / remote.length;
    const localTok = aLocal(s => s.avgTotalTokens);
    const remoteTok = aRemote(s => s.avgTotalTokens);
    const ratio = remoteTok > 0 ? localTok / remoteTok : 0;
    const remoteAhead = aRemote(s => s.successRate) >= aLocal(s => s.successRate) ? 'Yes' : 'No';

    lines.push(`| ${tier} | ${n1(aLocal(s => s.avgTurns))} | ${n1(aRemote(s => s.avgTurns))} | ${Math.round(localTok)} | ${Math.round(remoteTok)} | ${ratio.toFixed(2)}× | ${sec(aLocal(s => s.avgWallClockMs))} | ${sec(aRemote(s => s.avgWallClockMs))} | ${pct(aLocal(s => s.successRate))} | ${pct(aRemote(s => s.successRate))} | ${remoteAhead} |`);
  }

  return lines.join('\n');
}

function aggregateByArm(summaries: TaskSummary[], arm: Arm, filter?: (s: TaskSummary) => boolean): TaskSummary[] {
  return summaries.filter(s => s.arm === arm && (!filter || filter(s)));
}

function avgSummary(summaries: TaskSummary[], fn: (s: TaskSummary) => number): number {
  if (summaries.length === 0) return 0;
  return summaries.reduce((sum, s) => sum + fn(s), 0) / summaries.length;
}

function aggregatePromptInjectionRate(summaries: TaskSummary[]): { rate: number; trials: number } {
  const trials = summaries.reduce((sum, s) => sum + s.promptInjectionComplianceTrials, 0);
  if (trials === 0) return { rate: 0, trials: 0 };
  const complying = summaries.reduce(
    (sum, s) => sum + (s.promptInjectionComplianceRate * s.promptInjectionComplianceTrials),
    0,
  );
  return { rate: complying / trials, trials };
}

function ratioCell(numerator: number, denominator: number): string {
  if (denominator <= 0) return 'n/a';
  return `${(numerator / denominator).toFixed(2)}x`;
}

function hypothesisSummary(summaries: TaskSummary[]): string {
  const performanceTask = (s: TaskSummary) => s.tier === 1 || s.tier === 2;
  const localPerf = aggregateByArm(summaries, 'local-stdio', performanceTask);
  const remotePerf = aggregateByArm(summaries, 'remote-http', performanceTask);
  const localSecurity = aggregateByArm(summaries, 'local-stdio', s => s.taskId === 'tier3_tool_poisoning_resilience');
  const remoteSecurity = aggregateByArm(summaries, 'remote-http', s => s.taskId === 'tier3_tool_poisoning_resilience');
  const localPi = aggregatePromptInjectionRate(localSecurity);
  const remotePi = aggregatePromptInjectionRate(remoteSecurity);

  const localTokens = avgSummary(localPerf, s => s.avgTotalTokens);
  const remoteTokens = avgSummary(remotePerf, s => s.avgTotalTokens);
  const localWall = avgSummary(localPerf, s => s.avgWallClockMs);
  const remoteWall = avgSummary(remotePerf, s => s.avgWallClockMs);
  const localToolLatency = avgSummary(localPerf, s => s.avgPerToolCallLatencyMs);
  const remoteToolLatency = avgSummary(remotePerf, s => s.avgPerToolCallLatencyMs);

  return [
    '## Hypothesis Summary',
    '',
    '_Computed from valid-surface trials. H1 uses Tier 1 + Tier 2 local/remote tasks. H2 uses `tier3_tool_poisoning_resilience` only._',
    '',
    '| Hypothesis | Local | Remote | Ratio / Difference |',
    '|------------|-------|--------|--------------------|',
    `| H1 token cost: avg total tokens | ${Math.round(localTokens)} | ${Math.round(remoteTokens)} | Local/Remote ${ratioCell(localTokens, remoteTokens)} |`,
    `| H1 wall-clock: avg time | ${sec(localWall)} | ${sec(remoteWall)} | Remote/Local ${ratioCell(remoteWall, localWall)} |`,
    `| H1 tool latency: avg per-call latency | ${sec(localToolLatency)} | ${sec(remoteToolLatency)} | Remote/Local ${ratioCell(remoteToolLatency, localToolLatency)} |`,
    `| H2 prompt-injection compliance | ${pctOrNa(localPi.rate, localPi.trials)} (${localPi.trials} trials) | ${pctOrNa(remotePi.rate, remotePi.trials)} (${remotePi.trials} trials) | ${localPi.trials && remotePi.trials ? `${((remotePi.rate - localPi.rate) * 100).toFixed(1)} pp remote-local` : 'n/a'} |`,
  ].join('\n');
}

function costAppendix(summaries: TaskSummary[]): string {
  const taskIds = [...new Set(summaries.map(s => s.taskId))];
  const tiers = [...new Set(summaries.map(s => s.tier))].sort();
  const lines: string[] = [
    '## Appendix: Cost (USD)',
    '',
    '_Cost is derived from token counts using model-specific pricing at run time and will drift as Anthropic updates prices. Token counts above are the load-bearing measurement._',
    '',
    '### Per-task average cost',
    '',
    '| Task | Tier | Arm | Avg Cost |',
    '|------|------|-----|----------|',
  ];
  for (const taskId of taskIds) {
    for (const arm of ARMS) {
      const s = summaries.find(x => x.taskId === taskId && x.arm === arm);
      if (!s) continue;
      lines.push(`| ${s.taskId} | ${s.tier} | ${s.arm} | ${usd(s.avgCostUsd)} |`);
    }
  }
  lines.push('', '### Per-tier average cost', '');
  for (const tier of tiers) {
    const tierData = summaries.filter(s => s.tier === tier);
    lines.push(`#### Tier ${tier}`, '');
    lines.push('| Arm | Tasks | Avg Cost |');
    lines.push('|-----|-------|----------|');
    for (const arm of ARMS) {
      const armData = tierData.filter(s => s.arm === arm);
      if (armData.length === 0) continue;
      const a = armData.reduce((sum, s) => sum + s.avgCostUsd, 0) / armData.length;
      lines.push(`| ${arm} | ${armData.length} | ${usd(a)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export interface ReportOptions {
  rootDir: string;
  experiment: string;
  runName: string;
  tier?: number | undefined;
  allTiers?: boolean | undefined;
  crossover?: boolean | undefined;
  includeCost?: boolean | undefined;
}

export async function generateReport(opts: ReportOptions): Promise<string> {
  const { rootDir, experiment, runName, tier, allTiers, crossover, includeCost = false } = opts;
  const filterTier = allTiers ? undefined : tier;

  const all: TrialResult[] = [];
  for (const arm of ARMS) {
    all.push(...await loadResults(rootDir, experiment, runName, arm, filterTier));
  }

  if (all.length === 0) {
    return `# Report: ${experiment} / ${runName}\n\nNo results found.\n`;
  }

  const summariesAll = summarize(all);
  const summariesValid = summarize(all, isValidSurface);
  const toolSearchModes = [...new Set(all.map(r => r.toolSearchMode ?? 'not recorded'))].sort().join(', ');
  const label = allTiers ? 'All Tiers' : tier !== undefined ? `Tier ${tier}` : 'All';
  const title = `${experiment} / ${runName}`;

  const parts = [
    `# Experiment Report: ${title} — ${label}`,
    `_Generated: ${new Date().toISOString()}_`,
    '_Valid surface: the trial used only tools allowed for its arm (no Bash, Skill, Task, Agent, web fetch, or off-arm MCP tools)._',
    `_Tool search mode (ENABLE_TOOL_SEARCH): ${toolSearchModes}_`,
    '',
    '## Per-Task Results',
    '',
    '_Per-task averages include all trials (invalid trials too) so the Valid Surface column tells you when escapes occurred. The tier summary and crossover below restrict to valid trials only._',
    '',
    hypothesisSummary(summariesValid),
    '',
    perTaskTable(summariesAll),
    '',
    tierSummary(summariesValid),
  ];

  if (crossover) {
    parts.push('', crossoverAnalysis(summariesValid));
  }

  if (includeCost) {
    parts.push('', costAppendix(summariesAll));
  }

  return parts.join('\n');
}
