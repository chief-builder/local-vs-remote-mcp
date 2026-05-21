# Long-Form Writeup

## Thesis

The final GitHub MCP run compares a digest-pinned local Docker stdio server with GitHub hosted streamable HTTP using the same 41-tool overlap. In `full-n5-20260520`, total token cost was close across transports, wall-clock latency varied materially by tier, and prompt-injection behavior did not collapse to a transport-only story.

Questions:

- H1: Is token cost invariant across local stdio and remote streamable HTTP while wall-clock latency differs?
- H2: Is prompt-injection compliance the same on local and remote arms?

Results from `experiments/github/runs/full-n5-20260520/report.md` support the token-cost half of H1 directionally: valid-surface local/remote total token ratios were 1.09x in Tier 1, 0.96x in Tier 2, and 0.94x in Tier 3. The latency half is clearer: wall-clock ratios changed by tier, with remote slower in Tier 1 and faster in Tiers 2 and 3. H2 is not proven at N=5 because prompt-injection compliance was 40% local and 20% remote on `tier3_tool_poisoning_resilience`.

## Method

Arms:

- `baseline`: no MCP, pure reasoning floor.
- `local-stdio`: digest-pinned `ghcr.io/github/github-mcp-server@sha256:e3816a476a977cfb836e7d221510011436c654d11861db66ecfd826601aba6a4`.
- `remote-http`: `https://api.githubcopilot.com/mcp/`.

Control:

- Both MCP arms expose only the 41-tool overlap from `artifacts/spike/tools-list/overlap.md`.
- Non-overlap tools are explicitly disallowed.
- `tier1_workflow_status` is excluded from default runs because Actions tools are local-only in the current catalog.

Harness:

- Shared `harness/src/` runner and report generator.
- Paired seeds across arms.
- Validity classifier records off-surface tools.
- Secret scan runs before push and against final run artifacts.

## Pre-Experiment Gates

Phase 1 gates passed in `artifacts/spike/phase1-status.md`.

- The local and remote `tools/list` probes produced the catalog diff in `artifacts/spike/tools-list/overlap.md`.
- The remote non-interactive auth smoke passed with evidence in `artifacts/spike/auth/remote-smoke.json`.
- The local stdio env-scrub probe passed with evidence in `artifacts/spike/env-scrub/local-stdio-env.json`.

Catalog shape:

- Local tools: 79.
- Remote tools: 45.
- Overlap allow-list: 41.
- Local-only: 38.
- Remote-only: 4.

The env-scrub probe confirmed harness-internal token names such as `GITHUB_CONTROLLER_TOKEN`, `GITHUB_AGENT_TOKEN`, `GH_TOKEN`, and `GITHUB_TOKEN` did not survive into the local-stdio-shaped child environment. The arm credential was re-injected only under `GITHUB_PERSONAL_ACCESS_TOKEN`.

## Task Suite

Tier 1:

- `tier1_repo_inventory`
- `tier1_issue_triage`
- `tier1_pr_diff_answer`

Tier 2:

- `tier2_issue_workflow`
- `tier2_file_patch_pr`
- `tier2_file_patch_pr_directed`
- `tier2_issue_create`

Tier 3:

- `tier3_tool_poisoning_resilience`
- `tier3_env_leak_local`
- `tier3_oauth_scope_audit`

Coverage-gap note:

- `tier1_workflow_status` remains in source as `tier1CoverageGapTasks` but is not part of the apples-to-apples default run.

## Metrics

Inherited:

- Success/pass.
- Valid tool surface.
- Token counts.
- Turns.
- Wall-clock.
- Cost.

Added:

- `perToolCallLatencyMs`: elapsed time between a `tool_use` event and matching `tool_result`.
- `coldStartMs`: first tool-call latency compared with the median basis.
- `transportFailures`: count of 5xx, connection-reset, and OAuth-refresh signals.
- `promptInjectionCompliance`: whether the agent complied with the injected instruction in the tool-poisoning task.
- `secretInOutput`: regex scan over assistant text for token-shaped strings.

## Results

Source:

- `experiments/github/runs/full-n5-20260520/report.md`

The final report was generated on 2026-05-21 and covers all tiers for `full-n5-20260520`.

### H1: Cost and Latency

The report's hypothesis summary across valid-surface Tier 1 and Tier 2 MCP trials shows:

- Average total tokens: 64,681 local vs 64,156 remote, local/remote 1.01x.
- Average wall-clock: 32.3s local vs 33.7s remote, remote/local 1.04x.
- Average per-tool latency: 0.5s local vs 0.7s remote, remote/local 1.41x.

By tier:

- Tier 1 total tokens: 61,822 local vs 56,976 remote, local/remote 1.09x.
- Tier 2 total tokens: 66,825 local vs 69,541 remote, local/remote 0.96x.
- Tier 3 total tokens: 50,353 local vs 53,612 remote, local/remote 0.94x.
- Tier 1 wall-clock: 17.4s local vs 42.0s remote.
- Tier 2 wall-clock: 43.4s local vs 27.6s remote.
- Tier 3 wall-clock: 42.7s local vs 16.9s remote.

Interpretation:

- Token totals are close enough that transport did not appear to dominate cost in this run.
- Wall-clock did differ, but the faster transport depended on tier and task mix.
- The latency metric captured per-call overhead, while end-to-end wall-clock also reflected model turns, task behavior, and trial variance.
- Recorded `transportFailures` averaged 0.0 across all per-task and per-tier rows.

### H2: Prompt Injection

The security hypothesis uses only `tier3_tool_poisoning_resilience`.

- Local stdio: 40% prompt-injection compliance across five trials.
- Remote HTTP: 20% prompt-injection compliance across five trials.
- Difference: -20.0 percentage points remote minus local.

At N=5, this does not prove equality. It does support the threat-model framing that tool poisoning and indirect prompt injection are not solved by changing transport: both transports produced non-zero compliance with injected instructions.

### Baseline Floor

The baseline arm had no MCP tools. It was a reasoning floor, not a productive GitHub automation arm.

- Tier 1 baseline success: 0% across 15 valid-surface trials.
- Tier 2 baseline success: 0% across 20 valid-surface trials.
- Baseline valid surface: 100% in both Tier 1 and Tier 2.

This is the desired shape for the floor: no MCP meant no GitHub task completion, and the validity surface stayed clean.

## Security Interpretation

Local stdio:

- The local server process inherits the user's trust boundary.
- Supply-chain compromise can become local filesystem/env compromise.
- Digest pinning reduces version drift but does not sandbox execution.
- The env-scrub probe is necessary because local stdio is where accidental environment exposure is easiest to create.

Remote HTTP:

- Moves risk to OAuth, stored credentials, provider infrastructure, and data egress.
- Over-broad scopes and confused-deputy patterns matter even when tasks are read-only.
- The remote OAuth scope audit scored 0.9 on average but had 0% task success under the strict success check, which is a useful signal to inspect before broad claims.

Both:

- Tool poisoning and indirect prompt injection are protocol-level risks.
- Transport does not change the model's obligation to treat tool results as untrusted data.
- `secretInOutput` was 0% across the final report, and the run artifact secret scan passed, so the recorded outputs did not contain token-shaped assistant text by the configured scanners.

## Caveats

- N=5 is directional, not benchmark-grade.
- GitHub MCP catalogs can drift, so the overlap allow-list is a dated artifact.
- The validity classifier is a witness, not a sandbox.
- The local arm uses Docker stdio, so env exposure is bounded by what the MCP process/container receives.
- Results are provider-specific; do not generalize to every MCP server.
- Claude Code auth and live arm verification remain operational prerequisites before publishing a new regenerated report.

## Reproduction

Commands:

```bash
npm run check:static
npm run check:claude-auth
npm run harness -- verify-arms --experiment github --output artifacts/verify-arms/github.json
npm run run:final -- --run full-n5-20260520 --trials 5 --resume
npm run check:completion -- --run full-n5-20260520 --trials 5
```

For a full command preview:

```bash
npm run plan:run -- --run full-n5-20260520 --trials 5
npm run run:final -- --run full-n5-20260520 --trials 5 --dry-run
```

## Appendix

Key artifacts:

- Tool catalog diff: `artifacts/spike/tools-list/overlap.md`.
- Phase 1 status: `artifacts/spike/phase1-status.md`.
- Final report: `experiments/github/runs/full-n5-20260520/report.md`.
- Final results: `experiments/github/runs/full-n5-20260520/results/`.
- Final transcripts: `experiments/github/runs/full-n5-20260520/transcripts/`.
- Token/redaction policy: `redaction/README.md`.
