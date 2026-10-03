import { readFile } from 'node:fs/promises';

const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const staticSource = await readFile('scripts/check-static.mjs', 'utf8');

const requiredStaticChecks = [
  'phase1:status',
  'check:arms',
  'typecheck',
  'check:metrics',
  'check:report-generation',
  'check:completion-report-current',
  'check:completion-writeup-current',
  'check:completion-audit-coverage',
  'check:evidence-matrix',
  'check:docs-runbook',
  'check:phase1-freshness',
  'check:performance-smoke-audit',
  'check:result-invariants',
  'check:run-audit',
  'check:run-final-plan',
  'check:run-final-resume',
  'check:run-matrix',
  'check:static-audit',
  'check:artifact-sanitization',
  'check:secret-patterns',
  'check:security-framing',
  'check:harness-shape',
  'check:provider-config',
  'check:scripts',
  'scan:secrets',
  'check:whitespace',
];

const packageScripts = packageJson.scripts ?? {};
const failures = [];

for (const name of requiredStaticChecks) {
  if (name !== 'phase1:status' && name !== 'typecheck' && name !== 'scan:secrets' && !name.startsWith('check:')) {
    failures.push(`invalid required static check name: ${name}`);
  }
  if (!packageScripts[name]) {
    failures.push(`package.json is missing script ${name}`);
  }
  if (!staticSource.includes(`'${name}'`) && !staticSource.includes(`"${name}"`)) {
    failures.push(`scripts/check-static.mjs does not run ${name}`);
  }
}

if (!staticSource.includes("'--strict'") && !staticSource.includes('"--strict"')) {
  failures.push('scripts/check-static.mjs must run phase1:status with --strict');
}

if (!staticSource.includes("['npm', ['run', 'scan:secrets']]")
  && !staticSource.includes('["npm", ["run", "scan:secrets"]]')) {
  failures.push('scripts/check-static.mjs must run the full-repo secret scan without a narrowed --path');
}

if (packageScripts['check:completion'] !== 'node --import tsx scripts/check-completion.mjs') {
  failures.push('check:completion must run through tsx so it derives report rows from task metadata');
}

if (failures.length > 0) {
  console.error('Static gate audit failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Static gate audit passed.');
