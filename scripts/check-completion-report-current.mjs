import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { reportCurrent } from './lib/completion-report.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const reportText = [
  '# Experiment Report: github / synthetic',
  '## Hypothesis Summary',
  '| H1 token cost: avg total tokens |',
  '| H1 wall-clock: avg time |',
  '| H1 tool latency: avg per-call latency |',
  '| H2 prompt-injection compliance |',
  '## Per-Task Results',
  '| tier1_repo_inventory | 1 | baseline | 5 |',
  '## Per-Tier Summary',
  '## Crossover Analysis',
  '## Appendix: Cost (USD)',
].join('\n');

const root = await mkdtemp(join(tmpdir(), 'completion-report-current-'));
const runRoot = join(root, 'experiments', 'github', 'runs', 'synthetic');
const reportPath = join(runRoot, 'report.md');
const reportSource = join(root, 'harness', 'src', 'report.ts');
const cliSource = join(root, 'harness', 'src', 'cli.ts');
const finalDriver = join(root, 'scripts', 'run-final.mjs');

try {
  await mkdir(join(runRoot, 'results'), { recursive: true });
  await mkdir(join(runRoot, 'transcripts'), { recursive: true });
  await mkdir(join(root, 'harness', 'src'), { recursive: true });
  await mkdir(join(root, 'scripts'), { recursive: true });

  await writeFile(join(runRoot, 'results', 'fixture.json'), '{}\n', 'utf8');
  await writeFile(join(runRoot, 'transcripts', 'fixture.jsonl'), '{}\n', 'utf8');
  await writeFile(reportSource, 'export {}\n', 'utf8');
  await writeFile(cliSource, 'export {}\n', 'utf8');
  await writeFile(finalDriver, 'export {}\n', 'utf8');
  await writeFile(reportPath, `${reportText}\n`, 'utf8');

  const old = new Date('2026-05-20T00:00:00.000Z');
  const current = new Date('2026-05-20T00:00:05.000Z');
  const newer = new Date('2026-05-20T00:00:10.000Z');
  await utimes(join(runRoot, 'results', 'fixture.json'), current, current);
  await utimes(join(runRoot, 'transcripts', 'fixture.jsonl'), current, current);
  await utimes(reportSource, old, old);
  await utimes(cliSource, old, old);
  await utimes(finalDriver, old, old);
  await utimes(reportPath, current, current);

  const fresh = await reportCurrent({ root, reportPath, runRoot });
  assert(fresh.pass === true, `expected fresh report to pass, got ${JSON.stringify(fresh)}`);

  const matrixRow = await reportCurrent({
    root,
    reportPath,
    runRoot,
    runName: 'synthetic',
    expectedReportRows: ['| tier1_repo_inventory | 1 | baseline | 5 |'],
  });
  assert(matrixRow.pass === true, `expected exact-run report matrix row to pass, got ${JSON.stringify(matrixRow)}`);

  const missingMatrixRow = await reportCurrent({
    root,
    reportPath,
    runRoot,
    runName: 'synthetic',
    expectedReportRows: ['| tier1_repo_inventory | 1 | local-stdio | 5 |'],
  });
  assert(missingMatrixRow.pass === false, 'expected missing report matrix row check to fail');
  assert(
    missingMatrixRow.blocker?.includes('full expected matrix'),
    `unexpected missing-row blocker: ${JSON.stringify(missingMatrixRow)}`,
  );

  const wrongRun = await reportCurrent({ root, reportPath, runRoot, runName: 'other-run' });
  assert(wrongRun.pass === false, 'expected wrong-run report check to fail');
  assert(
    wrongRun.blocker?.includes('missing title'),
    `unexpected wrong-run blocker: ${JSON.stringify(wrongRun)}`,
  );

  await utimes(reportSource, newer, newer);
  const staleBySource = await reportCurrent({ root, reportPath, runRoot });
  assert(staleBySource.pass === false, 'expected report newer-source check to fail');
  assert(
    staleBySource.blocker?.includes('report generation sources are newer'),
    `unexpected source-staleness blocker: ${JSON.stringify(staleBySource)}`,
  );

  await utimes(reportSource, old, old);
  await utimes(join(runRoot, 'results', 'fixture.json'), newer, newer);
  const staleByEvidence = await reportCurrent({ root, reportPath, runRoot });
  assert(staleByEvidence.pass === false, 'expected report newer-evidence check to fail');
  assert(
    staleByEvidence.blocker?.includes('result/transcript artifacts are newer'),
    `unexpected evidence-staleness blocker: ${JSON.stringify(staleByEvidence)}`,
  );

  console.log('completion report freshness regression passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
