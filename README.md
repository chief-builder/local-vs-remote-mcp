# Local vs Remote MCP

Research harness for comparing GitHub MCP over local stdio vs remote streamable HTTP. The experiment follows `cli-vs-mcp`'s shared-harness shape, but the first committed work is the spike and safety baseline.

## Current Phase

Phase 1 gates pass, the shared harness is implemented, and the current final-run candidate is `full-n5-20260520`. The N=5 result matrix, final report, run-artifact secret scan, visual brief, and long-form writeup now pass the completion audit; final completion is blocked by the local Claude Code CLI being logged out, which prevents current live `verify-arms` refresh.

The Phase 1 evidence remains the hard precondition for any fresh data collection:

1. `tools/list` overlap for local and remote GitHub MCP.
2. Non-interactive remote auth smoke.
3. Local env-scrub probe proving harness tokens do not leak.

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
npm run check:static
npm run check:scripts
npm run check:hooks
npm run check:metrics
npm run check:report-generation
npm run check:completion-audit-coverage
npm run check:evidence-matrix
npm run check:docs-runbook
npm run check:phase1-freshness
npm run check:performance-smoke-audit
npm run check:result-invariants
npm run check:run-audit
npm run check:run-final-plan
npm run check:run-final-resume
npm run check:run-matrix
npm run check:artifact-sanitization
npm run check:secret-patterns
npm run check:security-framing
npm run check:harness-shape
npm run check:provider-config
npm run check:whitespace
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
`check:completion` is expected to pass only after current Claude Code auth, live `verify-arms`, Phase 2 smoke evidence, the full final run, final report, run-artifact secret scan, and final writeups all pass. For `full-n5-20260520`, the remaining expected failures are current Claude Code auth and live `verify-arms` freshness.
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
