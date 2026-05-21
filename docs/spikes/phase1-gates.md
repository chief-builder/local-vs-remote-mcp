# Phase 1 Spike Gates

Current status: PASS when `npm run phase1:status -- --strict` accepts the checked-in spike artifacts. Re-run strict mode after changing probe scripts or MCP configuration.

## Gate 1: Tool Catalog Overlap

Required evidence:

- `artifacts/spike/tools-list/local.json`
- `artifacts/spike/tools-list/remote.json`
- `artifacts/spike/tools-list/overlap.json`
- `artifacts/spike/tools-list/overlap.md`

The allow-list for `local-stdio` and `remote-http` must be the overlap, not either provider's full catalog.

Commands:

```bash
npm run auth:status
npm run probe:tools -- --arm local --auth-source auto
npm run probe:tools -- --arm remote --auth-source auto
npm run probe:tools -- --compare
```

The local probe scrubs inherited GitHub variables before launching Docker and re-injects only `GITHUB_PERSONAL_ACCESS_TOKEN`, `GITHUB_TOOLSETS`, and optional `GITHUB_HOST`.
`--auth-source auto` means `.env` first, then a valid `gh auth token` from the GitHub CLI keychain. Use `--auth-source env` or `--auth-source gh` to force one route.

## Gate 2: Non-Interactive Remote Auth

Required evidence:

- One successful `remote-http` `tools/list` probe from a child process.
- One manual smoke run that uses the remote GitHub MCP without interactive OAuth prompts.

Accepted routes:

- `GITHUB_PERSONAL_ACCESS_TOKEN` bearer header works against `https://api.githubcopilot.com/mcp/`.
- A keychain-stored OAuth session survives child-process invocations.

See `docs/spikes/non-interactive-auth.md` for the current CLI commands and metadata.

## Gate 3: Local Env-Scrub Probe

Required evidence:

- A local-stdio-shaped child process runs the equivalent of `env | grep -i github`.
- The output contains no harness-internal credential names: `GITHUB_CONTROLLER_TOKEN` and `GITHUB_AGENT_TOKEN`.
- The output contains no generic inherited token names: `GH_TOKEN` or `GITHUB_TOKEN`.
- `GITHUB_PERSONAL_ACCESS_TOKEN` may survive only as the deliberate local-stdio arm credential injected for the server. It must be redacted in logs and never written to committed artifacts.
- Surviving public configuration, such as a sandbox owner slug, is explicitly reviewed.

Command:

```bash
npm run probe:env-scrub
```

Artifact:

- `artifacts/spike/env-scrub/local-stdio-env.json`

This gate must pass before any data collection.

## Gate Verifier

Run:

```bash
npm run phase1:status
```

This writes:

- `artifacts/spike/phase1-status.json`
- `artifacts/spike/phase1-status.md`

Use strict mode before implementing harness code:

```bash
npm run phase1:status -- --strict
```

Strict mode exits non-zero until all three gates have passing evidence.
