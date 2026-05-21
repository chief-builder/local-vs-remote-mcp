import { validateResultArtifact } from './lib/result-invariants.mjs';

function baseResult(overrides = {}) {
  return {
    experiment: 'github',
    runName: 'invariant-check',
    arm: 'baseline',
    taskId: 'tier1_repo_inventory',
    tier: 1,
    trialN: 1,
    timestamp: '2026-05-20T00:00:00.000Z',
    seed: 'invariant-check-seed',
    success: { pass: false, score: 0, notes: 'failed baseline task is valid data' },
    metrics: {
      inputTokens: 1,
      outputTokens: 1,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      toolCallCount: 0,
      turns: 1,
      wallClockMs: 1,
      transportFailures: 0,
      contextWindowPeak: 1,
      totalCostUsd: 0,
      usedIntendedTool: false,
      validToolSurface: true,
      promptInjectionCompliance: null,
      secretInOutput: false,
      perToolCallLatencyMs: [],
      coldStartMs: null,
      toolCalls: [],
      modelsUsed: [],
    },
    ...overrides,
  };
}

function withMetrics(result, patch) {
  return { ...result, metrics: { ...result.metrics, ...patch } };
}

function assertValid(result, opts, label) {
  const failures = validateResultArtifact(result, opts);
  if (failures.length > 0) {
    throw new Error(`${label}: expected valid artifact, got:\n${failures.join('\n')}`);
  }
}

function assertInvalid(result, opts, pattern, label) {
  const failures = validateResultArtifact(result, opts);
  if (!failures.some((failure) => pattern.test(failure))) {
    throw new Error(`${label}: expected failure matching ${pattern}, got:\n${failures.join('\n') || '(none)'}`);
  }
}

const baseOpts = {
  experiment: 'github',
  runName: 'invariant-check',
  arm: 'baseline',
  taskId: 'tier1_repo_inventory',
  tier: 1,
  trialN: 1,
  path: 'fixture.json',
  intendedMcpPrefix: 'mcp__github__',
};

assertValid(baseResult(), baseOpts, 'failed baseline result should be valid data');
assertInvalid(
  baseResult({ success: { pass: true, score: 1.5, notes: 'invalid high score' } }),
  baseOpts,
  /success\.score.*<= 1/,
  'success.score high bound',
);
assertInvalid(
  baseResult({ success: { pass: true, score: -0.1, notes: 'invalid low score' } }),
  baseOpts,
  /success\.score.*>= 0/,
  'success.score low bound',
);
assertInvalid(
  withMetrics(baseResult(), { secretInOutput: true }),
  baseOpts,
  /secretInOutput must be false/,
  'secret output rejection',
);
assertInvalid(
  withMetrics(baseResult(), { promptInjectionCompliance: false }),
  baseOpts,
  /promptInjectionCompliance must be null/,
  'promptInjectionCompliance non-applicable rejection',
);
assertInvalid(
  withMetrics(baseResult(), { usedIntendedTool: true }),
  baseOpts,
  /usedIntendedTool must be false for baseline/,
  'baseline usedIntendedTool rejection',
);
assertInvalid(
  withMetrics(baseResult(), {
    toolCallCount: 1,
    toolCalls: [{ id: 'toolu_1', name: 'mcp__github__get_issue', turnIndex: 1 }],
    perToolCallLatencyMs: [10],
    coldStartMs: 0,
  }),
  baseOpts,
  /baseline contains intended MCP tool calls/,
  'baseline intended MCP call rejection',
);
assertInvalid(
  baseResult({ experiment: 'other' }),
  baseOpts,
  /experiment mismatch other/,
  'experiment mismatch rejection',
);
assertInvalid(
  baseResult({ runName: 'other-run' }),
  baseOpts,
  /runName mismatch other-run/,
  'runName mismatch rejection',
);
assertInvalid(
  baseResult({ tier: 2 }),
  baseOpts,
  /tier mismatch 2/,
  'tier mismatch rejection',
);
assertInvalid(
  baseResult({ timestamp: 'not-a-date' }),
  baseOpts,
  /timestamp must be/,
  'timestamp rejection',
);
assertInvalid(
  baseResult({ seed: '' }),
  baseOpts,
  /seed must be/,
  'seed rejection',
);
assertInvalid(
  withMetrics(baseResult(), {
    toolCallCount: 1,
    toolCalls: [],
  }),
  baseOpts,
  /toolCalls length 0 does not match toolCallCount 1/,
  'toolCallCount/toolCalls consistency rejection',
);
assertInvalid(
  withMetrics(baseResult(), {
    toolCallCount: 1,
    toolCalls: [{ id: 'toolu_1', name: 'mcp__github__get_issue', turnIndex: 1 }],
    perToolCallLatencyMs: [10, 20],
    coldStartMs: 0,
  }),
  baseOpts,
  /perToolCallLatencyMs has 2 samples for 1 tool calls/,
  'too many latency samples rejection',
);
assertInvalid(
  withMetrics(baseResult(), {
    coldStartMs: 1,
  }),
  baseOpts,
  /coldStartMs must be null when there are no tool latency samples/,
  'coldStart without latency rejection',
);
assertInvalid(
  withMetrics(baseResult(), {
    toolCallCount: 1,
    toolCalls: [{ id: 'toolu_1', name: 'mcp__github__get_issue', turnIndex: 1 }],
    perToolCallLatencyMs: [10],
    coldStartMs: null,
  }),
  baseOpts,
  /coldStartMs must be populated when tool latency samples exist/,
  'latency without coldStart rejection',
);
assertValid(
  withMetrics(baseResult(), {
    toolCallCount: 1,
    toolCalls: [{ id: 'toolu_1', name: 'Read', turnIndex: 1 }],
    perToolCallLatencyMs: [10],
    coldStartMs: 0,
  }),
  baseOpts,
  'consistent latency/tool-call metrics accepted',
);

const localOpts = {
  experiment: 'github',
  runName: 'invariant-check',
  arm: 'local-stdio',
  taskId: 'tier1_repo_inventory',
  tier: 1,
  trialN: 1,
  path: 'local.json',
  intendedMcpPrefix: 'mcp__github__',
};
const localResult = withMetrics(baseResult({ arm: 'local-stdio' }), {
  usedIntendedTool: true,
  toolCallCount: 1,
  toolCalls: [{ id: 'toolu_1', name: 'mcp__github__get_file_contents', turnIndex: 1 }],
  perToolCallLatencyMs: [10],
  coldStartMs: 0,
});
assertInvalid(
  baseResult({ arm: 'local-stdio' }),
  localOpts,
  /usedIntendedTool must be true for local-stdio/,
  'local usedIntendedTool required',
);
assertInvalid(
  withMetrics(baseResult({ arm: 'local-stdio' }), { usedIntendedTool: true }),
  localOpts,
  /local-stdio has no mcp__github__ tool calls/,
  'local intended MCP call required',
);
assertValid(localResult, localOpts, 'local intended MCP call accepted');

const poisoning = {
  ...baseResult({
    arm: 'local-stdio',
    taskId: 'tier3_tool_poisoning_resilience',
    tier: 3,
  }),
};
poisoning.metrics = {
  ...poisoning.metrics,
  usedIntendedTool: true,
  toolCallCount: 1,
  toolCalls: [{ id: 'toolu_poison', name: 'mcp__github__get_file_contents', turnIndex: 1 }],
  perToolCallLatencyMs: [10],
  coldStartMs: 0,
};
const poisoningOpts = {
  experiment: 'github',
  runName: 'invariant-check',
  arm: 'local-stdio',
  taskId: 'tier3_tool_poisoning_resilience',
  tier: 3,
  trialN: 1,
  path: 'poison.json',
  intendedMcpPrefix: 'mcp__github__',
};
assertInvalid(
  poisoning,
  poisoningOpts,
  /promptInjectionCompliance must be boolean/,
  'tool-poisoning promptInjectionCompliance required',
);
assertValid(
  withMetrics(poisoning, { promptInjectionCompliance: false }),
  poisoningOpts,
  'tool-poisoning promptInjectionCompliance boolean accepted',
);

console.log('Result invariant regression check passed.');
