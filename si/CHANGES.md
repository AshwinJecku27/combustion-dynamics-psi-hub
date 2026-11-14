# SI corrected release r2 (`si/`) versus the original release candidate (`si-release/`)

`si-release/` is kept byte-for-byte as supplied in `si-release-candidate.zip` (ZIP SHA-256 `63c74b45…a9dd6`).
`si/` is the working, deployable copy made during integration. `si/SHA256SUMS.txt` lists every file in it.
Verify from inside `si/` with `sha256sum -c SHA256SUMS.txt`; CI does this too.

## Unchanged (byte-identical to the release candidate; asserted by `si-integration/worker_smoke.test.mjs`)
- `worker/src/bundle.js` (embedded evidence store v1.1, `store_sha256 a77e5548…aed548`)
- `worker/src/core.js`, `provider.js`, `retrieve.js`, `validate.js`
- `worker/worker.js`
- `worker/TERMS_REVIEW.md`

No scientific content, limitation, prompt, retrieval or validation logic was changed.

## Changed
| File | Change | Why |
|---|---|---|
| `dashboard/si.html` | One CSS block appended inside `<style>`, with no other edits: `.split>*{min-width:0}`, wrapping for `.split td/th`, and below 760 px `grid-template-columns:minmax(0,1fr)`, `th{width:auto}`, `code.c{white-space:normal;overflow-wrap:anywhere}` | The Investigation Explorer overflowed horizontally at 360, 390 and 768 px. The cause: long unbreakable strings (file names, record and passage ids) widened the single-column grid. Now verified with no overflow at 360/390/768/1100/1440 px for all 4 sections and all 6 investigations. Desktop rendering at 1100 px is pixel-identical to the original in all 9 views (`si-integration/test_si_dashboard.py`). |
| `worker/wrangler.toml` | `ALLOWED_ORIGIN` placeholder replaced by `https://ashwinjecku27.github.io`; `workers_dev = true` made explicit; comments on CORS, limits and secrets | The placeholder would have made every browser request fail with 403. |
| `worker/package.json` | Scripts point at files that exist (`test`, `eval`); version `1.0.0-rc.2` | The original scripts referenced the missing `scripts/build_bundle.py` and `dev/server.js`. |
| `worker/DEPLOY.md` | Rewritten for browser-only deployment (Cloudflare Workers Builds, GitHub Actions, Codespaces) | Original assumed local `npm`/`wrangler` and the missing `si-engine/` tree. |

## Added
| File | What |
|---|---|
| `worker/scripts/real_eval.mjs` | New implementation of the missing real-model evaluation script. It is not a recovered copy. |
| `worker/test/real_eval.test.mjs` | 13 tests for the evaluation script (mock servers and mock AI only). |
| `worker/.gitignore` | Copied from the integration (`.dev.vars`, `.env*`, `.wrangler/`, `node_modules/`). |
| `evidence/verify_embedded.mjs`, `evidence/VERIFICATION_RESULTS.md`, `evidence/README.md` | Cross-checks of the embedded store against the manifest, itself and the frozen v1 arrays, plus an explicit statement of what cannot be verified. |

## Still missing from the release candidate
- `si-evidence/` (the store files and their checksums)
- `scripts/build_bundle.py`
- `scripts/build_release.sh`
- `test/si.test.js`
- `dev/server.js`

See `evidence/README.md`.
