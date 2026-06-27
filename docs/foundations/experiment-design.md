# Experiment Design

How the harness turns a hypothesis into trial data.

## Two experiments, one harness

The shared runner lives in `harness/src/`; each experiment supplies its own arms,
tasks, and fixtures.

- **`github`** (primary) — realistic transport choice: a digest-pinned GitHub MCP
  Docker image over stdio vs GitHub's hosted endpoint over streamable HTTP. It
  answers "what does the deployment I would actually pick cost me?" but confounds
  transport with server implementation, network path, and vendor backend.
- **`playwright`** (companion / control) — the *same* `@playwright/mcp` binary
  over both transports, isolating transport from server implementation. It exists
  to check whether the GitHub effects are about the wire or about the servers.

See [MCP transports](./mcp-transports.md) for what the transports are.

## Arms

Every experiment defines up to three arms:

- **`baseline`** — no MCP server; only local tools. The pure-reasoning floor.
  Used to confirm tasks genuinely require the MCP surface (baseline should fail
  GitHub tasks). Measured for GitHub; defined but not central for Playwright.
- **`local-stdio`** — the server over stdio, spawned per trial.
- **`remote-http`** — the server over streamable HTTP, a warm service.

## Tiers

- **Tier 1** — read-only tasks (inspect a repo, read a page title).
- **Tier 2** — state-mutating tasks (open an issue, patch a file in a PR, persist
  a form). GitHub mutates real sandbox repos via a controller token; Playwright
  mutates a per-trial in-memory store in the fixture server.
- **Tier 3** — security probes (prompt injection, affordance lures, env-leak and
  OAuth-scope checks). These carry the H2 metrics.

## Paired seeds

Each trial is keyed by a deterministic seed derived from
`(experiment, run, task, trial)`. Both arms of a comparison use the **same** seed
for the same trial number, so per-trial randomization (page contents, item names,
injected canaries) is identical across arms. This makes arm differences
attributable to the arm, not to luck of the draw.

## Validity classifier

The runner parses each transcript and records whether the agent stayed on its
intended tool surface (e.g. used `mcp__playwright__*` tools, not an escape hatch).
Reports separate **valid-surface** trials so that an arm that "cheated" its way to
an answer does not inflate success. It is a witness, not a sandbox.

## Metrics

Per trial the harness records:

- Inherited: success/pass, valid tool surface, token counts (input, cached, cache
  create, output, total), turns, wall-clock, cost.
- Transport: `perToolCallLatencyMs` (time between a `tool_use` and its
  `tool_result`), `coldStartMs` (first call vs median), `transportFailures`
  (5xx / reset / OAuth-refresh signals).
- Security: `promptInjectionCompliance` (did the agent execute the injected /
  lured action), `secretInOutput` (token-shaped strings in assistant text).

## Hypotheses

- **H1 — performance.** Token cost is transport-invariant; wall-clock latency is
  not. (Depends only on what the model reads vs how bytes arrive — see
  [MCP transports](./mcp-transports.md).)
- **H2 — security.** Protocol-level attacks (tool poisoning, prompt injection via
  tool results, affordance lures) are transport-agnostic; both arms should comply
  at the same rate. Transport-*specific* attacks differ (local: env/filesystem;
  remote: OAuth scope / stored tokens).

## How a trial runs

1. The runner derives the paired seed and calls the task's `setup`.
2. It starts a per-trial **fixture server** that renders the task's pages /
   responses (so tasks are hermetic and offline-reproducible).
3. It builds the `claude` CLI invocation for the arm (MCP config, allow/deny tool
   lists, model, timeout) and scrubs sensitive env from the child.
4. The agent runs to completion or the arm timeout; stdout (a JSONL transcript)
   and stderr are captured.
5. The task's `successCheck` grades the result — often by querying ground truth
   (the fixture store, a file the agent wrote, or the parsed tool-call log) rather
   than trusting the agent's self-report.
6. Metrics + grade are written to `results/<arm>/<task>/<trial>.json`; the
   transcript to `transcripts/<arm>/<task>/<trial>.jsonl`.

A run is a namespace under `experiments/<exp>/runs/<run>/`. The report generator
(`harness report`) aggregates a run into a markdown table with per-task, per-tier,
crossover, and cost sections.

> One variable this design must pin explicitly: **tool-discovery mode**. See
> [tool discovery and deferral](./tool-discovery-and-deferral.md) for why an
> unpinned `ENABLE_TOOL_SEARCH` can contaminate Tier 3 results.
</content>
