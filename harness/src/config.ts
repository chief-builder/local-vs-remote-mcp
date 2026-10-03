import { z } from 'zod';

/**
 * Run-policy constants shared by every experiment. Changing any of these
 * changes what a trial measures, so they live in one place and are
 * recorded in the README configuration table.
 */

/** Model used for trials and verify-arms. Kept at Sonnet 4.6 so new runs stay comparable with stored data. */
export const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Tool-less baseline floors give up sooner; live MCP trials get more room. */
export const BASELINE_TIMEOUT_MS = 90_000;
export const MCP_TIMEOUT_MS = 240_000;

/** Out-of-band fetch/execution paths blocked on every arm. */
export const ALWAYS_BLOCKED_TOOLS = ['WebFetch', 'WebSearch', 'Monitor', 'CronCreate', 'RemoteTrigger'];

/** Agent/execution tools blocked on every arm (the MCP server is the only intended surface). */
export const EXECUTION_TOOLS = ['Skill', 'Bash', 'Task', 'Agent'];

/** Flags passed to every `claude -p` trial: project-local settings only, no permission prompts. */
export const COMMON_CLAUDE_FLAGS = ['--setting-sources', 'project,local', '--permission-mode', 'bypassPermissions'];

/** Must match `.mcp.playwright.remote.json`. */
export const PLAYWRIGHT_REMOTE_URL = 'http://localhost:8931/mcp';

/** Every harness-created sandbox repo starts with this, so cleanup can find them. */
export const SANDBOX_REPO_PREFIX = 'lvrmcp-';

const nonEmpty = z.string().trim().min(1);

/** Credentials and sandbox target for the GitHub experiment, validated at startup. */
export const GithubEnvSchema = z
  .object({
    GITHUB_CONTROLLER_TOKEN: nonEmpty,
    GITHUB_SANDBOX_OWNER: nonEmpty.regex(/^[A-Za-z0-9-]+$/, 'must be a GitHub user or org name'),
    GITHUB_AGENT_TOKEN: nonEmpty.optional(),
    GITHUB_PERSONAL_ACCESS_TOKEN: nonEmpty.optional(),
    GITHUB_HOST: nonEmpty.optional(),
  })
  .refine((env) => env.GITHUB_AGENT_TOKEN || env.GITHUB_PERSONAL_ACCESS_TOKEN, {
    message: 'GITHUB_AGENT_TOKEN or GITHUB_PERSONAL_ACCESS_TOKEN is required',
    path: ['GITHUB_AGENT_TOKEN'],
  });
export type GithubEnv = z.infer<typeof GithubEnvSchema>;

/** Validates the GitHub env; the error lists every problem, never a value. */
export function readGithubEnv(env: NodeJS.ProcessEnv = process.env): GithubEnv {
  const blankToUndefined = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, value === '' ? undefined : value]));
  const parsed = GithubEnvSchema.safeParse(blankToUndefined);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`);
    throw new Error(`Invalid GitHub experiment configuration:\n  - ${problems.join('\n  - ')}`);
  }
  return parsed.data;
}
