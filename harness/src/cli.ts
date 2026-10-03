import { Command, InvalidArgumentError } from 'commander';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { execa } from 'execa';
import { ArmSchema } from './experiment.js';
import type { Arm, ExperimentSpec } from './experiment.js';
import { runTrial, buildClaudeArgs } from './runner.js';
import { buildChildEnv, loadDotEnv } from './env.js';
import { DEFAULT_MODEL } from './config.js';
import type { Task } from './tasks.js';
import { generateReport } from './report.js';
import { countTransportFailures, mergeRecomputedMetrics, parseTranscript } from './metrics.js';
import type { Metrics } from './metrics.js';
import { getExperiment, experiments } from './experiments/index.js';

const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

const program = new Command();

function intOption(name: string, min = 1): (value: string) => number {
  return (value: string) => {
    const n = Number(value);
    if (!Number.isInteger(n) || n < min) throw new InvalidArgumentError(`${name} must be an integer >= ${min}.`);
    return n;
  };
}

program
  .name('harness')
  .description('Local stdio MCP vs remote streamable HTTP MCP experiment harness')
  .version(pkg.version);

async function loadTasks(rootDir: string, tasksPath: string): Promise<Task[]> {
  const indexPath = join(rootDir, tasksPath);
  const mod = await import(indexPath) as { tasks: Task[] };
  return mod.tasks;
}

async function claudeAuthStatus(): Promise<{
  ok: boolean;
  loggedIn: boolean | null;
  authMethod: string | null;
  diagnostic: string;
}> {
  const result = await execa('claude', ['auth', 'status', '--json'], { reject: false });
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  let loggedIn: boolean | null = null;
  let authMethod: string | null = null;
  let apiProvider: string | null = null;
  try {
    const parsed = JSON.parse(result.stdout || '{}') as {
      loggedIn?: unknown;
      authMethod?: unknown;
      apiProvider?: unknown;
    };
    if (typeof parsed.loggedIn === 'boolean') loggedIn = parsed.loggedIn;
    if (typeof parsed.authMethod === 'string') authMethod = parsed.authMethod;
    if (typeof parsed.apiProvider === 'string') apiProvider = parsed.apiProvider;
  } catch {
    // Keep a short generic diagnostic below; artifacts must not store raw auth JSON.
  }
  const diagnostic = JSON.stringify({
    loggedIn,
    authMethod,
    apiProvider,
    exitCode: result.exitCode,
  });
  return {
    ok: result.exitCode === 0 && loggedIn === true,
    loggedIn,
    authMethod,
    diagnostic: diagnostic || (output ? '(auth status output redacted)' : '(no auth status output)'),
  };
}

function githubToolNames(values: string[] | undefined): string[] {
  return (values ?? []).filter((name) => name.startsWith('mcp__github__')).sort();
}

function extractGithubToolNames(output: string): string[] {
  return [...new Set(output.match(/\bmcp__github__[A-Za-z0-9_]+\b/g) ?? [])].sort();
}

function validateArmToolOutput(arm: Arm, cfg: { allowedTools?: string[] | undefined; disallowedTools: string[] }, output: string): {
  pass: boolean;
  observedGithubTools: string[];
  unexpectedGithubTools: string[];
  notes: string[];
} {
  const observedGithubTools = extractGithubToolNames(output);
  const allowed = new Set(githubToolNames(cfg.allowedTools));
  const disallowed = new Set(githubToolNames(cfg.disallowedTools));
  const unexpectedGithubTools = observedGithubTools.filter((name) => !allowed.has(name) || disallowed.has(name));
  const notes: string[] = [];

  if (arm === 'baseline' && observedGithubTools.length > 0) {
    notes.push('baseline reported GitHub MCP tools');
  }
  if ((arm === 'local-stdio' || arm === 'remote-http') && observedGithubTools.length === 0) {
    notes.push(`${arm} reported no exact GitHub MCP tool names`);
  }
  if (unexpectedGithubTools.length > 0) {
    notes.push(`${arm} reported GitHub tools outside its allow-list`);
  }

  return {
    pass: notes.length === 0,
    observedGithubTools,
    unexpectedGithubTools,
    notes,
  };
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------
program
  .command('run')
  .description('Run experiment trials')
  .requiredOption('--experiment <name>', `Experiment: ${Object.keys(experiments).join(' | ')}`)
  .requiredOption('--run <name>', 'Named run namespace (results stored under experiments/<exp>/runs/<run>)')
  .requiredOption('--arm <arm>', 'Arm: baseline | local-stdio | remote-http')
  .option('--task <id>', 'Run a specific task by ID')
  .option('--tier <n>', 'Run all tasks in this tier', intOption('--tier'))
  .requiredOption('--trials <n>', 'Number of trials per task', intOption('--trials'))
  .option('--trial <n>', 'Run only this trial number within the configured trial count', intOption('--trial'))
  .option('--model <model>', 'Claude model ID', DEFAULT_MODEL)
  .action(async (opts: {
    experiment: string;
    run: string;
    arm: string;
    task?: string;
    tier?: number;
    trials: number;
    trial?: number;
    model: string;
  }) => {
    const armParse = ArmSchema.safeParse(opts.arm);
    if (!armParse.success) {
      console.error(`Invalid arm "${opts.arm}". Must be one of: baseline, local-stdio, remote-http`);
      process.exit(1);
    }
    const arm = armParse.data;
    const rootDir = resolve(process.cwd());
    await loadDotEnv(rootDir);

    let experiment: ExperimentSpec;
    try {
      experiment = getExperiment(opts.experiment);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    if (experiment.preflight) {
      try {
        await experiment.preflight([arm]);
      } catch (err) {
        console.error('Preflight failed:', err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    }

    let tasks: Task[];
    try {
      tasks = await loadTasks(rootDir, experiment.tasksPath);
    } catch (err) {
      console.error(`Cannot load tasks for "${experiment.name}":`, err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    let filtered = tasks;
    if (opts.task) {
      filtered = tasks.filter(t => t.id === opts.task);
      if (filtered.length === 0) {
        console.error(`Task "${opts.task}" not found.`);
        process.exit(1);
      }
    } else if (opts.tier !== undefined) {
      const tier = opts.tier;
      filtered = tasks.filter(t => t.tier === tier);
    }
    filtered = filtered.filter(t => !t.applicableArms || t.applicableArms.includes(arm));
    if (filtered.length === 0) {
      if (opts.task) {
        console.error(`Task "${opts.task}" is not applicable to arm "${arm}".`);
        process.exit(1);
      }
      console.log(`No tasks apply to arm=${arm}${opts.tier !== undefined ? ` tier=${opts.tier}` : ''}.`);
      return;
    }
    if (opts.trial !== undefined && (!Number.isInteger(opts.trial) || opts.trial < 1 || opts.trial > opts.trials)) {
      console.error(`--trial must be an integer between 1 and --trials (${opts.trials}).`);
      process.exit(1);
    }

    const trialNumbers = opts.trial !== undefined
      ? [opts.trial]
      : Array.from({ length: opts.trials }, (_, idx) => idx + 1);

    for (const task of filtered) {
      for (const n of trialNumbers) {
        console.log(`→ ${experiment.name}/${opts.run}  ${task.id}  arm=${arm}  trial=${n}/${opts.trials}`);
        try {
          const result = await runTrial({
            experiment,
            runName: opts.run,
            arm,
            task,
            trialN: n,
            rootDir,
            model: opts.model,
          });
          const icon = result.success.pass ? '✓' : '✗';
          const valid = result.metrics.validToolSurface ? 'valid' : 'INVALID';
          console.log(`  ${icon} score=${result.success.score.toFixed(2)}  ${valid}  tokens_in=${result.metrics.inputTokens}  turns=${result.metrics.turns}  time=${(result.metrics.wallClockMs / 1000).toFixed(1)}s`);
          if (result.error) console.error(`  error: ${result.error}`);
        } catch (err) {
          console.error(`  trial ${n} threw:`, err);
        }
      }
    }
  });

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------
program
  .command('report')
  .description('Generate a markdown report from stored results')
  .requiredOption('--experiment <name>', 'Experiment name')
  .requiredOption('--run <name>', 'Named run namespace')
  .option('--tier <n>', 'Report on a specific tier', intOption('--tier'))
  .option('--all-tiers', 'Include all tiers', false)
  .option('--crossover-analysis', 'Include crossover analysis section', false)
  .option('--include-cost', 'Append a USD cost appendix', false)
  .option('--output <path>', 'Write report to file instead of stdout')
  .action(async (opts: {
    experiment: string;
    run: string;
    tier?: number;
    allTiers: boolean;
    crossoverAnalysis: boolean;
    includeCost: boolean;
    output?: string;
  }) => {
    const rootDir = resolve(process.cwd());
    await loadDotEnv(rootDir);
    // Resolve the spec so the report reads the experiment's storage directory.
    const reportExperiment = getExperiment(opts.experiment).name;
    const report = await generateReport({
      rootDir,
      experiment: reportExperiment,
      runName: opts.run,
      ...(opts.tier !== undefined ? { tier: opts.tier } : {}),
      allTiers: opts.allTiers,
      crossover: opts.crossoverAnalysis,
      includeCost: opts.includeCost,
    });

    if (opts.output) {
      await writeFile(opts.output, report, 'utf-8');
      console.log(`Report written to ${opts.output}`);
    } else {
      process.stdout.write(report + '\n');
    }
  });

// ---------------------------------------------------------------------------
// recompute-metrics
// ---------------------------------------------------------------------------
async function collectFiles(dir: string, suffix: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await collectFiles(path, suffix));
    else if (entry.name.endsWith(suffix)) out.push(path);
  }
  return out;
}

program
  .command('recompute-metrics')
  .description('Re-parse transcripts and update stored result metrics in place')
  .requiredOption('--experiment <name>', 'Experiment name')
  .requiredOption('--run <name>', 'Named run namespace')
  .option('--arm <arm>', 'Arm; defaults to all arms')
  .action(async (opts: { experiment: string; run: string; arm?: string }) => {
    const rootDir = resolve(process.cwd());
    await loadDotEnv(rootDir);
    const experiment = getExperiment(opts.experiment);
    const arms: Arm[] = [];
    if (opts.arm) {
      const armParse = ArmSchema.safeParse(opts.arm);
      if (!armParse.success) {
        console.error(`Invalid arm "${opts.arm}".`);
        process.exit(1);
      }
      arms.push(armParse.data);
    } else {
      arms.push('baseline', 'local-stdio', 'remote-http');
    }

    const artifactRoot = join(rootDir, 'experiments', experiment.name, 'runs', opts.run);

    let updated = 0;
    let missing = 0;
    for (const arm of arms) {
      const transcriptRoot = join(artifactRoot, 'transcripts', arm);
      const files = await collectFiles(transcriptRoot, '.jsonl');
      for (const transcriptPath of files) {
        const rel = transcriptPath.slice(transcriptRoot.length + 1);
        const resultPath = join(artifactRoot, 'results', arm, rel.replace(/\.jsonl$/, '.json'));
        let resultRaw: string;
        try {
          resultRaw = await readFile(resultPath, 'utf-8');
        } catch {
          missing++;
          continue;
        }
        const transcriptRaw = await readFile(transcriptPath, 'utf-8');
        const result = JSON.parse(resultRaw) as { metrics?: Partial<Metrics> };
        const metrics = parseTranscript(transcriptRaw.split('\n'), arm, experiment.classifier);
        const stderrPath = transcriptPath.replace(/\.jsonl$/, '.stderr.log');
        try {
          const stderrRaw = await readFile(stderrPath, 'utf-8');
          metrics.transportFailures += countTransportFailures(stderrRaw.split(/\r?\n/));
        } catch {
          // Older or clean trials may not have a stderr artifact.
        }
        result.metrics = mergeRecomputedMetrics(result.metrics, metrics);
        await writeFile(resultPath, JSON.stringify(result, null, 2), 'utf-8');
        updated++;
      }
    }

    console.log(`Recomputed metrics for ${updated} result file(s).`);
    if (missing > 0) console.log(`Skipped ${missing} transcript(s) with no matching result JSON.`);
  });

// ---------------------------------------------------------------------------
// verify-arms
// ---------------------------------------------------------------------------
program
  .command('verify-arms')
  .description('Probe each arm and ask it what tools it sees — confirm isolation before running trials')
  .requiredOption('--experiment <name>', 'Experiment name')
  .option('--model <model>', 'Claude model ID', DEFAULT_MODEL)
  .option('--output <path>', 'Write structured verification artifact')
  .action(async (opts: { experiment: string; model: string; output?: string }) => {
    const rootDir = resolve(process.cwd());
    await loadDotEnv(rootDir);
    const experiment = getExperiment(opts.experiment);
    const arms: Arm[] = ['baseline', 'local-stdio', 'remote-http'];
    const probe = experiment.name === 'github'
      ? 'List the exact internal GitHub MCP tool names you have access to right now, using names like mcp__github__example. Return only the exact names, one per line. If you have none, write exactly: NO_GITHUB_MCP_TOOLS.'
      : 'What tools do you have access to right now? List them specifically. If you have none, say so.';
    let failures = 0;
    const artifact: {
      generatedAt: string;
      experiment: string;
      model: string;
      pass: boolean;
      claudeAuth: {
        pass: boolean;
        loggedIn: boolean | null;
        authMethod: string | null;
        diagnostic: string;
      };
      arms: Array<{
        arm: Arm;
        description: string;
        exitCode: number | null;
        output: string;
        observedGithubTools?: string[];
        unexpectedGithubTools?: string[];
        policyNotes?: string[];
        pass: boolean;
      }>;
    } = {
      generatedAt: new Date().toISOString(),
      experiment: experiment.name,
      model: opts.model,
      pass: false,
      claudeAuth: {
        pass: false,
        loggedIn: null,
        authMethod: null,
        diagnostic: 'not checked',
      },
      arms: [],
    };

    const auth = await claudeAuthStatus();
    artifact.claudeAuth = {
      pass: auth.ok,
      loggedIn: auth.loggedIn,
      authMethod: auth.authMethod,
      diagnostic: auth.diagnostic,
    };
    if (!auth.ok) {
      console.error('Claude Code CLI is not logged in. Run `claude auth login` or `/login` in Claude Code, then retry verify-arms.');
      console.error(auth.diagnostic);
      if (opts.output) {
        const outputPath = resolve(rootDir, opts.output);
        await mkdir(dirname(outputPath), { recursive: true });
        await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf-8');
        console.log(`Wrote ${opts.output}`);
      }
      process.exitCode = 1;
      return;
    }

    for (const arm of arms) {
      const cfg = experiment.arms[arm];
      console.log(`\n${'='.repeat(60)}`);
      console.log(`ARM: ${arm}`);
      console.log(`Description: ${cfg.description}`);
      console.log('='.repeat(60));

      const args = buildClaudeArgs(cfg, probe, opts.model, rootDir, 'text');
      const agentEnv = experiment.buildAgentEnv ? experiment.buildAgentEnv(arm) : {};
      const childEnv = buildChildEnv(cfg.extraEnv, agentEnv);

      try {
        const result = await execa('claude', args, {
          cwd: rootDir,
          reject: false,
          env: childEnv,
          stdin: 'ignore',
        });
        const output = [result.stdout, result.stderr].filter(Boolean).join('\n') || '(no output)';
        console.log(output);
        const policy = experiment.name === 'github'
          ? validateArmToolOutput(arm, cfg, output)
          : { pass: true, observedGithubTools: [], unexpectedGithubTools: [], notes: [] };
        const pass = result.exitCode === 0 && !/not logged in/i.test(output) && policy.pass;
        artifact.arms.push({
          arm,
          description: cfg.description,
          exitCode: result.exitCode ?? null,
          output,
          observedGithubTools: policy.observedGithubTools,
          unexpectedGithubTools: policy.unexpectedGithubTools,
          policyNotes: policy.notes,
          pass,
        });
        if (!pass) {
          failures++;
        }
      } catch (err) {
        console.error('Error running claude:', err);
        artifact.arms.push({
          arm,
          description: cfg.description,
          exitCode: null,
          output: err instanceof Error ? err.message : String(err),
          pass: false,
        });
        failures++;
      }
    }
    artifact.pass = failures === 0;
    if (opts.output) {
      const outputPath = resolve(rootDir, opts.output);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf-8');
      console.log(`Wrote ${opts.output}`);
    }
    if (failures > 0) process.exitCode = 1;
  });

program.parse();
