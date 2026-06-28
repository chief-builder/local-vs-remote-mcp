# MCP Transports: stdio vs streamable HTTP

The [Model Context Protocol (MCP)](https://modelcontextprotocol.io/introduction)
lets an agent (here, the Claude Code CLI) call tools hosted by an external
**server**. The protocol defines the messages; the
**transport** defines how those messages travel between the agent and the
server. This experiment compares the two transports that matter in 2026.

## stdio

The server runs as a **child process** of the agent. The agent writes JSON-RPC
to the child's stdin and reads responses from its stdout.

- Launched on demand, usually **per session**. In this repo the GitHub local arm
  runs `docker run …` and the Playwright local arm runs `npx -y @playwright/mcp`,
  each spawned fresh for every trial and killed when the trial's agent exits.
- Runs **as the user**, inheriting the user's environment and filesystem access
  unless explicitly scrubbed. This is why the harness scrubs GitHub credentials
  from the child environment before each trial.
- No network hop: messages never leave the machine.

## streamable HTTP

The server runs as a **long-lived HTTP service**; the agent connects to a URL
(for GitHub, `https://api.githubcopilot.com/mcp/`; for the Playwright arm,
`http://localhost:8931/mcp`). It is the current spec transport, having replaced
SSE in March 2025 (SSE is being deprecated across the ecosystem through 2026).

- Started **once**, before the run, and reused across trials. The process stays
  warm between trials.
- Reached over the network, so it carries TLS, auth (OAuth or a bearer token),
  and standard network-failure surface.
- The server's environment and filesystem belong to the **provider**, not the
  user.

## The deployment asymmetry is deliberate

stdio servers are *typically* per-session children; HTTP servers are *typically*
persistent services. The harness mirrors that real-world default rather than
forcing them to match. The consequence is a per-trial cold-start cost on the
stdio arm that the warm HTTP arm does not pay — a property of how each transport
is deployed, not of the wire protocol itself. Keep this in mind when reading
latency results: "stdio vs HTTP" is entangled with "cold vs warm."

## What is identical across transports

After a message is delivered, the model sees the **same bytes** either way:

- The same tool **descriptions** (the server's advertised schema).
- The same tool **results** (whatever the tool returned).

So anything that depends only on what the model reads should be the same on both
transports: token cost, and how easily the model is fooled by instructions hidden
in tool descriptions or results. Anything that depends on *how* the bytes arrive
can differ: latency, connection reliability, where credentials live, whether data
leaves the machine. The two hypotheses
([experiment design](./experiment-design.md)) split exactly along this line.

## How the two experiments use transports

- **GitHub** compares two *different server implementations* (a digest-pinned
  [github/github-mcp-server](https://github.com/github/github-mcp-server) Docker
  image over stdio vs GitHub's hosted endpoint over HTTP). That is the
  realistic deployment choice, but it confounds transport with server build,
  network path, and vendor infrastructure.
- **Playwright** compares the *same*
  [`@playwright/mcp`](https://www.npmjs.com/package/@playwright/mcp) binary over
  both transports, isolating transport from server implementation. It is the
  control for the GitHub comparison.

See [threat models](./threat-models.md) for the security consequences of each
transport, and [experiment design](./experiment-design.md) for how the arms are
wired.
</content>
