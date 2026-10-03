import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { githubExperiment } from '../harness/src/experiments/github.ts';
import { checkArmTools, parseVerifyTranscript } from '../harness/src/verifyArms.ts';

const prefix = 'mcp__github__';
const allowed = githubExperiment.arms['remote-http'].allowedTools ?? [];
const overlapTools = allowed.filter((tool) => tool.startsWith(prefix));

describe('parseVerifyTranscript', () => {
  it('reads tools from the init event and the final answer from the result event', () => {
    const stdout = [
      JSON.stringify({ type: 'system', subtype: 'init', tools: ['Write', 'mcp__github__get_me'] }),
      'not json',
      JSON.stringify({ type: 'result', result: 'mcp__github__get_me' }),
    ].join('\n');
    assert.deepEqual(parseVerifyTranscript(stdout), { initTools: ['Write', 'mcp__github__get_me'], answer: 'mcp__github__get_me' });
  });

  it('returns null tools when there is no init event', () => {
    assert.equal(parseVerifyTranscript('').initTools, null);
  });
});

describe('checkArmTools', () => {
  it('passes an MCP arm that loaded exactly its overlap allow-list', () => {
    const r = checkArmTools('remote-http', prefix, allowed, ['ToolSearch', 'Write', ...overlapTools]);
    assert.equal(r.pass, true, r.notes.join('; '));
    assert.equal(r.observedTools.length, 41);
  });

  // Regression: on 2026-10-03 the remote server exposed delete_repository to
  // elicitation-capable clients only, so the probe-built deny list missed it.
  it('fails an MCP arm that loaded a tool outside the allow-list', () => {
    const r = checkArmTools('remote-http', prefix, allowed, [...overlapTools, 'mcp__github__delete_repository']);
    assert.equal(r.pass, false);
    assert.deepEqual(r.unexpectedTools, ['mcp__github__delete_repository']);
  });

  it('fails an MCP arm that is missing an allow-listed tool', () => {
    const r = checkArmTools('local-stdio', prefix, allowed, overlapTools.slice(1));
    assert.equal(r.pass, false);
    assert.deepEqual(r.missingTools, [overlapTools[0]]);
  });

  it('passes a baseline with no MCP tools and fails one with any', () => {
    const baselineAllowed = githubExperiment.arms.baseline.allowedTools;
    assert.equal(checkArmTools('baseline', prefix, baselineAllowed, ['Read', 'Write']).pass, true);
    assert.equal(checkArmTools('baseline', prefix, baselineAllowed, ['mcp__github__get_me']).pass, false);
  });

  it('fails when the transcript had no init event', () => {
    assert.equal(checkArmTools('remote-http', prefix, allowed, null).pass, false);
  });

  it('ignores what the model claims: only loaded tools count', () => {
    // A hallucinated name in the answer cannot fail the arm, because only initTools is checked.
    const r = checkArmTools('remote-http', prefix, allowed, overlapTools);
    assert.equal(r.pass, true);
  });
});
