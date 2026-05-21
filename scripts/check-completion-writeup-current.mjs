import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateWriteup, requiredWriteupSections } from './lib/completion-writeup.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function writeupText(kind, runName, reportEvidencePath) {
  return [
    `# ${kind} synthetic writeup`,
    ...requiredWriteupSections(kind),
    `Final run: ${runName}`,
    `Evidence: ${reportEvidencePath}`,
    'Final evidence says token cost and latency were measured from the audited report.',
  ].join('\n');
}

const root = await mkdtemp(join(tmpdir(), 'completion-writeup-current-'));
const runName = 'synthetic-final';
const reportEvidencePath = `experiments/github/runs/${runName}/report.md`;
const reportPath = join(root, reportEvidencePath);
const visualPath = join(root, 'docs', 'writeup', 'visual-brief.md');
const longFormPath = join(root, 'docs', 'writeup', 'long-form.md');

try {
  await mkdir(join(root, 'docs', 'writeup'), { recursive: true });
  await mkdir(join(root, 'experiments', 'github', 'runs', runName), { recursive: true });
  await writeFile(reportPath, '# report\n', 'utf8');
  await writeFile(visualPath, `${writeupText('visual', runName, reportEvidencePath)}\n`, 'utf8');
  await writeFile(longFormPath, `${writeupText('long-form', runName, reportEvidencePath)}\n`, 'utf8');

  const reportTime = new Date('2026-05-20T00:00:00.000Z');
  const writeupTime = new Date('2026-05-20T00:00:05.000Z');
  const newerReportTime = new Date('2026-05-20T00:00:10.000Z');
  await utimes(reportPath, reportTime, reportTime);
  await utimes(visualPath, writeupTime, writeupTime);
  await utimes(longFormPath, writeupTime, writeupTime);

  const freshVisual = await evaluateWriteup({
    kind: 'visual',
    path: visualPath,
    runName,
    reportPath,
    reportEvidencePath,
  });
  assert(freshVisual.pass === true, `expected fresh visual brief to pass, got ${JSON.stringify(freshVisual)}`);

  const freshLongForm = await evaluateWriteup({
    kind: 'long-form',
    path: longFormPath,
    runName,
    reportPath,
    reportEvidencePath,
  });
  assert(freshLongForm.pass === true, `expected fresh long-form to pass, got ${JSON.stringify(freshLongForm)}`);

  await utimes(reportPath, newerReportTime, newerReportTime);
  const staleVisual = await evaluateWriteup({
    kind: 'visual',
    path: visualPath,
    runName,
    reportPath,
    reportEvidencePath,
  });
  assert(staleVisual.pass === false, 'expected visual brief to fail when report is newer');
  assert(
    staleVisual.blocker?.includes('report.md is newer'),
    `unexpected visual staleness blocker: ${JSON.stringify(staleVisual)}`,
  );

  await writeFile(visualPath, `${writeupText('visual', runName, reportEvidencePath)}\nTBD\n`, 'utf8');
  await utimes(visualPath, writeupTime, writeupTime);
  const placeholderVisual = await evaluateWriteup({
    kind: 'visual',
    path: visualPath,
    runName,
    reportPath,
    reportEvidencePath,
  });
  assert(placeholderVisual.pass === false, 'expected visual brief with placeholder to fail');
  assert(
    placeholderVisual.blocker?.includes('placeholders'),
    `unexpected placeholder blocker: ${JSON.stringify(placeholderVisual)}`,
  );

  console.log('completion writeup freshness regression passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
