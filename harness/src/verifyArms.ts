import type { Arm } from './experiment.js';

export interface ArmToolCheck {
  pass: boolean;
  /** MCP tools for this experiment that Claude Code actually loaded (from the stream-json init event). */
  observedTools: string[];
  /** Loaded tools that are not on the arm's allow-list. */
  unexpectedTools: string[];
  /** Allow-listed tools that did not load. */
  missingTools: string[];
  notes: string[];
}

/** Pulls the tool list and final answer out of a `claude -p --output-format stream-json` transcript. */
export function parseVerifyTranscript(stdout: string): { initTools: string[] | null; answer: string } {
  let initTools: string[] | null = null;
  let answer = '';
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue;
    let event: { type?: string; subtype?: string; tools?: unknown; result?: unknown };
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === 'system' && event.subtype === 'init' && Array.isArray(event.tools)) {
      initTools = event.tools.filter((tool): tool is string => typeof tool === 'string');
    }
    if (event.type === 'result' && typeof event.result === 'string') answer = event.result;
  }
  return { initTools, answer };
}

/**
 * Checks the tools Claude Code actually loaded for an arm against its
 * policy. The model's self-reported list is not used for the verdict: it can
 * omit or invent names. MCP arms must load exactly their allow-listed MCP
 * tools; the baseline must load none.
 */
export function checkArmTools(arm: Arm, mcpPrefix: string, allowedTools: string[] | undefined, initTools: string[] | null): ArmToolCheck {
  const notes: string[] = [];
  if (initTools === null) {
    return { pass: false, observedTools: [], unexpectedTools: [], missingTools: [], notes: ['no system/init event in transcript'] };
  }
  const observedTools = initTools.filter((tool) => tool.startsWith(mcpPrefix)).sort();
  const allowed = new Set((allowedTools ?? []).filter((tool) => tool.startsWith(mcpPrefix)));
  const unexpectedTools = observedTools.filter((tool) => !allowed.has(tool));
  const missingTools = arm === 'baseline' ? [] : [...allowed].filter((tool) => !observedTools.includes(tool)).sort();

  if (arm === 'baseline' && observedTools.length > 0) notes.push('baseline loaded MCP tools');
  if (arm !== 'baseline' && observedTools.length === 0) notes.push(`${arm} loaded no MCP tools`);
  if (unexpectedTools.length > 0) notes.push(`${arm} loaded tools outside its allow-list`);
  if (missingTools.length > 0) notes.push(`${arm} is missing allow-listed tools`);

  return { pass: notes.length === 0, observedTools, unexpectedTools, missingTools, notes };
}
