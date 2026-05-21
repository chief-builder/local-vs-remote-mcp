import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { newestMtimeMs } from './completion-report.mjs';
import { validateResultArtifact } from './result-invariants.mjs';
import { scanTreeForTokenFindings, transcriptStatus } from './run-artifacts.mjs';

const smokeArms = ['local-stdio', 'remote-http'];
const smokeTask = 'tier1_pr_diff_answer';
const smokeTier = 1;
const smokeTrial = 1;

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function requireMetric(failures, condition, message) {
  if (!condition) failures.push(message);
}

export async function evaluatePerformanceSmoke({
  root,
  runName = 'latency-smoke',
} = {}) {
  const runRoot = join(root, 'experiments', 'github', 'runs', runName);
  const failures = [];
  const results = [];

  for (const arm of smokeArms) {
    const resultPath = join(runRoot, 'results', arm, smokeTask, `${smokeTrial}.json`);
    let result;
    try {
      result = await readJson(resultPath);
    } catch (err) {
      failures.push(`${resultPath}: missing or unreadable result JSON (${err instanceof Error ? err.message : String(err)})`);
      continue;
    }

    failures.push(...validateResultArtifact(result, {
      experiment: 'github',
      runName,
      arm,
      taskId: smokeTask,
      tier: smokeTier,
      trialN: smokeTrial,
      path: resultPath,
    }));

    const metrics = result.metrics ?? {};
    requireMetric(failures, metrics.toolCallCount > 0, `${resultPath}: smoke must include at least one tool call`);
    requireMetric(
      failures,
      Array.isArray(metrics.perToolCallLatencyMs) && metrics.perToolCallLatencyMs.length > 0,
      `${resultPath}: smoke must include per-tool latency samples`,
    );
    requireMetric(
      failures,
      Array.isArray(metrics.toolCalls) && metrics.toolCalls.some((call) => String(call.name ?? '').startsWith('mcp__github__')),
      `${resultPath}: smoke must exercise at least one GitHub MCP tool`,
    );
    requireMetric(failures, metrics.wallClockMs > 0, `${resultPath}: smoke must have positive wallClockMs`);
    results.push(result);

    const transcriptPath = join(runRoot, 'transcripts', arm, smokeTask, `${smokeTrial}.jsonl`);
    const transcript = await transcriptStatus(transcriptPath);
    if (!transcript.exists || !transcript.nonEmpty || !transcript.validJsonl || !transcript.secretFree) {
      failures.push(`${transcriptPath}: transcript must exist, be non-empty parseable JSONL, and be secret-free`);
    }
  }

  if (results.length === smokeArms.length && new Set(results.map((result) => result.seed)).size !== 1) {
    failures.push(`${runRoot}: local and remote smoke trials must share the paired seed`);
  }

  const secretFindings = await scanTreeForTokenFindings(runRoot, { baseDir: root });
  for (const finding of secretFindings) {
    failures.push(`${runRoot}: token-shaped secret finding ${finding}`);
  }

  const reportPath = join(runRoot, 'report.md');
  let reportStat;
  let reportText = '';
  try {
    reportStat = await stat(reportPath);
    reportText = await readFile(reportPath, 'utf8');
  } catch {
    failures.push(`${reportPath}: generate the Phase 2 smoke report`);
  }
  if (reportStat && !reportStat.isFile()) {
    failures.push(`${reportPath}: report path exists but is not a file`);
  }
  if (reportStat?.isFile()) {
    for (const required of [
      '## Per-Task Results',
      '## Per-Tier Summary',
      '## Crossover Analysis',
      smokeTask,
      'local-stdio',
      'remote-http',
    ]) {
      if (!reportText.includes(required)) {
        failures.push(`${reportPath}: missing required smoke report content ${required}`);
      }
    }
    const newestEvidence = Math.max(
      await newestMtimeMs(join(runRoot, 'results')),
      await newestMtimeMs(join(runRoot, 'transcripts')),
    );
    const newestReportDependency = Math.max(
      await newestMtimeMs(join(root, 'harness', 'src', 'report.ts')),
      await newestMtimeMs(join(root, 'harness', 'src', 'cli.ts')),
    );
    if (newestEvidence > 0 && reportStat.mtimeMs + 1000 < newestEvidence) {
      failures.push(`${reportPath}: regenerate the smoke report; result/transcript artifacts are newer`);
    }
    if (reportStat.mtimeMs + 1000 < newestReportDependency) {
      failures.push(`${reportPath}: regenerate the smoke report; report generation sources are newer`);
    }
  }

  return {
    pass: failures.length === 0,
    runName,
    evidence: runRoot,
    failures,
    blocker: failures.length > 0
      ? `Refresh Phase 2 performance smoke with local/remote ${smokeTask} N=1 and regenerate its report. Failures: ${failures.join('; ')}`
      : null,
  };
}
