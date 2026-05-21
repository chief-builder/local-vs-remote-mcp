import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

export async function newestMtimeMs(path) {
  let st;
  try {
    st = await stat(path);
  } catch {
    return 0;
  }
  if (st.isFile()) return st.mtimeMs;
  if (!st.isDirectory()) return 0;

  let newest = 0;
  let entries = [];
  try {
    entries = await readdir(path);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    newest = Math.max(newest, await newestMtimeMs(join(path, entry)));
  }
  return newest;
}

export async function reportCurrent({
  root,
  reportPath,
  runRoot,
  experiment = 'github',
  runName,
  expectedReportRows = [],
}) {
  let reportStat;
  try {
    reportStat = await stat(reportPath);
  } catch {
    return { pass: false, blocker: 'Generate the final report with harness report --all-tiers --crossover-analysis --include-cost.' };
  }
  if (!reportStat.isFile()) {
    return { pass: false, blocker: 'Report path exists but is not a file.' };
  }
  const text = await readFile(reportPath, 'utf8');
  if (runName) {
    const expectedTitle = `# Experiment Report: ${experiment} / ${runName}`;
    if (!text.includes(expectedTitle)) {
      return {
        pass: false,
        blocker: `Regenerate the final report for the audited run; missing title "${expectedTitle}".`,
      };
    }
  }
  const requiredSections = [
    '## Hypothesis Summary',
    '| H1 token cost: avg total tokens |',
    '| H1 wall-clock: avg time |',
    '| H1 tool latency: avg per-call latency |',
    '| H2 prompt-injection compliance |',
    '## Per-Task Results',
    '## Per-Tier Summary',
    '## Crossover Analysis',
    '## Appendix: Cost (USD)',
  ];
  const missingSections = requiredSections.filter((section) => !text.includes(section));
  if (missingSections.length > 0) {
    return {
      pass: false,
      blocker: `Regenerate the final report with hypothesis summary and cost/crossover sections. Missing: ${missingSections.join(', ')}`,
    };
  }
  const missingRows = expectedReportRows.filter((row) => !text.includes(row));
  if (missingRows.length > 0) {
    return {
      pass: false,
      blocker: `Regenerate the final report for the full expected matrix. Missing rows: ${missingRows.slice(0, 5).join(', ')}${missingRows.length > 5 ? ', ...' : ''}`,
    };
  }

  const newestEvidence = Math.max(
    await newestMtimeMs(join(runRoot, 'results')),
    await newestMtimeMs(join(runRoot, 'transcripts')),
  );
  const newestReportDependency = Math.max(
    await newestMtimeMs(join(root, 'harness', 'src', 'report.ts')),
    await newestMtimeMs(join(root, 'harness', 'src', 'cli.ts')),
    await newestMtimeMs(join(root, 'scripts', 'run-final.mjs')),
  );
  if (newestEvidence > 0 && reportStat.mtimeMs + 1000 < newestEvidence) {
    return {
      pass: false,
      blocker: 'Regenerate the final report; stored result/transcript artifacts are newer than report.md.',
    };
  }
  if (reportStat.mtimeMs + 1000 < newestReportDependency) {
    return {
      pass: false,
      blocker: 'Regenerate the final report; report generation sources are newer than report.md.',
    };
  }
  return { pass: true, blocker: null };
}
