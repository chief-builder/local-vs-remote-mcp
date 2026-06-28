# Local vs Remote MCP

Research harness comparing GitHub MCP over local stdio vs remote streamable HTTP, with a Playwright companion experiment that isolates transport from server implementation. Built on the `cli-vs-mcp` shared-harness shape.

## Current Phase

Phase 1 gates pass, the shared harness is implemented, and the final-run candidate is `full-n5-20260520`. The N=5 result matrix, final report, run-artifact secret scan, visual brief, and long-form writeup pass the completion audit. The remaining step before publishing a regenerated report is a fresh live `verify-arms` refresh under current Claude Code auth.

The Phase 1 evidence remains the hard precondition for any fresh data collection:

1. `tools/list` overlap for local and remote GitHub MCP.
2. Non-interactive remote auth smoke.
3. Local env-scrub probe proving harness tokens do not leak.

## Companion Experiment (Playwright)

A second experiment under `experiments/playwright/` isolates transport from server implementation: both arms run the **same** `@playwright/mcp` binary, differing only in delivery channel (per-trial stdio child vs warm `localhost:8931/mcp` service). It is the control for the GitHub comparison, which necessarily uses two different server implementations.

Latest Playwright data:

- `experiments/playwright/runs/full-repro-20260626/` — H1 (N=10) and H2 (N=30), report at `report.md`.
- `experiments/playwright/runs/unsafe-deconf-20260627/` — de-confound control for the affordance-lure task.

Headline: token cost is transport-invariant (0.99x); per-call latency is indistinguishable; prompt-injection compliance is 0 on both transports across three attack mechanics once tool discovery is controlled. The affordance-lure task only *looked* transport-dependent (33% local / 77% remote) because deferred-tool discovery confounded it; with `ENABLE_TOOL_SEARCH=false` it is 0/30 on both arms. See [tool discovery and deferral](docs/foundations/tool-discovery-and-deferral.md).

Running it (Claude Code must be logged in; the remote arm needs the server up):

```bash
# remote arm: start the shared server first
npx @playwright/mcp@latest --port 8931 --headless --isolated
# trials; set ENABLE_TOOL_SEARCH=false to load all MCP tools directly (no ToolSearch)
npm run harness -- run --experiment playwright --run <run> --arm local-stdio --task tier1_multistep_browse --trials 10
npm run harness -- run --experiment playwright --run <run> --arm remote-http --task tier1_multistep_browse --trials 10
npm run harness -- report --experiment playwright --run <run> --all-tiers --crossover-analysis --include-cost --output experiments/playwright/runs/<run>/report.md
```

## Foundations

Concept background for the whole experiment lives in [`docs/foundations/`](docs/foundations/README.md):

- [MCP transports](docs/foundations/mcp-transports.md) — stdio vs streamable HTTP.
- [Tool discovery and deferral](docs/foundations/tool-discovery-and-deferral.md) — the deferred-tool mechanism and its measurement confound.
- [Experiment design](docs/foundations/experiment-design.md) — arms, tiers, metrics, hypotheses.
- [Threat models](docs/foundations/threat-models.md) — security framing.

## Commands

```bash
npm run auth:status
npm run probe:tools -- --arm local
npm run probe:tools -- --arm remote
npm run probe:tools -- --compare
npm run probe:env-scrub
npm run phase1:status
npm run check:arms
npm run check:claude-auth
npm run check:static          # full non-live gate set; see package.json for the individual check:* scripts it runs
npm run check:completion -- --run <final-run> --trials 5
npm run plan:run -- --run <final-run> --trials 5
npm run run:final -- --run <final-run> --trials 5 --dry-run
npm run run:final -- --run <final-run> --trials 5 --resume
npm run cleanup:sandbox
npm run scan:secrets
npm run hooks:install

# After Phase 1 gates pass, run harness commands.
npm run harness -- verify-arms --experiment github
npm run harness -- run --experiment github --run smoke-n1 --arm local-stdio --task tier1_pr_diff_answer --trials 1
npm run harness -- run --experiment github --run smoke-n1 --arm remote-http --task tier1_pr_diff_answer --trials 1
npm run harness -- report --experiment github --run smoke-n1 --all-tiers --crossover-analysis
```

`auth:status` writes a sanitized auth readiness artifact under `artifacts/spike/auth/status.json`.
`probe:tools` writes sanitized tool-catalog JSON under `artifacts/spike/tools-list/`.
By default, `probe:tools` uses `--auth-source auto`: `.env` token first, then `gh auth token` if the GitHub CLI has a valid keychain token. You can force `--auth-source env` or `--auth-source gh`.
`probe:env-scrub` verifies the local-stdio child environment removes harness-internal token names before any trial data is collected.
`phase1:status` writes `artifacts/spike/phase1-status.json` and `.md`; use `npm run phase1:status -- --strict` as the hard gate before harness work. The strict gate also rejects stale catalog/auth/env-scrub artifacts when their relevant probe sources are newer.
`check:arms` verifies that the baseline exposes zero GitHub MCP tools, both MCP transports expose exactly the overlap allow-list, non-overlap tools are disallowed, configured timeouts match the run policy, and the default task export excludes the workflow coverage-gap task.
`check:claude-auth` verifies the local Claude Code CLI login needed by `verify-arms` and live trials.
`check:static` runs the non-live gate set: Phase 1 strict status, arm policy, TypeScript, metric parser regression, report-generation regression, completion report/writeup freshness regressions, completion-audit coverage, evidence-matrix audit, docs/runbook audit, Phase 1 freshness regression, performance-smoke audit regression, final-run artifact regressions, full-plan/resume driver regressions, run-matrix audit, static-gate coverage audit, artifact sanitization, secret-pattern drift, security-framing drift, shared-harness shape drift, provider-config drift, script syntax, hook installation, secret scan, and an explicit whitespace/conflict-marker scan over tracked and untracked files.
`check:completion` is expected to pass only after current Claude Code auth, live `verify-arms`, Phase 2 smoke evidence, the full final run, final report, run-artifact secret scan, and final writeups all pass. For `full-n5-20260520`, the remaining expected gap is a fresh live `verify-arms` refresh under current Claude Code auth.
`plan:run` prints the arm/task/tier matrix and exact final-run commands from task metadata.
`run:final` executes the static preflight, Phase 2 latency smoke, metadata-derived final run, report, run check, artifact secret scan, and completion audit; use `--dry-run` first and `--resume` after interruptions to run only smoke/final cells missing complete current evidence.
If live execution stops at Claude Code auth, run `claude auth login` in a terminal or `/login` in Claude Code, then resume with `npm run run:final -- --run <final-run> --trials 5 --resume`.
`cleanup:sandbox` lists harness-created sandbox repos with the `lvrmcp-` prefix and deletes them only with `-- --delete --yes`.

See `docs/runbook.md` for smoke, full N=5, security-tier, and coverage-gap commands.

## Default Trial Suite

The default GitHub task export contains only tasks supported by the 41-tool local/remote overlap allow-list. `tier1_workflow_status` is kept in source as `tier1CoverageGapTasks`, but it is excluded from normal runs because Actions tools are local-only in the current catalog (`actions_get`, `actions_list`, `actions_run_trigger`, `get_job_logs`) and the setup path requires controller Workflows write permission.

The baseline arm is intentionally tool-less for GitHub access and uses a shorter 90s timeout. The MCP arms keep the 240s timeout used for live network trials.

## GitHub Token Permissions

`GITHUB_CONTROLLER_TOKEN` is held by the harness and provisions/deletes sandbox repos. For the default overlap suite it needs access to `chief-builder-lab` with:

- Administration: read/write
- Contents: read/write
- Issues: read/write
- Pull requests: read/write

The coverage-gap `tier1_workflow_status` task additionally needs Actions read and Workflows read/write. Without Workflows write, setup fails with GitHub API 403 before the agent trial starts.

`GITHUB_AGENT_TOKEN` is exposed only to the MCP server child process as `GITHUB_PERSONAL_ACCESS_TOKEN`. For the default suite it needs sandbox-repo access with metadata, contents, issues, and pull requests. Tier 2 mutation tasks need write access to contents, issues, and pull requests.

## Local MCP Image

The local arm is pinned to:

```text
ghcr.io/github/github-mcp-server@sha256:e3816a476a977cfb836e7d221510011436c654d11861db66ecfd826601aba6a4
```

## Remote MCP URL

The remote arm uses GitHub's hosted streamable HTTP MCP endpoint:

```text
https://api.githubcopilot.com/mcp/
```

## Secret Recovery

If a token ever lands in history, first rotate the credential, then use:

```bash
git-filter-repo --replace-text redaction/git-filter-repo-replacements.txt --force
```

After rewriting, re-run `npm run scan:secrets` before any push.
