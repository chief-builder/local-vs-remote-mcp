const NUMERIC_METRIC_FIELDS = [
  'inputTokens',
  'outputTokens',
  'cachedInputTokens',
  'cacheCreationInputTokens',
  'toolCallCount',
  'turns',
  'wallClockMs',
  'transportFailures',
  'contextWindowPeak',
  'totalCostUsd',
];

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberFailure(label, min, max) {
  const maxLabel = max === Infinity ? '' : ` and <= ${max}`;
  return `${label} must be a finite number >= ${min}${maxLabel}`;
}

function requireFiniteNumber(failures, label, value, { min = 0, max = Infinity } = {}) {
  if (!isFiniteNumber(value) || value < min || value > max) {
    failures.push(numberFailure(label, min, max));
  }
}

function requireFiniteNumberArray(failures, label, value, { min = 0 } = {}) {
  if (!Array.isArray(value)) {
    failures.push(`${label} is not an array`);
    return;
  }
  for (const [idx, item] of value.entries()) {
    if (!isFiniteNumber(item) || item < min) {
      failures.push(numberFailure(`${label}[${idx}]`, min, Infinity));
    }
  }
}

export function validateResultArtifact(
  result,
  { experiment, runName, arm, taskId, tier, trialN, intendedMcpPrefix = 'mcp__github__', path = 'result' },
) {
  const failures = [];
  const p = (message) => `${path}: ${message}`;

  if (!result || typeof result !== 'object') {
    return [p('missing result object')];
  }

  if (experiment !== undefined && result.experiment !== experiment) {
    failures.push(p(`experiment mismatch ${result.experiment}`));
  }
  if (runName !== undefined && result.runName !== runName) {
    failures.push(p(`runName mismatch ${result.runName}`));
  }
  if (result.arm !== arm) failures.push(p(`arm mismatch ${result.arm}`));
  if (result.taskId !== taskId) failures.push(p(`taskId mismatch ${result.taskId}`));
  if (tier !== undefined && result.tier !== tier) failures.push(p(`tier mismatch ${result.tier}`));
  if (result.trialN !== trialN) failures.push(p(`trialN mismatch ${result.trialN}`));
  if (typeof result.timestamp !== 'string' || Number.isNaN(Date.parse(result.timestamp))) {
    failures.push(p('timestamp must be an ISO-like date string'));
  }
  if (typeof result.seed !== 'string' || result.seed.length === 0) {
    failures.push(p('seed must be non-empty string'));
  }

  const success = result.success;
  if (!success || typeof success !== 'object') {
    failures.push(p('missing success'));
  } else {
    if (typeof success.pass !== 'boolean') failures.push(p('success.pass must be boolean'));
    requireFiniteNumber(failures, p('success.score'), success.score, { min: 0, max: 1 });
    if (typeof success.notes !== 'string') failures.push(p('success.notes must be string'));
  }

  const metrics = result.metrics;
  if (!metrics || typeof metrics !== 'object') {
    failures.push(p('missing metrics'));
    return failures;
  }

  if (metrics.validToolSurface !== true) failures.push(p('validToolSurface is not true'));
  if (metrics.secretInOutput !== false) failures.push(p('secretInOutput must be false'));
  if (typeof metrics.usedIntendedTool !== 'boolean') {
    failures.push(p('usedIntendedTool must be boolean'));
  }
  requireFiniteNumberArray(failures, p('perToolCallLatencyMs'), metrics.perToolCallLatencyMs);
  if (metrics.coldStartMs !== null) {
    requireFiniteNumber(failures, p('coldStartMs'), metrics.coldStartMs);
  }
  for (const field of NUMERIC_METRIC_FIELDS) {
    requireFiniteNumber(failures, p(field), metrics[field]);
  }
  if (!Array.isArray(metrics.toolCalls)) failures.push(p('toolCalls is not an array'));
  if (!Array.isArray(metrics.modelsUsed)) failures.push(p('modelsUsed is not an array'));

  if (Array.isArray(metrics.toolCalls)) {
    const intendedToolCalls = metrics.toolCalls.filter((call) => {
      return call && typeof call.name === 'string' && call.name.startsWith(intendedMcpPrefix);
    });
    if (arm === 'baseline') {
      if (metrics.usedIntendedTool !== false) failures.push(p('usedIntendedTool must be false for baseline'));
      if (intendedToolCalls.length > 0) failures.push(p('baseline contains intended MCP tool calls'));
    } else if (arm === 'local-stdio' || arm === 'remote-http') {
      if (metrics.usedIntendedTool !== true) failures.push(p(`usedIntendedTool must be true for ${arm}`));
      if (intendedToolCalls.length === 0) failures.push(p(`${arm} has no ${intendedMcpPrefix} tool calls`));
    }
  }

  if (Array.isArray(metrics.toolCalls) && isFiniteNumber(metrics.toolCallCount)) {
    if (metrics.toolCalls.length !== metrics.toolCallCount) {
      failures.push(p(`toolCalls length ${metrics.toolCalls.length} does not match toolCallCount ${metrics.toolCallCount}`));
    }
  }
  if (Array.isArray(metrics.perToolCallLatencyMs) && isFiniteNumber(metrics.toolCallCount)) {
    if (metrics.perToolCallLatencyMs.length > metrics.toolCallCount) {
      failures.push(p(`perToolCallLatencyMs has ${metrics.perToolCallLatencyMs.length} samples for ${metrics.toolCallCount} tool calls`));
    }
    if (metrics.perToolCallLatencyMs.length === 0 && metrics.coldStartMs !== null) {
      failures.push(p('coldStartMs must be null when there are no tool latency samples'));
    }
    if (metrics.perToolCallLatencyMs.length > 0 && metrics.coldStartMs === null) {
      failures.push(p('coldStartMs must be populated when tool latency samples exist'));
    }
  }

  const pi = metrics.promptInjectionCompliance;
  if (taskId === 'tier3_tool_poisoning_resilience') {
    if (typeof pi !== 'boolean') failures.push(p('promptInjectionCompliance must be boolean for tool-poisoning task'));
  } else if (pi !== null) {
    failures.push(p('promptInjectionCompliance must be null for non-tool-poisoning task'));
  }

  return failures;
}

export function isValidResultArtifact(result, opts) {
  return validateResultArtifact(result, opts).length === 0;
}
