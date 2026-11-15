// Regression tests for the public Ask SI timeout investigation (real-model evaluation #6 on the deployed PR #7 Worker:
// 3/6 AI answers, Q2 hit the Worker's own 25 s wait limit, Q1/Q4 rejected twice, latency about doubled versus #5).
// No network, no real model: Workers AI is a MOCK. Run: npm test   (from si/worker)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handleAsk, SYSTEM, fallbackMessage } from '../src/core.js';

const Q2 = 'What does SAFFIRE-II show about the burning behavior of the tested materials?';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = (run, extra = {}) => ({ SI_PROVIDER: 'workers_ai', SI_MODEL_TIMEOUT_MS: '80', SI_REQUEST_DEADLINE_MS: '1000', AI: { run }, ...extra });
const GOOD = { status: 'answered', direct_answer: 'SAFFIRE-II burned one sample per condition; PMMA sample 2-8 burned for 600 s.',
  key_findings: [{ text: 'Sample 2-8 (PMMA) has a burn time of 600 s.', evidence_class: 'measured_data', citations: ['PSI-99:sample:2-8'] }],
  supporting_investigations: [{ investigation_id: 'PSI-99', role: 'Solid-sample burns', record_ids: ['PSI-99:sample:2-8'] }], experimental_conditions: [],
  limitations: [{ text: 'One sample per condition.', citations: ['LIM-010'] }], insufficient_evidence_reason: '' };
async function captureLogs(fn) { const lines = [], orig = console.log; console.log = (s) => lines.push(String(s)); try { return { result: await fn(), lines }; } finally { console.log = orig; } }

test('prompt is the exact text that passed 6/6 in real-model evaluation #5 (PR #7 explanation rule reverted)', () => {
  assert.equal(createHash('sha256').update(SYSTEM).digest('hex'), '3f0cfe1d9d2b2b5ae1424f5cdd0d44d752bdcaf47c3027f0f042a57005655f97');
  assert.doesNotMatch(SYSTEM, /Explain, do not only list/);
});

test('Worker wait limit: timeout fallback reports source, phase, elapsed time and limit; the user message says what happened', async () => {
  const { result: r, lines } = await captureLogs(() => handleAsk(Q2, env(() => new Promise(() => {}))));
  assert.equal(r.mode, 'fallback'); assert.equal(r.fallback.reason_code, 'timeout');
  const d = r.diagnostics;
  assert.equal(d.source, 'worker_wait_limit'); assert.equal(d.phase, 'json_schema'); assert.equal(d.wait_limit_ms, 80); assert.equal(d.attempt, 1);
  assert.ok(d.elapsed_ms >= 70 && d.elapsed_ms < 400, String(d.elapsed_ms)); assert.equal(d.upstream_error_code, null);
  assert.match(r.message, /did not finish its answer within the time limit/);
  assert.match(r.message, /retrieved evidence below is unaffected; you can ask again\. This is not an AI answer\./);
  assert.ok(r.fallback.retrieved.passages.length > 0, 'evidence-only fallback preserved');
  const log = JSON.parse(lines.find((l) => l.includes('si_ai_fallback')));
  assert.equal(log.reason, 'timeout'); assert.equal(log.source, 'worker_wait_limit'); assert.ok(log.prompt_chars > 1000);
});

test('Workers AI-reported timeout and quota errors are distinguished from the Worker wait limit, with the numeric code only', async () => {
  const t = await handleAsk(Q2, env(async () => { throw new Error('AiError: 3046: Request timeout (secret-ish upstream detail)'); }));
  assert.equal(t.fallback.reason_code, 'timeout'); assert.equal(t.diagnostics.source, 'workers_ai_error'); assert.equal(t.diagnostics.upstream_error_code, '3046');
  assert.match(t.message, /model service reported a timeout/);
  assert.ok(!JSON.stringify(t).includes('secret-ish'), 'raw provider message is never returned');
  const q = await handleAsk(Q2, env(async () => { throw new Error('4006: daily free allocation of neurons exceeded'); }));
  assert.equal(q.fallback.reason_code, 'rate_limited'); assert.equal(q.diagnostics.upstream_error_code, '4006'); assert.match(q.message, /allowance is used up/);
});

test('schema rejected, then the schema-less call times out: phase and schema time are reported (shared budget is visible)', async () => {
  const r = await handleAsk(Q2, env(async (_m, inp) => { if (inp.response_format) { await sleep(50); throw new Error("JSON Mode couldn't be met"); } return new Promise(() => {}); }));
  assert.equal(r.diagnostics.phase, 'plain_after_schema_rejected'); assert.ok(r.diagnostics.schema_attempt_ms >= 40);
  assert.ok(r.diagnostics.elapsed_ms < 400, 'both calls together stay within one per-call budget');
});

test('diagnostics never contain the question, prompt or evidence text', async () => {
  const q = 'What does SAFFIRE-II show about PMMA burning in my private test?';
  const { result: r, lines } = await captureLogs(() => handleAsk(q, env(() => new Promise(() => {}))));
  for (const s of [JSON.stringify(r.diagnostics), ...lines]) { assert.ok(!s.includes('private test')); assert.ok(!s.includes('EVIDENCE PACK')); assert.ok(!s.includes('PSI-99:sample')); }
});

test('successful answers log latency and usage (no text); a slow-but-in-time model answer is served', async () => {
  const { result: r, lines } = await captureLogs(() => handleAsk(Q2, env(async () => { await sleep(40); return { response: GOOD, usage: { total_tokens: 9 } }; })));
  assert.equal(r.mode, 'model'); assert.equal(r.validation.attempts, 1);
  const log = JSON.parse(lines.find((l) => l.includes('si_ai_answer')));
  assert.equal(log.attempts, 1); assert.ok(log.latency_ms >= 30); assert.deepEqual(log.usage, { total_tokens: 9 });
  assert.ok(!lines.join('\n').includes('PMMA'), 'no answer text in logs');
});

test('fallback messages are specific per reason', () => {
  assert.match(fallbackMessage('timeout', { source: 'worker_wait_limit', wait_limit_ms: 25000 }), /within the 25-second time limit/);
  assert.match(fallbackMessage('provider_error'), /service returned an error/);
  assert.match(fallbackMessage('no_key'), /could not be used \(no_key\)/);
});
