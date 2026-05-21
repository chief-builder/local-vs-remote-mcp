# Remote Auth Spike

Remote endpoint:

```text
https://api.githubcopilot.com/mcp/
```

Protected-resource metadata discovered on 2026-05-19:

- Resource: `https://api.githubcopilot.com/mcp/`
- Authorization server: `https://github.com/login/oauth`
- Bearer method: `header`
- Supported scopes include `repo`, `read:org`, `read:user`, `user:email`, `notifications`, and `workflow`

Claude Code's installed MCP CLI supports both candidate routes:

```bash
# HTTP server with OAuth-capable transport.
claude mcp add --transport http github-remote https://api.githubcopilot.com/mcp/

# HTTP server with an explicit bearer header, useful for service-token smoke tests.
claude mcp add --transport http github-remote https://api.githubcopilot.com/mcp/ \
  --header "Authorization: Bearer $GITHUB_PERSONAL_ACCESS_TOKEN"
```

Gate 2 is not passed until one route survives child-process invocation and a manual smoke run uses `remote-http` without an interactive prompt.

Minimum evidence to capture:

```bash
npm run auth:status
npm run probe:tools -- --arm remote
claude mcp list
claude mcp get github-remote
```

After the manual smoke passes, write a sanitized artifact at:

```text
artifacts/spike/auth/remote-smoke.json
```

Shape:

```json
{
  "generatedAt": "2026-05-19T00:00:00.000Z",
  "pass": true,
  "method": "bearer-header-or-keychain-oauth",
  "childProcessSurvived": true,
  "manualSmoke": "brief sanitized description",
  "notes": "no token material"
}
```

Do not commit `.env`, keychain exports, raw OAuth tokens, or full command output containing bearer values.
