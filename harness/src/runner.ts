import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, cp, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import type { Arm, ArmConfig, ExperimentSpec } from './experiment.js';
import type { Task, SuccessResult, TaskContext } from './tasks.js';
import { countTransportFailures, parseTranscript } from './metrics.js';
import type { Metrics } from './metrics.js';
import { startFixtureServer } from './fixtureServer.js';
import { mkPairedSeed } from './trialState.js';
import { buildChildEnv } from './env.js';
import { DEFAULT_MODEL, MCP_TIMEOUT_MS } from './config.js';

export interface TrialResult {
  experiment: string;
  runName?: string;
  arm: Arm;
  taskId: string;
  tier: number;
  trialN: number;
  timestamp: string;
  seed: string;
  /**
   * ENABLE_TOOL_SEARCH as seen by the agent child (`unset` if absent). Tool
   * discovery mode changes tool-selection results, so every trial records it.
   */
  toolSearchMode?: string;
  metrics: Metrics;
  success: SuccessResult;
  error?: string;
}

export interface RunTrialOptions {
  experiment: ExperimentSpec;
  runName: string;
  arm: Arm;
  task: Task;
  trialN: number;
  rootDir: string;
  model?: string;
  agentEnv?: Record<string, string>;
}

function updateObservedToolLatencies(line: string, nowMs: number, startedAt: Map<string, number>, latencies: number[]): void {
  const trimmed = line.trim();
  if (!trimmed.startsWith('{')) return;
  let event: unknown;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (!event || typeof event !== 'object') return;
  const e = event as {
    type?: string;
    message?: {
      content?: Array<{ type?: string; id?: string; tool_use_id?: string }>;
    };
  };
  const content = e.message?.content;
  if (!Array.isArray(content)) return;
  if (e.type === 'assistant') {
    for (const block of content) {
      if (block.type === 'tool_use' && typeof block.id === 'string') {
        startedAt.set(block.id, nowMs);
      }
    }
  } else if (e.type === 'user') {
    for (const block of content) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') continue;
      const started = startedAt.get(block.tool_use_id);
      if (started === undefined) continue;
      const delta = nowMs - started;
      if (delta >= 0) latencies.push(delta);
    }
  }
}

export function extractAssistantContent(rawLines: string[]): { text: string[]; toolInputs: string[] } {
  const text: string[] = [];
  const toolInputs: string[] = [];
  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!event || typeof event !== 'object') continue;
    const e = event as {
      type?: string;
      result?: unknown;
      message?: {
        content?: Array<{ type?: string; text?: string; input?: unknown }>;
      };
    };
    if (e.type === 'result' && typeof e.result === 'string') {
      text.push(e.result);
      continue;
    }
    if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue;
    for (const block of e.message.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        text.push(block.text);
      } else if (block.type === 'tool_use' && block.input !== undefined) {
        toolInputs.push(JSON.stringify(block.input));
      }
    }
  }
  return { text, toolInputs };
}

function coldStartFromLatencies(latencies: number[]): number | null {
  if (latencies.length === 0) return null;
  const [first, ...rest] = latencies;
  const basis = rest.length > 0 ? rest : latencies;
  const sorted = [...basis].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return Math.max(0, first! - median);
}

function artifactRoot(rootDir: string, experiment: string, runName: string): string {
  return join(rootDir, 'experiments', experiment, 'runs', runName);
}

export function buildClaudeArgs(
  armConfig: ArmConfig,
  prompt: string,
  model: string,
  rootDir: string,
  outputFormat: 'text' | 'stream-json' = 'stream-json',
): string[] {
  const mcpConfig = armConfig.mcpConfig.startsWith('{') ? armConfig.mcpConfig : resolve(rootDir, armConfig.mcpConfig);

  const args = ['-p', prompt, '--output-format', outputFormat, '--model', model, '--strict-mcp-config', '--mcp-config', mcpConfig];

  if (outputFormat === 'stream-json') {
    args.push('--verbose');
  }

  if (armConfig.allowedTools && armConfig.allowedTools.length > 0) {
    args.push('--allowed-tools', armConfig.allowedTools.join(' '));
  }

  if (armConfig.disallowedTools.length > 0) {
    args.push('--disallowed-tools', armConfig.disallowedTools.join(' '));
  }

  args.push(...armConfig.extraFlags);

  return args;
}

export async function runTrial(opts: RunTrialOptions): Promise<TrialResult> {
  const { experiment, runName, arm, task, trialN, rootDir, model = DEFAULT_MODEL, agentEnv = {} } = opts;
  const armConfig = experiment.arms[arm];

  const artifactsRoot = artifactRoot(rootDir, experiment.name, runName);
  const resultsDir = join(artifactsRoot, 'results', arm, task.id);
  const transcriptsDir = join(artifactsRoot, 'transcripts', arm, task.id);
  const persistentOutputDir = join(resultsDir, String(trialN));
  const fixturesPath = join(rootDir, 'experiments', experiment.name, 'fixtures');

  await mkdir(resultsDir, { recursive: true });
  await mkdir(transcriptsDir, { recursive: true });

  const trialWorkDir = await mkdtemp(join(tmpdir(), `localremote-${experiment.name}-${arm}-${task.id}-`));
  let state: unknown = null;
  let fixtureServer: Awaited<ReturnType<typeof startFixtureServer>> | null = null;
  let cleanupRan = false;

  try {
    const runtimeAgentEnv = experiment.buildAgentEnv ? experiment.buildAgentEnv(arm) : {};
    const seed = mkPairedSeed(experiment.name, runName, task.id, trialN);
    state = task.setup ? await task.setup(seed) : null;

    fixtureServer = await startFixtureServer(
      fixturesPath,
      task.renderResponse ? (req, res, body) => task.renderResponse!(state, req, res, body) : undefined,
    );
    const ctx: TaskContext = {
      rootDir,
      fixturesPath,
      fixturesUrl: fixtureServer.url,
      outputDir: trialWorkDir,
      state,
    };
    const timestamp = new Date().toISOString();
    const prompt = task.prompt(ctx);
    const taskAgentEnv = task.agentEnv ? task.agentEnv(state) : {};
    const args = buildClaudeArgs(armConfig, prompt, model, rootDir, 'stream-json');
    const childEnv = buildChildEnv(armConfig.extraEnv, { ...runtimeAgentEnv, ...taskAgentEnv, ...agentEnv });

    const transcriptLines: string[] = [];
    let stderrText = '';
    let cliError: string | undefined;
    const observedToolStartedAt = new Map<string, number>();
    const observedToolLatencies: number[] = [];

    const trialTimeoutMs = armConfig.timeoutMs ?? MCP_TIMEOUT_MS;
    const trialStartedAtMs = Date.now();

    try {
      const child = spawn('claude', args, {
        cwd: trialWorkDir,
        env: childEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
      let stdoutBuffer = '';
      let timedOut = false;
      let killEscalation: NodeJS.Timeout | undefined;

      const killProcessTree = (signal: NodeJS.Signals) => {
        if (child.pid === undefined) return;
        try {
          if (process.platform === 'win32') {
            child.kill(signal);
          } else {
            process.kill(-child.pid, signal);
          }
        } catch {
          // process already gone
        }
      };

      const timeout = setTimeout(() => {
        timedOut = true;
        killProcessTree('SIGTERM');
        killEscalation = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            killProcessTree('SIGKILL');
          }
        }, 5_000);
      }, trialTimeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        stdoutBuffer += chunk;
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() ?? '';
        const now = Date.now();
        for (const line of lines) {
          transcriptLines.push(line);
          updateObservedToolLatencies(line, now, observedToolStartedAt, observedToolLatencies);
        }
      });
      child.stderr.on('data', (chunk: string) => {
        stderrText += chunk;
      });

      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code, signal) => resolve({ code, signal }));
      });
      clearTimeout(timeout);
      if (killEscalation) clearTimeout(killEscalation);

      if (stdoutBuffer) {
        transcriptLines.push(stdoutBuffer);
        updateObservedToolLatencies(stdoutBuffer, Date.now(), observedToolStartedAt, observedToolLatencies);
      }

      if (timedOut) {
        cliError = `claude timed out after ${trialTimeoutMs}ms`;
      } else if (exit.code !== 0) {
        cliError = stderrText || `claude exited with code ${exit.code ?? `signal ${exit.signal}`}`;
      }
    } catch (err) {
      cliError = err instanceof Error ? err.message : String(err);
    }

    await writeFile(join(transcriptsDir, `${trialN}.jsonl`), transcriptLines.join('\n'), 'utf-8');

    if (stderrText.trim()) {
      await writeFile(join(transcriptsDir, `${trialN}.stderr.log`), stderrText, 'utf-8');
    }

    await rm(persistentOutputDir, { recursive: true, force: true });
    await cp(trialWorkDir, persistentOutputDir, {
      recursive: true,
      filter: (src) => !src.includes(`${sep}.claude`),
    });

    const metrics = parseTranscript(transcriptLines, arm, experiment.classifier);
    if (stderrText.trim()) {
      metrics.transportFailures += countTransportFailures(stderrText.split(/\r?\n/));
    }
    if (metrics.wallClockMs === 0) {
      metrics.wallClockMs = Date.now() - trialStartedAtMs;
    }
    if (observedToolLatencies.length > 0) {
      metrics.perToolCallLatencyMs = observedToolLatencies;
      metrics.coldStartMs = coldStartFromLatencies(observedToolLatencies);
    }

    const assistantContent = extractAssistantContent(transcriptLines);
    const persistentCtx: TaskContext = {
      ...ctx,
      outputDir: persistentOutputDir,
      assistantText: assistantContent.text,
      toolCallInputs: assistantContent.toolInputs,
      toolCallNames: metrics.toolCalls.map((t) => t.name),
    };

    let success: SuccessResult;
    try {
      success = await task.successCheck(persistentCtx);
    } catch (err) {
      success = {
        pass: false,
        score: 0,
        notes: `successCheck threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (success.security?.promptInjectionCompliance !== undefined) {
      metrics.promptInjectionCompliance = success.security.promptInjectionCompliance;
    }

    if (task.cleanup && state !== null) {
      try {
        await task.cleanup(state);
      } catch (err) {
        const note = `cleanup threw: ${err instanceof Error ? err.message : String(err)}`;
        success.notes = success.notes ? `${success.notes}\n${note}` : note;
      }
    }
    cleanupRan = true;

    const trialResult: TrialResult = {
      experiment: experiment.name,
      runName,
      arm,
      taskId: task.id,
      tier: task.tier,
      trialN,
      timestamp,
      seed,
      toolSearchMode: childEnv.ENABLE_TOOL_SEARCH ?? 'unset',
      metrics,
      success,
      ...(cliError ? { error: cliError } : {}),
    };

    await writeFile(join(resultsDir, `${trialN}.json`), JSON.stringify(trialResult, null, 2), 'utf-8');

    return trialResult;
  } finally {
    // Recovery path: if the body threw before reaching its own cleanup call,
    // still release the sandbox state (e.g. delete a provisioned GitHub repo)
    // so a re-run doesn't collide on the deterministic seed-derived name.
    if (!cleanupRan && task.cleanup && state !== null) {
      await Promise.resolve(task.cleanup(state)).catch(() => undefined);
    }
    if (fixtureServer) {
      await fixtureServer.close().catch(() => undefined);
    }
    await rm(trialWorkDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
