# Release candidate: test, deploy, roll back
Nothing here modifies the frozen dashboard (`psi-hub.html`, `index.html`) or `si-evidence/`. Run all commands from `si-engine/` unless noted. (If the folder is on a noexec mount, run scripts with `bash scripts/...`.)

## 0. Terms you must accept yourself (see TERMS_REVIEW.md)
Cloudflare account terms and the Llama 3.3 Community License / Acceptable Use Policy. The dashboard footer already shows "Built with Llama"; keep it.

## 1. Real-model test (required before deploying)
```
npm i -g wrangler            # or use npx wrangler
npx wrangler login
npx wrangler dev --remote    # runs this Worker locally with the real Workers AI binding; prints http://localhost:8787
# second terminal:
SI_URL=http://localhost:8787 node scripts/real_eval.mjs 3
```
This asks the six competition questions plus two extras, three times each, and writes `test/real_eval_report.md/json`: validator pass rate, fallbacks, latency, tokens and measured neurons per question (so the free-tier question count is measured, not assumed). Read the answers in the report for scientific accuracy and send me the report; I will tune prompt and retrieval from it. Acceptance suggestion: Q5 and Q6 are `insufficient_evidence` every time; no fallback caused by `provider_error`; validator final rejections 0 to 1 of 24.
If json_schema output is rejected by the model, the provider automatically retries without it; the verifier still guards every answer.

## 2. Deploy the API
1. Edit `wrangler.toml`: set `ALLOWED_ORIGIN` to your Pages origin (for example `https://<user>.github.io`). No secret is needed for Workers AI.
2. `npx wrangler deploy` (prints `https://psi-si-api.<you>.workers.dev`).
3. Check: `curl https://psi-si-api.<you>.workers.dev/v1/health` shows `"provider":"workers_ai","model_configured":true`.
4. Re-run step 1 with `SI_URL=https://psi-si-api.<you>.workers.dev`.

## 3. Build and publish the dashboard (new file only)
```
bash scripts/build_release.sh https://psi-si-api.<you>.workers.dev   # writes ../release/dashboard/si.html
```
Copy `release/dashboard/si.html` into the GitHub Pages repo as `si.html`; commit and push. Do not overwrite `index.html` or `psi-hub.html`. Live page: `https://<user>.github.io/<repo>/si.html`. Rollback: delete `si.html`; for the API, `npx wrangler rollback`.

## 4. Limits and fallbacks
- Rate limit: 6 requests per minute per IP and 300 per day (`wrangler.toml`), best-effort per Worker instance.
- Free Workers AI allocation is 10,000 neurons per day (resets 00:00 UTC). When it is used up, or the model fails or its answer fails verification, the page shows the retrieved evidence only and says no AI was used.
- Alternative provider (adult-only or cleared use): `SI_PROVIDER="gemini"` and `npx wrangler secret put GEMINI_API_KEY`. Not the default; see TERMS_REVIEW.md.
- Unverified until step 1/2: real output quality, JSON-schema support, Cloudflare 10 ms CPU limit.
