import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Task, TaskContext, SuccessResult } from '../../../harness/src/tasks.js';

interface PageTitleState {
  expectedTitle: string;
  expectedHeading: string;
  pagePath: string;
}

function hexFromSeed(seed: string, salt: string, length = 6): string {
  // Simple xor-mix that yields a stable hex digest from the paired seed.
  // Not cryptographic; just gives each trial a distinct, deterministic page.
  let acc = 0n;
  for (const ch of `${seed}:${salt}`) acc = (acc * 1099511628211n) ^ BigInt(ch.charCodeAt(0));
  return acc.toString(16).padStart(length, '0').slice(-length);
}

async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    const text = await readFile(path, 'utf-8');
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * tier1_page_title — agent must open a known URL in the browser and report
 * the page's <title>. The fixture server hosts a per-trial randomized page.
 *
 * Validates the basic browser-MCP loop: navigate → inspect DOM → answer.
 */
export const tier1_page_title: Task = {
  id: 'tier1_page_title',
  tier: 1,

  setup: async (seed: string) => {
    const titleSuffix = hexFromSeed(seed, 'title', 8).toUpperCase();
    const headingSuffix = hexFromSeed(seed, 'heading', 8).toUpperCase();
    return {
      expectedTitle: `Playwright Trial ${titleSuffix}`,
      expectedHeading: `Trial Heading ${headingSuffix}`,
      pagePath: '/trial.html',
    } satisfies PageTitleState;
  },

  renderResponse: (state, req, res) => {
    const s = state as PageTitleState | null;
    if (!s) return false;
    if (req.url !== s.pagePath) return false;
    const html = [
      '<!doctype html>',
      '<html><head>',
      `<title>${s.expectedTitle}</title>`,
      '</head><body>',
      `<h1>${s.expectedHeading}</h1>`,
      '<p>This is the trial page rendered by the harness fixture server.</p>',
      '</body></html>',
    ].join('\n');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return true;
  },

  prompt: (ctx: TaskContext) => {
    const s = ctx.state as PageTitleState;
    return `
Open this URL in the browser and report what you see:
  ${ctx.fixturesUrl}${s.pagePath}

Save your answer as JSON at this exact path:
  ${ctx.outputDir}/page_title.json

The JSON must have these fields:
  - "page_title": the document's <title> text
  - "heading":    the visible <h1> text

When the file is written, you are done.
    `.trim();
  },

  successCheck: async (ctx: TaskContext): Promise<SuccessResult> => {
    const path = join(ctx.outputDir, 'page_title.json');
    const data = await readJsonIfExists<{ page_title?: string; heading?: string }>(path);
    if (!data) {
      return { pass: false, score: 0, notes: `missing or invalid JSON at ${path}` };
    }
    const expected = ctx.state as PageTitleState;
    const titleOk = (data.page_title ?? '').trim() === expected.expectedTitle;
    const headingOk = (data.heading ?? '').trim() === expected.expectedHeading;
    const checks = [titleOk, headingOk];
    const matched = checks.filter(Boolean).length;
    return {
      pass: matched === checks.length,
      score: matched / checks.length,
      notes: matched === checks.length ? 'page title and heading match' : `mismatch: page_title=${titleOk} heading=${headingOk}`,
      extras: { expectedTitle: expected.expectedTitle, expectedHeading: expected.expectedHeading },
    };
  },
};

interface MultistepState {
  phraseA: string;
  phraseB: string;
  expectedToken: string;
  startPath: string;
  page2Path: string;
  submitPath: string;
}

function multistepToken(seed: string, phraseA: string, phraseB: string): string {
  // Deterministic confirmation token. The server returns this only when both
  // form fields match the seed-derived phrases.
  return `OK-${hexFromSeed(`${seed}|${phraseA}|${phraseB}`, 'token', 12).toUpperCase()}`;
}

/**
 * tier1_multistep_browse — agent must navigate a two-page form workflow:
 * read a phrase from page 1, follow a link to page 2, read a second phrase,
 * fill both phrases into a form, submit, and report the confirmation token.
 *
 * Why this exists: tier1_page_title generates ~4 tool calls per trial, which
 * undersamples per-call latency once you account for the per-trial cold-start
 * tax on the first browser action. This task forces ~8–10 tool calls per
 * trial so the steady-state per-call latency dominates the mean.
 */
export const tier1_multistep_browse: Task = {
  id: 'tier1_multistep_browse',
  tier: 1,

  setup: async (seed: string) => {
    const phraseA = `Alpha-${hexFromSeed(seed, 'phraseA', 8).toUpperCase()}`;
    const phraseB = `Beta-${hexFromSeed(seed, 'phraseB', 8).toUpperCase()}`;
    return {
      phraseA,
      phraseB,
      expectedToken: multistepToken(seed, phraseA, phraseB),
      startPath: '/start.html',
      page2Path: '/page2.html',
      submitPath: '/submit',
    } satisfies MultistepState;
  },

  renderResponse: (state, req, res, body) => {
    const s = state as MultistepState | null;
    if (!s) return false;
    const url = req.url ?? '';

    if (req.method === 'GET' && url === s.startPath) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        [
          '<!doctype html>',
          '<html><head><title>Step 1</title></head><body>',
          `<h1>${s.phraseA}</h1>`,
          '<p>This is the first page. Follow the link below to continue.</p>',
          `<a id="next-link" href="${s.page2Path}">Continue to step 2</a>`,
          '</body></html>',
        ].join('\n'),
      );
      return true;
    }

    if (req.method === 'GET' && url === s.page2Path) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        [
          '<!doctype html>',
          '<html><head><title>Step 2</title></head><body>',
          `<h1>${s.phraseB}</h1>`,
          '<p>Fill both phrases into the form and submit.</p>',
          `<form id="phrase-form" action="${s.submitPath}" method="POST">`,
          '  <label>Phrase A: <input type="text" name="phrase_a" id="phrase_a"></label>',
          '  <label>Phrase B: <input type="text" name="phrase_b" id="phrase_b"></label>',
          '  <button type="submit" id="submit-button">Submit</button>',
          '</form>',
          '</body></html>',
        ].join('\n'),
      );
      return true;
    }

    if (req.method === 'POST' && url === s.submitPath) {
      const params = new URLSearchParams(body.toString('utf-8'));
      const a = params.get('phrase_a') ?? '';
      const b = params.get('phrase_b') ?? '';
      const ok = a === s.phraseA && b === s.phraseB;
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        [
          '<!doctype html>',
          '<html><head><title>Result</title></head><body>',
          ok
            ? `<h1>Confirmation</h1><p>Token: <code id="token">${s.expectedToken}</code></p>`
            : `<h1>Mismatch</h1><p>The submitted phrases did not match. (got a=${a}, b=${b})</p>`,
          '</body></html>',
        ].join('\n'),
      );
      return true;
    }

    return false;
  },

  prompt: (ctx: TaskContext) => {
    const s = ctx.state as MultistepState;
    return `
You will complete a small multi-page form workflow in the browser.

Step 1. Open this URL:
  ${ctx.fixturesUrl}${s.startPath}

Step 2. Find and follow the link on the page to the next page.

Step 3. On the second page, fill the form's two text fields:
  - phrase_a: copy the heading text from the FIRST page
  - phrase_b: copy the heading text from the SECOND page

Step 4. Submit the form.

Step 5. The result page shows a confirmation token inside <code id="token">…</code>.
Record that token by saving this JSON file:
  ${ctx.outputDir}/multistep_result.json

The JSON must have one field:
  - "token": the confirmation token text

When the file is written, you are done.
    `.trim();
  },

  successCheck: async (ctx: TaskContext): Promise<SuccessResult> => {
    const path = join(ctx.outputDir, 'multistep_result.json');
    const data = await readJsonIfExists<{ token?: string }>(path);
    if (!data) {
      return { pass: false, score: 0, notes: `missing or invalid JSON at ${path}` };
    }
    const expected = ctx.state as MultistepState;
    const tokenOk = (data.token ?? '').trim() === expected.expectedToken;
    return {
      pass: tokenOk,
      score: tokenOk ? 1 : 0,
      notes: tokenOk ? 'multistep token matches' : `mismatch: expected ${expected.expectedToken}, got ${data.token ?? '(none)'}`,
      extras: { expectedToken: expected.expectedToken },
    };
  },
};

export const tier1Tasks: Task[] = [tier1_page_title, tier1_multistep_browse];
