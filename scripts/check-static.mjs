import { spawn } from 'node:child_process';

const checks = [
  ['npm', ['run', 'phase1:status', '--', '--strict']],
  ['npm', ['run', 'check:arms']],
  ['npm', ['run', 'typecheck']],
  ['npm', ['run', 'check:metrics']],
  ['npm', ['run', 'check:report-generation']],
  ['npm', ['run', 'check:completion-report-current']],
  ['npm', ['run', 'check:completion-writeup-current']],
  ['npm', ['run', 'check:completion-audit-coverage']],
  ['npm', ['run', 'check:evidence-matrix']],
  ['npm', ['run', 'check:docs-runbook']],
  ['npm', ['run', 'check:phase1-freshness']],
  ['npm', ['run', 'check:performance-smoke-audit']],
  ['npm', ['run', 'check:result-invariants']],
  ['npm', ['run', 'check:run-audit']],
  ['npm', ['run', 'check:run-final-plan']],
  ['npm', ['run', 'check:run-final-resume']],
  ['npm', ['run', 'check:run-matrix']],
  ['npm', ['run', 'check:static-audit']],
  ['npm', ['run', 'check:artifact-sanitization']],
  ['npm', ['run', 'check:secret-patterns']],
  ['npm', ['run', 'check:security-framing']],
  ['npm', ['run', 'check:harness-shape']],
  ['npm', ['run', 'check:provider-config']],
  ['npm', ['run', 'check:scripts']],
  ['npm', ['run', 'scan:secrets']],
  ['npm', ['run', 'check:whitespace']],
];

function run(command, args) {
  return new Promise((resolve) => {
    const label = [command, ...args].join(' ');
    console.log(`\n==> ${label}`);
    const child = spawn(command, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
    });
    child.on('close', (code, signal) => {
      resolve({ label, code: code ?? (signal ? 1 : 0) });
    });
    child.on('error', () => {
      resolve({ label, code: 1 });
    });
  });
}

const failures = [];
for (const [command, args] of checks) {
  const result = await run(command, args);
  if (result.code !== 0) failures.push(result);
}

if (failures.length > 0) {
  console.error('\nStatic checks failed:');
  for (const failure of failures) {
    console.error(`- ${failure.label} exited ${failure.code}`);
  }
  process.exit(1);
}

console.log('\nPASS static checks');
