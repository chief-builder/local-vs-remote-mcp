import type { ExperimentSpec, ExperimentClassifier, ArmConfig, Arm } from '../experiment.js';
import {
  ALWAYS_BLOCKED_TOOLS,
  BASELINE_TIMEOUT_MS,
  COMMON_CLAUDE_FLAGS,
  EXECUTION_TOOLS,
  MCP_TIMEOUT_MS,
  PLAYWRIGHT_REMOTE_URL,
} from '../config.js';

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
 *   npx @playwright/mcp@0.0.76 --port 8931 --headless --isolated
 *
 * The preflight only reaches the URL when the targeted arm includes
 * remote-http, so running local-stdio alone doesn't require the HTTP server.
 */


/**
 * Live catalog captured on 2026-05-29 (artifacts/spike/playwright-tools-list/list.json,
 * server `Playwright 1.61.0-alpha-1778188671000` = @playwright/mcp 0.0.75).
 * Re-probed 2026-10-03 against the pinned 0.0.76: same 23 tools. 0.0.83
 * adds `browser_emulate_media` and `browser_find`; re-probe before bumping
 * the pin. Since both arms use the same server, the catalog is identical
 * across transports by construction.
 *
 * Note: `browser_run_code_unsafe` is deliberately kept in the allow-list,
 * not denied. Security-tier tasks need it available so they can measure
 * whether an agent reaches for it when an injected instruction or a poisoned
 * tool description tries to lure them in.
 */
const PLAYWRIGHT_TOOLS = [
  'browser_click',
  'browser_close',
  'browser_console_messages',
  'browser_drag',
  'browser_drop',
  'browser_evaluate',
  'browser_file_upload',
  'browser_fill_form',
  'browser_handle_dialog',
  'browser_hover',
  'browser_navigate',
  'browser_navigate_back',
  'browser_network_request',
  'browser_network_requests',
  'browser_press_key',
  'browser_resize',
  'browser_run_code_unsafe',
  'browser_select_option',
  'browser_snapshot',
  'browser_tabs',
  'browser_take_screenshot',
  'browser_type',
  'browser_wait_for',
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
  const mcpDisallowedTools = [...EXECUTION_TOOLS, ...ALWAYS_BLOCKED_TOOLS];

  return {
    baseline: {
      id: 'baseline',
      description: 'No Playwright MCP: pure reasoning floor against the local filesystem',
      mcpConfig: '{"mcpServers":{}}',
      allowedTools: ['ToolSearch', 'Read', 'Glob', 'Grep', 'Write', 'TodoWrite'],
      disallowedTools: [...EXECUTION_TOOLS, ...ALWAYS_BLOCKED_TOOLS, ...OVERLAP_TOOLS],
      extraFlags: [...COMMON_CLAUDE_FLAGS],
      timeoutMs: BASELINE_TIMEOUT_MS,
    },
    'local-stdio': {
      id: 'local-stdio',
      description: '@playwright/mcp via stdio (npx-launched per trial)',
      mcpConfig: '.mcp.playwright.local.json',
      allowedTools: mcpAllowedTools,
      disallowedTools: mcpDisallowedTools,
      extraFlags: [...COMMON_CLAUDE_FLAGS],
      timeoutMs: MCP_TIMEOUT_MS,
    },
    'remote-http': {
      id: 'remote-http',
      description: '@playwright/mcp via local streamable HTTP (long-running service on localhost:8931/mcp)',
      mcpConfig: '.mcp.playwright.remote.json',
      allowedTools: mcpAllowedTools,
      disallowedTools: mcpDisallowedTools,
      extraFlags: [...COMMON_CLAUDE_FLAGS],
      timeoutMs: MCP_TIMEOUT_MS,
    },
  };
}

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
        `  npx @playwright/mcp@0.0.76 --port 8931 --headless --isolated\n` +
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
      await preflightHttpReachable(PLAYWRIGHT_REMOTE_URL);
    }
  },
};
