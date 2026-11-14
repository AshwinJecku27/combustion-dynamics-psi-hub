#!/usr/bin/env node
// Real-model evaluation for the SI Worker API.
//
// Written during repository integration because the release candidate's scripts/real_eval.mjs was not
// supplied. It is a new implementation, not a recovered copy of the original.
//
// What it does: sends the six competition questions (the dashboard's example questions, kept identical to
// EX in si/dashboard/si.html by a test) to a running Worker's POST /v1/ask, and records for every request the
// complete response body, HTTP status and retries, latency, mode (validated model answer vs evidence-only
// fallback), validator outcome and whatever usage metadata the Worker returns. It writes
// test/real_eval_report.json and test/real_eval_report.md.
//
// Honesty rules built in:
//  - Nothing is estimated. Usage and neuron fields are copied from the response or reported as "not reported".
//  - "Real model answer" means: the Worker returned mode "model" (Workers AI output that passed the validator).
//    The script cannot see inside the Worker; it reports what the Worker returned, plus the provider/model the
//    Worker's /v1/health declares. A localhost target is flagged, because it may be a mock.
//  - Fallbacks, HTTP errors and network errors are counted separately and never as model answers.
//
// Allowance protection (Workers AI free tier: 10,000 neurons/day):
//  - Default: each question once (6 requests; the Worker makes at most 2 model calls per request).
//  - Refuses to start if questions x reps exceeds --max-requests (default 6) unless you raise it.
//  - Aborts before asking anything if /v1/health says the model is not configured (no point; use
//    --allow-unconfigured to record fallback behaviour anyway, which costs no neurons).
//  - Stops early after --stop-after-quota consecutive quota/rate-limit fallbacks (default 2).
//  - Paces requests (--delay-ms, default 11000) to stay under the Worker's 6 requests/min/IP limit, so 429s
//    are not wasted retries.
//
// Usage:
//   node scripts/real_eval.mjs --url https://psi-si-api.<you>.workers.dev
//   node scripts/real_eval.mjs --url <url> --questions 5,6 --reps 2 --max-requests 4
//   SI_URL=<url> node scripts/real_eval.mjs 1          (positional reps, as in the original DEPLOY.md)
// Exit codes: 0 report written; 2 bad arguments or budget refusal; 3 health check failed or model not configured.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const SCRIPT_VERSION = '1.0.0';
export const EXPECTED_STORE_SHA256 = 'a77e55486a4d25f0c284c3467b485f9cc3aeded142a285a9e346357870aed548';

// The six competition questions (identical to EX in si/dashboard/si.html; enforced by test/real_eval.test.mjs).
// expect: 'insufficient_evidence' means the only acceptable model status is insufficient_evidence (DEPLOY.md
// acceptance: "Q5 and Q6 are insufficient_evidence every time"). 'answer' means no fixed expectation; a human
// must review the content.
export const QUESTIONS = [
  { id: 'Q1', expect: 'answer', text: 'Which investigations are most relevant to solid-material fire safety in a lunar habitat?' },
  { id: 'Q2', expect: 'answer', text: 'What does SAFFIRE-II show about the burning behavior of the tested materials?' },
  { id: 'Q3', expect: 'answer', text: 'What does SAME-R reveal about smoke particle characteristics?' },
  { id: 'Q4', expect: 'answer', text: 'What can FLEX tell us about gaseous suppression environments, and what can it not establish?' },
  { id: 'Q5', expect: 'insufficient_evidence', text: 'Is there actual partial-gravity combustion data in the current PSI evidence store?' },
  { id: 'Q6', expect: 'insufficient_evidence', text: 'Can the system establish a validated fire-risk probability for a lunar habitat?' },
];

const DEFAULTS = { reps: 1, maxRequests: 6, delayMs: 11000, timeoutMs: 90000, max429Retries: 2, stopAfterQuota: 2, allowUnconfigured: false };

export function parseArgs(argv, env = {}) {
  const o = { ...DEFAULTS, url: env.SI_URL || null, questions: null, outDir: null };
  const num = (k, v) => { const n = Number(v); if (!Number.isFinite(n) || n < 0) throw new Error(`--${k} must be a non-negative number`); return n; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]; const next = () => { if (i + 1 >= argv.length) throw new Error(`${a} needs a value`); return argv[++i]; };
    if (a === '--url') o.url = next();
    else if (a === '--reps') o.reps = num('reps', next());
    else if (a === '--questions') o.questions = next();
    else if (a === '--max-requests') o.maxRequests = num('max-requests', next());
    else if (a === '--delay-ms') o.delayMs = num('delay-ms', next());
    else if (a === '--timeout-ms') o.timeoutMs = num('timeout-ms', next());
    else if (a === '--stop-after-quota') o.stopAfterQuota = num('stop-after-quota', next());
    else if (a === '--out') o.outDir = next();
    else if (a === '--allow-unconfigured') o.allowUnconfigured = true;
    else if (/^\d+$/.test(a)) o.reps = Number(a);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!o.url) throw new Error('give the Worker URL with --url https://... (or SI_URL)');
  if (!/^https?:\/\/[^/\s]+$/.test(o.url.replace(/\/$/, ''))) throw new Error('--url must be an origin such as https://psi-si-api.example.workers.dev (no path)');
  o.url = o.url.replace(/\/$/, '');
  if (!Number.isInteger(o.reps) || o.reps < 1) throw new Error('--reps must be an integer >= 1');
  o.selected = selectQuestions(o.questions);
  return o;
}

export function selectQuestions(spec) {
  if (!spec || spec === 'all') return QUESTIONS.slice();
  const ids = spec.split(',').map((s) => s.trim().toUpperCase().replace(/^Q?/, 'Q'));
  const out = ids.map((id) => { const q = QUESTIONS.find((x) => x.id === id); if (!q) throw new Error(`unknown question ${id} (use 1-6)`); return q; });
  return out;
}

export function planRequests(opts) {
  const plan = [];
  for (let r = 1; r <= opts.reps; r++) for (const q of opts.selected) plan.push({ ...q, rep: r });
  return plan;
}

const isLocal = (url) => /^https?:\/\/(localhost|127\.|\[::1\])/.test(url);

async function timedFetch(fetchImpl, url, init, timeoutMs, now) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeoutMs);
  const t0 = now();
  try {
    const res = await fetchImpl(url, { ...init, signal: ctl.signal });
    const text = await res.text();
    return { ok: true, status: res.status, retryAfter: res.headers.get('retry-after'), text, ms: now() - t0 };
  } catch (e) {
    return { ok: false, error: e && e.name === 'AbortError' ? `timeout after ${timeoutMs} ms` : String((e && e.message) || e), ms: now() - t0 };
  } finally { clearTimeout(t); }
}

// Finds usage-like data the Worker actually returned. Never invents values.
export function extractUsage(body) {
  const usage = body && body.metrics && body.metrics.usage !== undefined ? body.metrics.usage : null;
  let neurons = null;
  const scan = (o) => { if (!o || typeof o !== 'object') return; for (const [k, v] of Object.entries(o)) { if (/neuron/i.test(k) && typeof v === 'number') neurons = v; else scan(v); } };
  scan(body && body.metrics);
  return { usage, neurons, note: usage == null ? 'not reported by the Worker for this response' : neurons == null ? 'token usage reported; neurons not reported by the API (see the Cloudflare dashboard, Workers AI usage)' : 'reported by the Worker' };
}

// Turns one HTTP exchange into a result record.
export function classify(q, exchange) {
  const r = { question_id: q.id, rep: q.rep, question: q.text, expectation: q.expect, http_attempts: exchange.attempts };
  const last = exchange.attempts[exchange.attempts.length - 1];
  r.latency_ms_total = exchange.attempts.reduce((s, a) => s + (a.ms || 0), 0);
  r.latency_ms_last = last ? last.ms : null;
  if (!last || last.error) { r.outcome = 'network_error'; r.error = last ? last.error : 'no attempt'; r.body = null; return finish(r); }
  r.http_status = last.http_status;
  let body = null; try { body = JSON.parse(last.text); } catch { /* keep raw */ }
  r.body = body; r.raw_body = body ? undefined : last.text;
  if (last.http_status !== 200) { r.outcome = 'http_error'; r.error = body && body.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${last.http_status}`; return finish(r); }
  if (!body || typeof body !== 'object') { r.outcome = 'invalid_response'; r.error = 'response body is not JSON'; return finish(r); }
  r.worker_latency_ms = body.metrics && typeof body.metrics.latency_ms === 'number' ? body.metrics.latency_ms : null;
  r.store_sha256 = body.store_sha256 || null;
  const u = extractUsage(body); r.usage = u.usage; r.neurons = u.neurons; r.usage_note = u.note;
  if (body.mode === 'model') {
    r.outcome = 'real_model_answer';
    r.model = body.model || null;
    r.answer_status = body.answer && body.answer.status;
    r.validator = { passed: true, attempts: body.validation && body.validation.attempts, rejected_attempts: Math.max(0, ((body.validation && body.validation.attempts) || 1) - 1), errors_of_rejected_attempts: 'not returned by the Worker' };
  } else if (body.mode === 'fallback') {
    r.outcome = 'fallback';
    r.fallback_reason = body.fallback && body.fallback.reason_code;
    r.model_invoked = r.fallback_reason === 'no_key' ? 'no' : r.fallback_reason === 'validation_failed' ? 'yes, output rejected' : 'attempted, call failed';
    if (body.validation) r.validator = { passed: false, attempts: body.validation.attempts, rejected_attempts: body.validation.attempts, final_errors: body.validation.errors || [] };
  } else { r.outcome = 'invalid_response'; r.error = 'unknown mode: ' + String(body.mode); }
  return finish(r);
}

function finish(r) {
  if (r.expectation === 'insufficient_evidence') {
    if (r.outcome === 'real_model_answer') r.expectation_met = r.answer_status === 'insufficient_evidence';
    else if (r.outcome === 'fallback') r.expectation_met = 'not applicable (no model judgement; fallback shown)';
    else r.expectation_met = 'not applicable (request failed)';
  } else r.expectation_met = r.outcome === 'real_model_answer' ? 'needs human review' : 'not applicable';
  return r;
}

const QUOTA_REASONS = new Set(['rate_limited']);

export async function runEval(opts, deps = {}) {
  const fetchImpl = deps.fetchImpl || fetch;
  const sleep = deps.sleep || ((ms) => new Promise((res) => setTimeout(res, ms)));
  const now = deps.now || (() => Date.now());
  const log = deps.log || (() => {});
  const plan = planRequests(opts);
  const report = { script: 'si/worker/scripts/real_eval.mjs', script_version: SCRIPT_VERSION, started_at: new Date(now()).toISOString(), target: opts.url, target_is_local: isLocal(opts.url),
    parameters: { reps: opts.reps, questions: opts.selected.map((q) => q.id), max_requests: opts.maxRequests, delay_ms: opts.delayMs, timeout_ms: opts.timeoutMs, stop_after_quota: opts.stopAfterQuota },
    planned_requests: plan.length, health: null, aborted: null, results: [] };
  if (plan.length > opts.maxRequests) {
    report.aborted = `budget guard: ${plan.length} requests planned (questions x reps) but --max-requests is ${opts.maxRequests}. Nothing was sent.`;
    return finalize(report, now);
  }
  const h = await timedFetch(fetchImpl, opts.url + '/v1/health', { method: 'GET' }, opts.timeoutMs, now);
  let hb = null; if (h.ok) { try { hb = JSON.parse(h.text); } catch { /* raw */ } }
  report.health = h.ok ? { http_status: h.status, body: hb, raw_body: hb ? undefined : h.text, latency_ms: h.ms } : { error: h.error, latency_ms: h.ms };
  if (!h.ok || h.status !== 200 || !hb || hb.ok !== true) { report.aborted = 'health check failed; no questions were sent'; return finalize(report, now); }
  if (hb.store_sha256 !== EXPECTED_STORE_SHA256) report.store_mismatch = `Worker reports store ${hb.store_sha256}, expected ${EXPECTED_STORE_SHA256}`;
  if (!hb.model_configured && !opts.allowUnconfigured) { report.aborted = 'the Worker reports model_configured=false, so every answer would be an evidence-only fallback; no questions were sent (use --allow-unconfigured to record fallbacks anyway)'; return finalize(report, now); }
  let quotaStreak = 0;
  for (let i = 0; i < plan.length; i++) {
    const q = plan[i];
    if (i > 0 && opts.delayMs > 0) await sleep(opts.delayMs);
    const attempts = [];
    for (let k = 0; k <= opts.max429Retries; k++) {
      const a = await timedFetch(fetchImpl, opts.url + '/v1/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q.text }) }, opts.timeoutMs, now);
      attempts.push(a.ok ? { http_status: a.status, retry_after: a.retryAfter, ms: a.ms, text: a.text } : { error: a.error, ms: a.ms });
      if (a.ok && a.status === 429 && k < opts.max429Retries) { const wait = (Number(a.retryAfter) || 60) * 1000; log(`${q.id} rep ${q.rep}: HTTP 429, waiting ${wait / 1000}s`); await sleep(wait); continue; }
      break;
    }
    const r = classify(q, { attempts });
    for (const a of r.http_attempts) delete a.text; // full body kept once, in r.body / r.raw_body
    report.results.push(r);
    log(`${q.id} rep ${q.rep}: ${r.outcome}${r.fallback_reason ? ' (' + r.fallback_reason + ')' : ''}${r.http_status ? ' HTTP ' + r.http_status : ''} ${r.latency_ms_total} ms`);
    quotaStreak = r.outcome === 'fallback' && QUOTA_REASONS.has(r.fallback_reason) ? quotaStreak + 1 : 0;
    if (opts.stopAfterQuota > 0 && quotaStreak >= opts.stopAfterQuota && i < plan.length - 1) { report.aborted = `stopped early after ${quotaStreak} consecutive quota/rate-limit fallbacks (daily Workers AI allocation probably used up); ${plan.length - i - 1} request(s) not sent`; break; }
  }
  return finalize(report, now);
}

function pct(arr, p) { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]; }

export function summarize(report) {
  const R = report.results; const c = (f) => R.filter(f).length;
  const fallbackReasons = {}; R.filter((r) => r.outcome === 'fallback').forEach((r) => (fallbackReasons[r.fallback_reason] = (fallbackReasons[r.fallback_reason] || 0) + 1));
  const lat = R.filter((r) => r.outcome === 'real_model_answer' || r.outcome === 'fallback').map((r) => r.latency_ms_last);
  const withUsage = R.filter((r) => r.usage && typeof r.usage === 'object');
  const tok = (k) => withUsage.every((r) => typeof r.usage[k] === 'number') && withUsage.length ? withUsage.reduce((s, r) => s + r.usage[k], 0) : null;
  const ins = R.filter((r) => r.expectation === 'insufficient_evidence' && r.outcome === 'real_model_answer');
  const s = {
    requests_sent: R.length, real_model_answers: c((r) => r.outcome === 'real_model_answer'), fallbacks: c((r) => r.outcome === 'fallback'), fallback_reasons: fallbackReasons,
    http_errors: c((r) => r.outcome === 'http_error'), network_errors: c((r) => r.outcome === 'network_error'), invalid_responses: c((r) => r.outcome === 'invalid_response'),
    http_429_responses: R.reduce((n, r) => n + r.http_attempts.filter((a) => a.http_status === 429).length, 0),
    validator_rejected_attempts_in_model_answers: R.reduce((n, r) => n + (r.outcome === 'real_model_answer' ? r.validator.rejected_attempts : 0), 0),
    validator_final_rejections: c((r) => r.fallback_reason === 'validation_failed'),
    latency_ms: { n: lat.length, p50: pct(lat, 50), p90: pct(lat, 90), max: lat.length ? Math.max(...lat) : null },
    usage: { responses_with_usage: withUsage.length, prompt_tokens: tok('prompt_tokens'), completion_tokens: tok('completion_tokens'), total_tokens: tok('total_tokens'),
      neurons: R.some((r) => typeof r.neurons === 'number') ? R.reduce((n, r) => n + (r.neurons || 0), 0) : null,
      note: 'Totals are sums of values the Worker returned; null means not reported for every response. Neurons are not returned by Workers AI here; check the Cloudflare dashboard (Workers AI usage) for the day of the run.' },
    insufficient_evidence_checks: { model_answers: ins.length, met: ins.filter((r) => r.expectation_met === true).length },
  };
  const reasons = [];
  if (report.aborted && !R.length) reasons.push('run aborted before any question was asked');
  if (s.real_model_answers === 0) reasons.push('no validated model answers were returned');
  let verdict;
  if (reasons.length) verdict = 'INCONCLUSIVE';
  else {
    const fails = [];
    if (s.insufficient_evidence_checks.met < s.insufficient_evidence_checks.model_answers) fails.push('a Q5/Q6 model answer was not insufficient_evidence');
    if ((fallbackReasons.provider_error || 0) > 0) fails.push('fallback caused by provider_error');
    if (s.validator_final_rejections > Math.max(1, Math.floor(R.length / 24))) fails.push('more than 1 validator final rejection per 24 requests');
    if (s.http_errors + s.network_errors + s.invalid_responses > 0) fails.push('HTTP, network or invalid-response errors occurred');
    verdict = fails.length ? 'FAIL' : 'PASS (automated checks only; answers still need scientific review)'; reasons.push(...fails);
  }
  if (report.target_is_local) reasons.push('target is localhost: it may be wrangler dev --remote (real model) or a local mock; the report cannot tell which');
  s.automated_verdict = verdict; s.verdict_notes = reasons;
  return s;
}

function finalize(report, now) { report.finished_at = new Date(now()).toISOString(); report.summary = summarize(report); return report; }

const esc = (s) => String(s == null ? '' : s).replace(/\|/g, '\\|').replace(/\n/g, ' ');
export function renderMarkdown(rep) {
  const s = rep.summary; const hb = rep.health && rep.health.body; const L = [];
  L.push('# SI real-model evaluation report', '');
  L.push('> Generated by `si/worker/scripts/real_eval.mjs` from actual HTTP responses of the target Worker. Nothing in this report is estimated or edited.');
  L.push('> **Real model answer** = the Worker returned `mode: "model"` (Workers AI output that passed the code validator). **Fallback** = evidence-only response; no AI-generated text was shown.', '');
  L.push('| Item | Value |', '|---|---|');
  L.push(`| Target | ${esc(rep.target)}${rep.target_is_local ? ' (**localhost: may be a mock or wrangler dev**)' : ''} |`);
  L.push(`| Started / finished (UTC) | ${rep.started_at} / ${rep.finished_at} |`);
  L.push(`| Health | ${rep.health ? (rep.health.error ? 'error: ' + esc(rep.health.error) : 'HTTP ' + rep.health.http_status) : 'not checked'} |`);
  if (hb) L.push(`| Provider / model (declared by Worker) | ${esc(hb.provider)} / ${esc(hb.model)} (model_configured: ${hb.model_configured}) |`, `| Evidence store served | \`${esc(hb.store_sha256)}\`${hb.store_sha256 === EXPECTED_STORE_SHA256 ? ' (matches v1.1)' : ' (**does not match v1.1**)'} |`);
  L.push(`| Parameters | questions ${rep.parameters.questions.join(',')}; reps ${rep.parameters.reps}; delay ${rep.parameters.delay_ms} ms; max requests ${rep.parameters.max_requests} |`);
  if (rep.aborted) L.push(`| **Aborted / stopped** | ${esc(rep.aborted)} |`);
  L.push('', '## Summary', '');
  L.push(`**Automated verdict: ${s.automated_verdict}**`, '');
  s.verdict_notes.forEach((n) => L.push(`- ${n}`));
  L.push('', '| Measure | Value |', '|---|---|');
  L.push(`| Requests sent | ${s.requests_sent} of ${rep.planned_requests} planned |`, `| Real model answers | ${s.real_model_answers} |`,
    `| Fallbacks (evidence only) | ${s.fallbacks}${Object.keys(s.fallback_reasons).length ? ' (' + Object.entries(s.fallback_reasons).map(([k, v]) => k + ': ' + v).join(', ') + ')' : ''} |`,
    `| HTTP errors / network errors / invalid responses | ${s.http_errors} / ${s.network_errors} / ${s.invalid_responses} |`, `| HTTP 429 responses (retried) | ${s.http_429_responses} |`,
    `| Validator: rejected attempts inside model answers / final rejections | ${s.validator_rejected_attempts_in_model_answers} / ${s.validator_final_rejections} |`,
    `| Q5/Q6 model answers with status insufficient_evidence | ${s.insufficient_evidence_checks.met} of ${s.insufficient_evidence_checks.model_answers} |`,
    `| Latency (last attempt, ms) p50 / p90 / max | ${s.latency_ms.p50 ?? 'n/a'} / ${s.latency_ms.p90 ?? 'n/a'} / ${s.latency_ms.max ?? 'n/a'} |`,
    `| Tokens prompt / completion / total | ${s.usage.prompt_tokens ?? 'not reported'} / ${s.usage.completion_tokens ?? 'not reported'} / ${s.usage.total_tokens ?? 'not reported'} (from ${s.usage.responses_with_usage} responses) |`,
    `| Neurons | ${s.usage.neurons ?? 'not reported by the API'} |`, '', `_${s.usage.note}_`, '');
  L.push('## Per request', '', '| Q | Rep | Outcome | HTTP | Model status | Validator attempts | Latency ms | Tokens (total) | Expectation |', '|---|---|---|---|---|---|---|---|---|');
  for (const r of rep.results) L.push(`| ${r.question_id} | ${r.rep} | ${r.outcome === 'real_model_answer' ? '**REAL MODEL ANSWER**' : r.outcome === 'fallback' ? 'FALLBACK (' + esc(r.fallback_reason) + ')' : esc(r.outcome.toUpperCase())} | ${r.http_attempts.map((a) => a.http_status || 'ERR').join(',')} | ${esc(r.answer_status || '')} | ${r.validator ? r.validator.attempts : ''} | ${r.latency_ms_total} | ${r.usage && typeof r.usage.total_tokens === 'number' ? r.usage.total_tokens : 'not reported'} | ${esc(r.expectation_met)} |`);
  L.push('', '## Complete responses', '');
  for (const r of rep.results) {
    L.push(`### ${r.question_id} (rep ${r.rep}): ${r.outcome === 'real_model_answer' ? 'REAL MODEL ANSWER' : r.outcome === 'fallback' ? 'FALLBACK, no AI text' : r.outcome.toUpperCase()}`, '', `**Question:** ${r.question}`, '');
    if (r.error) L.push(`**Error:** ${esc(r.error)}`, '');
    const b = r.body;
    if (r.outcome === 'real_model_answer') {
      const a = b.answer || {};
      L.push(`Model: ${esc(r.model && r.model.provider)} / ${esc(r.model && r.model.name)}. Status: \`${esc(a.status)}\`.`, '', `**Direct answer:** ${a.direct_answer}`, '');
      if (a.insufficient_evidence_reason) L.push(`**Insufficient-evidence reason:** ${a.insufficient_evidence_reason}`, '');
      for (const [k, title] of [['key_findings', 'Key findings'], ['experimental_conditions', 'Experimental conditions'], ['limitations', 'Limitations']]) {
        if (Array.isArray(a[k]) && a[k].length) { L.push(`**${title}:**`); a[k].forEach((f) => L.push(`- ${f.evidence_class ? '[' + f.evidence_class + '] ' : ''}${f.text} (${(f.citations || []).join(', ')})`)); L.push(''); }
      }
      if (Array.isArray(a.supporting_investigations) && a.supporting_investigations.length) { L.push('**Supporting investigations:**'); a.supporting_investigations.forEach((s2) => L.push(`- ${s2.investigation_id}: ${s2.role}${s2.record_ids && s2.record_ids.length ? ' (' + s2.record_ids.join(', ') + ')' : ''}`)); L.push(''); }
    } else if (r.outcome === 'fallback') {
      L.push(`Reason: \`${esc(r.fallback_reason)}\`. Model invoked: ${r.model_invoked}. ${esc(b.message)}`, '');
      if (r.validator && r.validator.final_errors && r.validator.final_errors.length) { L.push('**Validator errors on the final attempt:**'); r.validator.final_errors.forEach((e) => L.push(`- ${e}`)); L.push(''); }
    }
    L.push('<details><summary>Full response body</summary>', '', '```json', b ? JSON.stringify(b, null, 2) : String(r.raw_body ?? '(none)'), '```', '', '</details>', '');
  }
  return L.join('\n');
}

// A run that sent no questions never overwrites test/real_eval_report.*: it goes to real_eval_report.aborted.*
export async function writeReport(report, outDir) {
  await mkdir(outDir, { recursive: true });
  const base = report.results.length ? 'real_eval_report' : 'real_eval_report.aborted';
  const j = path.join(outDir, base + '.json'), m = path.join(outDir, base + '.md');
  await writeFile(j, JSON.stringify(report, null, 2) + '\n'); await writeFile(m, renderMarkdown(report) + '\n');
  return { json: j, md: m };
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2), process.env); } catch (e) { console.error('error: ' + e.message); process.exit(2); }
  const outDir = opts.outDir || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'test');
  const plan = planRequests(opts);
  console.log(`SI real-model evaluation: ${plan.length} request(s) to ${opts.url} (up to ${plan.length * 2} model calls), about ${Math.round((plan.length - 1) * opts.delayMs / 1000)} s of pacing.`);
  const report = await runEval(opts, { log: (m) => console.log(m) });
  if (report.aborted && /^budget guard/.test(report.aborted)) { console.error(report.aborted + ' Raise --max-requests if you really want this many.'); process.exit(2); }
  const files = await writeReport(report, outDir);
  console.log(`\n${report.summary.automated_verdict}`); report.summary.verdict_notes.forEach((n) => console.log(' - ' + n));
  console.log(`report: ${files.md}\n        ${files.json}`);
  if (report.aborted) console.log('aborted/stopped: ' + report.aborted);
  process.exit(report.aborted && !report.results.length ? (/budget/.test(report.aborted) ? 2 : 3) : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
