// Tests for Evidence Support (src/support.js) and the final-product prompt/answer additions.
// Deterministic, no network, no real model (model output is a MOCK). Run: npm test   (from si/worker)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPack } from '../src/retrieve.js';
import { validate } from '../src/validate.js';
import { evidenceSupport, LEVELS } from '../src/support.js';
import { handleAsk, SYSTEM } from '../src/core.js';
import { MOCK_ANSWER } from '../../../si-integration/local_worker_server.mjs';

const clone = (x) => JSON.parse(JSON.stringify(x));
const Q2 = 'What does SAFFIRE-II show about the burning behavior of the tested materials?';
const ctx = (q) => ({ pack: buildPack(q).pack, question: q });
const STRONG = { status: 'answered', direct_answer: 'SAFFIRE-II burned one sample per condition; PMMA sample 2-8 burned for 600 s.',
  key_findings: [
    { text: 'Sample 2-8 (PMMA) has a burn time of 600 s.', evidence_class: 'measured_data', citations: ['PSI-99:sample:2-8'] },
    { text: 'Sample 2-5 (SIBAL) has a burn time of 145 s.', evidence_class: 'measured_data', citations: ['PSI-99:sample:2-5'] },
    { text: 'Burn times differ between materials, but each was tested once, so the differences are observations for further testing.', evidence_class: 'interpretation', citations: ['PSI-99:sample:2-8', 'LIM-010'] }],
  supporting_investigations: [{ investigation_id: 'PSI-99', role: 'Solid-sample burns', record_ids: ['PSI-99:sample:2-8'] }],
  experimental_conditions: [{ text: 'Both samples were burned in concurrent flow.', citations: ['PSI-99:sample:2-8', 'PSI-99:sample:2-5'] }],
  limitations: [{ text: 'One sample per condition.', citations: ['LIM-010'] }], insufficient_evidence_reason: '' };

test('a fully cited, direct, condition-documented answer with its limitations linked is Strong', () => {
  assert.deepEqual(validate(STRONG, { ...buildPack(Q2), question: Q2 }).ok, true, 'fixture is a validated answer');
  const r = evidenceSupport(STRONG, ctx(Q2));
  assert.equal(r.level, 'strong'); assert.equal(r.label, 'Strong evidence support'); assert.deepEqual(r.caps, []);
  assert.deepEqual(Object.fromEntries(r.components.map((c) => [c.id, [c.n, c.d]])), { citation_coverage: [4, 4], direct_evidence: [2, 3], question_coverage: [1, 1], conditions_documented: [1, 1], limitations_linked: [1, 1] });
});

test('gates: fallback / unvalidated answers are not scored; insufficient_evidence is reported as such', () => {
  assert.equal(evidenceSupport(STRONG, { ...ctx(Q2), mode: 'fallback' }).level, 'not_scored');
  assert.equal(evidenceSupport(STRONG, { ...ctx(Q2), validated: false }).level, 'not_scored');
  assert.equal(evidenceSupport(null, ctx(Q2)).level, 'not_scored');
  const ins = { ...clone(STRONG), status: 'insufficient_evidence' };
  const r = evidenceSupport(ins, ctx(Q2)); assert.equal(r.level, 'insufficient'); assert.equal(r.label, 'Insufficient evidence'); assert.deepEqual(r.components, []);
});

test('caps: a partial answer can never be Strong', () => {
  const r = evidenceSupport({ ...clone(STRONG), status: 'partial' }, ctx(Q2));
  assert.equal(r.level, 'moderate'); assert.match(r.caps[0], /partial/);
});

test('caps: relying on a disputed quantity caps at Moderate; citing the same record for an unrelated quantity does not', () => {
  const thick = clone(STRONG); thick.key_findings[0] = { text: 'Sample 2-4 has a thickness recorded as 037 mm.', evidence_class: 'measured_data', citations: ['PSI-99:sample:2-4'] };
  const r = evidenceSupport(thick, ctx(Q2)); assert.equal(r.level, 'moderate'); assert.deepEqual(r.discrepant_records, ['PSI-99:sample:2-4']);
  const flow = clone(STRONG); flow.experimental_conditions = [{ text: 'Sample 2-6 was tested at 20 cm/s flow.', citations: ['PSI-99:sample:2-6'] }];
  assert.equal(evidenceSupport(flow, ctx(Q2)).level, 'moderate', 'CSV/DoD flow mismatch for 2-6');
  assert.equal(evidenceSupport(STRONG, ctx(Q2)).discrepant_records.length, 0, '2-8 is flagged for thickness, but the answer only uses its burn time');
});

test('an answer resting mostly on uncited interpretation or plan statements is Limited', () => {
  const weak = clone(STRONG);
  weak.key_findings = [{ text: 'The DoD states a sample card with 9 samples.', evidence_class: 'plan_or_metadata', citations: ['PSI-99:dod:p0:sample-card'] },
    { text: 'These materials are relevant to cabins.', evidence_class: 'interpretation', citations: [] }, { text: 'Fire spread matters.', evidence_class: 'interpretation', citations: [] }];
  const r = evidenceSupport(weak, ctx(Q2));
  assert.equal(r.level, 'limited'); assert.equal(r.components.find((c) => c.id === 'direct_evidence').n, 0);
});

test('question coverage: naming FLEX but citing only SAFFIRE evidence prevents Strong and Moderate', () => {
  const q = 'What does FLEX show about suppression, compared with SAFFIRE-II?';
  const r = evidenceSupport(STRONG, ctx(q)); const c = r.components.find((x) => x.id === 'question_coverage');
  assert.deepEqual([c.n, c.d], [1, 2]); assert.notEqual(r.level, 'strong');
  const only = evidenceSupport(STRONG, ctx('What does FLEX show about suppression?'));
  assert.equal(only.level, 'limited');
});

test('limitations must be investigation-specific: LIM-001 alone does not link SAFFIRE-II', () => {
  const a = clone(STRONG); a.limitations = [{ text: 'No partial-gravity data.', citations: ['LIM-001'] }];
  const r = evidenceSupport(a, ctx(Q2));
  assert.equal(r.components.find((c) => c.id === 'limitations_linked').met, false); assert.notEqual(r.level, 'strong');
});

test('honest presentation: no percentages or truth language; what is not evaluated is stated; deterministic', () => {
  const r = evidenceSupport(STRONG, ctx(Q2));
  assert.deepEqual(evidenceSupport(STRONG, ctx(Q2)), r);
  const text = [r.label, ...Object.values(LEVELS), ...r.components.flatMap((c) => [c.label, c.explanation]), ...r.caps].join(' | '); // human-readable strings only
  assert.doesNotMatch(text, /%|\bprobabilit|\btrue\b|\baccura|\bconfiden|\bvalidity/i);
  assert.ok(r.not_evaluated.some((s) => /semantically supports/.test(s)) && r.not_evaluated.some((s) => /scientifically correct/.test(s)));
});

test('the Worker attaches evidence_support to validated model answers only', async () => {
  const env = (resp) => ({ SI_PROVIDER: 'workers_ai', AI: { run: async () => ({ response: resp }) } });
  const ok = await handleAsk(Q2, env(STRONG));
  assert.equal(ok.mode, 'model'); assert.equal(ok.evidence_support.level, 'strong');
  const fb = await handleAsk(Q2, env('not json'));
  assert.equal(fb.mode, 'fallback'); assert.equal(fb.evidence_support, undefined);
});

test('the UI test mock answer is a genuinely valid answer through the real pipeline (Moderate: partial)', async () => {
  const q = 'How did flow direction relate to burn time in the SAFFIRE samples?';
  const r = await handleAsk(q, { SI_PROVIDER: 'workers_ai', AI: { run: async () => ({ response: MOCK_ANSWER }) } });
  assert.equal(r.mode, 'model'); assert.equal(r.validation.attempts, 1); assert.equal(r.evidence_support.level, 'moderate');
});

test('prompt asks for grounded qualitative explanation, and forbids unstated mechanisms', () => {
  assert.match(SYSTEM, /Explain, do not only list/);
  assert.match(SYSTEM, /Never add a mechanism, trend, relationship or number the pack does not state/);
  assert.match(SYSTEM, /interpretation: your own cautious reading of cited evidence; cite the items it interprets/);
});
