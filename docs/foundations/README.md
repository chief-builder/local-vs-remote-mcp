# Foundations

Background reading for the local-vs-remote MCP experiment. The writeups
(`docs/writeup/`) report what we measured; these documents explain the concepts
the measurements depend on, so a reader can follow the results without prior MCP
internals knowledge.

Read in this order:

1. [MCP transports](./mcp-transports.md) — what stdio and streamable HTTP are,
   how they are deployed, and what is identical across them.
2. [Tool discovery and deferral](./tool-discovery-and-deferral.md) — how an
   agent learns which tools exist, the `ToolSearch` deferred-tool mechanism, and
   why it is a load-bearing experimental variable (it produced a false security
   signal in one of our runs).
3. [Experiment design](./experiment-design.md) — arms, tiers, paired seeds,
   metrics, the two hypotheses, and why there are two experiments.
4. [Threat models](./threat-models.md) — the security framing: what each
   transport exposes and what is protocol-level and therefore transport-agnostic.

The findings these support:

- Visual brief: [`../writeup/visual-brief.md`](../writeup/visual-brief.md)
- Long-form writeup: [`../writeup/long-form.md`](../writeup/long-form.md)
- Slide deck: [`../presentation.html`](../presentation.html)

## Key external references

- [Claude Code: Scale with MCP tool search](https://code.claude.com/docs/en/mcp#scale-with-mcp-tool-search)
  — the `ENABLE_TOOL_SEARCH` / deferred-tool mechanism.
- [MCP security best practices](https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices)
  — confused deputy, scope minimization, and more, with mitigations.
- [Model Context Protocol](https://modelcontextprotocol.io/introduction) — the protocol itself.
</content>
