import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { newestMtimeMs } from './lib/completion-report.mjs';

const root = process.cwd();
const outDir = join(root, 'artifacts', 'spike');

function hasFlag(name) {
  return process.argv.includes(name);
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function fileMtimeMs(path) {
  try {
    const st = await stat(path);
    return st.isFile() ? st.mtimeMs : 0;
  } catch {
    return 0;
  }
}

async function requireNewerThan(path, dependencyPaths, blockers, label) {
  if (!(await exists(path))) return;
  const artifactTime = await fileMtimeMs(path);
  const newestDependency = Math.max(...(await Promise.all(dependencyPaths.map((dep) => newestMtimeMs(dep)))));
  if (newestDependency > 0 && artifactTime + 1000 < newestDependency) {
    blockers.push(`${label} is stale; regenerate ${path} because probe/config sources are newer`);
  }
}

// Record repo-relative paths so the committed artifact is machine-independent.
function rel(text) {
  return text.split(root + '/').join('');
}

function gate(id, name, pass, evidence, blockers) {
  return { id, name, pass, evidence: evidence.map((path) => relative(root, path)), blockers: blockers.map(rel) };
}

function probeSourcePath() {
  return join(root, 'scripts', 'probe-tools-list.mjs');
}

async function gate1() {
  const toolsDir = join(outDir, 'tools-list');
  const localPath = join(toolsDir, 'local.json');
  const remotePath = join(toolsDir, 'remote.json');
  const overlapPath = join(toolsDir, 'overlap.json');
  const overlapMdPath = join(toolsDir, 'overlap.md');
  const evidence = [];
  const blockers = [];

  for (const path of [localPath, remotePath, overlapPath, overlapMdPath]) {
    if (await exists(path)) evidence.push(path);
    else blockers.push(`missing ${path}`);
  }

  let countsOk = false;
  if (await exists(overlapPath)) {
    try {
      const overlap = await readJson(overlapPath);
      countsOk =
        Number(overlap.localCount) > 0 &&
        Number(overlap.remoteCount) > 0 &&
        Number(overlap.overlapCount) > 0 &&
        Array.isArray(overlap.overlap);
      if (!countsOk) blockers.push('overlap artifact exists but counts are empty or malformed');
    } catch (err) {
      blockers.push(`overlap artifact is not readable JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const catalogDependencies = [probeSourcePath()];
  await requireNewerThan(localPath, catalogDependencies, blockers, 'local tools/list artifact');
  await requireNewerThan(remotePath, catalogDependencies, blockers, 'remote tools/list artifact');
  await requireNewerThan(overlapPath, [localPath, remotePath, ...catalogDependencies], blockers, 'overlap artifact');
  await requireNewerThan(overlapMdPath, [overlapPath], blockers, 'overlap markdown artifact');

  return gate('gate1', 'tools/list local+remote overlap computed', blockers.length === 0 && countsOk, evidence, blockers);
}

async function gate2() {
  const remoteCatalog = join(outDir, 'tools-list', 'remote.json');
  const smokePath = join(outDir, 'auth', 'remote-smoke.json');
  const evidence = [];
  const blockers = [];

  if (await exists(remoteCatalog)) evidence.push(remoteCatalog);
  else blockers.push(`missing successful remote tools/list artifact ${remoteCatalog}`);

  if (await exists(smokePath)) {
    evidence.push(smokePath);
    try {
      const smoke = await readJson(smokePath);
      if (smoke.pass !== true) blockers.push('remote smoke artifact does not have pass=true');
      if (!smoke.method) blockers.push('remote smoke artifact is missing method');
    } catch (err) {
      blockers.push(`remote smoke artifact is not readable JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    blockers.push(`missing non-interactive remote smoke artifact ${smokePath}`);
  }
  await requireNewerThan(smokePath, [probeSourcePath()], blockers, 'remote auth smoke artifact');

  return gate('gate2', 'non-interactive remote auth smoke', blockers.length === 0, evidence, blockers);
}

async function gate3() {
  const scrubPath = join(outDir, 'env-scrub', 'local-stdio-env.json');
  const evidence = [];
  const blockers = [];

  if (await exists(scrubPath)) {
    evidence.push(scrubPath);
    try {
      const scrub = await readJson(scrubPath);
      if (scrub.pass !== true) blockers.push('env scrub artifact does not have pass=true');
      const forbidden = Array.isArray(scrub.forbiddenSurvivors) ? scrub.forbiddenSurvivors : [];
      if (forbidden.length > 0) blockers.push('env scrub artifact contains forbidden survivors');
    } catch (err) {
      blockers.push(`env scrub artifact is not readable JSON: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    blockers.push(`missing env scrub artifact ${scrubPath}`);
  }
  await requireNewerThan(
    scrubPath,
    [join(root, 'scripts', 'env-scrub-probe.mjs'), join(root, 'harness', 'src', 'env.ts'), join(root, '.mcp.github.local.json')],
    blockers,
    'local env-scrub artifact',
  );

  return gate('gate3', 'local-stdio env scrub probe', blockers.length === 0, evidence, blockers);
}

function markdownReport(status) {
  const lines = ['# Phase 1 Gate Status', '', `Generated: ${status.generatedAt}`, '', `Overall: ${status.pass ? 'PASS' : 'BLOCKED'}`, ''];

  for (const g of status.gates) {
    lines.push(`## ${g.id}: ${g.name}`);
    lines.push('');
    lines.push(`Status: ${g.pass ? 'PASS' : 'BLOCKED'}`);
    lines.push('');
    lines.push('Evidence:');
    if (g.evidence.length > 0) {
      for (const item of g.evidence) lines.push(`- ${item}`);
    } else {
      lines.push('- none');
    }
    lines.push('');
    lines.push('Blockers:');
    if (g.blockers.length > 0) {
      for (const item of g.blockers) lines.push(`- ${item}`);
    } else {
      lines.push('- none');
    }
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

const gates = [await gate1(), await gate2(), await gate3()];
const status = {
  generatedAt: new Date().toISOString(),
  pass: gates.every((g) => g.pass),
  gates,
};

// --strict is a read-only gate; the plain command refreshes the artifacts.
if (!hasFlag('--strict')) {
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'phase1-status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  await writeFile(join(outDir, 'phase1-status.md'), markdownReport(status), 'utf8');
}

for (const g of gates) {
  console.log(`${g.pass ? 'PASS' : 'BLOCKED'} ${g.id}: ${g.name}`);
  for (const blocker of g.blockers) console.log(`  - ${blocker}`);
}
console.log(`Overall: ${status.pass ? 'PASS' : 'BLOCKED'}`);

if (hasFlag('--strict') && !status.pass) {
  process.exit(1);
}
