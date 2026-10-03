import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { githubExperiment } from '../harness/src/experiments/github.ts';
import { playwrightExperiment } from '../harness/src/experiments/playwright.ts';
import { buildClaudeArgs } from '../harness/src/runner.ts';

function flag(args: string[], name: string): string[] {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1]!.split(' ') : [];
}

const overlap: string[] = JSON.parse(readFileSync('artifacts/spike/tools-list/overlap.json', 'utf8')).overlap;

describe('buildClaudeArgs (github)', () => {
  it('always isolates MCP config and runs headless stream-json', () => {
    const args = buildClaudeArgs(githubExperiment.arms['local-stdio'], 'do it', 'm', '/repo');
    assert.ok(args.includes('--strict-mcp-config'));
    assert.deepEqual(args.slice(0, 2), ['-p', 'do it']);
    assert.equal(args[args.indexOf('--output-format') + 1], 'stream-json');
    assert.ok(args.includes('--verbose'));
    assert.equal(args[args.indexOf('--mcp-config') + 1], resolve('/repo', '.mcp.github.local.json'));
  });

  it('passes inline JSON MCP config through unchanged for the baseline', () => {
    const args = buildClaudeArgs(githubExperiment.arms.baseline, 'p', 'm', '/repo', 'text');
    assert.equal(args[args.indexOf('--mcp-config') + 1], '{"mcpServers":{}}');
    assert.ok(!args.includes('--verbose'));
  });

  it('allows exactly the overlap on both MCP arms and denies execution tools', () => {
    for (const arm of ['local-stdio', 'remote-http'] as const) {
      const args = buildClaudeArgs(githubExperiment.arms[arm], 'p', 'm', '/repo');
      const allowed = flag(args, '--allowed-tools').filter((t) => t.startsWith('mcp__github__'));
      assert.deepEqual(allowed.sort(), overlap.map((t) => `mcp__github__${t}`).sort(), arm);
      const denied = flag(args, '--disallowed-tools');
      for (const tool of ['Bash', 'Skill', 'Task', 'Agent', 'WebFetch', 'WebSearch']) {
        assert.ok(denied.includes(tool), `${arm} must deny ${tool}`);
      }
      assert.ok(!denied.some((t) => allowed.includes(t)), `${arm} allow and deny lists overlap`);
    }
  });

  it('gives the baseline no GitHub MCP tools and denies all of them', () => {
    const args = buildClaudeArgs(githubExperiment.arms.baseline, 'p', 'm', '/repo');
    assert.equal(flag(args, '--allowed-tools').some((t) => t.startsWith('mcp__github__')), false);
    assert.ok(flag(args, '--disallowed-tools').includes(`mcp__github__${overlap[0]}`));
  });
});

describe('buildClaudeArgs (playwright)', () => {
  it('keeps browser_run_code_unsafe available on MCP arms (measured by Tier 3)', () => {
    const args = buildClaudeArgs(playwrightExperiment.arms['remote-http'], 'p', 'm', '/repo');
    assert.ok(flag(args, '--allowed-tools').includes('mcp__playwright__browser_run_code_unsafe'));
  });
});
