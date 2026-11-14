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
- It asks the six competition questions (the dashboard's example questions) once each by default: 6 requests, at most 12 model calls.
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
  - `validation_failed`: the model answered twice and the verifier rejected both.

The automated verdict is computed from the actual responses:
- **PASS** needs every Q5/Q6 model answer to have status `insufficient_evidence`, no `provider_error` fallback, at most one validator final rejection per 24 requests, and no HTTP or network errors.
- **INCONCLUSIVE** means no model answer was obtained.
- **PASS does not mean the answers are scientifically correct.** Read every answer against the limitations (LIM-001 to LIM-023) before relying on it.

## 3. Build the dashboard with the API address
1. **Actions** → **SI dashboard build (manual)** → **Run workflow**, and paste the Worker URL. This also needs the workflow on the default branch; from a Codespace, run `bash si-integration/configure_dashboard.sh <url>` instead.
2. Download the artifact `si-dashboard-configured`. It contains `si.html` with the address filled in. `si/dashboard/si.html` stays unconfigured on purpose.

## 4. Publish the dashboard (needs a separate, authorised change)
`.github/workflows/pages.yml` publishes `index.html` only. It is part of the frozen v1 checksums, so this branch does not change it. To publish the SI dashboard at `https://ashwinjecku27.github.io/combustion-dynamics-psi-hub/si.html`, a later pull request has to:
1. Commit the configured file as `si.html` in the repository root, next to `index.html`, so its "Original dashboard" link works.
2. Add one line to the "Stage site" step of `pages.yml`: `cp si.html _site/si.html`.
3. Regenerate `SHA256SUMS.txt` for `pages.yml` and record why in HANDOFF.md.

Never overwrite `index.html` or `psi-hub.html`.

## 5. Security and limits, as configured
- **Secrets:** none. Workers AI uses the account binding. The optional Gemini provider would need a Worker secret (**Settings → Variables and Secrets → Add → Secret**). It is not the default and is not recommended for a public site (`TERMS_REVIEW.md`). Never put a key in `wrangler.toml` or any other repository file. The `.gitignore` here excludes `.dev.vars` and `.env*`.
- **CORS:** browsers from any origin other than `ALLOWED_ORIGIN` get HTTP 403. Requests without an `Origin` header (curl, the evaluation workflow) are allowed. CORS is not authentication.
- **Rate limits:** 6 requests/min per IP and 300/day are counted in memory per Worker instance. Cloudflare may run several instances and recycle them, so the limits are best-effort, not global. The hard cost ceiling is the Workers AI free allocation (10,000 neurons/day, reset 00:00 UTC). On the free plan further calls fail, and the page shows the evidence-only fallback.
- **Request limits:** the body must be at most 2,000 characters and the question 5 to 500 characters. Only `GET /v1/health`, `POST /v1/ask` and `OPTIONS` are served.
- **Not yet verified on Cloudflare:**
  - real answer quality;
  - whether this model accepts the JSON schema (the Worker retries without it if refused);
  - CPU time per request on the free plan.

## 6. Roll back
- **Worker:** in the Cloudflare dashboard, open the Worker's **Deployments** and roll back to an earlier version, or delete the Worker. To stop automatic deploys, disconnect the repository in **Settings → Build**.
- **Dashboard:** remove `si.html` from the site. The original dashboard is not affected by any SI step.
