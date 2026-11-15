# SI Worker and dashboard: deploy, evaluate, roll back (browser only)

Everything below is done in a web browser on github.com and dash.cloudflare.com. Nothing has to be installed on
your computer. **Nothing here has been done yet. Each deployment step needs your explicit go-ahead.**

What stays untouched throughout:
- the frozen original dashboard (`index.html`, `psi-hub.html`), which GitHub Pages keeps serving;
- `si-release/`, the original release candidate.

Cloudflare's menu names change from time to time. If a label below differs from what you see, look for the closest
match. These steps were written without access to Cloudflare's documentation site, so check against
https://developers.cloudflare.com/workers/ci-cd/builds/ if unsure.

## 0. Before anything is deployed
- Read `TERMS_REVIEW.md`. You must accept Cloudflare's terms and the Llama 3.3 Community License / Acceptable Use Policy yourself.
- Keep the "Built with Llama" attribution. The dashboard shows it when the provider is Workers AI.
- Make sure the offline tests pass: the pull request's **Checks** tab, workflow "SI tests (offline)".

## 1. Deploy the API Worker from GitHub (Cloudflare Workers Builds)
1. Sign in at https://dash.cloudflare.com (a free account is enough).
2. Go to **Workers & Pages** and choose **Create**. Pick the option to import or connect a **Git repository**, authorise the Cloudflare GitHub app for `AshwinJecku27/combustion-dynamics-psi-hub`, and select the repository.
3. Set up the project:
   - **Project / Worker name:** `psi-si-api`. It must equal `name` in `si/worker/wrangler.toml`.
   - **Root directory (path):** `si/worker`
   - **Build command:** leave empty
   - **Deploy command:** `npx wrangler deploy` (the default)
   - **Production branch:** `main`
   - If offered, set **build watch paths** to `si/worker/*` so unrelated commits do not redeploy.
   - If offered, turn **non-production branch builds** off. Otherwise every push to another branch uploads a preview version.
4. Save and deploy. Cloudflare reads `wrangler.toml`, which:
   - creates the Workers AI binding `AI`. No API key exists or is needed.
   - sets the variables, including `ALLOWED_ORIGIN = https://ashwinjecku27.github.io`.
5. Note the URL, `https://psi-si-api.<your-subdomain>.workers.dev`, shown on the Worker's overview page.
6. Open `https://psi-si-api.<your-subdomain>.workers.dev/v1/health` in the browser. Expect:
   - `"ok":true`
   - `"provider":"workers_ai"`
   - `"model_configured":true`
   - `"store_sha256":"a77e5548…aed548"`

**Important:** after step 3, every push to `main` that changes `si/worker` redeploys the Worker automatically. That
includes merging a pull request. To stop that, disconnect the repository in the Worker's **Settings → Build**.

Configuration lives in `si/worker/wrangler.toml` and can be edited in the GitHub web editor. Each deploy
re-applies these values, so edit them there, not in the Cloudflare dashboard:

| Variable | Value | Notes |
|---|---|---|
| `ALLOWED_ORIGIN` | `https://ashwinjecku27.github.io` | Exact origin of the page that will call the API: scheme + host only. The GitHub Pages path `/combustion-dynamics-psi-hub/` is not part of the origin. If you host `si.html` elsewhere (for example a Cloudflare Pages domain), change this. |
| `SI_PER_IP_PER_MIN` | `6` | Best-effort, per Worker instance (section 5). |
| `SI_DAILY_CAP` | `300` | Best-effort, per Worker instance. |
| `SI_PROVIDER` / `WORKERS_AI_MODEL` | `workers_ai` / `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | |

## 2. Real-model evaluation (uses Workers AI allowance)
The evaluation script is `si/worker/scripts/real_eval.mjs`.
- It asks the six internal benchmark questions (regression benchmarks; the public dashboard takes open-ended questions and does not list them) once each by default: 6 requests, at most 12 model calls. Offline regression tests for them: `npm test` (`test/benchmark_regression.test.mjs`).
- It refuses to run more than `max_requests` requests.
- It stops early if the daily allocation appears used up.
- It never estimates usage. Workers AI does not return neuron counts, so check **Workers AI** usage in the Cloudflare dashboard after the run.

**Option A: GitHub Actions, after this branch is merged.** GitHub only shows the **Run workflow** button for workflows that exist on the default branch.
1. Go to the repository → **Actions** → **SI real-model evaluation (manual)** → **Run workflow**.
2. Choose the branch, paste the Worker URL from step 1.5, and keep `questions = all`, `reps = 1`, `max_requests = 6`.
3. Tick `commit_report` only if you want `si/worker/test/real_eval_report.md` and `.json` committed to that branch. The report is always available under the run's **Artifacts** and in its summary.

**Option B: GitHub Codespaces, before merging.** This runs in the browser; nothing is installed on your laptop.
1. On the pull request page, choose **Code → Codespaces → Create codespace on `claude/confident-archimedes-0dhfus`**.
2. In the Codespace terminal (Node is preinstalled):
   ```bash
   cd si/worker && node scripts/real_eval.mjs --url https://psi-si-api.<your-subdomain>.workers.dev
   ```
3. Commit `test/real_eval_report.md` and `test/real_eval_report.json` from the Codespace's Source Control panel.

Both options need the deployed Worker from section 1. Evaluating **before** deploying is possible from a Codespace
with `npx wrangler dev --remote`. That needs a Cloudflare API token stored as a Codespaces secret named
`CLOUDFLARE_API_TOKEN`, with Workers Scripts edit and Workers AI permissions. It is more setup; prefer section 1
when deployment is authorised.

### Reading the report
- **REAL MODEL ANSWER** rows are validated Workers AI output.
- **FALLBACK** rows showed retrieved evidence only. Their reason codes:
  - `no_key`: the model is not configured;
  - `rate_limited`: daily allocation used up;
  - `provider_error`, `timeout`: the model call failed;
  - `validation_failed`: the verifier rejected the model's answer, either twice, or once with no time left to retry (`retry_skipped: deadline`).
- Validated answers that needed a retry list the first attempt's objections under "Rejected attempts before this answer" (error codes plus the verifier's messages; never the model's text).

Every question gets its own outcome (script version 1.1.0):
- **PASS:** a validated model answer. For Q5 and Q6 its status must be `insufficient_evidence`. For Q1 to Q4 this covers the automated checks only.
- **FAIL:** the verifier rejected the model's answer, or a Q5/Q6 answer was not `insufficient_evidence`.
- **NOT EVALUATED:** there was no model answer to judge (`timeout`, `rate_limited`, `provider_error`, `no_key`, or an HTTP or network error). It never counts as a success.

The automated verdict for the run:
- **PASS:** every question passed, with no `provider_error` fallback and no HTTP or network errors.
- **FAIL:** any question failed, or one of those errors occurred.
- **INCOMPLETE:** no failures, but at least one question was NOT EVALUATED (for example the Q1 timeout in run #2). The verdict names the question and the reason.
- **INCONCLUSIVE:** no model answer was obtained at all.
- **PASS does not mean the answers are scientifically correct.** Read every answer against the limitations (LIM-001 to LIM-023) before relying on it.

## 3. Build the dashboard with the API address
1. **Actions** → **SI dashboard build (manual)** → **Run workflow**, and paste the Worker URL. This also needs the workflow on the default branch; from a Codespace, run `bash si-integration/configure_dashboard.sh <url>` instead.
2. Download the artifact `si-dashboard-configured`. It contains `si.html` with the address filled in. `si/dashboard/si.html` stays unconfigured on purpose.

## 4. Publish the dashboard (needs a separate, authorised change)
`.github/workflows/pages.yml` runs `si-integration/build_pages_site.sh`, which publishes:
- `/` = `index.html`, byte-identical. The script checks it against `SHA256SUMS.txt`.
- `/si/` = `si/dashboard/si.html` as `si/index.html`. Its "Original dashboard" link is rewritten to `../index.html`.

URL: `https://ashwinjecku27.github.io/combustion-dynamics-psi-hub/si/`.

**API address.** The build reads the repository variable `SI_API_BASE` (**Settings → Secrets and variables → Actions → Variables**). It must be an https origin with no path. For this project's Worker, set:

| Name | Value |
|---|---|
| `SI_API_BASE` | `https://psi-si-api.ashwin-jecku.workers.dev` |

**Ask SI does not work publicly until this variable is set and the Pages workflow has run again.** The address is deliberately not in the source, the workflow or the secrets: it is a public endpoint, set at build time only.
- **Not set:** `/si/` is published unconfigured. Ask SI sends nothing and says the service is not configured; the other three sections work from embedded data.
- **To turn Ask SI on:** add the variable, then re-run **Deploy static site to GitHub Pages** (**Actions** → **Run workflow**). Every visitor's question then uses the Worker's Workers AI allowance.

The Worker's `ALLOWED_ORIGIN` (`https://ashwinjecku27.github.io`) already covers `/si/`, because an origin carries no path.

Offline checks: `node --test si-integration/pages_site.test.mjs` and `python3 si-integration/test_pages_site.py`.

Never overwrite `index.html` or `psi-hub.html`.

## 5. Security and limits, as configured
- **Secrets:** none. Workers AI uses the account binding. The optional Gemini provider would need a Worker secret (**Settings → Variables and Secrets → Add → Secret**). It is not the default and is not recommended for a public site (`TERMS_REVIEW.md`). Never put a key in `wrangler.toml` or any other repository file. The `.gitignore` here excludes `.dev.vars` and `.env*`.
- **CORS:** browsers from any origin other than `ALLOWED_ORIGIN` get HTTP 403. Requests without an `Origin` header (curl, the evaluation workflow) are allowed. CORS is not authentication.
- **Rate limits:** 6 requests/min per IP and 300/day are counted in memory per Worker instance. Cloudflare may run several instances and recycle them, so the limits are best-effort, not global. The hard cost ceiling is the Workers AI free allocation (10,000 neurons/day, reset 00:00 UTC). On the free plan further calls fail, and the page shows the evidence-only fallback.
- **Request limits:** the body must be at most 2,000 characters and the question 5 to 500 characters. Only `GET /v1/health`, `POST /v1/ask` and `OPTIONS` are served.
- **Time limits:**
  - **Per model call:** `SI_MODEL_TIMEOUT_MS`, default 25,000 ms. The JSON-schema attempt and its schema-less retry share this one budget.
  - **Per request:** `SI_REQUEST_DEADLINE_MS`, default 45,000 ms. A retry after a rejected answer is started only if a full per-call budget still fits; otherwise the evidence-only fallback is returned.
  - **What a timeout means:** the Worker stops waiting, but does not cancel the model call. The runtime gives no cancellation guarantee, so an abandoned generation may keep running and may still count against the Workers AI allocation.
  - **Raising the limits** makes users wait longer. Worst case per request is about the deadline. The evaluation script's 90 s client timeout must stay above it.
  - Neither variable is set in `wrangler.toml`; the defaults apply.
- **Not yet verified on Cloudflare:**
  - real answer quality;
  - whether this model accepts the JSON schema (the Worker retries without it if refused);
  - CPU time per request on the free plan.

## 6. Roll back
- **Worker:** in the Cloudflare dashboard, open the Worker's **Deployments** and roll back to an earlier version, or delete the Worker. To stop automatic deploys, disconnect the repository in **Settings → Build**.
- **Dashboard:** remove `si.html` from the site. The original dashboard is not affected by any SI step.
