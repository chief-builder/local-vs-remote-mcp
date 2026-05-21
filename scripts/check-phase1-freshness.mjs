import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function runPhase1Status(cwd) {
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [
      resolve('scripts/phase1-status.mjs'),
      '--strict',
    ], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code, signal) => {
      resolvePromise({ code: code ?? (signal ? 1 : 0), stdout, stderr });
    });
    child.on('error', (err) => {
      resolvePromise({ code: 1, stdout, stderr: err.message });
    });
  });
}

async function writeFixture(root) {
  const toolsDir = join(root, 'artifacts', 'spike', 'tools-list');
  const authDir = join(root, 'artifacts', 'spike', 'auth');
  const scrubDir = join(root, 'artifacts', 'spike', 'env-scrub');
  await mkdir(toolsDir, { recursive: true });
  await mkdir(authDir, { recursive: true });
  await mkdir(scrubDir, { recursive: true });
  await mkdir(join(root, 'scripts', 'lib'), { recursive: true });

  await writeFile(join(root, 'scripts', 'probe-tools-list.mjs'), 'export {}\n', 'utf8');
  await writeFile(join(root, 'scripts', 'env-scrub-probe.mjs'), 'export {}\n', 'utf8');
  await writeFile(join(root, 'scripts', 'lib', 'github-env.mjs'), 'export {}\n', 'utf8');
  await writeFile(join(root, '.mcp.github.local.json'), '{}\n', 'utf8');

  await writeFile(join(toolsDir, 'local.json'), '{"count":1,"tools":[{"name":"issue_read"}]}\n', 'utf8');
  await writeFile(join(toolsDir, 'remote.json'), '{"count":1,"tools":[{"name":"issue_read"}]}\n', 'utf8');
  await writeFile(join(toolsDir, 'overlap.json'), `${JSON.stringify({
    generatedAt: '2026-05-20T00:00:00.000Z',
    localCount: 1,
    remoteCount: 1,
    overlapCount: 1,
    localOnlyCount: 0,
    remoteOnlyCount: 0,
    overlap: ['issue_read'],
    localOnly: [],
    remoteOnly: [],
  }, null, 2)}\n`, 'utf8');
  await writeFile(join(toolsDir, 'overlap.md'), '# overlap\n', 'utf8');
  await writeFile(join(authDir, 'remote-smoke.json'), '{"pass":true,"method":"bearer-header-from-env-agent-token"}\n', 'utf8');
  await writeFile(join(scrubDir, 'local-stdio-env.json'), '{"pass":true,"forbiddenSurvivors":[]}\n', 'utf8');
}

const root = await mkdtemp(join(tmpdir(), 'phase1-freshness-'));
try {
  await writeFixture(root);

  const old = new Date('2026-05-20T00:00:00.000Z');
  const current = new Date('2026-05-20T00:00:05.000Z');
  const newer = new Date('2026-05-20T00:00:10.000Z');
  for (const sourcePath of [
    join(root, 'scripts', 'probe-tools-list.mjs'),
    join(root, 'scripts', 'env-scrub-probe.mjs'),
    join(root, 'scripts', 'lib', 'github-env.mjs'),
    join(root, '.mcp.github.local.json'),
  ]) {
    await utimes(sourcePath, old, old);
  }
  for (const artifactPath of [
    join(root, 'artifacts', 'spike', 'tools-list', 'local.json'),
    join(root, 'artifacts', 'spike', 'tools-list', 'remote.json'),
    join(root, 'artifacts', 'spike', 'tools-list', 'overlap.json'),
    join(root, 'artifacts', 'spike', 'tools-list', 'overlap.md'),
    join(root, 'artifacts', 'spike', 'auth', 'remote-smoke.json'),
    join(root, 'artifacts', 'spike', 'env-scrub', 'local-stdio-env.json'),
  ]) {
    await utimes(artifactPath, current, current);
  }

  const fresh = await runPhase1Status(root);
  assert(fresh.code === 0, `expected fresh Phase 1 fixture to pass:\n${fresh.stderr}\n${fresh.stdout}`);

  await utimes(join(root, 'scripts', 'probe-tools-list.mjs'), newer, newer);
  const staleCatalog = await runPhase1Status(root);
  assert(staleCatalog.code !== 0, 'expected stale catalog/auth artifacts to fail when probe source is newer');
  assert(
    staleCatalog.stdout.includes('tools/list artifact is stale')
      && staleCatalog.stdout.includes('remote auth smoke artifact is stale'),
    `unexpected stale catalog output:\n${staleCatalog.stderr}\n${staleCatalog.stdout}`,
  );

  await utimes(join(root, 'scripts', 'probe-tools-list.mjs'), old, old);
  await utimes(join(root, 'scripts', 'env-scrub-probe.mjs'), newer, newer);
  const staleScrub = await runPhase1Status(root);
  assert(staleScrub.code !== 0, 'expected stale env-scrub artifact to fail when env-scrub source is newer');
  assert(
    staleScrub.stdout.includes('local env-scrub artifact is stale'),
    `unexpected stale env-scrub output:\n${staleScrub.stderr}\n${staleScrub.stdout}`,
  );

  console.log('Phase 1 freshness regression passed.');
} finally {
  await rm(root, { recursive: true, force: true });
}
