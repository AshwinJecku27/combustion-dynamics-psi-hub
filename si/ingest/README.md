# Adding a NASA PSI investigation (maintainers)

The public evidence store (`si/worker/src/bundle.js`, store v1.1, SHA-256 `a77e5548…aed548`) changes only through a reviewed pull request. Nothing is promoted automatically.

## Status of the tooling (read first)
| Step | Tooling |
|---|---|
| 1–4. Stage originals, provenance, checksums, structure profile, ingestion report | **Automated:** `si/ingest/stage.mjs`, tested by `si/ingest/stage.test.mjs`. |
| 5. Write store records, passages and limitations | **Manual.** The release's generator `scripts/build_bundle.py` was never supplied (see `si/evidence/README.md`). |
| 6. Regenerate `bundle.js`, store hash and dashboard data | **Blocked until the generator is recovered or rewritten.** Do not hand-edit `bundle.js`. |
| 7. Integrity checks and tests | **Automated:** `node si/evidence/verify_embedded.mjs`, `cd si/worker && npm test`, the CI workflow. |

## 1. Stage the source files
Put the original files, unmodified, in a folder. Then write a provenance file:
```json
{ "investigation_id": "PSI-NN", "investigation_name": "…", "source_urls": ["https://…"],
  "retrieved_on": "YYYY-MM-DD", "retrieved_by": "name", "terms_of_use": "…", "notes": "optional" }
```
Run the staging tool:
```bash
node si/ingest/stage.mjs --id PSI-NN --source-dir path/to/originals --provenance provenance.json
```
It writes `si/ingest/staging/PSI-NN/` (git-ignored):
- `source/`: byte-for-byte copies, with SHA-256 verified before and after copying;
- `manifest.json`;
- `INGESTION_REPORT.md`, which lists files, checksums and a column profile.

The report lists every ambiguity found:
- encoding;
- header characters lost in encoding;
- mixed numbers and text;
- `~` values and ranges;
- leading-zero values;
- blanks;
- duplicate identifiers and duplicate files.

Each one becomes a decision for a reviewer. Re-check the staged files at any time:
```bash
node si/ingest/stage.mjs --verify si/ingest/staging/PSI-NN
```

## 2. Review (a person, not the tool)
Every box in the report's checklist must be ticked:
- **Definitions:** columns are defined from the data dictionary (DoD), and undefined ones are recorded as undefined.
- **Units:** taken from the source; a disputed unit is never converted.
- **Gravity regime:** quoted with a locator.
- **Report statements:** quoted verbatim with file and page.
- **Limitations:** every unresolved ambiguity becomes a limitation (`LIM-*`).

Never fill blanks from another file, merge duplicate identifiers, repair values such as `037`, or choose between conflicting sources.

## 3. Integrate (pull request)
1. Add the records, passages, limitations and comparison rules in the evidence-store format (see the shapes in `bundle.js`).
2. Regenerate `bundle.js`, the store hash and the dashboard's embedded data with the recovered generator.
3. Add regression tests:
   - record counts;
   - limitation presence;
   - retrieval for a typical question;
   - grounding of any new materials (add them to `TERMS` in `si/worker/src/grounding.js`).
4. Run the full offline CI and `node si/evidence/verify_embedded.mjs`. Regenerate `si/SHA256SUMS.txt`.
5. Attach `INGESTION_REPORT.md` to the pull request. After merge, run the real-model evaluation workflow.

Investigations named in the dashboard's "not yet integrated" list stay there until these steps are complete.
