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
   * Assistant-authored text and tool inputs from the Claude transcript.
   * Excludes user tool_result blocks so untrusted fixture data does not
   * falsely count as model compliance.
   */
  assistantAuthoredContent?: string[];
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
