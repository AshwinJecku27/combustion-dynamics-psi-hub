// Regression tests for the two failures of real-model evaluation run #3 (commit cdc9115; 4 PASS / 2 FAIL):
//  Q1: finding 2 named silicone, Kapton and Pyrell, but none of its cited evidence mentions them (correctly rejected).
//  Q5: "the calculations showed an empty list of investigations with partial-gravity data" (a correct absence statement)
//      was wrongly rejected by the sentence-level no/not gravity check.
// The answer fixtures are RECONSTRUCTIONS of those shapes (the run #3 report text is not in this repository).
// No network, no real model: model output is a MOCK. Run: npm test   (from si/worker)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPack } from '../src/retrieve.js';
import { validate, repairHints } from '../src/validate.js';
import { handleAsk, groundingGuide, SYSTEM } from '../src/core.js';
import { TERMS, evidenceTexts, materialSources, gravityWordingErrors } from '../src/grounding.js';
import { QUESTIONS } from '../scripts/real_eval.mjs';

const Q = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.text]));
const check = (qid, ans) => { const { pack, ids, cls } = buildPack(Q[qid]); return validate(ans, { ids, pack, cls, question: Q[qid] }); };
const clone = (x) => JSON.parse(JSON.stringify(x));

const Q1 = { status: 'partial',
  direct_answer: 'SAFFIRE-II and SAFFIRE-I burned solid samples in low gravity, and SAME-R characterised smoke from heated solid materials; none of them contains lunar-gravity data.',
  key_findings: [
    { text: 'SAFFIRE-II burned PMMA; sample 2-8 has a burn time of 600 s.', evidence_class: 'measured_data', citations: ['PSI-99:sample:2-8'] },
    { text: 'SAFFIRE-I burned SIBAL Fabric samples in concurrent and opposed flow.', evidence_class: 'measured_data', citations: ['PSI-98:sample:S1', 'PSI-98:sample:S2'] },
    { text: 'SAME-R heated-wire records cover silicone, Kapton and Pyrell among other materials.', evidence_class: 'calculated', citations: ['calc:samer:breakdown'] },
  ],
  supporting_investigations: [{ investigation_id: 'PSI-99', role: 'Solid-material burning in low gravity', record_ids: ['PSI-99:sample:2-8'] }, { investigation_id: 'PSI-98', role: 'Fabric samples', record_ids: ['PSI-98:sample:S1'] }, { investigation_id: 'PSI-101', role: 'Smoke from heated solid materials', record_ids: [] }],
  experimental_conditions: [],
  limitations: [{ text: 'No partial-gravity combustion data: microgravity results do not establish lunar-gravity behaviour.', citations: ['LIM-001'] }, { text: 'Heated-wire smoke is not fire in a spacecraft atmosphere.', citations: ['LIM-022'] }],
  insufficient_evidence_reason: 'There is no lunar-gravity data, so these investigations identify relevant materials but not lunar behaviour.' };
const Q1_RUN3 = (() => { const a = clone(Q1); a.key_findings[2].citations = ['PSI-101:report:p4:table1', 'PSI-101:report:p26:rt-r0']; return a; })();

const Q5 = { status: 'insufficient_evidence',
  direct_answer: 'No. The calculations showed an empty list of investigations with partial-gravity data, so the evidence store contains no actual partial-gravity combustion data.',
  key_findings: [{ text: 'The calculations showed an empty list of investigations with partial-gravity data.', evidence_class: 'calculated', citations: ['calc:partial_gravity'] }],
  supporting_investigations: [], experimental_conditions: [],
  limitations: [{ text: 'All six investigations were conducted in microgravity or low gravity, not partial gravity; microgravity results do not establish lunar-gravity behaviour.', citations: ['LIM-001'] }],
  insufficient_evidence_reason: 'No integrated investigation contains partial-gravity combustion data.' };

// ---------------- Q1: material citation grounding ----------------
test('Q1 run #3 shape: silicone, Kapton and Pyrell cited to SAME-R passages that never name them are rejected', () => {
  const e = check('Q1', Q1_RUN3).errors;
  for (const t of ['silicone', 'Kapton', 'Pyrell']) assert.ok(e.includes(`finding 2: names ${t} but none of its cited evidence mentions it`), t);
});

test('Q1: the same materials pass only when cited to evidence that names them', () => {
  assert.deepEqual(check('Q1', Q1), { ok: true, errors: [] });
  const split = clone(Q1); split.key_findings[2] = { text: 'SAFFIRE-II burned silicone; SAME-R heated-wire records cover Kapton and Pyrell.', evidence_class: 'measured_data', citations: ['PSI-99:sample:2-1', 'calc:samer:breakdown'] };
  assert.deepEqual(check('Q1', split), { ok: true, errors: [] });
  const wrongSample = clone(Q1); wrongSample.key_findings[2].citations = ['PSI-99:sample:2-1']; // a silicone sample cannot support Kapton/Pyrell
  const e = check('Q1', wrongSample).errors;
  assert.ok(e.includes('finding 2: names Kapton but none of its cited evidence mentions it') && e.includes('finding 2: names Pyrell but none of its cited evidence mentions it'));
  assert.ok(!e.some((x) => /names silicone/.test(x)), 'silicone itself is grounded by the silicone sample');
});

test('Q1: omitting a material the pack cannot support is accepted; naming one with no source is rejected', () => {
  const omit = clone(Q1); omit.key_findings[2].text = 'SAME-R heated-wire records cover several solid materials.'; omit.key_findings[2].citations = ['calc:samer:breakdown'];
  assert.deepEqual(check('Q1', omit), { ok: true, errors: [] });
  const guess = clone(Q1); guess.key_findings[2].text = 'SAME-R heated-wire records cover Kapton and Nomex.';
  assert.ok(check('Q1', guess).errors.includes('finding 2: names Nomex but none of its cited evidence mentions it'));
});

test('Q1 pack carries material_sources: exact record/passage/calc ids, each one verifiably naming its material', () => {
  const { pack, ids } = buildPack(Q.Q1); const src = pack.material_sources; const texts = evidenceTexts(pack);
  assert.deepEqual(src.Kapton, ['calc:samer:breakdown']); assert.deepEqual(src.Pyrell, ['calc:samer:breakdown']);
  assert.ok(src.silicone.includes('PSI-99:sample:2-1') && src.silicone.includes('calc:samer:breakdown'));
  for (const [t, list] of Object.entries(src)) for (const id of list) {
    assert.ok(ids.has(id), `${id} is citable`); assert.ok(TERMS[t].some((re) => re.test(texts.get(id))), `${id} names ${t}`);
    assert.ok(!/^LIM-|^PSI-\d+$/.test(id), 'limitations and investigation metadata are not listed as exact sources');
  }
  assert.equal(src.helium, undefined, 'no entry for a material the pack does not name');
  assert.deepEqual(materialSources(pack), src);
});

test('material_sources is added only to relevance questions; Q2 to Q6 packs are unchanged', () => {
  for (const qid of ['Q2', 'Q3', 'Q4', 'Q5', 'Q6']) assert.equal('material_sources' in buildPack(Q[qid]).pack, false, qid);
});

test('prompt and retry: cite a listed id or omit the material; the retry names the exact ids', async () => {
  assert.match(SYSTEM, /"material_sources"/); assert.match(SYSTEM, /leave that material out; do not guess/);
  const { pack } = buildPack(Q.Q1);
  const g = groundingGuide(['finding 2: names Kapton but none of its cited evidence mentions it', 'finding 2: names helium but none of its cited evidence mentions it'], pack);
  assert.match(g, /Kapton: cite one of calc:samer:breakdown in that finding/); assert.match(g, /helium: no record, passage or calculation in the pack names it; omit it/);
  assert.equal(groundingGuide(['banned claim wording: x'], pack), '');
  const seen = []; const env = { SI_PROVIDER: 'workers_ai', AI: { run: async (_m, inp) => { seen.push(inp); return { response: seen.length === 1 ? Q1_RUN3 : Q1 }; } } };
  const r = await handleAsk(Q.Q1, env);
  assert.equal(r.mode, 'model'); assert.equal(r.validation.attempts, 2);
  assert.match(seen[1].messages[0].content, /Pyrell: cite one of calc:samer:breakdown/);
  assert.ok(r.validation.rejected_attempts[0].error_codes.includes('ungrounded_term'));
});

// ---------------- Q5: partial-gravity wording ----------------
test('Q5 run #3 statement (empty calculation list) is accepted, and the full answer passes with LIM-001', () => {
  assert.deepEqual(gravityWordingErrors(['The calculations showed an empty list of investigations with partial-gravity data.']), []);
  assert.deepEqual(check('Q5', Q5), { ok: true, errors: [] });
  assert.deepEqual(check('Q6', { ...clone(Q5), direct_answer: 'No. No integrated investigation contains partial-gravity combustion data, so no validated fire-risk probability can be established.' }), { ok: true, errors: [] });
});

test('correct absence statements are accepted', () => {
  for (const s of ['There is no partial-gravity combustion data.', 'No integrated investigation contains partial-gravity combustion data.', 'calc:partial_gravity is an empty list of investigations with partial-gravity data.',
    'None of the six investigations has lunar-gravity data.', 'SAFFIRE-II and SAME-R ran in low gravity; none of them contains lunar-gravity data.', 'Microgravity results do not establish lunar-gravity behaviour.',
    'Lunar-gravity data are absent from the store.', "The store doesn't contain Martian gravity tests.", 'The evidence store has no lunar or Martian gravity combustion data.', 'These experiments were not conducted at partial gravity.',
    'The six investigations were conducted in microgravity or low gravity, not partial gravity.', 'Whether flame behaviour at partial gravity lies between microgravity and 1 g behaviour is not tested by these data.'])
    assert.deepEqual(gravityWordingErrors([s]), [], s);
});

test('affirmative partial-gravity claims are rejected, including when an unrelated negation is in the same sentence', () => {
  for (const s of ['SAFFIRE-II provides partial-gravity data on burning.', 'FLEX droplets burned at Martian gravity.', 'These low-gravity tests are lunar gravity experiments.',
    'SAFFIRE-II provides partial-gravity data, not microgravity data.', 'There is no doubt SAFFIRE-II has partial-gravity data.', 'SAME-R did not measure detectors but ran in reduced gravity.',
    'The store contains partial-gravity data that is not yet analysed.', 'Low gravity (i.e. partial gravity) tests were run.', 'SAFFIRE-II is not only microgravity but partial-gravity data too.',
    'none of them doubts that SAFFIRE-II has lunar-gravity data.', 'Whether SAME-R is useful is unknown, but SAFFIRE-II provides partial-gravity data.'])
    assert.equal(gravityWordingErrors([s]).length, 1, s);
});

test('ambiguous or hedged partial-gravity wording is rejected', () => {
  for (const s of ['Partial-gravity data are limited.', 'Partial-gravity experiments would be needed to confirm this.', 'It is not clear whether there is partial-gravity data.', 'Some lunar-gravity behaviour can be inferred.'])
    assert.equal(gravityWordingErrors([s]).length, 1, s);
});

test('microgravity and low gravity, as the store states them, are not flagged', () => {
  assert.deepEqual(gravityWordingErrors(['SAFFIRE-II was conducted in long-duration low gravity.', 'FLEX ran in microgravity aboard the ISS.', 'calc:partial_gravity has no entries.']), []);
});

test('Q5: strict insufficient-evidence rules are unchanged', () => {
  const noLim = clone(Q5); noLim.limitations = [{ text: 'Conducted in microgravity or low gravity.', citations: ['LIM-016'] }];
  assert.ok(check('Q5', noLim).errors.includes('must cite LIM-001'));
  const answered = clone(Q5); answered.status = 'answered';
  assert.ok(check('Q5', answered).errors.includes('this question class must be reported as insufficient_evidence or partial'));
  const affirm = clone(Q5); affirm.direct_answer = 'Yes, SAFFIRE-II provides partial-gravity data, but it is limited.';
  assert.ok(check('Q5', affirm).errors.some((e) => /^gravity wording/.test(e)));
});

test('Q5 retry hint gives accepted absence phrasings', () => {
  const h = repairHints(['gravity wording: "x" mentions partial-gravity without an explicit statement that no such data exist']).join(' ');
  assert.match(h, /empty list of investigations with partial-gravity data/); assert.match(h, /elsewhere in the sentence does not count/);
  assert.match(SYSTEM, /calc:partial_gravity is an empty list of investigations with partial-gravity data/);
});
