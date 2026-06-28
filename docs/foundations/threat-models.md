# Threat Models

The security question is not "is local or remote safer?" but "which threat model
am I taking on?" The two transports move the blast radius to different places;
some risks are shared because they live in the protocol, not the wire.

## Local stdio

The server runs as the user. Its trust boundary is the user's trust boundary.

- **Supply-chain compromise has full local-privilege blast radius.** A malicious
  or compromised stdio server can read `.env`, SSH keys, and source trees; spawn
  processes; and exfiltrate anywhere the user can. A compromised dependency
  becomes local compromise. (The postmark-mcp backdoor, Sept 2025, did exactly
  this in production.)
- **No native sandboxing in most clients.** The server is a plain child process.
- **Rug-pulls.** `npx server@latest` / `docker run :latest` can pull different
  code each launch. Pinning by digest (the GitHub local arm pins
  `sha256:e3816a47…`) reduces drift but does **not** sandbox execution.
- Mitigation in this harness: GitHub credentials are scrubbed from the child
  environment before every trial, and only the minimum per-arm token is
  re-injected under the name the server expects.

## Remote streamable HTTP

The server runs on provider infrastructure. The blast radius moves to auth and
the backend.

- **OAuth confused-deputy.** If a remote proxy uses a static client ID and allows
  dynamic registration, an attacker can trick a user into an OAuth flow and
  exchange the code for tokens against the third-party API as the victim. OAuth
  2.1 with per-client consent is the mitigation; many servers do not implement it
  cleanly.
- **Persistent credential compromise.** Long-lived refresh tokens sit in the OS
  keychain; exfiltration grants indefinite, consent-scoped access.
- **Over-broad scopes.** A token scoped wider than the task needs is latent
  authority an attacker (or a confused agent) can use.
- **Multi-tenant blast radius.** One CVE in a hosted server hits every consumer;
  cross-tenant leakage is a documented pattern.
- **Data residency.** Every tool call ships conversation context to a third party.

## Protocol-level — identical across transports

These depend only on what the model reads, so they are transport-agnostic
(see [MCP transports](./mcp-transports.md)):

- **Tool poisoning.** Hidden instructions in tool *descriptions* or returned
  data. The model treats tool results as trusted unless prompted otherwise. A
  poisoned tool only has to be poisoned once to affect every session.
- **Indirect prompt injection.** The same shape, delivered through third-party
  content a tool fetches.
- **Affordance lures.** No instruction to obey — the content simply makes a
  powerful/"unsafe" tool available and recommends it, tempting the agent to use it
  on its own (temptation by availability, not by command). (Our
  `tier3_unsafe_code_temptation` task — and the
  [measurement caveat](./tool-discovery-and-deferral.md) that comes with it.)
- **Schema drift.** A server can change tool behavior after the user approved it.

H2 predicts these protocol-level attacks hit both arms equally. The experiments
support that: prompt-injection compliance does not split by transport. What does
split by transport is the *non-protocol* risk — env/filesystem on local, OAuth
and stored credentials on remote.

## The crisp comparison

- For a fresh, **untrusted, unaudited** server: **local is more dangerous** —
  total local compromise vs OAuth-scoped remote access.
- For a **well-vetted, signed, digest-pinned** server from a trusted vendor:
  **local is less exposed** — no shared multi-tenant backend, no OAuth dance to
  mis-implement, no network surface.
- The asymmetry is not about transport; it is about **trust origin × blast
  radius.** stdio amplifies trust failures locally; HTTP shifts the failure
  surface to OAuth and the provider.
</content>
