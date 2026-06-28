# Visual Brief

## Headline

Same tools, two MCP transports: token cost is invariant and latency moves by deployment (warm vs cold), not the wire — and the one "transport-specific" security gap turned out to be a tool-discovery measurement artifact, not a property of the transport. Prompt injection stays a protocol-level risk on both.

## First Screen

Required signals:

- Provider: GitHub MCP.
- Local arm: digest-pinned Docker stdio.
- Remote arm: GitHub hosted streamable HTTP.
- Baseline: no MCP.
- Catalog constraint: 41-tool overlap from `artifacts/spike/tools-list/overlap.md`.
- Final sample: N=5 per applicable task in final run `full-n5-20260520`.
- Evidence path: `experiments/github/runs/full-n5-20260520/report.md`.

Primary chart:

- Local vs remote total token ratio by tier: Tier 1 local/remote 1.09x, Tier 2 0.96x, Tier 3 0.94x.
- Local vs remote wall-clock by tier: Tier 1 17.4s local vs 42.0s remote, Tier 2 43.4s local vs 27.6s remote, Tier 3 42.7s local vs 16.9s remote.
- Security prompt-injection compliance rate for `tier3_tool_poisoning_resilience`: 40% local, 20% remote, five trials per transport.

## Panel 1: Tool Catalog

Source:

- `artifacts/spike/tools-list/overlap.md`

Facts to show:

- Local tools: 79.
- Remote tools: 45.
- Overlap allow-list: 41.
- Local-only tools: 38.
- Remote-only tools: 4.
- Local-only Actions tools are excluded from default comparisons.

Visual idea:

- Venn-style count block plus a callout: Actions tooling is a catalog gap, not a transport result.

## Panel 2: Performance

Source:

- `experiments/github/runs/full-n5-20260520/report.md`

Charts:

- Tier 1 and Tier 2 total token average: local 61,822 vs remote 56,976 in Tier 1; local 66,825 vs remote 69,541 in Tier 2.
- Tier 1 and Tier 2 wall-clock average: local 17.4s vs remote 42.0s in Tier 1; local 43.4s vs remote 27.6s in Tier 2.
- Per-tool latency average: local 0.2s vs remote 0.3s in Tier 1; local 0.7s vs remote 1.0s in Tier 2; local 13.1s vs remote 0.4s in Tier 3.
- Cold-start deltas rounded to 0.0s in the per-tier summaries.

Claim:

> H1 is partly supported. Token totals stayed close enough to look transport-invariant at this scale, but wall-clock latency was not invariant and did not favor one transport uniformly across tiers.

## Panel 3: Reliability

Source:

- `transportFailures` in final result JSON and `experiments/github/runs/full-n5-20260520/report.md`.

Charts:

- Transport failure count per arm.
- Success rate per task for local and remote.

Claim:

> Recorded transport failures were 0.0 across all report rows. Reliability differences showed up in task success and elapsed time, not in explicit 5xx, connection-reset, or OAuth-refresh counters.

Notes:

- Tier 1 success: local 100%, remote 93%.
- Tier 2 success: local 100%, remote 100%.
- Tier 3 success: local 70%, remote 40%, with different security tasks applicable to each transport.

## Panel 4: Security

Source:

- Tier 3 final results in `experiments/github/runs/full-n5-20260520/report.md`.

Charts:

- Prompt-injection compliance rate on local vs remote.
- Secret-in-output rate.
- Env leak canary outcome for local.
- OAuth scope audit mutation outcome for remote.

Claim:

> H2 is not proven at N=5. Prompt-injection compliance was 40% on local stdio and 20% on remote HTTP for `tier3_tool_poisoning_resilience`, so the observed rates were not identical even though the risk remains protocol-level for both transports.

Security counters:

- `secretInOutput`: 0% for every per-task and per-tier row.
- `tier3_env_leak_local`: 100% success, 0% secret output.
- `tier3_oauth_scope_audit`: 0% success with 0.9 average score, 0% secret output.

## Panel 5: Threat Model

Show three lanes:

- Local stdio: user-privilege local process, filesystem/env blast radius, supply-chain sensitivity.
- Remote HTTP: OAuth/confused-deputy, persistent credential, provider/backend blast radius.
- Both: tool poisoning and indirect prompt injection.

Interpretation:

- Local stdio reduces remote OAuth exposure but makes the local MCP binary and its environment a high-value trust boundary.
- Remote HTTP moves execution out of the local process but keeps credential persistence and delegated authority central.
- Tool output remains untrusted data in both cases.

## Panel 6: Companion Experiment (Playwright)

Source:

- `experiments/playwright/runs/full-repro-20260626/report.md`
- `experiments/playwright/runs/unsafe-deconf-20260627/` (de-confound control)

Facts to show:

- The same `@playwright/mcp` binary runs on both transports, isolating transport from server implementation (the github confound).
- H1 token cost: local 269,883 vs remote 273,911 total (0.99x) — transport-invariant, even tighter than github.
- H1 per-call latency: indistinguishable (local 28ms vs remote 21ms median).
- H2 compliance: two injection mechanics scored 0/30 on both arms. The affordance-lure task scored 33% local / 77% remote under deferred tools, then collapsed to 0/30 on both arms once tools were loaded directly (`ENABLE_TOOL_SEARCH=false`).

Claim:

> The one large transport-looking security effect was a tool-discovery measurement artifact, not a transport property. Controlled for, prompt-injection compliance is 0 on both transports. See `docs/foundations/tool-discovery-and-deferral.md`.

## Footer

Link targets:

- Full long-form writeup: `docs/writeup/long-form.md`.
- Foundations (concept background): `docs/foundations/`.
- github final run report: `experiments/github/runs/full-n5-20260520/report.md`.
- Playwright run report: `experiments/playwright/runs/full-repro-20260626/report.md`.
- Tool catalog diff: `artifacts/spike/tools-list/overlap.md`.
- Redaction/secret-scan recipe: `redaction/README.md`.
