import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { parseTranscript } from '../harness/src/metrics.ts';
import { generateReport } from '../harness/src/report.ts';
import type { TrialResult } from '../harness/src/runner.ts';
import type { Arm } from '../harness/src/experiment.ts';

const CLI = resolve('harness/src/cli.ts');
// Absolute loader URL so the CLI can run with a cwd outside the repo.
const TSX = import.meta.resolve('tsx');

function result(arm: Arm, taskId: string, tier: number, trialN: number, over: Partial<TrialResult['metrics']> = {}, pass = true): TrialResult {
  const metrics = { ...parseTranscript([], arm, { intendedMcpPrefix: 'mcp__github__' }), inputTokens: 100, wallClockMs: 1000, ...over };
  return { experiment: 'github', runName: 'r', arm, taskId, tier, trialN, timestamp: '2026-01-01T00:00:00.000Z', seed: 'abcd', toolSearchMode: 'unset', metrics, success: { pass, score: pass ? 1 : 0, notes: '' } };
}

describe('generateReport', () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'lvrmcp-report-'));
    const rows = [
      result('local-stdio', 'tier1_a', 1, 1, { inputTokens: 200 }),
      result('remote-http', 'tier1_a', 1, 1, { inputTokens: 100 }),
      result('local-stdio', 'tier3_tool_poisoning_resilience', 3, 1, { promptInjectionCompliance: true }),
      result('local-stdio', 'tier3_tool_poisoning_resilience', 3, 2, { promptInjectionCompliance: false }),
      result('remote-http', 'tier3_tool_poisoning_resilience', 3, 1, { promptInjectionCompliance: false }),
      result('remote-http', 'tier1_a', 1, 2, { inputTokens: 999_999, validToolSurface: false }),
    ];
    for (const r of rows) {
      const dir = join(root, 'experiments', 'github', 'runs', 'r', 'results', r.arm, r.taskId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${r.trialN}.json`), JSON.stringify(r));
    }
  });

  after(async () => { await rm(root, { recursive: true, force: true }); });

  it('computes H1 from valid-surface trials only and H2 from the poisoning task', async () => {
    const md = await generateReport({ rootDir: root, experiment: 'github', runName: 'r', allTiers: true, crossover: true });
    assert.match(md, /H1 token cost: avg total tokens \| 200 \| 100 \| Local\/Remote 2\.00x/);
    assert.match(md, /H2 prompt-injection compliance \| 50% \(2 trials\) \| 0% \(1 trials\) \| -50\.0 pp remote-local/);
    assert.match(md, /Tool search mode \(ENABLE_TOOL_SEARCH\): unset/);
    assert.match(md, /## Crossover Analysis/);
    assert.doesNotMatch(md, /chained Bash calls/);
  });

  it('shows n/a for prompt-injection on tasks where it does not apply', async () => {
    const md = await generateReport({ rootDir: root, experiment: 'github', runName: 'r', tier: 1 });
    assert.match(md, /\| tier1_a \| 1 \| local-stdio \|.*\| n\/a \| 0% \|/);
  });

  it('reports an empty run without crashing', async () => {
    const md = await generateReport({ rootDir: root, experiment: 'github', runName: 'missing' });
    assert.match(md, /No results found/);
  });

  it('is reachable through the CLI and writes --output', async () => {
    const out = join(root, 'report.md');
    const run = spawnSync(process.execPath, ['--import', TSX, CLI, 'report', '--experiment', 'github', '--run', 'r', '--all-tiers', '--output', out], { cwd: root, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(await readFile(out, 'utf8'), /# Experiment Report: github \/ r/);
  });
});

describe('CLI argument validation', () => {
  const cli = (...args: string[]) => spawnSync(process.execPath, ['--import', TSX, CLI, ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_CONTROLLER_TOKEN: '' } });

  it('rejects a non-numeric --trials', () => {
    const run = cli('run', '--experiment', 'github', '--run', 'x', '--arm', 'baseline', '--trials', 'abc');
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /--trials must be an integer >= 1/);
  });

  it('rejects an unknown arm', () => {
    const run = cli('run', '--experiment', 'github', '--run', 'x', '--arm', 'sideways', '--trials', '1');
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Invalid arm "sideways"/);
  });

  it('rejects an unknown experiment', () => {
    const run = cli('report', '--experiment', 'nope', '--run', 'x');
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Unknown experiment "nope"/);
  });
});
