import { z } from 'zod';
import type { Task } from './tasks.js';

export const ArmSchema = z.enum(['baseline', 'local-stdio', 'remote-http']);
export type Arm = z.infer<typeof ArmSchema>;

/**
 * Per-arm tool isolation: which MCP config to point Claude Code at, the
 * positive allow-list of tools, and the negative deny-list. Plus an
 * `extraEnv` map for static env vars the arm needs in the child process
 * (e.g. GITHUB_TOOLSETS for the local stdio server). `timeoutMs` can be
 * shortened for intentionally tool-less baseline floors without changing
 * the shared runner.
 */
export const ArmConfigSchema = z.object({
  id: ArmSchema,
  description: z.string(),
  mcpConfig: z.string(),
  allowedTools: z.array(z.string()).optional(),
  disallowedTools: z.array(z.string()),
  extraFlags: z.array(z.string()),
  extraEnv: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
});
export type ArmConfig = z.infer<typeof ArmConfigSchema>;

/**
 * Per-experiment classifier rules. The transcript classifier in metrics.ts
 * takes its rules from the active experiment's spec so adding a provider
 * comparison does not require editing the harness core.
 */
export interface ExperimentClassifier {
  intendedMcpPrefix: string;
}

export interface ExperimentSpec {
  name: string;
  description: string;
  arms: Record<Arm, ArmConfig>;
  classifier: ExperimentClassifier;
  /**
   * Optional pre-flight check run once before the first trial of a given run.
   * Use it to assert credentials, container images, or external services are
   * reachable. Throwing aborts the run.
   */
  preflight?: () => Promise<void>;
  /**
   * Loaded lazily by the runner — keeps the experiment registry decoupled
   * from per-experiment task definitions.
   */
  tasksPath: string;
  /**
   * Per-arm runtime env vars injected into the child claude process. Called
   * once per trial after the GITHUB_* env scrub. Use this to read tokens
   * from the parent process env and forward them under the right key for
   * each arm (e.g., GITHUB_PERSONAL_ACCESS_TOKEN for both GitHub MCP
   * transports).
   */
  buildAgentEnv?: (arm: Arm) => Record<string, string>;
}

export type LoadedExperiment = ExperimentSpec & { tasks: Task[] };
