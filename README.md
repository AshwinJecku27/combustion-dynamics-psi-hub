# Combustion Dynamics | PSI Intelligence Hub

An interactive, single-file dashboard built by **Team Combustion Dynamics** for the **NASA Space Apps Challenge 2026, "Flame in Freefall"**. It explores real NASA Physical Sciences Informatics (PSI) combustion datasets and asks what they do, and do not, tell us about spacecraft and lunar-habitat fire **prevention, detection and suppression**.

> **Scientific stance:** accuracy over impressive charts. Only values present in the source files are plotted. Every chart and finding is labelled by evidence type (measured CSV data, report-derived, plan/metadata) with provenance. The dashboard states plainly what the data cannot answer. **None of the integrated datasets is a partial-gravity (lunar 0.16 g / Mars 0.38 g) combustion dataset.**

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
HANDOFF.md          Architecture, provenance, limitations, backend/SI plan, deployment
```
**`psi-hub.html` is canonical.** The `src/` files are the exact script contents embedded in it (verified as substrings), provided for easier diffing and editing. If you edit `src/`, rebuild the HTML (see HANDOFF.md) and update the checksum.

## Deploy
See "Deployment" in `HANDOFF.md` (GitHub Pages workflow included at `.github/workflows/pages.yml`; Cloudflare Pages instructions also provided).

## Data and attribution
Data originate from NASA's Physical Sciences Informatics repository. Confirm each dataset's DOI and terms of use at the PSI site and cite them in any publication; DOIs were not embedded in this handoff.

## Regression test (optional)
`pip install playwright && playwright install chromium && python3 src/test_playwright.py`
