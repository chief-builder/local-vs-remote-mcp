# Runbook

This runbook assumes `npm run check:static` passes before live trials.

## Preflight

```bash
npm run check:static
npm run check:claude-auth
npm run harness -- verify-arms --experiment github --output artifacts/verify-arms/github.json
```

`verify-arms` requires a logged-in Claude Code CLI. If `check:claude-auth` reports `not logged in`, run `claude auth login` in a terminal or `/login` in Claude Code, then retry.

## Smoke

Run one representative Tier 1 read task on both MCP transports:

```bash
npm run harness -- run --experiment github --run latency-smoke --arm local-stdio --task tier1_pr_diff_answer --trials 1
npm run harness -- run --experiment github --run latency-smoke --arm remote-http --task tier1_pr_diff_answer --trials 1
npm run harness -- report --experiment github --run latency-smoke --all-tiers --crossover-analysis --include-cost --output experiments/github/runs/latency-smoke/report.md
```

Run Tier 2 mutation smoke on the overlap-safe tasks:

```bash
for task in tier2_issue_workflow tier2_file_patch_pr tier2_file_patch_pr_directed tier2_issue_create; do
  npm run harness -- run --experiment github --run tier2-smoke --arm local-stdio --task "$task" --trials 1
  npm run harness -- run --experiment github --run tier2-smoke --arm remote-http --task "$task" --trials 1
done
npm run harness -- report --experiment github --run tier2-smoke --tier 2 --crossover-analysis
```

Run the security tier smoke:

```bash
npm run harness -- run --experiment github --run security-smoke --arm local-stdio --tier 3 --trials 1
npm run harness -- run --experiment github --run security-smoke --arm remote-http --tier 3 --trials 1
npm run harness -- report --experiment github --run security-smoke --tier 3 --crossover-analysis
```

## Full N=5

Use a new run name when collecting final data. The default task suite intentionally excludes `tier1_workflow_status` because Actions tools are not in the local/remote overlap catalog.

```bash
RUN=full-n5-$(date +%Y%m%d)
npm run plan:run -- --run "$RUN" --trials 5

for arm in baseline local-stdio remote-http; do
  npm run harness -- run --experiment github --run "$RUN" --arm "$arm" --tier 1 --trials 5
  npm run harness -- run --experiment github --run "$RUN" --arm "$arm" --tier 2 --trials 5
done

for arm in local-stdio remote-http; do
  npm run harness -- run --experiment github --run "$RUN" --arm "$arm" --tier 3 --trials 5
done

npm run harness -- report --experiment github --run "$RUN" --all-tiers --crossover-analysis --include-cost --output "experiments/github/runs/$RUN/report.md"
npm run check:run -- --run "$RUN" --trials 5
npm run scan:secrets -- --path "experiments/github/runs/$RUN"
npm run check:static
npm run check:completion -- --run "$RUN" --trials 5
```

The same sequence can be run from task metadata with a resumable driver:

```bash
RUN=full-n5-$(date +%Y%m%d)
npm run run:final -- --run "$RUN" --trials 5 --dry-run
npm run run:final -- --run "$RUN" --trials 5 --resume
```

Without `--resume`, the driver runs `check:static`, refreshes `latency-smoke`, and runs arm/tier batches. With `--resume`, it still runs `check:static`, then checks the Phase 2 smoke audit. Refresh Phase 2 performance smoke when local/remote N=1 smoke is missing or stale, then check existing final result JSON plus transcript JSONL and run only incomplete arm/task/trial cells. A final trial is considered complete only when it has a well-formed success judgment with a `0..1` score, valid tool surface, correct intended-tool evidence (`baseline` has no GitHub MCP calls; `local-stdio` and `remote-http` have at least one `mcp__github__*` call), no secret-shaped assistant output, required metric fields, a non-empty parseable transcript JSONL, and no token-shaped text in that trial's task-output directory. `success.pass=false` is still valid data, especially for the tool-less baseline floor. Partially complete tasks are resumed with `harness run --trial <n>` so valid trials are not overwritten. The resume driver and `check:run` share the transcript, result-invariant, and run-artifact scanning helpers so skip behavior tracks the final audit.

## Unattended runs

Run on AC power and keep the machine awake for the whole run (macOS: `caffeinate -i -s npm run run:final -- ...`).
Sleep inflates wall-clock latency. After a run, compare trial windows with `pmset -g log` and delete and resume any
trial that overlapped a sleep.

## Cleanup

Interrupted live runs can leave private sandbox repos behind. The cleanup helper is dry-run by default and only targets harness-created repo names with the `lvrmcp-` prefix:

```bash
npm run cleanup:sandbox
npm run cleanup:sandbox -- --delete --yes
```

## Coverage-Gap Task

`tier1_workflow_status` is retained in source as `tier1CoverageGapTasks`, but it is not part of the default apples-to-apples run. To study it separately, first grant the controller token Actions read and Workflows read/write, then add a one-off task export or small runner command for coverage-gap trials. Do not mix those results into the overlap report.
