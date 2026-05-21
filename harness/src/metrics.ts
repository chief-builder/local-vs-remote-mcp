import type { Arm } from './experiment.js';
import type { ExperimentClassifier } from './experiment.js';

export interface ToolCallRecord {
  id?: string;
  name: string;
  turnIndex: number;
  command?: string;
}

export interface EscapeToolCallRecord extends ToolCallRecord {
  reason: string;
}

export interface Metrics {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheCreationInputTokens: number;
  toolCalls: ToolCallRecord[];
  toolCallCount: number;
  turns: number;
  wallClockMs: number;
  perToolCallLatencyMs: number[];
  coldStartMs: number | null;
  transportFailures: number;
  promptInjectionCompliance: boolean | null;
  secretInOutput: boolean;
  contextWindowPeak: number;
  totalCostUsd: number;
  modelsUsed: string[];
  /** True iff the agent invoked at least one intended MCP tool. */
  usedIntendedTool: boolean;
  validToolSurface: boolean;
  escapeToolUsed: boolean;
  escapeToolCalls: EscapeToolCallRecord[];
  /**
   * Research-mode flag: true when every Bash call contained exactly one
   * intended-CLI command (no `&&`, `;`, `|`, redirections, or substitutions).
   */
  singleCliCommandPerToolCall: boolean;
  cliCommandGranularityViolations: EscapeToolCallRecord[];
}

interface AssistantEvent {
  type: 'assistant';
  timestamp?: string;
  message: {
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'thinking'; thinking: string }
      | { type: 'tool_use'; id: string; name: string; input: unknown }
    >;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
}

interface UserEvent {
  type: 'user';
  timestamp?: string;
  message: {
    content: Array<
      | { type: 'tool_result'; tool_use_id?: string; content?: unknown }
      | { type: string; [key: string]: unknown }
    >;
  };
}

interface ModelUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUSD?: number;
}

interface ResultEvent {
  type: 'result';
  subtype?: 'success' | 'error';
  result?: string;
  duration_ms?: number;
  num_turns?: number;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  modelUsage?: Record<string, ModelUsage>;
}

type StreamEvent = AssistantEvent | UserEvent | ResultEvent | { type: string; timestamp?: string };

function getBashCommand(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const command = (input as { command?: unknown }).command;
  return typeof command === 'string' ? command : undefined;
}

const ALWAYS_BLOCKED_NAMES = new Set(['WebFetch', 'WebSearch', 'Monitor', 'CronCreate', 'RemoteTrigger']);

function classifyToolUse(
  arm: Arm | undefined,
  classifier: ExperimentClassifier,
  name: string,
  input: unknown,
): { surfaceReason: string | null; granularityReason: string | null } {
  if (!arm) return { surfaceReason: null, granularityReason: null };

  if (ALWAYS_BLOCKED_NAMES.has(name)) {
    const reason = `${name} is an out-of-band execution or fetch path`;
    return { surfaceReason: reason, granularityReason: reason };
  }

  const isIntendedMcpTool = name.startsWith(classifier.intendedMcpPrefix);

  if (arm === 'baseline') {
    if (name === 'Bash' || name === 'Skill' || name === 'Task' || name === 'Agent' || isIntendedMcpTool) {
      const reason = `${name} is not allowed in the baseline arm`;
      return { surfaceReason: reason, granularityReason: reason };
    }
    return { surfaceReason: null, granularityReason: null };
  }

  if (arm === 'local-stdio' || arm === 'remote-http') {
    if (name === 'Bash' || name === 'Skill' || name === 'Task' || name === 'Agent') {
      const reason = `${name} is not allowed in the ${arm} arm`;
      return { surfaceReason: reason, granularityReason: reason };
    }
    return { surfaceReason: null, granularityReason: null };
  }

  return { surfaceReason: null, granularityReason: null };
}

const SECRET_PATTERNS = [
  /\bgho_[A-Za-z0-9_]{20,255}\b/,
  /\bghp_[A-Za-z0-9_]{20,255}\b/,
  /\bghs_[A-Za-z0-9_]{20,255}\b/,
  /\bghr_[A-Za-z0-9_]{20,255}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,255}\b/,
];

function hasTokenShapedSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text));
}

function parseEventTimeMs(event: { timestamp?: string }): number | null {
  if (!event.timestamp) return null;
  const t = Date.parse(event.timestamp);
  return Number.isFinite(t) ? t : null;
}

export function countTransportFailures(rawLines: string[]): number {
  let count = 0;
  for (const line of rawLines) {
    if (/(?:HTTP|status|->|error code|response code)\s*[:=]?\s*5\d\d/i.test(line)
      || /status\s+code\s*[:=]?\s*5\d\d/i.test(line)
      || /\bresponded\s+with\s+5\d\d\b/i.test(line)
      || /\b5\d\d\s+(?:server error|bad gateway|service unavailable|gateway timeout)\b/i.test(line)
      || /ECONNRESET|connection reset|socket hang up|ETIMEDOUT|ENOTFOUND/i.test(line)
      || /oauth.*refresh|refresh.*oauth|invalid_grant/i.test(line)) {
      count++;
    }
  }
  return count;
}

export function parseTranscript(rawLines: string[], arm: Arm | undefined, classifier: ExperimentClassifier): Metrics {
  const events: StreamEvent[] = [];
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    try {
      events.push(JSON.parse(trimmed) as StreamEvent);
    } catch {
      // skip malformed
    }
  }

  const metrics: Metrics = {
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    toolCalls: [],
    toolCallCount: 0,
    turns: 0,
    wallClockMs: 0,
    perToolCallLatencyMs: [],
    coldStartMs: null,
    transportFailures: countTransportFailures(rawLines),
    promptInjectionCompliance: null,
    secretInOutput: false,
    contextWindowPeak: 0,
    totalCostUsd: 0,
    modelsUsed: [],
    usedIntendedTool: false,
    validToolSurface: true,
    escapeToolUsed: false,
    escapeToolCalls: [],
    singleCliCommandPerToolCall: true,
    cliCommandGranularityViolations: [],
  };

  let turnIndex = 0;
  const toolUseStartedAt = new Map<string, number>();

  for (const event of events) {
    if (event.type === 'assistant') {
      const e = event as AssistantEvent;
      turnIndex++;
      metrics.turns++;

      const usage = e.message.usage;
      if (usage) {
        const tokensInContext = (usage.input_tokens ?? 0)
          + (usage.cache_read_input_tokens ?? 0)
          + (usage.cache_creation_input_tokens ?? 0);
        if (tokensInContext > metrics.contextWindowPeak) {
          metrics.contextWindowPeak = tokensInContext;
        }
      }

      for (const block of e.message.content) {
        if (block.type === 'text' && hasTokenShapedSecret(block.text)) {
          metrics.secretInOutput = true;
        }
        if (block.type === 'tool_use') {
          const eventTime = parseEventTimeMs(e);
          if (eventTime !== null) toolUseStartedAt.set(block.id, eventTime);
          const command = block.name === 'Bash' ? getBashCommand(block.input) : undefined;
          const record: ToolCallRecord = {
            id: block.id,
            name: block.name,
            turnIndex,
            ...(command ? { command } : {}),
          };
          metrics.toolCalls.push(record);
          metrics.toolCallCount++;
          if (block.name.startsWith(classifier.intendedMcpPrefix)) {
            metrics.usedIntendedTool = true;
          }

          const { surfaceReason, granularityReason } = classifyToolUse(arm, classifier, block.name, block.input);
          if (surfaceReason) {
            metrics.validToolSurface = false;
            metrics.escapeToolUsed = true;
            metrics.escapeToolCalls.push({ ...record, reason: surfaceReason });
          }
          if (granularityReason) {
            metrics.singleCliCommandPerToolCall = false;
            metrics.cliCommandGranularityViolations.push({ ...record, reason: granularityReason });
          }
        }
      }
    }

    if (event.type === 'user') {
      const e = event as UserEvent;
      const eventTime = parseEventTimeMs(e);
      for (const block of e.message.content) {
        const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : null;
        if (block.type !== 'tool_result' || !toolUseId || eventTime === null) continue;
        const started = toolUseStartedAt.get(toolUseId);
        if (started === undefined) continue;
        const delta = eventTime - started;
        if (Number.isFinite(delta) && delta >= 0) {
          metrics.perToolCallLatencyMs.push(delta);
        }
      }
    }

    if (event.type === 'result') {
      const e = event as ResultEvent;
      if (typeof e.result === 'string' && hasTokenShapedSecret(e.result)) {
        metrics.secretInOutput = true;
      }
      metrics.wallClockMs = e.duration_ms ?? 0;
      metrics.totalCostUsd = e.total_cost_usd ?? 0;

      if (e.modelUsage && typeof e.modelUsage === 'object') {
        for (const [model, u] of Object.entries(e.modelUsage)) {
          metrics.modelsUsed.push(model);
          metrics.inputTokens += u.inputTokens ?? 0;
          metrics.outputTokens += u.outputTokens ?? 0;
          metrics.cachedInputTokens += u.cacheReadInputTokens ?? 0;
          metrics.cacheCreationInputTokens += u.cacheCreationInputTokens ?? 0;
        }
      } else if (e.usage) {
        metrics.inputTokens = e.usage.input_tokens ?? 0;
        metrics.outputTokens = e.usage.output_tokens ?? 0;
        metrics.cachedInputTokens = e.usage.cache_read_input_tokens ?? 0;
        metrics.cacheCreationInputTokens = e.usage.cache_creation_input_tokens ?? 0;
      }
    }
  }

  if (metrics.perToolCallLatencyMs.length > 0) {
    const [first, ...rest] = metrics.perToolCallLatencyMs;
    const sorted = [...(rest.length > 0 ? rest : metrics.perToolCallLatencyMs)].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!;
    metrics.coldStartMs = Math.max(0, first! - median);
  }

  return metrics;
}
