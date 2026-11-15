# SI corrected release r3 (`si/`) versus the original release candidate (`si-release/`)

## r3 (2026-11-14): fixes after the first live Workers AI evaluation
The first live evaluation against the deployed `psi-si-api` Worker gave 4/6 validated model answers. Q2 (SAFFIRE-II) and Q4 (FLEX) fell back to evidence-only on validator errors. Q1 passed but said only that lunar-gravity data is absent. Q3 passed. Q5 and Q6 correctly returned `insufficient_evidence`. There were no HTTP, network or rate-limit errors.

**Root causes**
- **Q2 and Q4: no honest evidence class for test-plan and DoD statements.** The evidence store has **no report passages** for SAFFIRE-II (PSI-99), SAFFIRE-I (PSI-98) or FLEX (PSI-69). SAFFIRE-II has 2 DoD passages. FLEX has 7 test-plan passages and 2 DoD passages. The prompt offered only `measured_data`, `report_derived`, `calculated` and `interpretation`, and described passages as "PSI-xx:report:...". A model quoting a DoD or test-plan passage therefore labelled it `report_derived`, which the validator correctly rejected (`report_derived finding must cite a report passage`). The validator was right; the taxonomy and prompt were wrong.
- **Q2 retrieval spill-over.** The word "materials" selected SAME-R and SAFFIRE-I alongside SAFFIRE-II, so 6 of the 8 passage slots were SAME-R report quotes. Under the old validator, citing one of them for a SAFFIRE-II claim would have **passed**: a citation from another investigation.
- **Q4 banned wording.** The ban `validates? (the )?(habitat|fire safety|suppress)` does not look at negation, so even a correct sentence ("FLEX does not validate habitat fire safety") is rejected. The ban is kept unchanged; the prompt now says the words are rejected in any sentence and gives replacement phrasing.
- **Q1.** Two causes. The "lunar/habitat" keyword boosted FLEX (liquid droplets) into a solid-material question. And nothing told the model that a relevance question must name investigations, so a reply that only said "no lunar data" passed the validator.

**Changes (no evidence-store content changed; `bundle.js` is byte-identical)**
| File | Change |
|---|---|
| `worker/src/investigations.js` (new) | Explicit investigation names (SAFFIRE-I does not match the prefix of SAFFIRE-II). Ownership of cited ids. Passage counts per kind for each investigation. Accepted source owners, read from the store: PSI-98 may cite the SAFFIRE-II DoD only because the store names it as PSI-98's series-level gravity source. |
| `worker/src/validate.js` | New evidence class `plan_or_metadata`, which must cite a passage of kind `plan_statement` or `dod_statement`. `report_derived` now checks the passage `kind` from the pack (`report_finding`/`report_context`) rather than an id substring. `measured_data` no longer accepts a DoD *passage* id as a "record". **New:** a finding's supporting citation must belong to the investigation the finding names. **New:** questions about lunar, Martian or habitat conditions must cite LIM-001. **New:** "which investigations…" answers must name at least one. `repairHints()` turns errors into fix instructions for the retry. Banned wording, the number check and every existing rule are unchanged. |
| `worker/src/core.js` | Prompt: evidence classes defined by passage kind, including `plan_or_metadata`. Never label a plan or DoD statement `report_derived`. Never borrow another investigation's evidence. Banned words apply even in negative sentences. Rule 9 on how to answer relevance questions about lunar or habitat conditions. The retry message carries the repair hints. The evidence sheet returns each passage's `kind`. |
| `worker/src/provider.js` | JSON-schema enum gains `plan_or_metadata`. |
| `worker/src/retrieve.js` | A question that explicitly names investigations selects only those, unless it asks to compare or broaden. A solid-material question no longer pulls in FLEX via "lunar/habitat". Each selected investigation keeps its best passage. Investigations carry `source_passages_by_kind`. Aliases now cover the store's material names (`kapton`, `teflon`, `lampwick`, `pyrell` → SAME-R; `pmma`, `nomex`, `cotton` → SAFFIRE-II) and `detect`. Whole-store questions (Q5, Q6) and Q3 retrieve exactly what the release candidate retrieved (tested). |
| `dashboard/si.html` | Ask SI is open-ended. The list of the six benchmark questions was removed, and the free-text box gains a placeholder and help text. Passages are labelled by kind ("Test plan statement (intent, not a result)", "Data description (DoD) statement", "Report quote"). Before, every passage, including FLEX test-plan text, was headed "Report quotes", in Ask SI and in the Investigation Explorer. Evidence class label for `plan_or_metadata`. |
| `worker/scripts/real_eval.mjs` | Comments only. The six questions are internal regression benchmarks, not the dashboard's examples. |
| `worker/test/benchmark_regression.test.mjs` (new) | 25 tests. Reproduce the Q2/Q4 errors on the unmodified release-candidate code; corrected answers pass only with legitimate citations; fabricated, borrowed or mislabelled citations, banned wording and unsupported numbers stay rejected; Q1 retrieval and answer rules; Q3/Q5/Q6 unchanged; evidence-only fallback and retry. |
| `worker/test/real_eval.test.mjs` | The "questions equal dashboard EX" test is replaced by "benchmarks stay internal; the dashboard has a free-text box and does not hard-code them". |
| `worker/package.json` | Version `1.0.0-rc.3`. |

Integration tests changed outside `si/`:
- `si-integration/worker_smoke.test.mjs`: `bundle.js`, `worker.js` and `TERMS_REVIEW.md` must still be byte-identical to the release candidate. The four logic files are expected to differ.
- `si-integration/test_si_dashboard.py`: Ask SI must be free-text with no benchmark menu, and a user-written question must reach the Worker. Overview and Comparisons must stay pixel-identical to the release candidate at 1100 px. The Explorer must be text-identical apart from the passage-kind labels.

**Merging r3 to `main` redeploys the Worker** if Cloudflare Workers Builds is connected (it watches `si/worker`). Real-model behaviour after r3 is untested until a new evaluation is run.

---

# r2 (earlier): corrected release versus the release candidate

`si-release/` is kept byte-for-byte as supplied in `si-release-candidate.zip` (ZIP SHA-256 `63c74b45…a9dd6`).
`si/` is the working, deployable copy made during integration. `si/SHA256SUMS.txt` lists every file in it.
Verify from inside `si/` with `sha256sum -c SHA256SUMS.txt`; CI does this too.

## Unchanged (byte-identical to the release candidate; asserted by `si-integration/worker_smoke.test.mjs`)
- `worker/src/bundle.js` (embedded evidence store v1.1, `store_sha256 a77e5548…aed548`)
- `worker/worker.js`
- `worker/TERMS_REVIEW.md`
- In r2, `worker/src/core.js`, `provider.js`, `retrieve.js` and `validate.js` were also byte-identical. r3 changes them (above).

r2 changed no scientific content, limitation, prompt, retrieval or validation logic.

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
