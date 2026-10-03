import { readFile, stat } from 'node:fs/promises';

const visualSections = [
  '## Headline',
  '## First Screen',
  '## Panel 1: Tool Catalog',
  '## Panel 2: Performance',
  '## Panel 3: Reliability',
  '## Panel 4: Security',
  '## Panel 5: Threat Model',
  '## Footer',
];

const longFormSections = [
  '## Thesis',
  '## Method',
  '## Pre-Experiment Gates',
  '## Task Suite',
  '## Metrics',
  '## Results',
  '### H1: Cost and Latency',
  '### H2: Prompt Injection',
  '### Baseline Floor',
  '## Security Interpretation',
  '## Caveats',
  '## Reproduction',
  '## Appendix',
];

const placeholderPattern = /\bTBD\b|Status:\s*scaffold|scaffold only|<final-run>|Candidate framing|Claim template/i;

export function requiredWriteupSections(kind) {
  if (kind === 'visual') return visualSections;
  if (kind === 'long-form') return longFormSections;
  throw new Error(`unknown writeup kind: ${kind}`);
}

export async function evaluateWriteup({ kind, path, runName, reportPath, reportEvidencePath }) {
  let writeupStat;
  let text;
  try {
    writeupStat = await stat(path);
    if (!writeupStat.isFile()) {
      return { pass: false, blocker: 'Writeup path exists but is not a file.' };
    }
    text = await readFile(path, 'utf8');
  } catch {
    return { pass: false, blocker: 'Writeup file is missing.' };
  }

  const requiredEvidence = runName ? [runName, reportEvidencePath].filter(Boolean) : [];
  const hasPlaceholder = placeholderPattern.test(text);
  const missingSections = requiredWriteupSections(kind).filter((section) => !text.includes(section));
  const missingEvidence = requiredEvidence.filter((evidence) => !text.includes(evidence));
  if (hasPlaceholder) {
    return { pass: false, blocker: 'Replace scaffold/TBD/template placeholders with final-run evidence.' };
  }
  if (missingSections.length > 0) {
    return { pass: false, blocker: `Add required writeup sections: ${missingSections.join(', ')}` };
  }
  if (missingEvidence.length > 0) {
    return { pass: false, blocker: `Tie the writeup to this audited final run and report path: ${missingEvidence.join(', ')}` };
  }

  if (reportPath) {
    let reportStat;
    try {
      reportStat = await stat(reportPath);
    } catch {
      reportStat = null;
    }
    if (reportStat?.isFile() && writeupStat.mtimeMs + 1000 < reportStat.mtimeMs) {
      return {
        pass: false,
        blocker: 'Update the writeup after regenerating the final report; report.md is newer than this writeup.',
      };
    }
  }

  return { pass: true, blocker: null };
}
