# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/chief-builder/local-vs-remote-mcp/security/advisories/new)
("Report a vulnerability" on the Security tab). Do not open a public issue.

Include what you found, how to reproduce it, and the impact you expect. You should get an
acknowledgement within a week.

If you believe a credential has leaked into this repository's history, report it the same way.
The maintainer's recovery steps are in [`redaction/README.md`](redaction/README.md): rotate the
credential first, then rewrite history.

## Supported versions

This is a research harness, not a released library. Only the latest commit on `main` is
supported; fixes are not backported.

## Scope notes

- Trials run the Claude Code CLI with `--permission-mode bypassPermissions` and a restricted tool
  allow-list. Treat any machine that runs live trials as exposed to the MCP servers under test
  (see [`docs/foundations/threat-models.md`](docs/foundations/threat-models.md)).
- The repository contains deliberate prompt-injection fixtures (Tier 3 tasks). These are test
  data, not vulnerabilities.
