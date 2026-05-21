import { readFile } from 'node:fs/promises';
import { parseTranscript } from '../harness/src/metrics.ts';
import { TOKEN_PATTERNS } from './lib/secret-patterns.mjs';

const classifier = { intendedMcpPrefix: 'mcp__github__' };
const samples = [
  `gho_${'A'.repeat(40)}`,
  `ghp_${'B'.repeat(40)}`,
  `ghs_${'C'.repeat(40)}`,
  `ghr_${'D'.repeat(40)}`,
  `github_pat_${'E'.repeat(82)}`,
];

function transcriptWithText(text) {
  return [
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text }],
      },
    }),
  ];
}

function parseReplacementRegexes(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith('regex:'))
    .map((line) => {
      const body = line.slice('regex:'.length).split('==>')[0];
      return new RegExp(body);
    });
}

const redactionText = await readFile('redaction/git-filter-repo-replacements.txt', 'utf8');
const redactionPatterns = parseReplacementRegexes(redactionText);

const failures = [];
for (const sample of samples) {
  if (!TOKEN_PATTERNS.some((pattern) => {
    pattern.re.lastIndex = 0;
    return pattern.re.test(sample);
  })) {
    failures.push(`scan patterns missed ${sample.slice(0, sample.indexOf('_') + 1)} sample`);
  }

  const metrics = parseTranscript(transcriptWithText(`assistant leaked ${sample}`), 'remote-http', classifier);
  if (!metrics.secretInOutput) {
    failures.push(`metrics secretInOutput missed ${sample.slice(0, sample.indexOf('_') + 1)} sample`);
  }

  if (!redactionPatterns.some((pattern) => pattern.test(sample))) {
    failures.push(`git-filter-repo redaction patterns missed ${sample.slice(0, sample.indexOf('_') + 1)} sample`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(failure);
  process.exit(1);
}

console.log('Secret pattern drift check passed.');
