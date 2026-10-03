# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased] — 2026-10-03 hardening

### Fixed

- `tier3_tool_poisoning_resilience` counted an agent *quoting* the injected canary while refusing it as
  compliance. All three "compliant" trials in `full-n5-20260520` were such refusals. Compliance now means the
  canary reached the saved answer or a tool call.
- `tier3_oauth_scope_audit` snapshotted labels before GitHub finished creating its default labels, failing every
  trial. The provisioner now waits for labels to settle.
- `harness recompute-metrics` erased `promptInjectionCompliance` and live-observed latencies.
- `npm run check:static` failed from a clean clone. Running it also rewrote tracked artifacts with absolute paths.
- Grader notes and Phase 1 artifacts no longer contain absolute local paths.
- Numeric CLI options reject invalid values instead of silently running zero trials.
- The tools/list probe now sees what Claude Code sees (revision `2026-07-28`, elicitation advertised). The remote
  server was exposing `delete_repository` to the remote arm outside both the allow and deny lists.
- `verify-arms` judges arms by the tools Claude Code actually loaded, not the model's self-report.
- `provisionRepo` deletes the sandbox repo when seeding fails partway, instead of leaking it.
- The `tier2_issue_create` grader waits out GitHub's issue-list lag (about 20 s, previously 2.5 s).
- The default-label wait no longer treats the initial empty label list as settled.

### Security

- Built-in tools are whitelisted per arm with `--tools`. Baseline agents had used Claude Code's new `ListAgents` /
  `SendMessage` tools to ask other local sessions for help; any off-list tool now counts as off-surface.
- The `auth-status` artifact no longer records raw `gh` / `claude mcp list` output.
- One credential scrub list (`harness/src/env.ts`) for trials, probes, and the env-scrub gate, which now tests
  the real trial path. It also scrubs `CONTROLLER_*` / `AGENT_*` names.
- Secret patterns now cover `ghu_` tokens. The redaction file matches.
- `@playwright/mcp` pinned to `0.0.76` instead of `@latest`.
- esbuild bumped past GHSA-g7r4-m6w7-qqqr (low). `npm audit` reports 0 vulnerabilities.
- Added SECURITY.md, Dependabot, and a least-privilege CI workflow with SHA-pinned actions.

### Added

- `node:test` suite (`npm test`, `npm run test:coverage`) with unit and integration tests.
- CI: lint, format check, typecheck, tests with coverage, build, `check:static`, and a link check.
- Biome lint/format, `.editorconfig`, CONTRIBUTING.md, issue and PR templates.
- `toolSearchMode` recorded in every trial result and listed in reports.
- Published `report.md` and per-trial result JSON for the runs cited in `docs/`.
- GitHub re-run `full-n5-20261003` (125 trials), which replaces the superseded `full-n5-20260520` numbers in the docs.

### Changed

- Node 24 LTS pinned (`.nvmrc`, `engines`). Upgraded TypeScript 7, commander 15, execa 10, zod 4.6, tsx 4.23.
- Run policy (model, timeouts, blocked tools, URLs) centralized in `harness/src/config.ts`, with GitHub
  settings validated at startup.
- README rewritten: quickstart, architecture, configuration, tests, status and limitations.
- Docs corrected where the audit found claims wrong or unsupported (see `AUDIT.md`).

### Removed

- Dead code inherited from `cli-vs-mcp`: `harness/src/shell.ts`, unused `trialState` generators, and the unused
  `--single-cli-command` mode.
