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

### Security

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

### Changed

- Node 24 LTS pinned (`.nvmrc`, `engines`). Upgraded TypeScript 7, commander 15, execa 10, zod 4.6, tsx 4.23.
- Run policy (model, timeouts, blocked tools, URLs) centralized in `harness/src/config.ts`, with GitHub
  settings validated at startup.
- README rewritten: quickstart, architecture, configuration, tests, status and limitations.
- Docs corrected where the audit found claims wrong or unsupported (see `AUDIT.md`).

### Removed

- Dead code inherited from `cli-vs-mcp`: `harness/src/shell.ts`, unused `trialState` generators, and the unused
  `--single-cli-command` mode.
