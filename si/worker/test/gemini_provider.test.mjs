// Gemini as the live provider (SI_PROVIDER = "gemini"). Every Gemini call here is a MOCK fetch: no network, no key, no quota.
// Run: npm test   (from si/worker)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleAsk, handleRequest } from '../src/core.js';

const KEY = 'TEST-SENTINEL-KEY-do-not-leak-123';
const Q2 = 'What does SAFFIRE-II show about the burning behavior of the tested materials?';
const Q5 = 'Is there actual partial-gravity combustion data in the current PSI evidence store?';
const GOOD = { status: 'answered', direct_answer: 'SAFFIRE-II burned one sample per condition; PMMA sample 2-8 burned for 600 s.',
  key_findings: [{ text: 'Sample 2-8 (PMMA) has a burn time of 600 s.', evidence_class: 'measured_data', citations: ['PSI-99:sample:2-8'] }],
  supporting_investigations: [{ investigation_id: 'PSI-99', role: 'Solid-sample burns', record_ids: ['PSI-99:sample:2-8'] }], experimental_conditions: [],
  limitations: [{ text: 'One sample per condition.', citations: ['LIM-010'] }], insufficient_evidence_reason: '' };
const BAD_CITE = { ...GOOD, key_findings: [{ text: 'Sample 2-8 burned.', evidence_class: 'measured_data', citations: ['PSI-99:sample:INVENTED'] }] };
const gem = (obj) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 1234 } } });
function mockFetch(steps) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const s = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (s === 'hang') return new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    return new Response(JSON.stringify(s.body), { status: s.status });
  };
  f.calls = calls; return f;
}
const workersAiSpy = () => { const s = { n: 0, run: async () => { s.n++; throw new Error('should not be called'); } }; return s; };
const env = (extra = {}) => ({ SI_PROVIDER: 'gemini', GEMINI_MODEL: 'gemini-2.5-flash', GEMINI_API_KEY: KEY, AI: workersAiSpy(), ...extra });
async function quiet(fn) { const lines = [], o = console.log; console.log = (x) => lines.push(String(x)); try { return { r: await fn(), lines }; } finally { console.log = o; } }

test('deployment config: Gemini is the live provider with gemini-2.5-flash; no key in the repository', async () => {
  const t = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(t, /^SI_PROVIDER = "gemini"$/m); assert.match(t, /^GEMINI_MODEL = "gemini-2\.5-flash"$/m);
  assert.doesNotMatch(t, /^\s*GEMINI_API_KEY\s*=/m);
});

test('success: a valid Gemini answer is validated, scored and labelled as Gemini; the request is built server-side', async () => {
  const f = mockFetch([gem(GOOD)]); const e = env();
  const { r, lines } = await quiet(() => handleAsk(Q2, e, { fetchImpl: f }));
  assert.equal(r.mode, 'model'); assert.deepEqual(r.model, { provider: 'gemini', name: 'gemini-2.5-flash' });
  assert.equal(r.validation.attempts, 1); assert.ok(r.evidence_support && r.evidence_support.level);
  assert.equal(f.calls.length, 1); assert.equal(e.AI.n, 0, 'Workers AI is never called');
  const c = f.calls[0];
  assert.equal(c.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
  assert.ok(!c.url.includes(KEY), 'key is not in the URL'); assert.equal(c.init.headers['x-goog-api-key'], KEY);
  assert.equal(c.body.generationConfig.responseMimeType, 'application/json'); assert.ok(c.body.generationConfig.responseSchema.properties.key_findings);
  assert.deepEqual(c.body.generationConfig.thinkingConfig, { thinkingBudget: 0 });
  assert.match(c.body.systemInstruction.parts[0].text, /^You are the Scientific Intelligence/); assert.match(c.body.contents[0].parts[0].text, /^EVIDENCE PACK/);
  assert.ok(!JSON.stringify(r).includes(KEY) && !lines.join('\n').includes(KEY), 'key never in the response or logs');
});

test('insufficient-evidence class: the Gemini schema narrows status to insufficient_evidence / partial', async () => {
  const f = mockFetch([gem('not json')]); await quiet(() => handleAsk(Q5, env(), { fetchImpl: f }));
  assert.deepEqual(f.calls[0].body.generationConfig.responseSchema.properties.status.enum, ['partial', 'insufficient_evidence']);
});

test('malformed output: non-JSON twice -> evidence-only fallback (validation_failed), two calls at most', async () => {
  const f = mockFetch([gem('Here is my answer: SAFFIRE...')]);
  const { r } = await quiet(() => handleAsk(Q2, env(), { fetchImpl: f }));
  assert.equal(r.mode, 'fallback'); assert.equal(r.fallback.reason_code, 'validation_failed'); assert.equal(f.calls.length, 2);
  assert.match(r.fallback.generated_by, /No AI model was used/);
});

test('validator rejection is never bypassed: an invented citation is rejected; a corrected retry is served', async () => {
  const f1 = mockFetch([gem(BAD_CITE)]); const { r: a } = await quiet(() => handleAsk(Q2, env(), { fetchImpl: f1 }));
  assert.equal(a.mode, 'fallback'); assert.ok(a.validation.errors.some((x) => /citation not in evidence pack: PSI-99:sample:INVENTED/.test(x)));
  const f2 = mockFetch([gem(BAD_CITE), gem(GOOD)]); const { r: b } = await quiet(() => handleAsk(Q2, env(), { fetchImpl: f2 }));
  assert.equal(b.mode, 'model'); assert.equal(b.validation.attempts, 2);
  assert.match(f2.calls[1].body.systemInstruction.parts[0].text, /previous answer was rejected by the verifier/);
});

test('missing secret: evidence-only fallback, no Gemini call and no Workers AI call', async () => {
  const f = mockFetch([gem(GOOD)]); const e = env({ GEMINI_API_KEY: undefined });
  const { r } = await quiet(() => handleAsk(Q2, e, { fetchImpl: f }));
  assert.equal(r.mode, 'fallback'); assert.equal(r.fallback.reason_code, 'no_key'); assert.equal(f.calls.length, 0); assert.equal(e.AI.n, 0);
  const h = await (await handleRequest(new Request('http://w/v1/health'), e)).json();
  assert.equal(h.provider, 'gemini'); assert.equal(h.model_configured, false);
  const h2 = await (await handleRequest(new Request('http://w/v1/health'), env())).json(); assert.equal(h2.model_configured, true);
  assert.ok(!JSON.stringify(h2).includes(KEY));
});

test('rate limit (HTTP 429): one call, evidence-only fallback, quota message, status code only in diagnostics', async () => {
  const f = mockFetch([{ status: 429, body: { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'quota detail mentioning ' + KEY } } }]);
  const { r, lines } = await quiet(() => handleAsk(Q2, env(), { fetchImpl: f }));
  assert.equal(r.fallback.reason_code, 'rate_limited'); assert.equal(f.calls.length, 1); assert.equal(r.diagnostics.http_status, 429);
  assert.match(r.message, /allowance is used up/);
  assert.ok(!JSON.stringify(r).includes(KEY) && !lines.join('\n').includes(KEY) && !JSON.stringify(r).includes('RESOURCE_EXHAUSTED'));
});

test('timeout: the request is aborted at the per-call limit; evidence-only fallback with timing', async () => {
  const f = mockFetch(['hang']);
  const t = Date.now(); const { r } = await quiet(() => handleAsk(Q2, env({ SI_MODEL_TIMEOUT_MS: '60' }), { fetchImpl: f }));
  assert.equal(r.fallback.reason_code, 'timeout'); assert.equal(r.diagnostics.source, 'worker_wait_limit'); assert.ok(Date.now() - t < 1000);
  assert.equal(f.calls.length, 1, 'no retry after a timeout');
});

test('blocked or empty Gemini candidates and server errors fall back cleanly', async () => {
  const blocked = mockFetch([{ status: 200, body: { promptFeedback: { blockReason: 'SAFETY' }, candidates: [] } }]);
  assert.equal((await quiet(() => handleAsk(Q2, env(), { fetchImpl: blocked }))).r.fallback.reason_code, 'invalid_response');
  const s500 = mockFetch([{ status: 503, body: { error: { message: 'overloaded' } } }]);
  const { r } = await quiet(() => handleAsk(Q2, env(), { fetchImpl: s500 }));
  assert.equal(r.fallback.reason_code, 'provider_error'); assert.equal(r.diagnostics.http_status, 503); assert.match(r.message, /service returned an error/);
  const auth = mockFetch([{ status: 403, body: {} }]);
  assert.equal((await quiet(() => handleAsk(Q2, env(), { fetchImpl: auth }))).r.fallback.reason_code, 'auth_error');
});
