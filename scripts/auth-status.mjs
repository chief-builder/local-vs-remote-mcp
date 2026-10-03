import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { TOKEN_PATTERNS } from '../harness/src/secretPatterns.ts';
import { loadDotEnv, resolveGitHubToken } from './lib/github-env.mjs';

const execFileAsync = promisify(execFile);
const outDir = join(process.cwd(), 'artifacts', 'spike', 'auth');

async function commandStatus(command, args) {
  try {
    const result = await execFileAsync(command, args, {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    return {
      ok: true,
      exitCode: 0,
      stdout: sanitize(result.stdout),
      stderr: sanitize(result.stderr),
    };
  } catch (err) {
    return {
      ok: false,
      exitCode: typeof err?.code === 'number' ? err.code : 1,
      stdout: sanitize(err?.stdout ?? ''),
      stderr: sanitize(err?.stderr ?? err?.message ?? String(err)),
    };
  }
}

function sanitize(text) {
  let out = String(text);
  for (const { re } of TOKEN_PATTERNS) out = out.replace(re, '***GITHUB_TOKEN_REDACTED***');
  return out.replace(/Bearer\s+(?!error=)[A-Za-z0-9._~+/-]{8,}=*/gi, 'Bearer ***REDACTED***');
}

// The artifact is committed, so keep only what the gate needs: whether the
// command worked, and (for `claude mcp list`) whether a GitHub server is
// configured. Raw output can list unrelated personal connectors.
function summarize(result, extra = {}) {
  return { ok: result.ok, exitCode: result.exitCode, ...extra };
}

async function remoteMetadataStatus() {
  try {
    const res = await fetch('https://api.githubcopilot.com/.well-known/oauth-protected-resource/mcp/');
    return {
      ok: res.ok,
      status: res.status,
      body: res.ok ? await res.json() : sanitize(await res.text()),
    };
  } catch (err) {
    return {
      ok: false,
      error: sanitize(err instanceof Error ? err.message : String(err)),
    };
  }
}

await loadDotEnv();
const envHasToken = Boolean(process.env.GITHUB_PERSONAL_ACCESS_TOKEN || process.env.GITHUB_AGENT_TOKEN);
const token = await resolveGitHubToken({ authSource: 'auto' });
const ghStatus = await commandStatus('gh', ['auth', 'status']);
const claudeMcpList = await commandStatus('claude', ['mcp', 'list']);
const metadata = await remoteMetadataStatus();

const status = {
  generatedAt: new Date().toISOString(),
  envHasGitHubToken: envHasToken,
  autoTokenAvailable: Boolean(token),
  ghAuthStatus: summarize(ghStatus),
  claudeMcpList: summarize(claudeMcpList, { githubServerConfigured: /github/i.test(claudeMcpList.stdout) }),
  remoteProtectedResourceMetadata: metadata,
  nextSteps: [
    'Set GITHUB_PERSONAL_ACCESS_TOKEN in .env or repair gh auth login.',
    'Then run npm run probe:tools -- --arm local and npm run probe:tools -- --arm remote.',
    'If using Claude Code OAuth, configure github-remote and capture artifacts/spike/auth/remote-smoke.json.',
  ],
};

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, 'status.json'), `${JSON.stringify(status, null, 2)}\n`, 'utf8');
console.log(`env token: ${envHasToken ? 'present' : 'missing'}`);
console.log(`auto token: ${token ? 'available' : 'missing'}`);
console.log(`gh auth: ${ghStatus.ok ? 'ok' : 'not usable'}`);
console.log(`claude mcp list: ${claudeMcpList.ok ? 'ok' : 'not usable'}`);
console.log(`remote metadata: ${metadata.ok ? 'ok' : 'not usable'}`);
console.log(`Wrote ${join(outDir, 'status.json')}`);
