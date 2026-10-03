import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const path = join(process.cwd(), 'docs', 'writeup', 'evidence-matrix.md');
const text = await readFile(path, 'utf8');

function assertIncludes(needle, label = needle) {
  if (!text.includes(needle)) {
    throw new Error(`evidence matrix is missing ${label}`);
  }
}

const requiredRows = [
  'Three arms exist',
  'Local provider is digest-pinned GitHub MCP Docker image',
  'Remote provider is GitHub hosted MCP streamable HTTP',
  '`tools/list` probed for both transports and overlap computed',
  'MCP arms use only overlap allow-list',
  'Baseline has no GitHub MCP tools',
  'Claude Code CLI is logged in for live trials',
  'Non-interactive remote auth works',
  'Local env scrub prevents harness-internal token leak',
  'Token scrub list and secret regexes are present',
  'Pre-push secret scan exists',
  'Shared harness shape is reused, not forked per experiment',
  'Paired-seed task model exists',
  'Validity classifier exists',
  'New metric: `perToolCallLatencyMs`',
  'New metric: `coldStartMs`',
  'New metric: `transportFailures`',
  'New metric: `promptInjectionCompliance`',
  'New metric: `secretInOutput`',
  'Security framing captured in CLAUDE.md',
  'Tier 3 tasks exist',
  'Phase 2 performance smoke N=1',
  'Phase 3 full N=5 across all arms',
  'Final N=5 command path is reproducible',
  'Phase 4 security tier final run',
  'Phase 5 visual brief',
  'Phase 5 long-form writeup',
];

for (const row of requiredRows) {
  assertIncludes(`| ${row}`, `required row: ${row}`);
}

const requiredEvidence = [
  'npm run phase1:status -- --strict',
  'npm run check:arms',
  'npm run check:claude-auth',
  'npm run check:run -- --run <final-run> --trials 5',
  'npm run scan:secrets -- --path experiments/github/runs/<final-run>',
  'npm run check:completion -- --run <final-run> --trials 5',
  'npm run check:completion-writeup-current',
  'npm run check:harness-shape',
  'npm run check:provider-config',
  'npm run check:security-framing',
  'artifacts/spike/tools-list/overlap.json',
  'artifacts/spike/env-scrub/local-stdio-env.json',
  'artifacts/spike/auth/remote-smoke.json',
  'experiments/github/runs/<final-run>/report.md',
  'experiments/github/runs/full-n5-20260520/report.md',
  'docs/writeup/visual-brief.md',
  'docs/writeup/long-form.md',
];

for (const evidence of requiredEvidence) {
  assertIncludes(evidence, `evidence reference: ${evidence}`);
}

for (const metric of ['perToolCallLatencyMs', 'coldStartMs', 'transportFailures', 'promptInjectionCompliance', 'secretInOutput']) {
  assertIncludes(metric, `metric reference: ${metric}`);
}

for (const securityTask of ['tier3_tool_poisoning_resilience', 'tier3_env_leak_local', 'tier3_oauth_scope_audit']) {
  assertIncludes(securityTask, `security task reference: ${securityTask}`);
}

for (const status of ['Implemented', 'Partially verified', 'Blocked']) {
  assertIncludes(`| ${status} |`, `status marker: ${status}`);
}

assertIncludes(
  'Completion rule: the goal is not complete until the blocked Claude Code auth and live `verify-arms` rows have concrete current evidence.',
  'completion rule',
);

console.log('Evidence matrix audit passed.');
