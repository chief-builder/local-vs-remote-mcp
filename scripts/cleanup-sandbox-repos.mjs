import { loadDotEnv } from './lib/github-env.mjs';

const PREFIX = 'lvrmcp-';

function hasFlag(name) {
  return process.argv.includes(name);
}

function argValue(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} not set`);
  return value;
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'local-vs-remote-mcp-harness/1.0',
  };
}

async function ghRequest({ host, token, method, path }) {
  const res = await fetch(`https://${host}${path}`, {
    method,
    headers: ghHeaders(token),
  });
  if (res.status === 204) return null;
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub API ${method} ${path} -> ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function listSandboxRepos({ host, token, owner, prefix }) {
  const repos = [];
  for (let page = 1; page <= 20; page++) {
    const rows = await ghRequest({
      host,
      token,
      method: 'GET',
      path: `/orgs/${owner}/repos?type=all&per_page=100&page=${page}`,
    });
    if (!Array.isArray(rows) || rows.length === 0) break;
    repos.push(...rows.filter((repo) => typeof repo.name === 'string' && repo.name.startsWith(prefix)));
    if (rows.length < 100) break;
  }
  return repos.sort((a, b) => a.name.localeCompare(b.name));
}

await loadDotEnv();

const token = requireEnv('GITHUB_CONTROLLER_TOKEN');
const owner = argValue('--owner') ?? requireEnv('GITHUB_SANDBOX_OWNER');
const host = process.env.GITHUB_HOST ?? 'api.github.com';
const prefix = argValue('--prefix') ?? PREFIX;
const shouldDelete = hasFlag('--delete');
const confirmed = hasFlag('--yes');

if (!prefix.startsWith(PREFIX)) {
  throw new Error(`Refusing prefix "${prefix}". Prefix must start with ${PREFIX}`);
}
if (shouldDelete && !confirmed) {
  throw new Error('Refusing deletion without --yes. Re-run with --delete --yes after reviewing dry-run output.');
}

const repos = await listSandboxRepos({ host, token, owner, prefix });
console.log(`${shouldDelete ? 'DELETE' : 'DRY-RUN'} ${repos.length} repo(s) under ${owner} with prefix ${prefix}`);
for (const repo of repos) {
  console.log(`- ${repo.full_name}`);
}

if (shouldDelete) {
  for (const repo of repos) {
    await ghRequest({
      host,
      token,
      method: 'DELETE',
      path: `/repos/${repo.full_name}`,
    });
    console.log(`deleted ${repo.full_name}`);
  }
}
