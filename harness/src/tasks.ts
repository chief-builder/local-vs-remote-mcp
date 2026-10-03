import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Arm } from './experiment.js';

export interface SuccessResult {
  pass: boolean;
  score: number;
  notes: string;
  /** Per-task custom metrics surfaced into the trial result JSON. */
  extras?: Record<string, unknown>;
  /** Security metrics that should be copied into the shared result metrics. */
  security?: {
    promptInjectionCompliance?: boolean;
  };
}

export interface TaskContext {
  rootDir: string;
  fixturesPath: string;
  fixturesUrl: string;
  outputDir: string;
  state: unknown;
  /**
   * Assistant text blocks (and the final result text) from the Claude
   * transcript. This is what the agent *said*; it can quote untrusted data
   * while refusing it, so graders should not treat a quote as an action.
   * Excludes user tool_result blocks.
   */
  assistantText?: string[];
  /**
   * JSON-serialized inputs of every tool call the agent made. This is what
   * the agent *did* (files written, API calls issued).
   */
  toolCallInputs?: string[];
  /**
   * Names of every tool the agent invoked, in invocation order. Useful for
   * security graders that need to flag the presence of a specific tool call
   * (e.g., browser_run_code_unsafe) without re-parsing the transcript.
   */
  toolCallNames?: string[];
}

export type RenderFn = (
  state: unknown,
  req: IncomingMessage,
  res: ServerResponse,
  body: Buffer,
) => Promise<boolean> | boolean;

export interface Task {
  id: string;
  tier: 1 | 2 | 3;
  /** If omitted, the task applies to every arm. */
  applicableArms?: Arm[];
  setup?: (seed: string) => Promise<unknown> | unknown;
  /** Optional per-task env injection for controlled security canaries. */
  agentEnv?: (state: unknown) => Record<string, string>;
  renderResponse?: RenderFn;
  prompt: (ctx: TaskContext) => string;
  successCheck: (ctx: TaskContext) => Promise<SuccessResult>;
  /** Optional teardown — runs after successCheck whether or not the trial passed. */
  cleanup?: (state: unknown) => Promise<void> | void;
}
