import { readFile } from 'node:fs/promises';

const EXPECTED_IMAGE = 'ghcr.io/github/github-mcp-server@sha256:e3816a476a977cfb836e7d221510011436c654d11861db66ecfd826601aba6a4';
const EXPECTED_REMOTE_URL = 'https://api.githubcopilot.com/mcp/';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoLiteralToken(text, path) {
  assert(!/\bgh[opsr]_[A-Za-z0-9_]{20,255}\b/.test(text), `${path} must not contain a literal classic GitHub token`);
  assert(!/\bgithub_pat_[A-Za-z0-9_]{20,255}\b/.test(text), `${path} must not contain a literal fine-grained GitHub token`);
}

const localText = await readFile('.mcp.github.local.json', 'utf8');
const remoteText = await readFile('.mcp.github.remote.json', 'utf8');
assertNoLiteralToken(localText, '.mcp.github.local.json');
assertNoLiteralToken(remoteText, '.mcp.github.remote.json');

const local = JSON.parse(localText);
const remote = JSON.parse(remoteText);

const localGithub = local?.mcpServers?.github;
assert(localGithub?.type === 'stdio', 'local GitHub MCP server must use stdio transport');
assert(localGithub?.command === 'docker', 'local GitHub MCP server must launch through docker');
assert(localGithub?.env && Object.keys(localGithub.env).length === 0, 'local GitHub MCP config env block must not store secrets');
assert(Array.isArray(localGithub?.args), 'local GitHub MCP config must provide docker args');

const args = localGithub.args;
assert(args[0] === 'run' && args.includes('-i') && args.includes('--rm'), 'local Docker args must run interactively and remove the container');
assert(args.includes(EXPECTED_IMAGE), `local Docker args must use the expected digest-pinned image ${EXPECTED_IMAGE}`);
assert(!args.some((arg) => typeof arg === 'string' && /github-mcp-server:(latest|main|master)\b/.test(arg)), 'local Docker args must not use floating image tags');
assert(args.filter((arg) => arg === EXPECTED_IMAGE).length === 1, 'local Docker args must include the pinned image exactly once');
assert(args[args.length - 1] === 'stdio', 'local Docker args must invoke github-mcp-server stdio mode');
for (const expectedEnv of ['GITHUB_PERSONAL_ACCESS_TOKEN', 'GITHUB_TOOLSETS', 'GITHUB_HOST', 'HARMLESS_TOKEN']) {
  const envIndex = args.indexOf(expectedEnv);
  assert(envIndex > 0 && args[envIndex - 1] === '-e', `local Docker args must pass through ${expectedEnv} via -e ${expectedEnv}`);
}

const remoteGithub = remote?.mcpServers?.github;
assert(remoteGithub?.type === 'http', 'remote GitHub MCP server must use http transport');
assert(remoteGithub?.url === EXPECTED_REMOTE_URL, `remote GitHub MCP URL must be ${EXPECTED_REMOTE_URL}`);
assert(remoteGithub?.headers?.Authorization === 'Bearer ${GITHUB_PERSONAL_ACCESS_TOKEN}', 'remote Authorization header must use the GITHUB_PERSONAL_ACCESS_TOKEN placeholder');

const probeSource = await readFile('scripts/probe-tools-list.mjs', 'utf8');
assert(probeSource.includes(`const IMAGE = '${EXPECTED_IMAGE}'`), 'tools/list local probe must use the same pinned image as the MCP config');
assert(probeSource.includes(`const REMOTE_URL = '${EXPECTED_REMOTE_URL}'`), 'tools/list remote probe must use the same remote URL as the MCP config');

const githubExperimentSource = await readFile('harness/src/experiments/github.ts', 'utf8');
assert(githubExperimentSource.includes("mcpConfig: '.mcp.github.local.json'"), 'local arm must point at .mcp.github.local.json');
assert(githubExperimentSource.includes("mcpConfig: '.mcp.github.remote.json'"), 'remote arm must point at .mcp.github.remote.json');

for (const [path, required] of [
  ['README.md', [EXPECTED_IMAGE, EXPECTED_REMOTE_URL]],
  ['CLAUDE.md', [EXPECTED_IMAGE, EXPECTED_REMOTE_URL]],
]) {
  const text = await readFile(path, 'utf8');
  for (const value of required) {
    assert(text.includes(value), `${path} must document ${value}`);
  }
}

console.log('Provider config check passed.');
