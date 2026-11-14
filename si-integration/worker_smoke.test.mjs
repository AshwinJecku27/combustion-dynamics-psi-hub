// Integration smoke tests for the SI release candidate Worker (si-release/si-api).
// Written during repository integration; they are NOT the release candidate's own
// test suite (test/si.test.js was not included in the supplied ZIP).
// They import the release-candidate code unmodified and use a MOCK env.AI binding.
// No network, no Cloudflare account, no real model. Real inference is NOT tested here.
// Run: node --test si-integration/
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../si-release/si-api/src/core.js';
import B from '../si-release/si-api/src/bundle.js';

const STORE_SHA = 'a77e55486a4d25f0c284c3467b485f9cc3aeded142a285a9e346357870aed548';
let ipN = 0; // core.js rate-limits 6/min per IP; give each request its own IP
const ask = (env, question, headers = {}) => handleRequest(new Request('http://w/v1/ask', {
  method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.0.0.${++ipN}`, ...headers }, body: JSON.stringify({ question }) }), env);
const baseEnv = { SI_PROVIDER: 'workers_ai', WORKERS_AI_MODEL: '@cf/meta/llama-3.3-70b-instruct-fp8-fast' };

test('bundle pins evidence store v1.1 and keeps key qualifications', () => {
  assert.equal(B.store_version, '1.1');
  assert.equal(B.store_sha256, STORE_SHA);
  assert.deepEqual(B.investigations.map((i) => i.id).sort(), ['PSI-10', 'PSI-101', 'PSI-159', 'PSI-69', 'PSI-98', 'PSI-99']);
  for (const i of B.investigations) assert.equal(i.partial_gravity_data.present, false, i.id);
  const lim = Object.fromEntries(B.limitations.map((l) => [l.id, l]));
  assert.match(lim['LIM-001'].title, /No partial-gravity/);
  assert.match(lim['LIM-008'].title, /thickness unit/);   // PSI-98 thickness unit unresolved
  assert.match(lim['LIM-008'].interpretation_boundary, /Do not convert/);
  assert.match(lim['LIM-009'].title, /CSV and DoD disagree/); // SAFFIRE-II discrepancies
  assert.match(lim['LIM-012'].title, /'CO' column is not defined/); // FLEX CO ambiguity
  assert.match(lim['LIM-015'].title, /no demonstrated suppressant efficacy/);
  assert.match(lim['LIM-019'].title, /no detector performance/);
});

test('health without AI binding reports not configured', async () => {
  const r = await handleRequest(new Request('http://w/v1/health'), baseEnv);
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.provider, 'workers_ai');
  assert.equal(j.model_configured, false);
  assert.equal(j.store_sha256, STORE_SHA);
});

test('no AI binding -> evidence-only fallback, labelled as not AI', async () => {
  const j = await (await ask(baseEnv, 'What does FLEX tell us about fire suppression?')).json();
  assert.equal(j.mode, 'fallback');
  assert.equal(j.fallback.reason_code, 'no_key');
  assert.match(j.message, /not an AI answer/);
  assert.match(j.fallback.generated_by, /No AI model was used/);
});

test('partial-gravity data question -> fallback note cites LIM-001', async () => {
  const j = await (await ask(baseEnv, 'Is there any actual lunar gravity combustion data available?')).json();
  assert.equal(j.mode, 'fallback');
  assert.match(j.fallback.note, /LIM-001/);
});

test('mock model returning invalid output twice -> validation_failed fallback', async () => {
  let calls = 0;
  const env = { ...baseEnv, AI: { run: async () => { calls++; return { response: 'not json' }; } } };
  const j = await (await ask(env, 'What does SAME-R tell us about smoke?')).json();
  assert.equal(calls, 2);
  assert.equal(j.mode, 'fallback');
  assert.equal(j.fallback.reason_code, 'validation_failed');
});

test('mock model citing an id outside the evidence pack is rejected', async () => {
  const bad = { status: 'answered', direct_answer: 'FLEX droplets burned in many atmospheres.', key_findings: [{ text: 'x', evidence_class: 'measured_data', citations: ['PSI-69:row:INVENTED'] }],
    supporting_investigations: [], experimental_conditions: [], limitations: [{ text: 'y', citations: ['LIM-999'] }], insufficient_evidence_reason: '' };
  const env = { ...baseEnv, AI: { run: async () => ({ response: bad }) } };
  const j = await (await ask(env, 'What does FLEX tell us about droplet burning?')).json();
  assert.equal(j.mode, 'fallback');
  assert.ok(j.validation.errors.some((e) => /citation not in evidence pack/.test(e)));
});

test('mock model failure -> provider_error / rate_limited fallback', async () => {
  const env1 = { ...baseEnv, AI: { run: async () => { throw new Error('boom'); } } };
  assert.equal((await (await ask(env1, 'What does FLEX tell us?')).json()).fallback.reason_code, 'provider_error');
  const env2 = { ...baseEnv, AI: { run: async () => { throw new Error('4006: daily free allocation of neurons exceeded'); } } };
  assert.equal((await (await ask(env2, 'What does FLEX tell us?')).json()).fallback.reason_code, 'rate_limited');
});

test('json_schema rejection is retried without response_format', async () => {
  const seen = [];
  const env = { ...baseEnv, AI: { run: async (_m, inp) => { seen.push(!!inp.response_format); if (inp.response_format) throw new Error("JSON Mode couldn't be met"); return { response: 'nope' }; } } };
  await ask(env, 'What does FLEX tell us?');
  assert.deepEqual(seen.slice(0, 2), [true, false]);
});

test('HTTP guards: CORS origin, bad input, unknown path', async () => {
  const env = { ...baseEnv, ALLOWED_ORIGIN: 'https://example.github.io' };
  assert.equal((await ask(env, 'What does FLEX tell us?', { origin: 'https://evil.example' })).status, 403);
  const ok = await ask(env, 'What does FLEX tell us?', { origin: 'https://example.github.io' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://example.github.io');
  assert.equal((await ask(baseEnv, 'hi')).status, 400);
  assert.equal((await handleRequest(new Request('http://w/nope'), baseEnv)).status, 404);
});
