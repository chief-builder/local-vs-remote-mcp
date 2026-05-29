import type { ExperimentSpec, ExperimentClassifier, ArmConfig, Arm } from '../experiment.js';

/**
 * Playwright transport comparison. Both MCP arms point at the *same* server
 * implementation (`@playwright/mcp`) and differ only in transport:
 *
 *   - local-stdio:  spawned per-trial via npx
 *   - remote-http:  long-running HTTP service on localhost:8931, /mcp endpoint
 *
 * The remote arm uses the current **streamable HTTP** transport (the /mcp
 * endpoint). The server's legacy SSE endpoint (/sse) is deliberately not in
 * scope — this experiment is about the current spec, not the legacy one.
 *
 * Same server, same tool catalog, two delivery channels. This isolates
 * transport overhead from server-implementation drift.
 *
 * The remote-http arm requires the server to be running externally before
 * trials start, e.g.
 *
 *   npx @playwright/mcp@latest --port 8931 --headless --isolated
 *
 * The preflight only reaches the URL when the targeted arm includes
 * remote-http, so running local-stdio alone doesn't require the HTTP server.
 */

const ALWAYS_BLOCKED = ['WebFetch', 'WebSearch', 'Monitor', 'CronCreate', 'RemoteTrigger'];
const COMMON_FLAGS = ['--setting-sources', 'project,local', '--permission-mode', 'bypassPermissions'];

/**
 * Starter allow-list derived from the `@playwright/mcp` tool catalog. After
 * the first probe the user should replace this with the overlap from a real
 * `tools/list` probe (the catalog is identical across transports by
 * construction here, so "overlap" is just "everything the server exposes").
 */
const PLAYWRIGHT_TOOLS = [
  'browser_navigate',
  'browser_navigate_back',
  'browser_close',
  'browser_resize',
  'browser_snapshot',
  'browser_take_screenshot',
  'browser_click',
  'browser_type',
  'browser_fill_form',
  'browser_select_option',
  'browser_press_key',
  'browser_hover',
  'browser_drag',
  'browser_file_upload',
  'browser_handle_dialog',
  'browser_evaluate',
  'browser_wait_for',
  'browser_console_messages',
  'browser_network_requests',
  'browser_tabs',
];

const OVERLAP_TOOLS = PLAYWRIGHT_TOOLS.map((name) => `mcp__playwright__${name}`);

const playwrightClassifier: ExperimentClassifier = {
  intendedMcpPrefix: 'mcp__playwright__',
};

function buildArms(): Record<Arm, ArmConfig> {
  const mcpAllowedTools = ['ToolSearch', 'Read', 'Write', 'TodoWrite', ...OVERLAP_TOOLS];
  // The baseline disallows the playwright catalog as well, so its only
  // execution surface is local filesystem + ToolSearch — same shape as the
  // github baseline.
  const mcpDisallowedTools = ['Skill', 'Bash', 'Task', 'Agent', ...ALWAYS_BLOCKED];

  return {
    baseline: {
      id: 'baseline',
      description: 'No Playwright MCP: pure reasoning floor against the local filesystem',
      mcpConfig: '{"mcpServers":{}}',
      allowedTools: ['ToolSearch', 'Read', 'Glob', 'Grep', 'Write', 'TodoWrite'],
      disallowedTools: ['Skill', 'Bash', 'Task', 'Agent', ...ALWAYS_BLOCKED, ...OVERLAP_TOOLS],
      extraFlags: [...COMMON_FLAGS],
      timeoutMs: 90_000,
    },
    'local-stdio': {
      id: 'local-stdio',
      description: '@playwright/mcp via stdio (npx-launched per trial)',
      mcpConfig: '.mcp.playwright.local.json',
      allowedTools: mcpAllowedTools,
      disallowedTools: mcpDisallowedTools,
      extraFlags: [...COMMON_FLAGS],
      timeoutMs: 240_000,
    },
    'remote-http': {
      id: 'remote-http',
      description: '@playwright/mcp via local streamable HTTP (long-running service on localhost:8931/mcp)',
      mcpConfig: '.mcp.playwright.remote.json',
      allowedTools: mcpAllowedTools,
      disallowedTools: mcpDisallowedTools,
      extraFlags: [...COMMON_FLAGS],
      timeoutMs: 240_000,
    },
  };
}

const REMOTE_HTTP_URL = 'http://localhost:8931/mcp';

async function preflightHttpReachable(url: string): Promise<void> {
  try {
    const probeUrl = url.replace(/\/mcp\/?$/, '/');
    const res = await fetch(probeUrl, { method: 'GET' });
    // Any response (including 404/405) proves the listener is up.
    if (!res) throw new Error('no response');
  } catch (err) {
    throw new Error(
      `remote-http arm requires the Playwright MCP server to be reachable at ${url}.\n` +
        `Start it in another terminal with:\n` +
        `  npx @playwright/mcp@latest --port 8931 --headless --isolated\n` +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export const playwrightExperiment: ExperimentSpec = {
  name: 'playwright',
  description: 'Playwright MCP transport comparison: same server, stdio vs local streamable HTTP.',
  arms: buildArms(),
  classifier: playwrightClassifier,
  tasksPath: 'experiments/playwright/tasks/index.js',
  preflight: async (arms) => {
    // Only check the HTTP listener when the run actually targets remote-http.
    // local-stdio launches its own child per trial and needs no external service.
    if (arms.includes('remote-http')) {
      await preflightHttpReachable(REMOTE_HTTP_URL);
    }
  },
};
