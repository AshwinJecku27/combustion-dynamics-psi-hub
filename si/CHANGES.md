# SI release r7 (`si/`) versus the original release candidate (`si-release/`)

## r7 (2026-11-15): final product milestone
Built on `186d0ac`, where real-model evaluation #5 passed all six benchmark questions. **The r7 prompt addition (qualitative interpretation) has not been evaluated against the live model.** The evidence store, its limitations, the frozen v1 dashboard, `si-release/`, `worker.js` and `wrangler.toml` are unchanged. No validator rule was relaxed.

| Area | Change | Files |
|---|---|---|
| Ask SI | **Answer structure:** Direct answer → What the evidence shows (typed by evidence class) → Scientific interpretation (labelled, not a result) → Experimental conditions → Limitations → Sources. Empty sections are hidden. **Sources:** every citation opens the exact source in a dialog (passage quote with locator, record values and store flags with the investigation's limitations, limitation text, calculation). **Labels:** clear AI vs evidence-only labelling; failed verification is shown, collapsed. **Examples:** example questions that only prefill (none is a benchmark). | `dashboard/si.html` |
| Evidence Support | **New:** deterministic indicator (Strong / Moderate / Limited / Insufficient) for validated answers only. Components are computed exactly. Caps: partial answers, and statements relying on a store-flagged discrepancy (keyword-scoped to the flagged quantity). It states what it does not evaluate (semantic entailment, contradictions beyond store flags, correctness of the research). It is not a probability. | `worker/src/support.js` (new), `worker/src/core.js` |
| Qualitative explanation | **Prompt:** when the pack allows, one cited interpretation finding explaining what the results mean, why the recorded conditions matter, and the relevance to prevention, detection or suppression. It never adds a mechanism, trend, relationship or number the pack does not state. Interpretation findings are asked to cite what they interpret. | `worker/src/core.js` |
| Design | **Visual:** new restrained dark scientific design with one blue accent and fine borders; no third-party fonts, images or scripts. **Responsive:** 360–1440 px with no overflow; the insights matrix stacks on phones; records are collapsed by default. | `dashboard/si.html` |
| Overview | **Purpose first:** purpose headline and two calls to action. **Accurate statistics:** passages broken down as 23 report / 7 test plan / 4 DoD; the old label "verified report quotes" was inaccurate. **Scope:** explicit statement that the library is a small subset of PSI. **Research areas:** prevention, detection and suppression, using the store's own team classification, labelled as SI classification. | `dashboard/si.html` |
| Investigations | **Search:** by name, ID or topic. **Objective:** quoted from the store, or "not stated". **Environment and contents:** environment as stated, what was recorded, passages, limitations, records with flags. **"Ask SI about …":** opens Ask SI with a prefilled question. **Not yet integrated:** relevant research listed as such, with no data. | `dashboard/si.html` |
| Insights & Gaps | **Matrix:** prevention, detection, suppression and habitats, each "shows / cannot establish" statement with sources. **Charts:** oxygen and pressure range charts with labelled reference atmospheres from the challenge statement; palette validated for dark mode, dashed and labelled reference lines, hover titles. **Also:** comparison table and open questions taken from the limitations' "not known" fields. | `dashboard/si.html` |
| Ingestion | **New maintainer staging tool:** provenance required; byte-for-byte copies with SHA-256 checks; CSV profiling (encoding, lost header characters, mixed types, `~`, ranges, leading zeros, blanks, duplicates); ingestion report with a review checklist; `--verify`. It never writes to the store. Integration remains a reviewed pull request (the bundle generator is still missing). | `ingest/stage.mjs`, `ingest/stage.test.mjs`, `ingest/README.md` (new) |
| Evaluation | The report records each answer's Evidence Support level. | `worker/scripts/real_eval.mjs` |

Tests:
- **New:** `worker/test/support.test.mjs` (11) and `ingest/stage.test.mjs` (7).
- **Rewritten for the new UI:** `si-integration/test_si_dashboard.py` (51 checks). It covers:
  - overview accuracy;
  - Ask SI in three states, including a mock answer through the real pipeline;
  - source dialogs and markup escaping;
  - explorer search and insights;
  - no external requests, and no overflow at 5 widths.
- **Updated:** `si-integration/test_pages_site.py` (new tab names) and `worker/test/real_eval.test.mjs` (examples allowed, never benchmarks).
- **Local wrapper:** `si-integration/local_worker_server.mjs` gains a test-only `--mock-ai` mode.

`worker/package.json`: `1.0.0-rc.7`.

---

# r6 (2026-11-15)

## r6 (2026-11-15): the two failures of real-model evaluation run #4
Run #4 (main `379b943`): Q1–Q4 PASS; Q5 and Q6 FAIL. **Not yet verified against the real model.** No validator rule was relaxed. Q1–Q4 prompts, JSON schema and evidence packs are byte-identical to before (tested).

| Q | Failure | Root cause | Fix |
|---|---|---|---|
| Q5 | `this question class must be reported as insufficient_evidence or partial`, on both attempts | The code marks this class `question_class.mustBeInsufficient`, but the prompt never referred to it. Rule 6 asks for `insufficient_evidence` only "if the evidence cannot answer", and a plain "No" does answer the question. The prompt's JSON example shows `"answered"`, the schema allowed it, and the retry had no hint for this error. | **Question-class instruction**, appended only for this class: required status, an explicit store-scoped first sentence, no claims about research elsewhere, no presenting microgravity results as lunar-gravity measurements, no risk numbers, LIM-001. **Structured status:** the JSON schema sent to the model narrows the status enum to `insufficient_evidence` / `partial` for this class (`schemaWithStatus` can only narrow). **Retry hint** for the status error. |
| Q6 | `gravity wording: ... mentions lunar gravity without an explicit statement that no such data exist` | The scoped absence check lacked common correct forms: "no data on combustion at lunar gravity", "no experiments conducted in partial gravity", "none of the investigations was conducted at …", "rather than lunar gravity", and suspended hyphens ("no actual lunar- or partial-gravity data"). The same class instruction was also missing. | Those forms added, each still attached to the mention within its clause. Misleading negation ("no doubts that lunar gravity data exist"), affirmative and ambiguous wording ("would require lunar-gravity data") stay rejected. |

New safeguards (stricter):
- **Explicit answer:** for partial-gravity-data and validated-risk questions, the direct answer (or reason) must contain an accepted absence statement.
- **Store scope:** a gravity sentence claiming absence "anywhere", "ever", by "no one" and so on is rejected; absence applies to this evidence store only.
- **No risk figures:** validated-risk answers may not contain a probability, percentage or odds.
- **Explicit fallback:** the evidence-only fallback note for this class now answers the question in code-written, store-scoped words ("No. The current integrated PSI evidence store contains no actual partial-gravity … combustion data: calc:partial_gravity is an empty list (LIM-001) …"; Q6 adds "… so it cannot establish a validated lunar-habitat fire-risk probability"). It is still labelled "No AI model was used" and still counts as a fallback (FAIL) in the evaluation.

Files:
- `worker/src/core.js`: `classInstruction`, `classNote`, `statusEnum`.
- `worker/src/provider.js`: `schemaWithStatus`.
- `worker/src/grounding.js`: absence forms, overclaim check, `statesGravityAbsence`.
- `worker/src/validate.js`: explicit-absence and risk-number checks, hints.
- `worker/test/q5_q6_eval4.test.mjs` (new): 13 tests.
- `worker/package.json`: `1.0.0-rc.6`.

Each new safeguard was disabled in a scratch copy, and its tests were confirmed to fail.

---

# r5 (2026-11-15)

## r5 (2026-11-15): the two failures of real-model evaluation run #3
Run #3 (commit `cdc9115`) gave 4 PASS / 2 FAIL. Q2, Q3, Q4 and Q6 passed. **Neither fix below is verified against the real model yet.**

| Q | Failure | Root cause | Fix |
|---|---|---|---|
| Q1 | Finding 2 named silicone, Kapton and Pyrell, but none of its cited evidence mentions them. The rejection was correct. | In the Q1 pack, Kapton and Pyrell are named by exactly one citable item, `calc:samer:breakdown`. SAME-R's report passages never name them, and its row ids carry no text. Nothing told the model which id names which material. | **Grounding validator unchanged and still strict.** Relevance-question packs now carry `material_sources`, derived only from the pack's own text: for each material, the exact record, passage or calculation ids that name it (limitations and investigation metadata are not listed). The prompt says to cite one of those ids or leave the material out, and never to cite one material's record for another. After a grounding rejection, the retry lists the valid ids for each named material, or says to omit it. Q2 to Q6 packs are unchanged. |
| Q5 | "The calculations showed an empty list of investigations with partial-gravity data", a correct absence statement, was rejected. | The r4 gravity check accepted a sentence only if it contained a negation word anywhere. That wrongly rejects absence stated without "no" or "not", and wrongly accepts an affirmative claim next to an unrelated negation. | **Scoped check:** each partial, lunar or Martian gravity mention must carry an absence statement attached to that phrase, within its own clause. Accepted forms: "no / without / absence of …"; ", not partial gravity"; a negated verb taking the phrase as object ("do not establish lunar-gravity behaviour"); "an empty list … with …"; "none of the investigations / none of them has …"; "… data are absent / not available / not tested"; "whether … is not tested". Affirmative, hedged ("limited partial-gravity data") and ambiguous wording is rejected, as is a negation elsewhere in the sentence ("no doubt SAFFIRE-II has partial-gravity data"). LIM-001 citation, insufficient-evidence status rules and the microgravity / low gravity wording are unchanged. |

Files:
- `worker/src/grounding.js`: `materialSources`, the scoped `absenceStated` / `gravityWordingErrors`.
- `worker/src/retrieve.js`: adds `material_sources` to relevance-question packs.
- `worker/src/core.js`: prompt rules and `groundingGuide` retry text.
- `worker/src/validate.js`: gravity repair hint.
- `worker/test/q1_q5_followup.test.mjs` (new): 13 tests.
- `worker/package.json`: `1.0.0-rc.5`.

Each safeguard was disabled in a scratch copy and its tests were confirmed to fail: the material index, the old sentence-level check, clause scoping, and grounding.

---

# r4 (2026-11-15)

## r4 (2026-11-15): post-r3 audit fixes
Real-model evaluation run #2 (commit `2e9a4f8`) reported PASS with 5 model answers. But Q1 hit the 25 s per-call model timeout and fell back, and Q4 mentioned planned SF6 testing without a citation that clearly supported it. The audit confirmed six issues. **None of the fixes below has been checked against the real model yet; that needs a fresh evaluation.** No evidence-store content, limitation, frozen file or existing validator rule was changed or relaxed. Every change adds checks.

| # | Issue | Fix | Files |
|---|---|---|---|
| 1 | Q1's single model call exceeded the 25 s per-call timeout (the Worker answered HTTP 200 with a `timeout` fallback; the request itself did not time out). A timeout does not cancel the call, and the schema-less retry got a fresh 25 s. | **Smaller Q1:** "which investigations" questions get experiment (`sample`) records only and no identifier groups, so the Q1 pack shrinks from 25,163 to 20,998 characters. The prompt caps the answer size. **Time budget:** one budget per model call, shared with the schema-less retry (timers cleared). A request deadline, `SI_REQUEST_DEADLINE_MS` (default 45 s), stops a retry from starting when a full call no longer fits. The 25 s per-call timeout is unchanged. The code and docs say the Worker stops waiting and does not cancel the call. | `src/provider.js`, `src/core.js`, `src/retrieve.js` |
| 2 | A claim naming a substance or material could cite an item that never mentions it (an SF6 claim cited to a CO2-only test matrix passed). | **Grounding check:** every substance or material named in a finding or experimental condition must appear in at least one item it cites. Aliases: He/helium, CO2/carbon dioxide, N2/nitrogen, SIBAL/cotton-fiberglass, chemical formulas. Belonging to the same investigation is not enough. Uncited interpretation findings that name a substance are rejected. | new `src/grounding.js`, `src/validate.js` |
| 3 | The "6" in "SF6" (and digits in other formulas) was read as a numerical claim. | Formula-shaped tokens (real element symbols with subscripts of at most 2 digits, such as `SF6`, `C4H10` and `CO2`) are removed before the number check. Values such as `0.30`, `20 cm/s`, `600 s` and `731`, and letter-number labels such as `T1130`, are still checked. | `src/grounding.js`, `src/validate.js` |
| 4 | A timeout fallback still gave an overall PASS. | Each question is PASS, FAIL or NOT EVALUATED, and the run verdict becomes `INCOMPLETE` when any question is NOT EVALUATED. A rejected model answer now FAILs its question (previously one rejection per 24 requests was tolerated). The six benchmarks are reported question by question. | `scripts/real_eval.mjs` (v1.1.0) |
| 5 | Why the first attempts of Q2 and Q4 were rejected was invisible. | `validation.rejected_attempts`: the attempt number, error codes and the verifier's messages (capped), never the model's text or provider details. The dashboard does not display them for model answers; the evaluation report does. | `src/core.js`, `scripts/real_eval.mjs` |
| 6 | Planned work could be described as performed, and gravity regimes reworded. | **Prompt:** planned is not performed; quote each investigation's `gravity_regime` exactly; never call anything reduced, partial, lunar or Martian gravity. **Validator:** a sentence mentioning partial, lunar or Martian gravity must also state absence or negation. | `src/core.js`, `src/grounding.js` |

Tests: new `worker/test/post_r3_fixes.test.mjs` (19 tests). Each new safeguard was disabled in a scratch copy, and its tests were confirmed to fail. Existing suites unchanged. `worker/package.json` is now `1.0.0-rc.4`.

---

# r3 (2026-11-14)

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
