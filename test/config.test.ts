import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { PLAYWRIGHT_REMOTE_URL, readGithubEnv } from '../harness/src/config.ts';
import { ghConfigFromEnv } from '../experiments/github/provisioner.ts';

// Test-only placeholder values; not real credentials.
const valid = {
  GITHUB_CONTROLLER_TOKEN: 'test-controller-value',
  GITHUB_AGENT_TOKEN: 'test-agent-value',
  GITHUB_SANDBOX_OWNER: 'example-lab',
};

describe('readGithubEnv', () => {
  it('accepts a complete configuration', () => {
    assert.equal(readGithubEnv(valid).GITHUB_SANDBOX_OWNER, 'example-lab');
  });

  it('accepts GITHUB_PERSONAL_ACCESS_TOKEN in place of GITHUB_AGENT_TOKEN', () => {
    const { GITHUB_AGENT_TOKEN: _omit, ...rest } = valid;
    assert.doesNotThrow(() => readGithubEnv({ ...rest, GITHUB_PERSONAL_ACCESS_TOKEN: 'test-pat-value' }));
  });

  it('lists every missing value', () => {
    assert.throws(() => readGithubEnv({}), (err: Error) => {
      assert.match(err.message, /GITHUB_CONTROLLER_TOKEN/);
      assert.match(err.message, /GITHUB_SANDBOX_OWNER/);
      return true;
    });
  });

  it('treats blank values as missing', () => {
    assert.throws(() => readGithubEnv({ ...valid, GITHUB_CONTROLLER_TOKEN: '' }), /GITHUB_CONTROLLER_TOKEN/);
  });

  it('requires an agent credential', () => {
    const { GITHUB_AGENT_TOKEN: _omit, ...rest } = valid;
    assert.throws(() => readGithubEnv(rest), /GITHUB_AGENT_TOKEN or GITHUB_PERSONAL_ACCESS_TOKEN/);
  });

  it('rejects an owner that is not a GitHub name', () => {
    assert.throws(() => readGithubEnv({ ...valid, GITHUB_SANDBOX_OWNER: 'evil/owner' }), /GITHUB_SANDBOX_OWNER/);
  });

  it('never echoes credential values in errors', () => {
    assert.throws(() => readGithubEnv({ ...valid, GITHUB_SANDBOX_OWNER: '' }), (err: Error) => {
      assert.doesNotMatch(err.message, /test-controller-value|test-agent-value/);
      return true;
    });
  });
});

describe('ghConfigFromEnv', () => {
  it('defaults the API host to api.github.com', () => {
    assert.deepEqual(ghConfigFromEnv(valid), {
      controllerToken: 'test-controller-value',
      sandboxOwner: 'example-lab',
      host: 'api.github.com',
    });
  });
});

describe('committed MCP configs', () => {
  it('Playwright remote URL matches .mcp.playwright.remote.json', () => {
    const cfg = JSON.parse(readFileSync('.mcp.playwright.remote.json', 'utf8'));
    assert.equal(cfg.mcpServers.playwright.url, PLAYWRIGHT_REMOTE_URL);
  });

  it('Playwright local server is pinned to an exact version', () => {
    const cfg = JSON.parse(readFileSync('.mcp.playwright.local.json', 'utf8'));
    const pkg = cfg.mcpServers.playwright.args.find((arg: string) => arg.startsWith('@playwright/mcp'));
    assert.match(pkg, /^@playwright\/mcp@\d+\.\d+\.\d+$/);
  });

  it('GitHub local server is pinned by digest and remote config holds no literal token', () => {
    const local = readFileSync('.mcp.github.local.json', 'utf8');
    const remote = readFileSync('.mcp.github.remote.json', 'utf8');
    assert.match(local, /github-mcp-server@sha256:[0-9a-f]{64}/);
    assert.match(remote, /Bearer \$\{GITHUB_PERSONAL_ACCESS_TOKEN\}/);
  });
});
