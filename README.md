# Combustion Dynamics | PSI Intelligence Hub (SI)

**Team Combustion Dynamics · NASA Space Apps Challenge 2026 · "Flame in Freefall: SI-Powered Fire Safety Insights from Microgravity Combustion Data"**

SI (Scientific Intelligence) is a web application for asking questions about NASA Physical Sciences Informatics (PSI) combustion experiments and getting answers you can check.
- **Explains:** a language model explains the evidence.
- **Checks:** code retrieves that evidence, verifies every citation, number and named material, and shows each source.
- **States limits:** it says plainly what the evidence cannot establish.

The central idea: NASA has valuable combustion research, and SI makes it easier to find, compare, interpret and apply responsibly to spacecraft and habitat fire safety.

| | |
|---|---|
| SI application | `https://ashwinjecku27.github.io/combustion-dynamics-psi-hub/si/` |
| Original v1 dashboard (frozen) | `https://ashwinjecku27.github.io/combustion-dynamics-psi-hub/` |
| API | Cloudflare Worker `psi-si-api`, Workers AI (Llama 3.3 70B) |

> **Scientific stance.** The integrated evidence library has six NASA PSI investigations, a small curated subset of NASA's PSI database. **None of them contains partial-gravity (lunar or Martian) combustion data**; microgravity and normal-gravity results are not lunar-gravity measurements. SI never produces fire-risk probabilities.

## What SI does
The application has four sections.
1. **Overview:** what SI is, the evidence it uses (with counts computed from the store), and how the integrated research maps to fire **prevention**, **detection** and **suppression** (an SI classification, labelled as such).
2. **Ask SI** (the centrepiece): ask any question in your own words. A verified answer is laid out as:
   - **Direct answer**;
   - **What the evidence shows**, with each finding typed as measured data, report-derived, calculated or test-plan/DoD;
   - **Scientific interpretation**, SI's reading of the cited evidence, labelled as not a result;
   - **Experimental conditions**;
   - **Limitations**;
   - **Sources**.

   Empty sections are hidden. Every citation chip opens the exact source: passage quote and page, record values and flags, limitation, or calculation.
3. **Investigations:** search by name, ID or topic (for example "smoke", "airflow", "PSI-69"). Each investigation shows:
   - its objective (quoted from the files, or "not stated");
   - its environment, as stated;
   - what was recorded;
   - source passages, limitations and records.

   Relevant research that is **not** integrated (BASS/BASS-II, SAME, FLEX-2, CFI, BRE, DAFT, SPICE/SLICE, SoFIE, FM2, LUCI, E-FIELD Flames) is listed as such, with no data shown.
4. **Insights & Gaps:** for prevention, detection, suppression and space habitats, what the evidence shows and what it cannot establish, each statement linked to its source. It also includes:
   - charts of the recorded oxygen and pressure ranges against the challenge's reference atmospheres (Earth 21% O₂ / 14.7 psi; proposed lunar habitats and pressurized rovers ≥30% O₂ at up to ~10.2 psi; spacesuits 100% O₂ / ~4.3 psi);
   - a side-by-side comparison;
   - open questions for future experiments.

### AI transparency
- **AI answers** carry an "AI answer · Llama 3.3 70B" badge and "Passed code verification".
- **If no answer passes verification, or the model is unavailable,** the page shows **"Evidence only · no AI model was used"** with the retrieved evidence. The reason for withholding is available on request, and fallback text is never presented as AI.
- **For questions about partial-gravity data or a validated risk probability,** the fallback includes a short, store-scoped statement written by code.

### Evidence Support
A deterministic indicator (Strong / Moderate / Limited / Insufficient evidence) of how well a **validated** answer is supported by the retrieved evidence. It is **not** a measure of whether the research is correct, and not a probability that a claim is true. Its components are computed exactly from the answer and the evidence pack:
- statements with citations;
- findings resting on measured, report or calculated evidence (rather than plans or interpretation);
- investigations named in the question that are cited;
- experimental conditions cited;
- investigation-specific limitations cited.

Gates and caps:
- **Fallbacks** are not scored.
- **`insufficient_evidence` answers** show "Insufficient evidence".
- **Partial answers** are capped at Moderate.
- **Statements that rely on an unresolved source discrepancy** (for example SAFFIRE-II CSV/DoD thickness or flow) are capped at Moderate.

Semantic entailment between a passage and a claim is **not** evaluated, and the breakdown says so. Implementation: `si/worker/src/support.js`.

## Scientific limitations (always in force)
The evidence store holds 23 documented limitations (LIM-001 to LIM-023), cited in answers. Key ones:
- **No partial-gravity data** (LIM-001). E-FIELD Flames used electric fields to mimic certain partial-gravity effects on flame ions; it is not integrated and is not an actual lunar-gravity experiment.
- **FLEX (PSI-69):**
  - liquid-droplet combustion; its test plan's intent to study CO₂, He and SF₆ is not demonstrated suppressant efficacy (LIM-015, LIM-016);
  - the column headed "CO" is unresolved (probably CO₂, not confirmed; LIM-012);
  - PSI-69 is FLEX, not FLEX-2.
- **SAME-R (PSI-101):** smoke-particle characterization only; no detector sensitivity, response time or false-alarm rate (LIM-019); heated-wire smoke is not fire (LIM-022).
- **SAFFIRE:**
  - SAFFIRE-II has one sample per condition (LIM-010), and its CSV/DoD thickness and flow discrepancies stay visible and unresolved (LIM-009).
  - The PSI-98 thickness unit is disputed (LIM-008).
- **Not integrated:** BASS-II data (no calibration or test documentation), and SAME, SoFIE, SPICE and other candidate data. Nothing is integrated silently.

## How it works
```
Browser: si/dashboard/si.html, published at /si/ (static; evidence summary embedded; no third-party requests)
   │  POST /v1/ask {question}
   ▼
Cloudflare Worker psi-si-api (si/worker)
   retrieve.js   deterministic retrieval from the pinned evidence store (bundle.js, store v1.1, SHA-256 a77e5548…)
   core.js       prompt + question-class rules → Workers AI (provider.js) → validator → Evidence Support
   validate.js   citations in the pack · passage kinds · investigation ownership · named-material grounding
   grounding.js  · numbers in the pack · banned claims · scoped partial-gravity wording · no risk numbers
   support.js    Evidence Support (deterministic)
   → mode "model" (validated answer) or mode "fallback" (evidence only, labelled "No AI model was used")
```
Limits:
- **Per model call:** 25 s (`SI_MODEL_TIMEOUT_MS`).
- **Per request:** 45 s (`SI_REQUEST_DEADLINE_MS`).
- **Rate:** 6 requests/min per IP and 300/day, best-effort.
- **Cost ceiling:** the Workers AI daily allocation.

There are no secrets: the AI binding lives inside the Worker. CORS allows `https://ashwinjecku27.github.io` only.

## Run and test
```bash
python3 -m http.server 8000      # then open http://localhost:8000/si/dashboard/si.html
node si-integration/local_worker_server.mjs 8787             # local Worker, no AI (evidence-only)
node si-integration/local_worker_server.mjs 8788 --mock-ai   # local Worker with a canned test answer (not a model)
# open si.html?si_api=http://localhost:8787 to wire the page to a local Worker
```
Offline CI (`.github/workflows/si-tests.yml`) runs on every pull request; the same steps locally:
```bash
sha256sum --ignore-missing -c SHA256SUMS.txt && (cd si && sha256sum -c SHA256SUMS.txt)
node --test si-integration/worker_smoke.test.mjs
node --test si-integration/pages_site.test.mjs
node --test si/ingest/stage.test.mjs
(cd si/worker && npm test)
node si/evidence/verify_embedded.mjs
python3 src/test_playwright.py
python3 si-integration/test_si_dashboard.py
python3 si-integration/test_pages_site.py
```
**Real-model evaluation.** The workflow **SI real-model evaluation (manual)** sends the six internal benchmark questions to the deployed Worker and reports PASS / FAIL / NOT EVALUATED per question. Evaluation #5 passed all six on `186d0ac`. The prompt additions in this release (qualitative interpretation) have not yet been evaluated against the live model.

## Deploy and maintain
- **SI page:** GitHub Pages (`.github/workflows/pages.yml`) publishes `index.html` unchanged at `/` and the SI page at `/si/`. Ask SI works publicly only when the repository variable `SI_API_BASE` is set (Settings → Secrets and variables → Actions → Variables).
- **Worker:** Cloudflare Workers Builds, root directory `si/worker`. Pushes to `main` that touch `si/worker` redeploy it. Steps and rollback: `si/worker/DEPLOY.md`.
- **Adding investigations:** `si/ingest/README.md`. The staging tool (`si/ingest/stage.mjs`) checks provenance, checksums and structure, and never integrates. Integration is a reviewed pull request.
- **Change record:** `si/CHANGES.md`. Full handoff: `HANDOFF.md`.

## Repository layout
```
si/dashboard/si.html     The SI application (single file)
si/worker/               Cloudflare Worker: src/ (core, retrieve, provider, validate, grounding, support, bundle = evidence store), tests, evaluation script
si/ingest/               Maintainer staging tool and workflow
si/evidence/             Cross-checks of the embedded evidence store
si-integration/          Integration tests, local Worker wrapper, Pages build script
si-release/              Original SI release candidate (frozen, for provenance)
index.html, psi-hub.html, src/, data/   Original v1 dashboard (frozen; SHA256SUMS.txt)
```

## Data and attribution
Data originate from NASA's Physical Sciences Informatics repository; confirm each dataset's DOI and terms at the PSI site. Reference atmospheres are from the NASA Space Apps 2026 challenge statement. AI answers use Llama 3.3 70B (Meta) on Cloudflare Workers AI. Built with Llama. Not NASA-certified; not a validated fire-risk model.
