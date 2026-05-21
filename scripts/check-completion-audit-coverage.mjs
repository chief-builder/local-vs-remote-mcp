import { readFile } from 'node:fs/promises';

const source = await readFile('scripts/check-completion.mjs', 'utf8');

function assertIncludes(needle, label = needle) {
  if (!source.includes(needle)) {
    throw new Error(`completion audit is missing ${label}`);
  }
}

for (const checkName of [
  'Phase 1 gates pass',
  'GitHub tool overlap is computed',
  'Static preflight passes',
  'Claude Code CLI auth passes',
  'Live verify-arms artifact passes',
  'Phase 2 performance smoke passes',
  'Final run name provided',
  'Final report exists and is current',
  'Final run matrix passes',
  'Final run artifacts have no token-shaped secrets',
  'Visual brief is filled',
  'Long-form writeup is filled',
]) {
  assertIncludes(checkName, `completion check: ${checkName}`);
}

for (const commandOrArtifact of [
  'npm run check:static',
  'npm run check:claude-auth',
  'artifacts',
  'verify-arms',
  'github.json',
  'latency-smoke',
  'npm run check:run -- --run',
  'npm run scan:secrets -- --path experiments/github/runs',
  'docs',
  'writeup',
  'visual-brief.md',
  'long-form.md',
  'experiments/github/runs',
  'report.md',
]) {
  assertIncludes(commandOrArtifact, `evidence reference: ${commandOrArtifact}`);
}

for (const helper of [
  'reportCurrent',
  'evaluateWriteup',
  'evaluatePerformanceSmoke',
  'newestMtimeMs',
  'briefOutput',
]) {
  assertIncludes(helper, `coverage helper: ${helper}`);
}

for (const sourcePath of [
  'harness',
  'src',
  'cli.ts',
  'runner.ts',
  'experiments',
  'github.ts',
  '.mcp.github.local.json',
  '.mcp.github.remote.json',
]) {
  assertIncludes(sourcePath, `freshness dependency: ${sourcePath}`);
}

assertIncludes('overlap.overlapCount === 41', 'explicit 41-tool overlap assertion');
assertIncludes('Number(expectedTrialsRaw)', 'completion parses expected trial count');
assertIncludes('Number.isInteger(expectedTrials)', 'completion validates integer trial count');
assertIncludes('process.exit(2)', 'completion exits usage error for invalid trial count');
assertIncludes('reportCurrent({', 'final report audit call');
assertIncludes("import { tasks } from '../experiments/github/tasks/index.ts';", 'completion derives report matrix from task metadata');
assertIncludes("const arms = ['baseline', 'local-stdio', 'remote-http'];", 'completion derives rows for all arms');
assertIncludes('task.applicableArms', 'completion honors task applicableArms metadata');
assertIncludes("experiment: 'github'", 'final report tied to GitHub experiment');
assertIncludes('runName,', 'final report tied to audited run name');
assertIncludes('expectedReportRows: expectedReportRows(expectedTrials)', 'final report covers expected matrix rows');
assertIncludes('tasksForArm(arm)', 'final report matrix rows are derived per arm');
assertIncludes('task.id', 'final report rows include task IDs from metadata');
assertIncludes('task.tier', 'final report rows include task tiers from metadata');
assertIncludes('verifyArms.arms.length === 3', 'three-arm live verifier assertion');
assertIncludes('verifyArms.arms.every((arm) => arm.pass === true)', 'all live arms pass assertion');
assertIncludes('checks.every((check) => check.pass)', 'completion aggregates every check');
assertIncludes('if (!summary.complete) process.exit(1)', 'nonzero exit on incomplete audit');

console.log('Completion audit coverage check passed.');
