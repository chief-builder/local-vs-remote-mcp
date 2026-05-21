# Local vs Remote MCP Experiment

Compares GitHub MCP over two transports with an overlapping tool catalog:

- `baseline` - no MCP, pure reasoning floor.
- `local-stdio` - `ghcr.io/github/github-mcp-server@sha256:e3816a476a977cfb836e7d221510011436c654d11861db66ecfd826601aba6a4` via Docker stdio.
- `remote-http` - `https://api.githubcopilot.com/mcp/` over streamable HTTP.

## Non-Negotiable Gates

Do not implement or run the trial harness until all three spike gates are proven and documented:

1. Probe `tools/list` against both GitHub MCP variants. Compute the intersection and use that as the allow-list. Document local-only and remote-only tools.
2. Prove remote auth works non-interactively: either a pre-issued bearer token works, or a keychain-stored OAuth session survives child-process invocations. Validate with one manual smoke run.
3. Run the local env-scrub probe with `env | grep -i github` before data collection. No harness-internal token names or values may reach an agent child.

## Security Model

Local stdio servers run as the user. A compromised local MCP server can read the filesystem and inherited environment, spawn processes, and exfiltrate data with the user's privileges. Supply-chain compromise can become total local compromise. Digest pinning reduces image drift; it does not sandbox the process.

Remote streamable HTTP servers move the blast radius to OAuth and provider infrastructure. The main risks are confused-deputy authorization, over-broad scopes, keychain refresh-token compromise, multi-tenant backend bugs, and data leaving the local machine with every tool call.

Tool poisoning and indirect prompt injection are protocol-level problems. They affect local and remote transports equally because the model consumes the same tool descriptions and tool results after transport delivery.

## Harness Shape

Reuse the `cli-vs-mcp` structure when the gates pass:

- `harness/src/` remains shared across experiments. Do not fork a per-experiment runner.
- `experiments/github/` owns task definitions, fixtures, and run artifacts.
- Trials use paired seeds across arms.
- Metrics include inherited success/pass, validity, token, turn, wall-clock, and cost fields plus transport latency and security fields.
- Every transcript and assistant text turn is scanned for token-shaped strings before push.

## Credential Rules

Scrub inherited GitHub-related variables before every child process:

- Harness-internal: `GITHUB_CONTROLLER_TOKEN`, `GITHUB_AGENT_TOKEN`, and any future `CONTROLLER_*` / `AGENT_*` credential names.
- GitHub CLI / MCP: `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN`, `GITHUB_PERSONAL_ACCESS_TOKEN`, `GH_HOST`, `GITHUB_HOST`, `GH_REPO`, `GH_PAGER`, `GH_EDITOR`, `GH_BROWSER`, `GH_FORCE_TTY`, `GH_PROMPT_DISABLED`, `GH_CONFIG_DIR`, `GITHUB_TOOLSETS`.

Only per-arm credential injection may add back the minimum required value. The controller token is never agent-visible. For the local stdio server, `GITHUB_PERSONAL_ACCESS_TOKEN` is the only token-shaped GitHub variable that may be deliberately re-injected into the server child environment; log output must redact it.

## Hypotheses

- H1: token cost is invariant across transports; wall-clock latency is not.
- H2: prompt-injection compliance rate is the same on `local-stdio` and `remote-http`.
