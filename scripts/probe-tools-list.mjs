import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildLocalStdioProbeEnvWithToken, loadDotEnv, resolveGitHubToken } from './lib/github-env.mjs';

const IMAGE = 'ghcr.io/github/github-mcp-server@sha256:e3816a476a977cfb836e7d221510011436c654d11861db66ecfd826601aba6a4';
const REMOTE_URL = 'https://api.githubcopilot.com/mcp/';
const OUT_DIR = join(process.cwd(), 'artifacts', 'spike', 'tools-list');
const PROTOCOL_VERSION = '2025-06-18';

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function hasFlag(name) {
  return process.argv.includes(name);
}

function rpc(id, method, params = {}) {
  return { jsonrpc: '2.0', id, method, params };
}

function initializedNotification() {
  return { jsonrpc: '2.0', method: 'notifications/initialized' };
}

function initializeMessage(id) {
  return rpc(id, 'initialize', {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: 'local-vs-remote-mcp-probe', version: '0.0.0' },
  });
}

function normalizeTools(response) {
  const tools = response?.result?.tools;
  if (!Array.isArray(tools)) {
    throw new Error(`tools/list response did not include result.tools: ${JSON.stringify(response).slice(0, 500)}`);
  }
  return tools
    .map((tool) => ({
      name: String(tool.name ?? ''),
      description: typeof tool.description === 'string' ? tool.description : '',
    }))
    .filter((tool) => tool.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseSseOrJson(text) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return JSON.parse(trimmed);
  const dataLines = [];
  for (const line of trimmed.split(/\r?\n/)) {
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) {
    throw new Error(`Response was neither JSON nor SSE data: ${trimmed.slice(0, 500)}`);
  }
  return JSON.parse(dataLines.join('\n'));
}

async function postRemote(message, sessionId) {
  const headers = {
    accept: 'application/json, text/event-stream',
    'content-type': 'application/json',
    'mcp-protocol-version': PROTOCOL_VERSION,
  };
  const token = await resolveGitHubToken({ authSource: argValue('--auth-source') ?? 'auto' });
  if (token) headers.authorization = `Bearer ${token}`;
  if (sessionId) headers['mcp-session-id'] = sessionId;

  const res = await fetch(REMOTE_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(message),
  });
  const text = await res.text();
  if (!res.ok) {
    const www = res.headers.get('www-authenticate');
    throw new Error(`remote HTTP ${res.status}${www ? ` (${www})` : ''}: ${text.slice(0, 500)}`);
  }
  return {
    response: text.trim() ? parseSseOrJson(text) : null,
    sessionId: res.headers.get('mcp-session-id') ?? sessionId,
  };
}

async function probeRemote() {
  const init = await postRemote(initializeMessage(1));
  await postRemote(initializedNotification(), init.sessionId);
  const listed = await postRemote(rpc(2, 'tools/list'), init.sessionId);
  return normalizeTools(listed.response);
}

async function probeLocal() {
  const env = await buildLocalStdioProbeEnvWithToken({ authSource: argValue('--auth-source') ?? 'auto' });

  const child = spawn(
    'docker',
    ['run', '-i', '--rm', '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', '-e', 'GITHUB_TOOLSETS', '-e', 'GITHUB_HOST', IMAGE, 'stdio'],
    { env, stdio: ['pipe', 'pipe', 'pipe'] },
  );

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  child.stdin.write(`${JSON.stringify(initializeMessage(1))}\n`);
  child.stdin.write(`${JSON.stringify(initializedNotification())}\n`);
  child.stdin.write(`${JSON.stringify(rpc(2, 'tools/list'))}\n`);

  const response = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`timed out waiting for local tools/list. stderr: ${stderr.slice(0, 1000)}`));
    }, 60_000);

    child.stdout.on('data', () => {
      for (const line of stdout.split(/\r?\n/)) {
        if (!line.trim().startsWith('{')) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === 2) {
            clearTimeout(timeout);
            child.kill('SIGTERM');
            resolve(parsed);
          }
        } catch {
          // keep buffering
        }
      }
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code && code !== 143) {
        clearTimeout(timeout);
        reject(new Error(`local MCP exited ${code}. stderr: ${stderr.slice(0, 1000)}`));
      }
    });
  });

  return normalizeTools(response);
}

async function writeCatalog(name, tools) {
  await mkdir(OUT_DIR, { recursive: true });
  const path = join(OUT_DIR, `${name}.json`);
  await writeFile(path, `${JSON.stringify({ generatedAt: new Date().toISOString(), count: tools.length, tools }, null, 2)}\n`);
  console.log(`Wrote ${path} (${tools.length} tools)`);
}

function scrubErrorText(text) {
  return text
    .replace(/\bgh[opsr]_[A-Za-z0-9_]{20,255}\b/g, '***GITHUB_TOKEN_REDACTED***')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g, '***GITHUB_TOKEN_REDACTED***')
    .replace(/Bearer\s+(?!error=)[A-Za-z0-9._~+/-]{8,}=*/gi, 'Bearer ***REDACTED***');
}

async function writeFailure(name, err) {
  await mkdir(OUT_DIR, { recursive: true });
  const message = scrubErrorText(err instanceof Error ? err.message : String(err));
  const path = join(OUT_DIR, `${name}.error.txt`);
  await writeFile(path, `${message}\n`);
  console.error(message);
  console.error(`Wrote ${path}`);
}

async function compareCatalogs() {
  const localCatalog = JSON.parse(await readFile(join(OUT_DIR, 'local.json'), 'utf8'));
  const remoteCatalog = JSON.parse(await readFile(join(OUT_DIR, 'remote.json'), 'utf8'));
  const local = localCatalog.tools.map((t) => t.name);
  const remote = remoteCatalog.tools.map((t) => t.name);
  const localSet = new Set(local);
  const remoteSet = new Set(remote);
  const overlap = local.filter((name) => remoteSet.has(name)).sort();
  const localOnly = local.filter((name) => !remoteSet.has(name)).sort();
  const remoteOnly = remote.filter((name) => !localSet.has(name)).sort();
  const out = {
    generatedAt: new Date().toISOString(),
    localCount: local.length,
    remoteCount: remote.length,
    overlapCount: overlap.length,
    localOnlyCount: localOnly.length,
    remoteOnlyCount: remoteOnly.length,
    overlap,
    localOnly,
    remoteOnly,
  };
  await writeFile(join(OUT_DIR, 'overlap.json'), `${JSON.stringify(out, null, 2)}\n`);
  await writeFile(
    join(OUT_DIR, 'overlap.md'),
    [
      '# GitHub MCP Tool Catalog Diff',
      '',
      `Generated: ${out.generatedAt}`,
      '',
      `- Local tools: ${out.localCount}`,
      `- Remote tools: ${out.remoteCount}`,
      `- Overlap allow-list: ${out.overlapCount}`,
      `- Local-only: ${out.localOnlyCount}`,
      `- Remote-only: ${out.remoteOnlyCount}`,
      '',
      '## Overlap Allow-List',
      '',
      ...overlap.map((name) => `- ${name}`),
      '',
      '## Local-Only',
      '',
      ...(localOnly.length ? localOnly.map((name) => `- ${name}`) : ['(none)']),
      '',
      '## Remote-Only',
      '',
      ...(remoteOnly.length ? remoteOnly.map((name) => `- ${name}`) : ['(none)']),
      '',
    ].join('\n'),
  );
  console.log(`Overlap: ${overlap.length}; local-only: ${localOnly.length}; remote-only: ${remoteOnly.length}`);
}

async function main() {
  await loadDotEnv();

  if (hasFlag('--help') || hasFlag('-h')) {
    console.log('Usage: npm run probe:tools -- --arm local|remote [--auth-source auto|env|gh] OR npm run probe:tools -- --compare');
    return;
  }
  if (hasFlag('--compare')) {
    await compareCatalogs();
    return;
  }

  const arm = argValue('--arm');
  if (arm === 'local') {
    await writeCatalog('local', await probeLocal());
    return;
  }
  if (arm === 'remote') {
    await writeCatalog('remote', await probeRemote());
    return;
  }

  console.error('Usage: npm run probe:tools -- --arm local|remote [--auth-source auto|env|gh] OR npm run probe:tools -- --compare');
  process.exit(2);
}

try {
  await main();
} catch (err) {
  const arm = argValue('--arm') ?? (hasFlag('--compare') ? 'overlap' : 'probe');
  await writeFailure(arm, err);
  process.exit(1);
}
