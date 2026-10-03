# Contributing

Thanks for your interest. This is a small research harness; issues and focused pull requests are
welcome.

## Setup

```bash
nvm use            # Node 24, from .nvmrc
npm ci
npm test           # unit + integration tests, no network or credentials needed
```

## Before opening a pull request

```bash
npm run lint
npm run format:check   # npm run format to fix
npm run typecheck
npm test
npm run check:static   # non-live gate set, includes the secret scan
```

CI runs the same commands plus a link check.

## Guidelines

- Keep changes small and focused; use [Conventional Commits](https://www.conventionalcommits.org/)
  (`fix:`, `feat:`, `docs:` ...).
- Never commit credentials, `.env`, raw run transcripts, or OAuth/session material. Install the
  pre-push secret scan with `npm run hooks:install`.
- Do not change published numbers in `docs/` without the run artifacts that support them.
- Shared runner code lives in `harness/src/`; experiment-specific tasks live in `experiments/<name>/`.
