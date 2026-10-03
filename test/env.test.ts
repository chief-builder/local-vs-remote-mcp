import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { buildChildEnv, GITHUB_ENV_TO_SCRUB, isScrubbedEnvKey, loadDotEnv, parseDotEnv } from '../harness/src/env.ts';
import { githubExperiment } from '../harness/src/experiments/github.ts';

describe('buildChildEnv', () => {
  it('drops every listed GitHub credential and setting', () => {
    const source = Object.fromEntries(GITHUB_ENV_TO_SCRUB.map((key) => [key, `value-of-${key}`]));
    const env = buildChildEnv(undefined, {}, { ...source, PATH: '/usr/bin' });
    for (const key of GITHUB_ENV_TO_SCRUB) {
      if (key === 'GH_PROMPT_DISABLED' || key === 'GH_PAGER') continue; // reset to safe defaults below
      assert.equal(env[key], undefined, `${key} should be scrubbed`);
    }
    assert.equal(env.PATH, '/usr/bin');
  });

  it('scrubs future CONTROLLER_* and AGENT_* credential names', () => {
    const env = buildChildEnv(undefined, {}, {
      CONTROLLER_DEPLOY_TOKEN: 'x',
      AGENT_NEW_TOKEN: 'x',
      GITHUB_CONTROLLER_APP_KEY: 'x',
      GITHUB_AGENT_SECONDARY: 'x',
    });
    assert.deepEqual(
      Object.keys(env).filter((key) => /CONTROLLER|AGENT/.test(key)),
      [],
    );
  });

  it('does not scrub unrelated names that merely contain AGENT', () => {
    assert.equal(isScrubbedEnvKey('SSH_AGENT_PID'), false);
    assert.equal(isScrubbedEnvKey('USER_AGENT'), false);
    assert.equal(isScrubbedEnvKey('HOME'), false);
  });

  it('re-adds only the explicit arm and agent values, agent last', () => {
    const env = buildChildEnv(
      { GITHUB_TOOLSETS: 'all', SHARED: 'arm' },
      { GITHUB_PERSONAL_ACCESS_TOKEN: 'agent-token', SHARED: 'agent' },
      { GITHUB_PERSONAL_ACCESS_TOKEN: 'inherited-token', GITHUB_CONTROLLER_TOKEN: 'controller' },
    );
    assert.equal(env.GITHUB_PERSONAL_ACCESS_TOKEN, 'agent-token');
    assert.equal(env.GITHUB_TOOLSETS, 'all');
    assert.equal(env.SHARED, 'agent');
    assert.equal(env.GITHUB_CONTROLLER_TOKEN, undefined);
  });

  it('disables gh prompts and pagers in the child', () => {
    const env = buildChildEnv(undefined, {}, { GH_PAGER: 'less', GH_PROMPT_DISABLED: '' });
    assert.equal(env.GH_PAGER, 'cat');
    assert.equal(env.GH_PROMPT_DISABLED, '1');
    assert.equal(env.GH_NO_UPDATE_NOTIFIER, '1');
  });
});

describe('GitHub arm credential injection', () => {
  const withEnv = (vars: Record<string, string | undefined>, fn: () => void) => {
    const saved = Object.fromEntries(Object.keys(vars).map((key) => [key, process.env[key]]));
    Object.assign(process.env, vars);
    for (const [key, value] of Object.entries(vars)) if (value === undefined) delete process.env[key];
    try { fn(); } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };

  it('gives MCP arms the agent token under GITHUB_PERSONAL_ACCESS_TOKEN only', () => {
    withEnv({ GITHUB_AGENT_TOKEN: 'agent', GITHUB_CONTROLLER_TOKEN: 'controller', GITHUB_PERSONAL_ACCESS_TOKEN: undefined }, () => {
      for (const arm of ['local-stdio', 'remote-http'] as const) {
        const env = buildChildEnv(githubExperiment.arms[arm].extraEnv, githubExperiment.buildAgentEnv!(arm));
        assert.equal(env.GITHUB_PERSONAL_ACCESS_TOKEN, 'agent', arm);
        assert.equal(env.GITHUB_AGENT_TOKEN, undefined, arm);
        assert.equal(env.GITHUB_CONTROLLER_TOKEN, undefined, arm);
      }
    });
  });

  it('gives the baseline arm no GitHub credential at all', () => {
    withEnv({ GITHUB_AGENT_TOKEN: 'agent', GITHUB_PERSONAL_ACCESS_TOKEN: 'pat' }, () => {
      const env = buildChildEnv(githubExperiment.arms.baseline.extraEnv, githubExperiment.buildAgentEnv!('baseline'));
      assert.equal(env.GITHUB_PERSONAL_ACCESS_TOKEN, undefined);
      assert.equal(env.GITHUB_AGENT_TOKEN, undefined);
    });
  });
});

describe('.env loading', () => {
  it('parses comments, blanks, and quoted values', () => {
    assert.deepEqual(parseDotEnv('# c\n\nA=1\nB="two words"\nC=\'3\'\n=bad\nnoequals\nD = spaced \n'), {
      A: '1',
      B: 'two words',
      C: '3',
      D: 'spaced',
    });
  });

  it('never overrides values already set in the environment', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'lvrmcp-dotenv-'));
    try {
      await writeFile(join(dir, '.env'), 'KEEP=from-file\nNEW=from-file\n');
      const target: NodeJS.ProcessEnv = { KEEP: 'from-shell' };
      await loadDotEnv(dir, target);
      assert.equal(target.KEEP, 'from-shell');
      assert.equal(target.NEW, 'from-file');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('is a no-op when .env is missing', async () => {
    const target: NodeJS.ProcessEnv = {};
    await loadDotEnv(join(tmpdir(), 'lvrmcp-does-not-exist'), target);
    assert.deepEqual(target, {});
  });
});
