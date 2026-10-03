/** Builders for synthetic Claude Code stream-json transcript lines. */

export function assistantText(text: string, timestamp?: string): string {
  return JSON.stringify({ type: 'assistant', ...(timestamp ? { timestamp } : {}), message: { content: [{ type: 'text', text }] } });
}

export function toolUse(id: string, name: string, input: unknown, timestamp?: string): string {
  return JSON.stringify({
    type: 'assistant',
    ...(timestamp ? { timestamp } : {}),
    message: {
      content: [{ type: 'tool_use', id, name, input }],
      usage: { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5, output_tokens: 3 },
    },
  });
}

export function toolResult(id: string, content: string, timestamp?: string): string {
  return JSON.stringify({
    type: 'user',
    ...(timestamp ? { timestamp } : {}),
    message: { content: [{ type: 'tool_result', tool_use_id: id, content }] },
  });
}

export function resultEvent(result: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    type: 'result',
    subtype: 'success',
    result,
    duration_ms: 1234,
    total_cost_usd: 0.01,
    modelUsage: {
      'claude-sonnet-4-6': { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 300, cacheCreationInputTokens: 40 },
    },
    ...extra,
  });
}
