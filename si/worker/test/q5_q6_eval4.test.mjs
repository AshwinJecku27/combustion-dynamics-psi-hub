// Regression tests for the two failures of real-model evaluation run #4 (main 379b943: Q1-Q4 PASS, Q5 and Q6 FAIL):
//  Q5: "this question class must be reported as insufficient_evidence or partial" (model answered "answered" twice).
//  Q6: "gravity wording: ... mentions lunar gravity without an explicit statement that no such data exist".
// The answer fixtures RECONSTRUCT those failure shapes (the run #4 answer text is not in this repository), plus
// alternate phrasings and misleading negation. No network, no real model: model output is a MOCK.
// Run: npm test   (from si/worker)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPack } from '../src/retrieve.js';
import { validate, repairHints } from '../src/validate.js';
import { handleAsk, SYSTEM, classInstruction, classNote } from '../src/core.js';
import { JSON_SCHEMA, schemaWithStatus } from '../src/provider.js';
import { gravityWordingErrors, statesGravityAbsence } from '../src/grounding.js';
import { QUESTIONS } from '../scripts/real_eval.mjs';

const Q = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.text]));
const check = (qid, ans) => { const { pack, ids, cls } = buildPack(Q[qid]); return validate(ans, { ids, pack, cls, question: Q[qid] }); };
const clone = (x) => JSON.parse(JSON.stringify(x));
const lim = [{ text: 'All six investigations are microgravity or low-gravity experiments; microgravity results do not establish lunar-gravity behaviour.', citations: ['LIM-001'] }];

const Q5_GOOD = { status: 'insufficient_evidence',
  direct_answer: 'No. The current integrated PSI evidence store contains no actual partial-gravity combustion data; calc:partial_gravity is an empty list.',
  key_findings: [{ text: 'The calculations showed an empty list of investigations with partial-gravity data.', evidence_class: 'calculated', citations: ['calc:partial_gravity'] }],
  supporting_investigations: [], experimental_conditions: [], limitations: lim,
  insufficient_evidence_reason: 'No integrated investigation contains partial-gravity combustion data.' };
const Q5_RUN4 = { ...clone(Q5_GOOD), status: 'answered', insufficient_evidence_reason: '' }; // a plain "No" answered as "answered"

const Q6_GOOD = { status: 'insufficient_evidence',
  direct_answer: 'No. The current integrated PSI evidence store contains no actual lunar- or partial-gravity combustion data, and the system computes no risk probabilities, so it cannot establish a validated lunar-habitat fire-risk probability.',
  key_findings: [{ text: 'The calculations showed an empty list of investigations with partial-gravity data.', evidence_class: 'calculated', citations: ['calc:partial_gravity'] }],
  supporting_investigations: [], experimental_conditions: [], limitations: lim,
  insufficient_evidence_reason: 'A validated probability cannot be established because there is no data on combustion at lunar gravity in this store and no validated risk model.' };
const Q6_RUN4 = (() => { const a = clone(Q6_GOOD); a.direct_answer = 'No. A validated fire-risk probability for a lunar habitat would require combustion data at lunar gravity and a validated risk model.'; return a; })();

const mockEnv = (responses, seen) => ({ SI_PROVIDER: 'workers_ai', AI: { run: async (_m, inp) => { seen.push(inp); return { response: responses[Math.min(seen.length - 1, responses.length - 1)] }; } } });

// ---------------- Q5: status ----------------
test('Q5 run #4 failure reproduces: a plain "No" with status "answered" is still rejected (validator unchanged)', () => {
  assert.ok(check('Q5', Q5_RUN4).errors.includes('this question class must be reported as insufficient_evidence or partial'));
  assert.deepEqual(check('Q5', Q5_GOOD), { ok: true, errors: [] });
  assert.deepEqual(check('Q5', { ...clone(Q5_GOOD), status: 'partial' }), { ok: true, errors: [] });
});

test('Q5/Q6: the JSON schema sent to the model allows only insufficient_evidence or partial; Q1-Q4 schema unchanged', async () => {
  for (const qid of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']) {
    const seen = []; await handleAsk(Q[qid], mockEnv(['not json'], seen));
    const sch = seen[0].response_format.json_schema;
    if (qid === 'Q5' || qid === 'Q6') assert.deepEqual(sch.properties.status.enum, ['partial', 'insufficient_evidence'], qid);
    else assert.deepEqual(sch, JSON_SCHEMA, qid + ' schema byte-for-byte unchanged');
  }
  assert.deepEqual(schemaWithStatus(JSON_SCHEMA, ['answered', 'bogus']).properties.status.enum, ['answered'], 'can only narrow, never widen');
  assert.equal(schemaWithStatus(JSON_SCHEMA, undefined), JSON_SCHEMA);
});

test('Q5/Q6 prompts carry the explicit question-class instruction; Q1-Q4 prompts are exactly the unchanged SYSTEM prompt', async () => {
  for (const qid of ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']) {
    const seen = []; await handleAsk(Q[qid], mockEnv(['not json'], seen));
    const sys = seen[0].messages[0].content;
    if (qid === 'Q5' || qid === 'Q6') { assert.match(sys, /QUESTION CLASS/); assert.match(sys, /Never "answered", even when the answer is a plain "No"/); assert.match(sys, /never say that no partial-gravity research exists anywhere/); }
    else assert.equal(sys, SYSTEM, qid);
  }
  assert.equal(classInstruction(buildPack(Q.Q3).cls), '');
});

test('Q5: after an "answered" rejection the retry carries a status hint, and a corrected answer is served as a model answer', async () => {
  const seen = []; const r = await handleAsk(Q.Q5, mockEnv([Q5_RUN4, Q5_GOOD], seen));
  assert.equal(r.mode, 'model'); assert.equal(r.answer.status, 'insufficient_evidence'); assert.equal(r.validation.attempts, 2);
  assert.match(seen[1].messages[0].content, /must use status "insufficient_evidence" \(or "partial"\), never "answered"/);
  assert.ok(r.validation.rejected_attempts[0].error_codes.includes('status_rule'));
});

test('Q5/Q6: the direct answer must explicitly state store-scoped absence (a vague insufficient answer is rejected)', () => {
  const vague = { ...clone(Q5_GOOD), direct_answer: 'The evidence is insufficient to answer this question.', insufficient_evidence_reason: 'Not enough evidence in the pack to decide.' };
  for (const qid of ['Q5', 'Q6']) assert.ok(check(qid, vague).errors.some((e) => /direct_answer must state explicitly that the evidence store contains no partial-gravity/.test(e)), qid);
  assert.equal(statesGravityAbsence([Q5_GOOD.direct_answer]), true);
  assert.ok(repairHints(['question asks about partial-gravity data or a validated fire-risk probability: direct_answer must state explicitly that the evidence store contains no partial-gravity (lunar or Martian) combustion data']).some((h) => /Begin direct_answer/.test(h)));
});

// ---------------- Q6: gravity wording ----------------
test('Q6 run #4 failure reproduces: "would require ... data at lunar gravity" is still rejected (not an absence statement)', () => {
  assert.ok(check('Q6', Q6_RUN4).errors.some((e) => /^gravity wording: .*mentions lunar gravity without an explicit statement/.test(e)));
});

test('Q6: the corrected answer passes and explains why a validated probability cannot be established', () => {
  assert.deepEqual(check('Q6', Q6_GOOD), { ok: true, errors: [] });
  assert.match(Q6_GOOD.direct_answer, /cannot establish a validated lunar-habitat fire-risk probability/);
});

test('alternate correct absence phrasings are accepted', () => {
  for (const s of ['A validated probability cannot be established because there is no data on combustion at lunar gravity.', 'There are no experiments conducted in partial gravity in this store.',
    'The store holds microgravity and low-gravity results rather than lunar gravity data.', 'None of the investigations was conducted at lunar gravity.', 'No integrated experiment was performed under partial gravity.',
    'No measurements under lunar gravity are in the evidence store.', 'The current integrated PSI evidence store contains no actual lunar- or partial-gravity combustion data.'])
    assert.deepEqual(gravityWordingErrors([s]), [], s);
});

test('misleading negation, affirmative and ambiguous lunar-gravity wording is rejected', () => {
  for (const s of ['There are no doubts that lunar gravity data exist.', 'None of the investigations was conducted, but SAFFIRE-II ran at lunar gravity.', 'SAFFIRE-II low-gravity results are lunar-gravity measurements.',
    'Microgravity data can stand in for lunar gravity.', 'A validated probability would require lunar-gravity combustion data.', 'Lunar gravity risk is low.', 'We cannot say much, although FLEX provides lunar gravity data.'])
    assert.equal(gravityWordingErrors([s]).length, 1, s);
});

test('absence is scoped to the evidence store: claims about all research are rejected', () => {
  for (const s of ['No partial-gravity combustion research exists anywhere.', 'Partial-gravity combustion has never been studied, so no partial-gravity data exist.', 'No one has measured fire at lunar gravity, and the store has no lunar-gravity data.'])
    assert.ok(gravityWordingErrors([s]).some((e) => /claims more than this evidence store can show/.test(e) || /without an explicit statement/.test(e)), s);
  assert.deepEqual(gravityWordingErrors(['The current integrated PSI evidence store contains no actual partial-gravity combustion data.']), []);
});

test('Q6: no risk probability, percentage or odds may be given', () => {
  for (const bad of ['The fire-risk probability is roughly 0.3 based on FLEX.', 'There is a 5% risk of ignition.', 'The chance of fire is 1 in 1000.']) {
    const a = clone(Q6_GOOD); a.key_findings.push({ text: bad, evidence_class: 'interpretation', citations: [] });
    assert.ok(check('Q6', a).errors.some((e) => /gives a risk number/.test(e)), bad);
  }
});

// ---------------- fallback and preservation ----------------
test('Q5/Q6 evidence-only fallback answers the question explicitly, scoped to the store, labelled as not AI', async () => {
  for (const qid of ['Q5', 'Q6']) {
    const r = await handleAsk(Q[qid], mockEnv([Q5_RUN4], []));
    assert.equal(r.mode, 'fallback'); assert.equal(r.fallback.reason_code, 'validation_failed'); assert.match(r.fallback.generated_by, /No AI model was used/);
    const n = r.fallback.note;
    assert.match(n, /^No\. The current integrated PSI evidence store contains no actual partial-gravity/); assert.match(n, /calc:partial_gravity is an empty list \(LIM-001\)/);
    assert.match(n, /says nothing about research outside this evidence store/); assert.deepEqual(gravityWordingErrors([n]), [], 'the code-written note passes the same check');
    if (qid === 'Q6') assert.match(n, /cannot establish a validated lunar-habitat fire-risk probability/);
  }
  assert.match(classNote({ mustBeInsufficient: true, asksSafetyGuarantee: true }), /^This cannot be established from the evidence store/);
});

test('Q1-Q4: evidence packs, prompts and schema untouched by the class instruction', () => {
  for (const qid of ['Q1', 'Q2', 'Q3', 'Q4']) { const { cls } = buildPack(Q[qid]); assert.equal(cls.mustBeInsufficient, false, qid); assert.equal(classInstruction(cls), '', qid); }
});
