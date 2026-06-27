# Writeup Workspace

Final writeup artifacts for `full-n5-20260520` live here. They are tied to `experiments/github/runs/full-n5-20260520/report.md` and are audited by `npm run check:completion-writeup-current` plus the final completion gate.

Artifacts:

- `visual-brief.md` - short visual narrative, mirroring the `cli-vs-mcp` visual briefs.
- `long-form.md` - full methodology, results, caveats, and security framing.
- `evidence-matrix.md` - requirement-by-requirement evidence checklist.

Companion experiment (Playwright) data, summarized in `long-form.md`:

- `experiments/playwright/runs/full-repro-20260626/report.md` (H1 N=10, H2 N=30)
- `experiments/playwright/runs/unsafe-deconf-20260627/` (de-confound control)

Concept background for both experiments lives in `../foundations/`.

Do not promote smoke-run numbers to headline claims. Smoke reports prove the harness works; final claims require a fresh full N=5 run and report.

Final data inputs:

- `artifacts/spike/tools-list/overlap.md`
- `artifacts/spike/phase1-status.md`
- `experiments/github/runs/full-n5-20260520/report.md`
- `experiments/github/runs/full-n5-20260520/results/**/<trial>.json`
- `experiments/github/runs/full-n5-20260520/transcripts/**/*.jsonl`

Use the placeholder form below when collecting a future final run:

- `experiments/github/runs/<final-run>/report.md`
- `experiments/github/runs/<final-run>/results/**/<trial>.json`
- `experiments/github/runs/<final-run>/transcripts/**/*.jsonl`

Publish gate:

```bash
npm run check:static
npm run check:claude-auth
npm run harness -- verify-arms --experiment github --output artifacts/verify-arms/github.json
npm run harness -- report --experiment github --run <final-run> --all-tiers --crossover-analysis --include-cost --output experiments/github/runs/<final-run>/report.md
npm run check:run -- --run <final-run> --trials 5
npm run scan:secrets -- --path experiments/github/runs/<final-run>
npm run check:completion -- --run <final-run> --trials 5
```
