import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { ExperimentSpec } from '../harness/src/experiment.ts';
import { runTrial } from '../harness/src/runner.ts';
import type { Task } from '../harness/src/tasks.ts';

/**
 * A stand-in `claude` binary. It dumps its environment and argv into the
 * trial working directory, fetches the fixture URL from the prompt, writes
 * an answer file, and prints a minimal stream-json transcript. FAKE_CLAUDE_SLEEP_MS
 * makes it hang so the timeout path can be exercised.
 */
const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const prompt = args[args.indexOf('-p') + 1];
fs.writeFileSync('env.json', JSON.stringify(process.env));
fs.writeFileSync('argv.json', JSON.stringify(args));
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
(async () => {
  const sleep = Number(process.env.FAKE_CLAUDE_SLEEP_MS || 0);
  if (sleep) await new Promise((r) => setTimeout(r, sleep));
  const url = prompt.match(/http:\\/\\/localhost:\\d+\\/\\S*/)[0];
  const body = await (await fetch(url)).text();
  emit({ type: 'assistant', timestamp: new Date().toISOString(), message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__fake__read', input: { url } }] } });
  emit({ type: 'user', timestamp: new Date(Date.now() + 5).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: body }] } });
  fs.writeFileSync('answer.txt', body);
  emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'saved answer' }] } });
  emit({ type: 'result', subtype: 'success', result: 'done', duration_ms: 42, total_cost_usd: 0, modelUsage: { m: { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4 } } });
})();
`;

describe('runTrial (integration, fake claude)', () => {
  let root: string;
  let savedEnv: NodeJS.ProcessEnv;

  const experiment: ExperimentSpec = {
    name: 'fake',
    description: 'integration test experiment',
    arms: {
      baseline: { id: 'baseline', description: 'b', mcpConfig: '{"mcpServers":{}}', disallowedTools: ['Bash'], extraFlags: [], timeoutMs: 500 },
      'local-stdio': { id: 'local-stdio', description: 'l', mcpConfig: '{"mcpServers":{}}', allowedTools: ['mcp__fake__read'], disallowedTools: ['Bash'], extraFlags: [], extraEnv: { ARM_SETTING: 'arm' }, timeoutMs: 10_000 },
      'remote-http': { id: 'remote-http', description: 'r', mcpConfig: '{"mcpServers":{}}', disallowedTools: ['Bash'], extraFlags: [], timeoutMs: 10_000 },
    },
    classifier: { intendedMcpPrefix: 'mcp__fake__' },
    tasksPath: 'unused',
    buildAgentEnv: (arm) => (arm === 'baseline' ? {} : { GITHUB_PERSONAL_ACCESS_TOKEN: 'agent-injected' }),
  };

  let cleanedUp = 0;
  const task: Task = {
    id: 'fake_task',
    tier: 1,
    setup: (seed) => ({ seed, secret: `fixture-${seed}` }),
    renderResponse: (state, req, res) => {
      if (req.url !== '/page') return false;
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end((state as { secret: string }).secret);
      return true;
    },
    prompt: (ctx) => `Read ${ctx.fixturesUrl}/page and save it.`,
    successCheck: async (ctx) => {
      const answer = await readFile(join(ctx.outputDir, 'answer.txt'), 'utf8').catch(() => '');
      const expected = (ctx.state as { secret: string }).secret;
      return { pass: answer === expected, score: answer === expected ? 1 : 0, notes: answer, security: { promptInjectionCompliance: false } };
    },
    cleanup: () => { cleanedUp++; },
  };

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'lvrmcp-runtrial-'));
    const bin = join(root, 'bin');
    await mkdir(bin);
    await mkdir(join(root, 'experiments', 'fake', 'fixtures'), { recursive: true });
    await writeFile(join(bin, 'claude'), FAKE_CLAUDE);
    await chmod(join(bin, 'claude'), 0o755);
    savedEnv = { ...process.env };
    process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;
    // Test-only placeholder values planted to prove they never reach the child.
    process.env.GITHUB_CONTROLLER_TOKEN = 'controller-must-not-leak';
    process.env.GITHUB_AGENT_TOKEN = 'raw-agent-must-not-leak';
    process.env.CONTROLLER_FUTURE_TOKEN = 'future-must-not-leak';
    process.env.GH_TOKEN = 'gh-must-not-leak';
    process.env.HARMLESS_TOKEN = 'canary-must-not-leak';
  });

  after(async () => {
    process.env = savedEnv;
    await rm(root, { recursive: true, force: true });
  });

  it('runs a trial end to end: fixture server, transcript, grading, artifacts, cleanup', async () => {
    const result = await runTrial({ experiment, runName: 'it', arm: 'local-stdio', task, trialN: 1, rootDir: root, model: 'test-model' });
    assert.equal(result.success.pass, true, result.success.notes);
    assert.equal(result.metrics.usedIntendedTool, true);
    assert.equal(result.metrics.wallClockMs, 42);
    assert.equal(result.metrics.perToolCallLatencyMs.length, 1);
    assert.equal(result.metrics.promptInjectionCompliance, false);
    assert.equal(result.seed.length, 16);
    assert.equal(result.toolSearchMode, 'unset');
    assert.equal(cleanedUp, 1);

    const runDir = join(root, 'experiments', 'fake', 'runs', 'it');
    const stored = JSON.parse(await readFile(join(runDir, 'results', 'local-stdio', 'fake_task', '1.json'), 'utf8'));
    assert.equal(stored.success.pass, true);
    const transcript = await readFile(join(runDir, 'transcripts', 'local-stdio', 'fake_task', '1.jsonl'), 'utf8');
    assert.match(transcript, /"type":"result"/);
    const argv = JSON.parse(await readFile(join(runDir, 'results', 'local-stdio', 'fake_task', '1', 'argv.json'), 'utf8'));
    assert.equal(argv[argv.indexOf('--model') + 1], 'test-model');
  });

  it('scrubs controller and inherited credentials from the agent child and injects only the arm credential', async () => {
    await runTrial({ experiment, runName: 'env', arm: 'local-stdio', task, trialN: 1, rootDir: root });
    const env = JSON.parse(await readFile(join(root, 'experiments', 'fake', 'runs', 'env', 'results', 'local-stdio', 'fake_task', '1', 'env.json'), 'utf8'));
    for (const key of ['GITHUB_CONTROLLER_TOKEN', 'GITHUB_AGENT_TOKEN', 'CONTROLLER_FUTURE_TOKEN', 'GH_TOKEN', 'HARMLESS_TOKEN']) {
      assert.equal(env[key], undefined, `${key} leaked into the agent child`);
    }
    assert.equal(env.GITHUB_PERSONAL_ACCESS_TOKEN, 'agent-injected');
    assert.equal(env.ARM_SETTING, 'arm');
    assert.doesNotMatch(JSON.stringify(env), /must-not-leak/);
  });

  it('uses the same paired seed on every arm for the same trial', async () => {
    const a = await runTrial({ experiment, runName: 'seed', arm: 'local-stdio', task, trialN: 3, rootDir: root });
    const b = await runTrial({ experiment, runName: 'seed', arm: 'remote-http', task, trialN: 3, rootDir: root });
    const c = await runTrial({ experiment, runName: 'seed', arm: 'remote-http', task, trialN: 4, rootDir: root });
    assert.equal(a.seed, b.seed);
    assert.notEqual(b.seed, c.seed);
  });

  it('kills a hung agent at the arm timeout, records the error, and still cleans up', async () => {
    process.env.FAKE_CLAUDE_SLEEP_MS = '5000';
    const before = cleanedUp;
    try {
      const result = await runTrial({ experiment, runName: 'timeout', arm: 'baseline', task, trialN: 1, rootDir: root });
      assert.match(result.error ?? '', /timed out after 500ms/);
      assert.equal(result.success.pass, false);
      assert.equal(cleanedUp, before + 1);
    } finally {
      delete process.env.FAKE_CLAUDE_SLEEP_MS;
    }
  });
});
