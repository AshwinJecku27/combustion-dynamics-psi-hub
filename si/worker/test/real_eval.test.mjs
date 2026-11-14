// Tests for scripts/real_eval.mjs. No network beyond 127.0.0.1, no Cloudflare account, no real model.
// Everything labelled "model" here comes from a MOCK env.AI binding and proves only that the script records
// and labels responses correctly. Run: node --test test/   (from si/worker) or npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { handleRequest } from '../src/core.js';
import { QUESTIONS, EXPECTED_STORE_SHA256, parseArgs, selectQuestions, planRequests, runEval, classify, extractUsage, summarize, renderMarkdown, writeReport } from '../scripts/real_eval.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'real_eval.mjs');
const noSleep = async () => {};
const insufficient = { status: 'insufficient_evidence', direct_answer: 'The evidence store contains no partial-gravity combustion data, so this cannot be answered.', key_findings: [], supporting_investigations: [], experimental_conditions: [],
  limitations: [{ text: 'No partial-gravity data in any integrated investigation.', citations: ['LIM-001'] }], insufficient_evidence_reason: 'No lunar or Martian gravity combustion data exist in the supplied files.' };

// Serves the real Worker code (src/core.js) with a configurable env on 127.0.0.1.
async function serveWorker(env) {
  const srv = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = req.method === 'POST' ? Buffer.concat(chunks) : undefined;
    const r = await handleRequest(new Request('http://127.0.0.1' + req.url, { method: req.method, headers: { ...req.headers, 'cf-connecting-ip': String(Math.random()) }, body }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  return { url: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((ok) => srv.close(ok)) };
}
// Scripted fake fetch: a list of handlers consumed in order per path.
function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    const p = new URL(url).pathname; calls.push({ path: p, init });
    const q = routes[p]; if (!q || !q.length) throw new Error('unexpected call ' + p);
    const step = q.length > 1 ? q.shift() : q[0];
    if (step instanceof Error) throw step;
    return new Response(typeof step.body === 'string' ? step.body : JSON.stringify(step.body), { status: step.status || 200, headers: step.headers || {} });
  };
  f.calls = calls; return f;
}
const health = (o = {}) => ({ body: { ok: true, store_sha256: EXPECTED_STORE_SHA256, bundle_version: '1.0', model_configured: true, provider: 'workers_ai', model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', ...o } });
const base = (extra = {}) => ({ ...parseArgs(['--url', 'https://psi-si-api.example.workers.dev']), delayMs: 0, ...extra });

test('the six questions are exactly the dashboard example questions (si/dashboard/si.html EX)', async () => {
  const html = await readFile(path.join(HERE, '..', '..', 'dashboard', 'si.html'), 'utf8');
  const m = html.match(/const EX=(\[[^\]]*\]);/); assert.ok(m, 'EX array found');
  assert.deepEqual(QUESTIONS.map((q) => q.text), JSON.parse(m[1].replace(/'/g, '"')));
  assert.deepEqual(QUESTIONS.filter((q) => q.expect === 'insufficient_evidence').map((q) => q.id), ['Q5', 'Q6']);
});

test('argument parsing and allowance guard', () => {
  assert.throws(() => parseArgs([]), /Worker URL/);
  assert.throws(() => parseArgs(['--url', 'https://x.dev/path']), /origin/);
  assert.throws(() => parseArgs(['--url', 'https://x.dev', '--bogus']), /unknown argument/);
  const o = parseArgs(['3'], { SI_URL: 'http://localhost:8787/' });
  assert.equal(o.url, 'http://localhost:8787'); assert.equal(o.reps, 3); assert.equal(o.maxRequests, 6); assert.equal(o.delayMs, 11000);
  assert.deepEqual(selectQuestions('5,q6').map((q) => q.id), ['Q5', 'Q6']);
  assert.throws(() => selectQuestions('7'), /unknown question/);
  assert.equal(planRequests({ reps: 2, selected: selectQuestions('1,2') }).length, 4);
});

test('budget guard refuses before any network call', async () => {
  const f = fakeFetch({});
  const rep = await runEval(base({ reps: 2 }), { fetchImpl: f, sleep: noSleep });
  assert.equal(f.calls.length, 0); assert.match(rep.aborted, /budget guard/); assert.equal(rep.summary.automated_verdict, 'INCONCLUSIVE');
});

test('model not configured: aborts after health only, unless --allow-unconfigured', async () => {
  const f = fakeFetch({ '/v1/health': [health({ model_configured: false })] });
  const rep = await runEval(base(), { fetchImpl: f, sleep: noSleep });
  assert.deepEqual(f.calls.map((c) => c.path), ['/v1/health']); assert.match(rep.aborted, /model_configured=false/);
});

test('end to end against the real Worker code with NO AI binding: all fallbacks, verdict INCONCLUSIVE', async () => {
  const w = await serveWorker({ SI_PROVIDER: 'workers_ai' });
  try {
    const rep = await runEval({ ...parseArgs(['--url', w.url, '--allow-unconfigured']), delayMs: 0 }, { sleep: noSleep });
    assert.equal(rep.results.length, 6);
    assert.ok(rep.results.every((r) => r.outcome === 'fallback' && r.fallback_reason === 'no_key' && r.model_invoked === 'no'));
    assert.equal(rep.summary.real_model_answers, 0); assert.equal(rep.summary.automated_verdict, 'INCONCLUSIVE');
    assert.ok(rep.summary.verdict_notes.some((n) => /no validated model answers/.test(n)));
    assert.ok(rep.target_is_local);
    assert.ok(rep.results.every((r) => r.usage === null && r.neurons === null && /not reported/.test(r.usage_note)), 'usage never invented');
    const md = renderMarkdown(rep);
    assert.match(md, /FALLBACK \(no_key\)/); assert.doesNotMatch(md, /REAL MODEL ANSWER/); assert.match(md, /localhost: may be a mock/);
  } finally { await w.close(); }
});

test('end to end with a MOCK AI binding: model answers recorded with usage copied verbatim', async () => {
  let calls = 0;
  const env = { SI_PROVIDER: 'workers_ai', AI: { run: async () => { calls++; return { response: insufficient, usage: { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050 } }; } } };
  const w = await serveWorker(env);
  try {
    const rep = await runEval({ ...parseArgs(['--url', w.url, '--questions', '5,6']), delayMs: 0 }, { sleep: noSleep });
    assert.equal(calls, 2);
    assert.ok(rep.results.every((r) => r.outcome === 'real_model_answer' && r.answer_status === 'insufficient_evidence' && r.expectation_met === true));
    assert.equal(rep.summary.usage.total_tokens, 2100); assert.equal(rep.summary.usage.neurons, null);
    assert.equal(rep.summary.insufficient_evidence_checks.met, 2);
    assert.match(rep.summary.automated_verdict, /^PASS/);
    assert.ok(rep.summary.verdict_notes.some((n) => /localhost/.test(n)), 'local target flagged even on PASS');
    assert.match(renderMarkdown(rep), /\*\*REAL MODEL ANSWER\*\*/);
  } finally { await w.close(); }
});

test('validator final rejection is recorded with the final errors', async () => {
  const env = { SI_PROVIDER: 'workers_ai', AI: { run: async () => ({ response: 'not json' }) } };
  const w = await serveWorker(env);
  try {
    const rep = await runEval({ ...parseArgs(['--url', w.url, '--questions', '3']), delayMs: 0 }, { sleep: noSleep });
    const r = rep.results[0];
    assert.equal(r.outcome, 'fallback'); assert.equal(r.fallback_reason, 'validation_failed'); assert.equal(r.model_invoked, 'yes, output rejected');
    assert.equal(r.validator.attempts, 2); assert.deepEqual(r.validator.final_errors, ['response was not valid JSON']);
    assert.equal(rep.summary.validator_final_rejections, 1);
    assert.match(renderMarkdown(rep), /Validator errors on the final attempt/);
  } finally { await w.close(); }
});

test('Q5 model answer that is not insufficient_evidence fails the automated check', () => {
  const r = classify({ ...QUESTIONS[4], rep: 1 }, { attempts: [{ http_status: 200, ms: 5, text: JSON.stringify({ mode: 'model', model: { provider: 'workers_ai', name: 'm' }, answer: { ...insufficient, status: 'answered' }, validation: { passed: true, attempts: 2 } }) }] });
  assert.equal(r.expectation_met, false); assert.equal(r.validator.rejected_attempts, 1);
  const s = summarize({ results: [r], target_is_local: false });
  assert.equal(s.automated_verdict, 'FAIL'); assert.equal(s.validator_rejected_attempts_in_model_answers, 1);
});

test('HTTP 429 is retried after Retry-After; 500, network errors and non-JSON are recorded, not counted as answers', async () => {
  const fb = { body: { mode: 'fallback', fallback: { reason_code: 'provider_error' }, message: 'x' } };
  const f = fakeFetch({ '/v1/health': [health()], '/v1/ask': [{ status: 429, headers: { 'retry-after': '7' }, body: { error: { code: 'rate_limited', message: 'wait' } } }, fb, { status: 500, body: { error: { code: 'internal_error', message: 'Unexpected error.' } } }, new TypeError('fetch failed'), { body: '<html>oops' }, fb] });
  const slept = [];
  const rep = await runEval(base({ delayMs: 11000 }), { fetchImpl: f, sleep: async (ms) => slept.push(ms) });
  assert.deepEqual(rep.results.map((r) => r.outcome), ['fallback', 'http_error', 'network_error', 'invalid_response', 'fallback', 'fallback']);
  assert.deepEqual(rep.results[0].http_attempts.map((a) => a.http_status), [429, 200]);
  assert.ok(slept.includes(7000), 'waited Retry-After'); assert.equal(slept.filter((x) => x === 11000).length, 5, 'paced between requests');
  assert.equal(rep.results[1].error, 'internal_error: Unexpected error.'); assert.match(rep.results[2].error, /fetch failed/);
  assert.equal(rep.results[3].raw_body, '<html>oops');
  const s = rep.summary;
  assert.equal(s.http_429_responses, 1); assert.equal(s.http_errors, 1); assert.equal(s.network_errors, 1); assert.equal(s.invalid_responses, 1); assert.equal(s.real_model_answers, 0);
  assert.equal(s.automated_verdict, 'INCONCLUSIVE');
});

test('stops early when the daily allocation appears exhausted', async () => {
  const q = { body: { mode: 'fallback', fallback: { reason_code: 'rate_limited' }, message: 'x' } };
  const f = fakeFetch({ '/v1/health': [health()], '/v1/ask': [q] });
  const rep = await runEval(base(), { fetchImpl: f, sleep: noSleep });
  assert.equal(rep.results.length, 2); assert.match(rep.aborted, /stopped early.*4 request/);
});

test('usage extraction copies only what is returned', () => {
  assert.deepEqual(extractUsage({ mode: 'fallback' }).usage, null);
  assert.equal(extractUsage({ metrics: { usage: { total_tokens: 5, neurons: 3.2 } } }).neurons, 3.2);
  assert.equal(extractUsage({ metrics: { usage: { total_tokens: 5 } } }).neurons, null);
});

test('reports are written; a run that sent nothing never overwrites real_eval_report.*', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'si-eval-'));
  try {
    const f = fakeFetch({ '/v1/health': [health()], '/v1/ask': [{ body: { mode: 'model', model: { provider: 'workers_ai', name: 'm' }, answer: insufficient, validation: { passed: true, attempts: 1 }, metrics: { latency_ms: 9, usage: null } } }] });
    const rep = await runEval(base({ selected: selectQuestions('5') }), { fetchImpl: f, sleep: noSleep });
    await writeReport(rep, dir);
    const bad = await runEval(base(), { fetchImpl: fakeFetch({ '/v1/health': [new TypeError('fetch failed')] }), sleep: noSleep });
    await writeReport(bad, dir);
    assert.deepEqual((await readdir(dir)).sort(), ['real_eval_report.aborted.json', 'real_eval_report.aborted.md', 'real_eval_report.json', 'real_eval_report.md']);
    const j = JSON.parse(await readFile(path.join(dir, 'real_eval_report.json'), 'utf8'));
    assert.equal(j.results.length, 1); assert.equal(j.results[0].usage, null);
    assert.match(await readFile(path.join(dir, 'real_eval_report.md'), 'utf8'), /Full response body/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CLI: missing URL and budget refusal exit 2 and write nothing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'si-eval-cli-'));
  try {
    assert.equal(spawnSync(process.execPath, [SCRIPT, '--out', dir], { env: {} }).status, 2);
    assert.equal(spawnSync(process.execPath, [SCRIPT, '--url', 'https://x.workers.dev', '--reps', '2', '--out', dir], { env: {} }).status, 2);
    assert.deepEqual(await readdir(dir), []);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
