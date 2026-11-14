# HANDOFF: Combustion Dynamics | PSI Intelligence Hub

Written so another coding agent can continue this project without the original Claude conversation.

- **Canonical artifact:** `psi-hub.html`, exported from Claude Artifact version `1794684963-17ec`
- **Size / SHA-256:** 127,139 bytes / `cfbbc812c59652ee3d2ecc8c27ce705fd051e440431a46f6454f0204e9d9d12c`
- `index.html` is a byte-identical copy for static hosting. Verify every tracked file with `sha256sum -c SHA256SUMS.txt` (covers both HTML files, `src/`, the workflow, `.gitignore`, `data/README.md`; not the two prose docs).
- No API keys, credentials or secrets exist in this repo or in the app. Keep it that way (see section 6 for backend secrets).
- **State at handoff:** a scientific QC pass was completed and published. Verified in headless Chromium only (no JS errors, no overflow at 390 px). **A real-browser visual check was not done** (no browser was connectable); do this first.

## 1. Architecture

Single HTML file, vanilla JavaScript, inline CSS, no framework, no CDN, no fetch/XHR. Three `<script>` blocks, in order:

| Block | Source file | Contents |
|---|---|---|
| 1 | `src/data.js` | `FD` (147 PSI-10 rows), `CF` (179 PSI-159 rows), `FL` (fuel names) |
| 2 | `src/data2.js` | `SF2` (9 SAFFIRE-II rows, verbatim strings), `DOD` (DoD sample table), `IMG` (image-log frame counts), `FX` (274 FLEX rows), `SR` (109 SAME-R rows), `SRM`, `SRT` (report Table 1 values) |
| 3 | `src/app3.js` | All logic and UI |

Array layouts are documented in the comments/mappers in `app3.js` (`FDR`, `CFR`, `FXR`, `SFR`, `SRR` map raw arrays to objects). FLEX rows: `[n,id,fuelIdx(0=Heptane),p_mmHg|null,o2,n2,co,he,d0,dext,rate,bt,endIdx,csvRow,approx]`. SAME-R rows: `[matIdx,test,desc,date,vel,rr0,dur,pag,pmix,net,csvRow]`.

**Rebuild** after editing `src/`:
```python
h=open('index.html').read(); i=h.rindex('<script>')   # last <script> = app3.js
open('index.html','w').write(h[:i]+'<script>'+open('src/app3.js').read()+'</script></body></html>')
```
(Editing data blocks requires replacing blocks 1-2 similarly.) Then copy to `psi-hub.html`, regenerate `SHA256SUMS.txt`, and run the test.

**Key code in `src/app3.js`** (line numbers at handoff):
- `h()` DOM helper, `s()` SVG helper; `render()` (l.288) re-renders from state object `st` (l.30). `TABS` (l.286) registers the six sections.
- Charts: `scatter`, `bars`, `stack`, `legend`, `sel`, `showTip/hideTip`.
- Provenance: `prov(src)`, `provx(kind,file,note)`; badge kinds CSV / REPORT / PLAN / DOD / LOG.
- Views: `vRank` (139), `vCharts` (223) with `vFD` (34), `vCF` (48), `vSAF` (58), `vSF2` (174), `vFX` (159), `vSR` (191), `vDQ` (207); `vSim` (226); `compat`/`vCmp` (247/256); `vInsOld`/`newInsights`/`vIns` (61/264/276); `vAlign` (278).
- Knowledge base: `INV` array (l.71), fields `id,name,ds,cat,cls,hw,fuel,diag,unit,out,find,src,kw`. `ds:1` = dataset integrated (PSI-10, 159, 98, 99, 69, 101); `ds:0` = background only (SAME, BASS, SoFIE, FM2, FLARE, SPICE, SLICE).

**Tests:** `src/test_playwright.py` (Python Playwright, headless Chromium) checks navigation, all six sections, seven sub-tabs, FLEX/SAME-R filters, simulator presets, comparator, ranker queries, insights, alignment, mobile overflow and page errors. Run `python3 src/test_playwright.py` from anywhere (needs `pip install playwright` and `playwright install chromium`); it tests `index.html` at the repo root, or pass another path as the first argument. It was run successfully from an extracted copy of the zip at release-audit time (no page errors, no mobile overflow); it prints counts and does not assert them, so compare against section 4.

## 2. Existing functionality
1. **Query & Ranker:** keyword + intent + named-investigation + numeric-condition scoring over `INV`; shows relevance score, evidence badges (DATA / CONTEXT / GAP) and answer cards from `answers()`.
2. **Data Explorer:** interactive SVG charts with tooltips for each integrated dataset, plus a data-quality log. FLEX and SAME-R have fuel/atmosphere/material filters.
3. **Habitat Simulator:** O2 % and pressure sliders with Earth / Lunar Habitat (30%, 10.2 psi) / Spacesuit presets; `rowsFor`/`cover` find integrated rows within ±3% O2 and ±1 psi. This is *condition similarity only*.
4. **Comparator:** default FLEX vs SAFFIRE-II vs SAME-R; `compat` warns on incompatible hardware, fuel class, units and gravity.
5. **Scientific Insights:** 11 evidence-labelled cards.
6. **Challenge Alignment:** Prevention / Detection / Suppression evidence table and research gaps.

## 3. Scientific limitations (must be preserved in any continuation)
- **No partial-gravity data.** All integrated data are microgravity or reference gravity. Lunar (0.16 g) / Mars (0.38 g) behaviour is not covered.
- **FLEX "CO" column is ambiguous.** Header reads "CO initial ambient composition". No CSV/DoD/Test Plan defines it. The Test Plan never mentions carbon monoxide, uses CO2 as suppressant with X_CO2 0.15-0.70 (CSV: 0.05-0.70), and CO and He never co-occur, so it is *probably* CO2, but **unconfirmed**. UI label: "CO column (probable CO2)". Resolve via the FLEX PI/PSI data dictionary.
- **FLEX is liquid-droplet combustion** (heptane, methanol). It does not test habitat materials, has no LOI / minimum-extinction-concentration column, and so does **not** show suppressant efficacy. "Extinction / Disruption / Completion" test-end labels are undefined in the files. 8 tests lie near 30% O2 and ~10.3 psi (535 +/- 5 mmHg; 4 methanol, 4 heptane, N2 only; 1 Completion, 7 Disruption): atmosphere similarity only, not habitat fire-safety validation.
- **FLEX identifier 193F001 appears in tests 70 and 73.** Same date/GMT/pressure, different measurements (d0 4.67 vs 4.64 mm, burning rate 0.41 vs 0.56, burn time 1.6 vs 1.5 s). Unexplained; both kept and flagged. If merged, unique count is 273. (274 rows, 273 distinct IDs.) Other FLEX issues: test #114 has pressure 0 mmHg (treated as missing); 6 rows have composition sums >0.02 from 1; extinction diameter missing in 77 tests, initial diameter in 12, burning rate in 16, burn time in 6 (+2 approximate "~6","~9"). The two uploaded FLEX CSVs were byte-identical (md5 10b423c8...) and counted once.
- **SAME-R counts:** 109 CSV records = 67 primary rows + 42 aged-smoke follow-ups (test numbers with an "a" suffix). The 67 primary rows cover **66 unique test numbers**, matching the report's "66 test points"; test 57 has two rows (Lampwick and Teflon, same date/conditions). SAME-R characterizes smoke particles (report-derived diameters, Rt/R0 heated-wire conditions). It has **no detector sensitivity, response-time, alarm-threshold or false-alarm data** and must never be presented as detector validation.
- **SAFFIRE-II:** 9 samples, one per condition (n = 1); 4 silicone samples "Insignificant". Observations, not statistically conclusive. O2 is approximate (derived from CO2 production, CSV Note 1). The CSV loses a character in a header ("?-g"); read as latin1 and flagged. Thickness is confounded with material.
- **SAFFIRE-1 (PSI-98):** only 2 samples (420 s concurrent vs 70 s opposed at 20 cm/s, ~21.5% O2).
- **PSI-10 extinction temperature (~1130 K)** and critical mass fluxes are report-derived, not CSV columns. PSI-159 cool flames only for n-butane at 2 bar, XO2 0.39 (report).
- Evidence types: *measured* (CSV rows), *report-derived* (PDF text/tables), *metadata/plan* (DoD, test plan, image logs). Keep the three visibly distinct. Test-plan values (e.g. cup-burner MEC for CO2) are plan citations, not results.
- Image-log frame counts come from an xlsx metadata file; no measurements were extracted from images.

## 4. Data provenance
Source files (not in repo; place in `data/` after checking terms): `PSI-10` Flame Design CSV + report PDF; `PSI-159` CFI-G CSV + report PDF; `PSI-98` SAFFIRE-1 CSVs; `PSI-99_Experimental_table_SAFFIRE-2.csv`, SAFFIRE-II DoD + nomenclature PDFs, image-log xlsx; `PSI-69_Experimental_table_FLEX.csv` (+ identical "(1)" copy), `FLEX_DoD.docx`, `FLEX_Test_Plan.pdf`; `PSI-101_Experimental_table_SAME-R.csv`, `SAMER_Final_0602_2014.pdf` (89 pp). CSV encodings: FLEX is cp1252, SAFFIRE-II is latin1.

Verified counts: FLEX 274 (heptane 117; N2-only 101; nonzero CO column 123; He 50; Extinction 186 / Disruption 61 / Completion 27); SAME-R 109 / 67 primary / 11 zero-flow / 48 at >=8 cm/s / 16 Kapton; SAFFIRE-II 9; Flame Design 147; CFI-G 179. Unit conversions: atm x14.696, bar x14.504, mmHg x0.019337 = psi.

Each UI chart carries a provenance line naming file and rows. DOIs are **not** embedded; add them from the PSI repository (unfinished work).

## 5. Deployment (static)
The site is one file. Serve `index.html` at the root.

**GitHub Pages**
1. Create a repo, push this folder to `main`.
2. Settings > Pages > Source: **GitHub Actions**. The included `.github/workflows/pages.yml` publishes `index.html`. (Alternative: Source = "Deploy from a branch", `main`, `/ (root)`.)
3. Site appears at `https://<user>.github.io/<repo>/`. Relative paths only; no config needed.

**Cloudflare Pages**
1. Workers & Pages > Create > Pages > Connect to Git, choose the repo.
2. Framework preset: None. Build command: *(empty)*. Build output directory: `/` (or copy `index.html` to a `public/` folder and use that).
3. Deploy. To use a custom domain, add it under the project's Custom domains tab.

Local: `python3 -m http.server 8000`.

## 6. Connecting a future independent SI backend

Goal: genuine, evidence-grounded AI answers without breaking the existing static, offline-capable dashboard.

**Principles:** the backend holds all model keys (never in the frontend); the static page remains the fallback; every AI claim must cite retrievable evidence records; the model may not invent measurements.

**Suggested architecture**
- *Evidence store:* export the embedded arrays plus report/DoD/plan passages to structured JSON with stable IDs (e.g. `PSI-69:row274`, `PSI-101:report:p78`) and evidence type (`measured` / `report-derived` / `metadata`). Index passages for retrieval (embeddings + keyword). The `INV` array becomes the investigation catalogue; add the limitations in section 3 as first-class `limitations` fields.
- *API:* `POST /api/si/query` with `{question, conditions:{o2,psi}|null, filters}` returning
```json
{"answer":"...","claims":[{"text":"...","evidence":["PSI-69:row12"],"type":"measured|report-derived|metadata|gap"}],
 "ranked":[{"id":"PSI-69","score":0.82,"why":[{"kind":"DATA","text":"..."}]}],
 "gaps":["No partial-gravity data"],"model":"...","retrieved":[...]}
```
  Keep `ranked[].why[].kind` in the existing DATA / CONTEXT / GAP vocabulary so the current badge renderer can display it unchanged.
- *Frontend wiring:* add a `siQuery(q)` async function (the only place that calls `fetch`), a configurable `window.SI_API_URL` (empty = disabled, use rule-based ranker), and a toggle in `vRank`. On failure or empty URL, fall back to the existing code path. Render claims with the existing `prov`/badge helpers; show citation chips that scroll to the cited rows.
- *Hosting/CORS:* serverless (Cloudflare Workers / Pages Functions, Cloud Run, etc.). Restrict CORS to the site origin; rate limit; log queries without personal data. Store secrets only in the host's secret manager / environment variables, never in git.
- *Guardrails (server-side):* require citations for every numeric claim; reject or mark as "not in data" anything outside the evidence store; always append the gap statement for partial gravity, suppressant efficacy and detector performance when relevant; post-validate that cited IDs exist and that quoted numbers match the cited rows.
- *Evaluation:* build a question set (the ranker test queries in `test_playwright.py` are a starting point) with expected cited records and expected "cannot answer" cases (partial gravity, detector response time, suppressant efficacy).

## 7. Where the rule-based ranker must be extended or replaced for real SI

All in `src/app3.js` (line numbers at handoff):

| Location | Current behaviour | Needed for AI-powered SI |
|---|---|---|
| `vRank` l.139: tokenization (`toks`, stop-word regex) | Words >2 chars, fixed stop list | Replace with embedding/semantic retrieval and query understanding |
| `vRank`: `o2m`/`pm` regex | Parses only "N%" and "N psi/bar/atm" | LLM or parser for structured conditions (ranges, units, gravity, fuel, hardware) |
| `intent` object l.142 | Three regexes mapping to Prevention/Detection/Suppression | LLM intent classification with multi-label confidence |
| `spec` l.143 | Hard-coded names -> IDs (SAFFIRE-II, SAME-R, FLEX...) | Entity linking over the investigation catalogue |
| Scoring loop over `INV` | Adds fixed points (15/keyword, 25/10 intent, 40 named, 25+ conditions); caps at 100 | Retrieval relevance + condition-match scoring against evidence rows; calibrated and explainable, not magic constants |
| `hay=(kw+name+find)` | Substring match on hand-written keywords | Retrieval over full evidence passages (reports, DoD, plan) |
| `INV[].kw` / `find` / `src` l.71 | Hand-authored text | Generated from or checked against the evidence store; source of truth moves out of the JS file |
| `rangeNum`, `ranges`, `cover`, `rowsFor` l.103-131 | Fixed +/-3% O2, +/-1 psi window over embedded arrays | Query-driven tolerance, other dimensions (flow velocity, fuel, material, gravity), server-side querying |
| `answers(q)` l.132 | Regex-triggered, hand-written cards (FLEX, SAME-R, SAFFIRE-II, gaps, priority, lunar) | LLM answer synthesis with mandatory citations and validator; keep these cards as regression expectations and gap templates |
| `newInsights` l.264 / `vInsOld` l.61 | Static authored insights | Optionally generated, but each must keep evidence, limitation and provenance fields |
| `vSim`/`cover` l.226 | Condition similarity only | Same data, but any AI text must repeat "condition similarity != habitat validation" |
| `compat` / `vCmp` l.247 | Rule-based compatibility flags | Model-assisted, still rule-verified |
| `vAlign` l.278 | Static Prevention/Detection/Suppression table | Generate from the evidence store; keep gap rows |
| `vDQ` l.207 | Hand-written provenance log | Generate from ingestion scripts so counts cannot drift |
| UI label "RULE-BASED EVIDENCE SUMMARY" (in `answers()` output) | Honest labelling | Label per mode ("rule-based" vs "AI-assisted, cites evidence") and display model/version |

Also needed for genuine SI: an ingestion pipeline (CSV/PDF/DOCX -> JSON with row IDs), a citation-checking validator, an offline evaluation harness, and a policy that AI output may never present measured values that are absent from the cited rows.

## 8. Unfinished work / next steps
1. **Real-browser visual check** of the published page (desktop and phone); only headless Chromium was used.
2. Add DOIs and exact citations per dataset.
3. Resolve the FLEX CO/CO2 definition, the 193F001 duplicate, and the undefined test-end labels with the data owners.
4. Optional: extract `data` into JSON files and split `app3.js` into modules with a build script (kept single-file so far to avoid white-screen/CDN failures).
5. Implement the backend (section 6) and the ranker replacements (section 7).
6. Source CSVs/PDFs are not in the repo; add them (licence permitting) or an ingestion script.
7. Accessibility review (keyboard access to charts, colour contrast) and a tooltip-free data table alternative for each chart.
8. The companion research report was written as a separate Claude Doc: https://claude.ai/artifact/MSYoi7yqgFBDCQEaydUPKn (may not be accessible outside the original account; export it if needed).
9. Do not redesign without cause; the layout and wording were deliberately conservative about scientific claims.

## 9. Do-not-regress checklist
- Partial-gravity absence stays prominent.
- FLEX never described as proving suppressant effectiveness; CO column stays "probable CO2".
- SAME-R never described as showing detector sensitivity/response time.
- SAFFIRE-II never described as statistically conclusive.
- Measured vs report-derived vs metadata badges stay distinct.
- Record counts above are reproduced by the tests.

## 10. Adding verified NASA source files to `data/` without silently changing records
1. Put each original file in `data/raw/<PSI-ID>/` unmodified, with its original name. Never edit a raw file.
2. Add a row to `data/MANIFEST.md`: file name, PSI ID, download URL, download date, SHA-256, licence/terms, DOI.
3. Re-derive records with a script that reads only `data/raw/` and writes a *separate* candidate file (e.g. `data/derived/PSI-69.json`). Do not overwrite `src/data*.js` directly.
4. Diff candidate vs embedded arrays (row count, per-row values, encodings: FLEX cp1252, SAFFIRE-II latin1). Any difference must be explained in the PR and in the data-quality log (`vDQ`); counts in section 4 and README must be updated in the same PR.
5. Only then regenerate the embedded blocks, rebuild `index.html`, copy to `psi-hub.html`, regenerate `SHA256SUMS.txt`, and run the test.
6. Check licence terms before committing raw files to a public repo; otherwise list them in `MANIFEST.md` and add the folder to `.gitignore`.

## 11. Release audit record
Audited from an extracted copy of the release zip: checksums verified, HTML files byte-identical, `src/*.js` found verbatim inside the HTML, no credentials found, portable test run once. **Not done:** real-browser visual check, and a live GitHub Pages deployment (cannot be tested before the repo exists).
