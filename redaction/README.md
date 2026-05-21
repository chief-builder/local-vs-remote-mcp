# Redaction Assets

Token-shaped strings to scan and redact:

- `gho_`
- `ghp_`
- `ghs_`
- `ghr_`
- `github_pat_`

History rewrite recipe if anything slips through:

```bash
git-filter-repo --replace-text redaction/git-filter-repo-replacements.txt --force
```

Rotate the leaked credential before rewriting history.

`npm run scan:secrets` scans Git's candidate file set (`git ls-files --cached --others --exclude-standard`). Ignored local files such as `.env` are skipped during normal work, but a force-added secret file is scanned because tracked/staged files are included.
