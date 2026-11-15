# Combustion Dynamics | PSI Intelligence Hub

An interactive, single-file dashboard built by **Team Combustion Dynamics** for the **NASA Space Apps Challenge 2026, "Flame in Freefall"**. It explores real NASA Physical Sciences Informatics (PSI) combustion datasets and asks what they do, and do not, tell us about spacecraft and lunar-habitat fire **prevention, detection and suppression**.

> **Scientific stance:** accuracy over impressive charts. Only values present in the source files are plotted. Every chart and finding is labelled by evidence type (measured CSV data, report-derived, plan/metadata) with provenance. The dashboard states plainly what the data cannot answer. **None of the integrated datasets is a partial-gravity (lunar 0.16 g / Mars 0.38 g) combustion dataset.**

## Two dashboards in this repository
| | Original dashboard (v1, **frozen**) | SI dashboard (corrected release r3) |
|---|---|---|
| File | `index.html` = `psi-hub.html` (root) | `si/dashboard/si.html` (the untouched original release candidate is in `si-release/`) |
| Data | Arrays embedded from `src/` | Evidence store v1.1, pinned by SHA-256 `a77e5548…aed548`, embedded in `si/worker/src/bundle.js` (the store files themselves were not supplied: `si/evidence/README.md`) |
| Network | None | Calls the SI Worker API (`/v1/health`, `/v1/ask`) at a configurable address; works offline as evidence-only |
| AI | None (rule-based ranker) | Cloudflare Workers AI, Llama 3.3 70B, behind a code validator; evidence-only fallback when the model is unavailable or rejected |
| Status | Live via GitHub Pages | **Real Cloudflare inference not yet tested. Nothing authorized for deployment.** |

The original dashboard stays the default page and the fallback. The SI dashboard links back to it ("Original dashboard" → `index.html`). See `HANDOFF.md` section 0 for the SI architecture, verification record and remaining steps, and **`si/worker/DEPLOY.md` for the browser-only deployment and evaluation steps** (GitHub + Cloudflare dashboard; nothing to install).

> The SI dashboard is a retrieval-and-explanation tool over the evidence store. It does **not** predict lunar or Martian fire risk, and its answers inherit every limitation below (the evidence store carries 23 first-class limitations, LIM-001 to LIM-023).

## Challenge objectives addressed
- Build a tool that helps researchers explore PSI combustion investigations relevant to fire safety in exploration habitats.
- Query investigations by question, atmosphere (O2, pressure) and safety goal (prevention / detection / suppression).
- Compare atmospheres of Earth, a lunar-habitat-like cabin and a spacesuit.
- Compare investigations side by side and surface gaps in the evidence.

## The six dashboard sections
1. **Query & Ranker** - free-text question, ranked investigations with relevance, evidence-type badges and explanation. *Rule-based keyword/condition matching. It is not AI.*
2. **Data Explorer** - interactive SVG charts with 7 sub-tabs: PSI-10, PSI-159, PSI-98, PSI-99, PSI-69, PSI-101, and a Data-quality log.
3. **Habitat Simulator** - presets (Earth 21% / 14.7 psi, Lunar habitat 30% / 10.2 psi, Spacesuit 100% / 4.3 psi) and sliders; shows which integrated rows lie near the chosen atmosphere (condition similarity only).
4. **Comparator** - side-by-side comparison of investigations (default: FLEX, SAFFIRE-II, SAME-R) with compatibility caveats.
5. **Scientific Insights** - evidence-labelled findings with limitations and provenance.
6. **Challenge Alignment** - Prevention / Detection / Suppression evidence table and research gaps.

## The six integrated investigations
| PSI | Investigation | Records embedded | What it is |
|---|---|---|---|
| PSI-10 | ACME Flame Design | 147 rows | Spherical-burner gas flames (ethylene, propane) in the Combustion Integrated Rack: mass flow, O2, adiabatic flame temperature |
| PSI-159 | ACME CFI-G (Cool Flames Investigation with Gases) | 179 rows | Spherical-burner tests with ethane, propane, n-butane: hot ignition, cool-flame label, burn time |
| PSI-98 | SAFFIRE-1 | 2 samples | Large SIBAL fabric samples on Cygnus: burn time, concurrent vs opposed flow |
| PSI-99 | SAFFIRE-II | 9 samples | One sample per condition on a sample card |
| PSI-69 | FLEX | 274 records (273 distinct IDs) | Liquid-fuel droplet combustion, heptane/methanol, N2/"CO"(probable CO2)/He atmospheres |
| PSI-101 | SAME-R | 109 records (67 primary rows / 66 unique test numbers + 42 aged follow-ups) | Smoke particle characterization from heated wire samples |

Background-only entries (no dataset integrated): SAME, BASS, SoFIE, FM2, FLARE, SPICE, SLICE.

## Key limitations (read before citing anything)
- FLEX is **droplet** combustion; it does not establish habitat-material flammability or suppressant efficacy (no LOI / minimum extinction concentration columns). Its "CO" column is **probably CO2 but unconfirmed**.
- SAME-R gives smoke-particle data only: **no detector sensitivity, response time or false-alarm data**.
- SAFFIRE-II is n = 1 per condition: observations, not statistically conclusive.
- No partial-gravity data anywhere. See `HANDOFF.md` for the full list.
- The Habitat Simulator shows condition similarity only; it is **not** a validated fire-risk probability model.
- PSI-98 thickness units (header "cm" vs SAFFIRE-II DoD "mm") and the SAFFIRE-II CSV/DoD discrepancies are **unresolved**; nothing converts or reconciles them (SI limitations LIM-008, LIM-009).

## Run locally
The app is one self-contained file: no build step, no CDN, no network calls, no dependencies.

```bash
# Option 1: just open it
open index.html            # macOS;  xdg-open index.html on Linux;  double-click on Windows

# Option 2: a local static server (recommended for development)
python3 -m http.server 8000
# then browse to http://localhost:8000/
```

`psi-hub.html` and `index.html` are byte-identical (see `SHA256SUMS.txt`); `index.html` exists so static hosts serve it at the root.

## Repository layout
```
index.html          Deployable copy (identical to psi-hub.html)
psi-hub.html        Verified export of Claude Artifact version 1794684963-17ec
SHA256SUMS.txt      cfbbc812c59652ee3d2ecc8c27ce705fd051e440431a46f6454f0204e9d9d12c
src/data.js         Embedded PSI-10 / PSI-159 arrays
src/data2.js        Embedded SAFFIRE-II, FLEX, SAME-R arrays
src/app3.js         All application logic (the three files above are concatenated into the HTML as <script> blocks)
src/test_playwright.py  Headless regression test used during QC
data/               Intentionally empty (see data/README.md and HANDOFF.md section 10)
HANDOFF.md          Architecture, provenance, limitations, SI integration record, deployment

si/                         SI corrected release r3: the deployable copy (si/CHANGES.md lists every difference)
  SHA256SUMS.txt            Manifest of every file in si/ (verify from inside si/)
  dashboard/si.html         Four-section SI dashboard, 390 px overflow fixed (API address placeholder unfilled)
  worker/                   Cloudflare Worker; Workers Builds root directory = si/worker
    wrangler.toml           Name psi-si-api, Workers AI binding "AI", ALLOWED_ORIGIN https://ashwinjecku27.github.io, limits
    worker.js, src/         Byte-identical to the release candidate: core.js (HTTP, CORS, rate limit, fallback),
                            retrieve.js (deterministic retrieval), provider.js (Workers AI default), validate.js
                            (citation + number verifier), bundle.js (GENERATED from evidence store v1.1; do not edit)
    scripts/real_eval.mjs   Real-model evaluation (new implementation; the original was not supplied)
    test/                   Tests for the evaluation script; real_eval_report.md/.json land here after a real run
    DEPLOY.md               Browser-only deploy / evaluate / roll back
    TERMS_REVIEW.md         Provider terms review from the release candidate
  evidence/                 Cross-checks of the embedded store (verify_embedded.mjs, VERIFICATION_RESULTS.md, README.md)
si-release/                 Original SI release candidate, byte-for-byte from si-release-candidate.zip (kept for provenance)
si-integration/             Integration tests and helpers (not part of the release candidate)
  worker_smoke.test.mjs     Worker tests with a MOCK AI binding (+ evidence-store identity and wrangler.toml checks)
  test_si_dashboard.py      Playwright test of si/dashboard/si.html: sections, wiring, overflow at 360-1440 px, desktop identity
  local_worker_server.mjs   Node wrapper around the Worker for local wiring tests (no AI binding)
  configure_dashboard.sh    Writes si-integration/build/si.html with the Worker URL filled in
.github/workflows/
  pages.yml                 Frozen v1 Pages deploy (index.html only)
  si-tests.yml              Offline CI on pull requests: checksums, all tests above, evidence cross-checks
  si-real-eval.yml          Manual: real-model evaluation against a deployed Worker (uses Workers AI allowance)
  si-dashboard-build.yml    Manual: builds si.html with the Worker URL as a downloadable artifact
```
The original evidence store v1.1 files (`si-evidence/`) and the release's own build tooling and tests (`scripts/build_bundle.py`, `scripts/build_release.sh`, `test/si.test.js`, `dev/server.js`) were **not** in the supplied ZIP; see HANDOFF.md section 0.4.
**`psi-hub.html` is canonical.** The `src/` files are the exact script contents embedded in it (verified as substrings), provided for easier diffing and editing. If you edit `src/`, rebuild the HTML (see HANDOFF.md) and update the checksum.

## Deploy
See "Deployment" in `HANDOFF.md` (GitHub Pages workflow included at `.github/workflows/pages.yml`; Cloudflare Pages instructions also provided).

**Note:** `.github/workflows/pages.yml` is active. It runs on every push to `main` and publishes `index.html` only. It does not publish `si.html` or the Worker. Merging the SI integration therefore redeploys the unchanged original dashboard and nothing else.

## SI tests and real-model evaluation
All offline tests run automatically on pull requests (workflow **SI tests (offline)**, visible in the PR's Checks tab). To run them yourself (needs Node 22 and Python Playwright):
```bash
node --test si-integration/worker_smoke.test.mjs        # Worker, mock AI binding, no network
(cd si/worker && npm test)                              # evaluation script tests
node si/evidence/verify_embedded.mjs                    # embedded evidence cross-checks
python3 si-integration/test_si_dashboard.py             # SI dashboard in headless Chromium
```
Real Cloudflare inference has **not** been run. To run it from the browser, see `si/worker/DEPLOY.md` section 2: GitHub Actions or a GitHub Codespace, against the deployed Worker.

## Data and attribution
Data originate from NASA's Physical Sciences Informatics repository. Confirm each dataset's DOI and terms of use at the PSI site and cite them in any publication; DOIs were not embedded in this handoff.

## Regression test for the original dashboard (optional)
`pip install playwright && playwright install chromium && python3 src/test_playwright.py`
