import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();

async function read(path) {
  return readFile(join(root, path), 'utf8');
}

function assertIncludes(text, needle, label = needle) {
  if (!text.includes(needle)) {
    throw new Error(`missing ${label}`);
  }
}

function assertNotIncludes(text, needle, label = needle) {
  if (text.includes(needle)) {
    throw new Error(`unexpected stale text: ${label}`);
  }
}

const readme = await read('README.md');
const runbook = await read('docs/runbook.md');
const writeupReadme = await read('docs/writeup/README.md');
const phase1 = await read('docs/spikes/phase1-gates.md');

for (const command of [
  'npm run check:evidence-matrix',
  'npm run check:static',
  'npm run check:completion -- --run <final-run> --trials 5',
  'npm run run:final -- --run <final-run> --trials 5 --dry-run',
  'npm run run:final -- --run <final-run> --trials 5 --resume',
]) {
  assertIncludes(readme, command, `README command ${command}`);
}

assertIncludes(readme, 'evidence-matrix audit', 'README static-check description of evidence-matrix audit');
assertIncludes(readme, 'claude auth login', 'README auth recovery command');
assertIncludes(readme, 'N=5 result matrix, final report, run-artifact secret scan, visual brief, and long-form writeup now pass', 'README current final-run status');
assertIncludes(readme, 'remaining expected failures are current Claude Code auth and live `verify-arms` freshness', 'README current completion blocker');
assertNotIncludes(readme, 'remaining trial cells', 'obsolete README remaining trial cells status');
assertNotIncludes(readme, 'writeup can finish', 'obsolete README writeup status');
assertNotIncludes(readme, 'writeup scaffolds have been replaced', 'obsolete README writeup scaffold status');

for (const command of [
  'npm run check:static',
  'npm run check:claude-auth',
  'npm run harness -- verify-arms --experiment github --output artifacts/verify-arms/github.json',
  'npm run harness -- run --experiment github --run latency-smoke --arm local-stdio --task tier1_pr_diff_answer --trials 1',
  'npm run harness -- run --experiment github --run latency-smoke --arm remote-http --task tier1_pr_diff_answer --trials 1',
  'npm run harness -- report --experiment github --run latency-smoke --all-tiers --crossover-analysis --include-cost --output experiments/github/runs/latency-smoke/report.md',
  'npm run run:final -- --run "$RUN" --trials 5 --dry-run',
  'npm run run:final -- --run "$RUN" --trials 5 --resume',
  'npm run check:completion -- --run "$RUN" --trials 5',
]) {
  assertIncludes(runbook, command, `runbook command ${command}`);
}

assertIncludes(runbook, 'claude auth login', 'runbook auth recovery command');
assertIncludes(runbook, 'Refresh Phase 2 performance smoke', 'runbook resume smoke-refresh explanation');

for (const artifact of [
  'artifacts/spike/tools-list/overlap.md',
  'artifacts/spike/phase1-status.md',
  'experiments/github/runs/full-n5-20260520/report.md',
  'experiments/github/runs/full-n5-20260520/results/**/<trial>.json',
  'experiments/github/runs/full-n5-20260520/transcripts/**/*.jsonl',
  'experiments/github/runs/<final-run>/report.md',
  'experiments/github/runs/<final-run>/results/**/<trial>.json',
  'experiments/github/runs/<final-run>/transcripts/**/*.jsonl',
]) {
  assertIncludes(writeupReadme, artifact, `writeup input ${artifact}`);
}

for (const command of [
  'npm run check:static',
  'npm run check:claude-auth',
  'npm run harness -- verify-arms --experiment github --output artifacts/verify-arms/github.json',
  'npm run check:completion -- --run <final-run> --trials 5',
]) {
  assertIncludes(writeupReadme, command, `writeup publish command ${command}`);
}

for (const artifact of [
  'artifacts/spike/tools-list/local.json',
  'artifacts/spike/tools-list/remote.json',
  'artifacts/spike/tools-list/overlap.json',
  'artifacts/spike/tools-list/overlap.md',
  'artifacts/spike/env-scrub/local-stdio-env.json',
]) {
  assertIncludes(phase1, artifact, `phase1 artifact ${artifact}`);
}

assertIncludes(phase1, 'Current status:', 'phase1 current status');
assertNotIncludes(phase1, 'Status as of bootstrap: not yet proven.', 'obsolete bootstrap status');

console.log('Docs runbook audit passed.');
