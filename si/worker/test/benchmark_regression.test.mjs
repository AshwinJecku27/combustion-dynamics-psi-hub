// Regression tests for the six internal benchmark questions (scripts/real_eval.mjs QUESTIONS) after the first live
// Workers AI evaluation (4/6 validated; Q2 and Q4 fell back on validator errors; Q1 answered only "no lunar data").
//
// No network, no Cloudflare account, no real model: model output is a MOCK. The Q2 and Q4 "original" answers below
// are RECONSTRUCTIONS shaped to reproduce the exact validator errors reported from the live run (the live response
// bodies are not in this repository). The original release-candidate code in si-release/si-api/src is imported
// unchanged to show the failures reproduce there, and the current code in src/ is tested for the fix.
// Run: npm test   (from si/worker)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPack } from '../src/retrieve.js';
import { validate } from '../src/validate.js';
import { handleAsk, SYSTEM } from '../src/core.js';
import { JSON_SCHEMA } from '../src/provider.js';
import { buildPack as buildPackRC } from '../../../si-release/si-api/src/retrieve.js';
import { validate as validateRC } from '../../../si-release/si-api/src/validate.js';
import { QUESTIONS } from '../scripts/real_eval.mjs';

const Q = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.text]));
const check = (qid, ans) => { const { pack, ids, cls } = buildPack(Q[qid]); return validate(ans, { ids, pack, cls, question: Q[qid] }); };
const checkRC = (qid, ans) => { const { pack, ids, cls } = buildPackRC(Q[qid]); return validateRC(ans, { ids, pack, cls, question: Q[qid] }); };
const clone = (x) => JSON.parse(JSON.stringify(x));
const mockEnv = (responses, seen = []) => ({ SI_PROVIDER: 'workers_ai', AI: { run: async (_m, inp) => { seen.push(inp); const r = responses[Math.min(seen.length - 1, responses.length - 1)]; return { response: r, usage: { total_tokens: 1 } }; } } });

// ---------- fixtures ----------
const Q2_ORIGINAL = { status: 'answered',
  direct_answer: 'SAFFIRE-II burned one sample per condition on a sample card; several silicone samples had an insignificant burn time while other materials burned for longer.',
  key_findings: [
    { text: 'SAFFIRE-II has a sample card that contains 9 samples, each 5 cm x 29 cm.', evidence_class: 'report_derived', citations: ['PSI-99:dod:p0:sample-card'] },
    { text: 'Sample 2-1 (silicone) has a burn time recorded as Insignificant.', evidence_class: 'measured_data', citations: ['PSI-99:sample:2-1'] },
    { text: 'Sample 2-5 has a burn time of 145 s.', evidence_class: 'measured_data', citations: ['PSI-99:sample:2-5'] },
  ],
  supporting_investigations: [{ investigation_id: 'PSI-99', role: 'Solid-sample burn observations', record_ids: ['PSI-99:sample:2-1', 'PSI-99:sample:2-5'] }],
  experimental_conditions: [{ text: 'Air flow recorded as 20 cm/s for these samples.', citations: ['PSI-99:sample:2-1', 'PSI-99:sample:2-5'] }],
  limitations: [{ text: 'One sample per condition; conditions differ in several variables at once.', citations: ['LIM-010'] }, { text: 'CSV and DoD disagree on thickness and flow.', citations: ['LIM-009'] }],
  insufficient_evidence_reason: '' };
const Q2_CORRECTED = (() => { const a = clone(Q2_ORIGINAL); a.key_findings[0].evidence_class = 'plan_or_metadata'; return a; })();

const Q4_ORIGINAL = { status: 'partial',
  direct_answer: 'FLEX recorded droplet burning in atmospheres with different diluents, but it is liquid-droplet combustion and records no suppressant-efficacy metric.',
  key_findings: [
    { text: 'FLEX investigates the effectiveness of fire suppressants in microgravity.', evidence_class: 'report_derived', citations: ['PSI-69:dod:p0:purpose'] },
    { text: 'The FLEX test plan examines the efficacy of CO2 and He as agents.', evidence_class: 'report_derived', citations: ['PSI-69:plan:p5:agents'] },
    { text: 'FLEX has 9 tests with initial O2 strictly above 0.30.', evidence_class: 'calculated', citations: ['calc:flex:o2_gt_0.30'] },
  ],
  supporting_investigations: [{ investigation_id: 'PSI-69', role: 'Droplet combustion in diluted atmospheres', record_ids: [] }],
  experimental_conditions: [{ text: 'Droplet geometry is the model geometry.', citations: ['PSI-69:plan:p2:droplet'] }],
  limitations: [
    { text: 'FLEX does not validate habitat fire safety or suppression systems.', citations: ['LIM-016'] },
    { text: 'No demonstrated suppressant efficacy; the column headed CO is probably CO2 but not confirmed.', citations: ['LIM-015', 'LIM-012'] },
  ],
  insufficient_evidence_reason: 'FLEX contains no suppressant-efficacy metric (no LOI or minimum extinction concentration column).' };
const Q4_CORRECTED = (() => { const a = clone(Q4_ORIGINAL);
  a.key_findings[0].evidence_class = 'plan_or_metadata'; a.key_findings[1].evidence_class = 'plan_or_metadata';
  a.key_findings[0].text = 'The FLEX data description states that FLEX investigates the effectiveness of fire suppressants in microgravity (a stated purpose, not a result).';
  a.key_findings[1].text = 'The FLEX test plan states an intent to examine CO2 and He as agents; the plan states intended tests, not results.';
  a.limitations[0].text = 'FLEX is liquid-droplet combustion: habitat-like conditions are condition similarity only, not habitat-level evidence, and FLEX does not establish suppressant efficacy.';
  return a; })();

const Q1_LUNAR_ONLY = { status: 'partial', direct_answer: 'None of the investigations contain lunar-gravity combustion data, so lunar-habitat solid-material fire behaviour is not covered.',
  key_findings: [{ text: 'No investigation has partial-gravity data.', evidence_class: 'calculated', citations: ['calc:partial_gravity'] }],
  supporting_investigations: [], experimental_conditions: [], limitations: [{ text: 'No partial-gravity data.', citations: ['LIM-001'] }],
  insufficient_evidence_reason: 'No lunar-gravity combustion data exist in the evidence store.' };
const Q1_GOOD = { status: 'partial',
  direct_answer: 'SAFFIRE-II and SAFFIRE-I burned solid samples in low gravity and SAME-R characterised smoke from heated solid materials, so they are the most relevant to solid-material fire safety; none of them contains lunar-gravity data.',
  key_findings: [
    { text: 'SAFFIRE-II burned solid samples including silicone, SIBAL and PMMA; sample 2-8 has a burn time of 600 s.', evidence_class: 'measured_data', citations: ['PSI-99:sample:2-1', 'PSI-99:sample:2-5', 'PSI-99:sample:2-8'] },
    { text: 'SAFFIRE-I burned SIBAL Fabric samples, one in concurrent and one in opposed flow.', evidence_class: 'measured_data', citations: ['PSI-98:sample:S1', 'PSI-98:sample:S2'] },
    { text: 'The SAFFIRE-I gravity regime is known only from the series-level SAFFIRE objective to determine how rapidly a large scale fire grows in low-gravity.', evidence_class: 'plan_or_metadata', citations: ['PSI-99:dod:p0:objective'] },
    { text: 'SAME-R heated-wire tests covered Kapton, Silicone, Lampwick, Teflon and Pyrell.', evidence_class: 'measured_data', citations: ['calc:samer:breakdown'] },
  ],
  supporting_investigations: [
    { investigation_id: 'PSI-99', role: 'Solid-material burning in low gravity (one sample per condition)', record_ids: ['PSI-99:sample:2-1', 'PSI-99:sample:2-8'] },
    { investigation_id: 'PSI-98', role: 'Large fabric samples, concurrent vs opposed flow', record_ids: ['PSI-98:sample:S1', 'PSI-98:sample:S2'] },
    { investigation_id: 'PSI-101', role: 'Smoke from heated solid materials (detection context only)', record_ids: [] },
  ],
  experimental_conditions: [],
  limitations: [
    { text: 'No partial-gravity combustion data: microgravity results do not establish lunar-gravity behaviour.', citations: ['LIM-001'] },
    { text: 'SAFFIRE-II has one sample per condition.', citations: ['LIM-010'] },
    { text: 'Heated-wire smoke is not fire in a spacecraft atmosphere.', citations: ['LIM-022'] },
  ],
  insufficient_evidence_reason: 'There is no lunar-gravity data, so these investigations identify relevant materials and phenomena but not lunar behaviour.' };

const Q3_GOOD = { status: 'answered', direct_answer: 'SAME-R characterises smoke particles from heated materials; the report gives average mass diameters for baseline runs, but no detector performance data.',
  key_findings: [
    { text: 'The SAME-R report presents average mass diameter results from the moment instruments for baseline runs in Table 1.', evidence_class: 'report_derived', citations: ['PSI-101:report:p4:table1'] },
    { text: 'SAME-R records cover Kapton, Silicone, Lampwick, Teflon and Pyrell, with primary and aged follow-up runs.', evidence_class: 'calculated', citations: ['calc:samer:breakdown'] },
  ],
  supporting_investigations: [{ investigation_id: 'PSI-101', role: 'Smoke particle characterisation', record_ids: [] }],
  experimental_conditions: [{ text: 'Rt/R0 is the ratio of heated-wire resistance to room-temperature resistance.', citations: ['PSI-101:report:p26:rt-r0'] }],
  limitations: [{ text: 'No detector sensitivity or response-time measurements.', citations: ['LIM-019'] }, { text: 'Heated-wire smoke is not fire.', citations: ['LIM-022'] }],
  insufficient_evidence_reason: '' };

const INSUFFICIENT = { status: 'insufficient_evidence', direct_answer: 'No integrated investigation contains partial-gravity combustion data, so this cannot be answered from the evidence store.',
  key_findings: [], supporting_investigations: [], experimental_conditions: [], limitations: [{ text: 'No partial-gravity data in any integrated investigation.', citations: ['LIM-001'] }],
  insufficient_evidence_reason: 'The evidence store has no lunar or Martian gravity combustion data and no validated risk model.' };

// ---------- 1. reproduce the live failures on the original release-candidate code ----------
test('Q2 original failure reproduces on the release-candidate code: DoD passage labelled report_derived', () => {
  assert.deepEqual(checkRC('Q2', Q2_ORIGINAL).errors, ['finding 0: report_derived finding must cite a report passage']);
});

test('Q4 original failure reproduces on the release-candidate code: two plan/DoD findings + banned validation wording', () => {
  const e = checkRC('Q4', Q4_ORIGINAL).errors;
  assert.deepEqual(e, ['finding 0: report_derived finding must cite a report passage', 'finding 1: report_derived finding must cite a report passage',
    'banned claim wording: /\\bvalidates? (the )?(habitat|fire safety|suppress)/i']);
});

test('root cause: the store has no report passages for SAFFIRE-II, SAFFIRE-I or FLEX', () => {
  for (const qid of ['Q2', 'Q4']) {
    const { pack, selected } = buildPack(Q[qid]);
    const inv = pack.investigations.find((i) => i.id === selected[0]);
    assert.equal(inv.source_passages_by_kind.report, 0, qid);
    assert.ok(pack.passages.every((p) => p.kind === 'plan_statement' || p.kind === 'dod_statement'), qid + ' pack holds only plan/DoD passages');
  }
  const q1 = buildPack(Q.Q1).pack.investigations.find((i) => i.id === 'PSI-98');
  assert.deepEqual(q1.source_passages_by_kind, { report: 0, test_plan: 0, dod: 0 });
});

test('release-candidate loophole: a SAME-R report passage could be borrowed for a SAFFIRE-II claim (now closed)', () => {
  const laundered = clone(Q2_ORIGINAL); laundered.key_findings[0] = { text: 'SAFFIRE-II average mass diameter results are presented in Table 1.', evidence_class: 'report_derived', citations: ['PSI-101:report:p4:table1'] };
  assert.equal(checkRC('Q2', laundered).ok, true, 'old code accepted a citation from another investigation');
  const now = check('Q2', laundered);
  assert.equal(now.ok, false);
  assert.ok(now.errors.some((e) => /citation not in evidence pack: PSI-101:report:p4:table1/.test(e)), 'Q2 pack no longer carries SAME-R passages');
  // Even where the passage IS in the pack (Q1 retrieves both), ownership is checked.
  const q1 = clone(Q1_GOOD); q1.key_findings.push({ text: 'SAFFIRE-II average mass diameter results are presented in Table 1.', evidence_class: 'report_derived', citations: ['PSI-101:report:p4:table1'] });
  assert.ok(check('Q1', q1).errors.some((e) => /belongs to PSI-101, not to PSI-99/.test(e)));
});

// ---------- 2. corrected answers pass only with legitimate citations ----------
test('Q2 corrected: the DoD statement labelled plan_or_metadata passes', () => {
  assert.deepEqual(check('Q2', Q2_CORRECTED), { ok: true, errors: [] });
});

test('Q2: the original mislabelled answer is still rejected (validator not weakened)', () => {
  const v = check('Q2', Q2_ORIGINAL);
  assert.equal(v.ok, false);
  assert.match(v.errors[0], /^finding 0: report_derived finding must cite a report passage \(the cited passage is a test-plan or DoD statement, not a report\)$/);
});

test('Q2: fabricated or mismatched citations are rejected', () => {
  const fab = clone(Q2_CORRECTED); fab.key_findings[0] = { text: 'SAFFIRE-II flames spread faster on thin samples.', evidence_class: 'report_derived', citations: ['PSI-99:report:p12:spread'] };
  const ef = check('Q2', fab).errors;
  assert.ok(ef.some((e) => /citation not in evidence pack: PSI-99:report:p12:spread/.test(e)));
  assert.ok(ef.some((e) => /report_derived finding must cite a report passage/.test(e)));
  const wrongKind = clone(Q2_CORRECTED); wrongKind.key_findings[1].citations = ['PSI-99:dod:p0:objective']; // a passage is not a record
  assert.ok(check('Q2', wrongKind).errors.some((e) => /finding 1: measured_data finding must cite a record or calc/.test(e)));
  const planNoPassage = clone(Q2_CORRECTED); planNoPassage.key_findings[0].citations = ['PSI-99:sample:2-1'];
  assert.ok(check('Q2', planNoPassage).errors.some((e) => /plan_or_metadata finding must cite a test-plan or DoD passage/.test(e)));
});

test('Q4 corrected: plan/DoD statements labelled plan_or_metadata and limitation reworded pass', () => {
  assert.deepEqual(check('Q4', Q4_CORRECTED), { ok: true, errors: [] });
});

test('Q4: the original answer is still rejected on every original count', () => {
  const e = check('Q4', Q4_ORIGINAL).errors;
  assert.equal(e.filter((x) => /report_derived finding must cite a report passage/.test(x)).length, 2);
  assert.ok(e.some((x) => /banned claim wording: .*validates\?/.test(x)));
});

test('banned claim wording stays banned, including negated forms', () => {
  for (const bad of ['FLEX validates habitat fire safety.', 'FLEX does not validate the suppression system.', 'This proves the agent works.', 'The data are proven.',
    'It guarantees safety.', 'FLEX demonstrates suppression of droplet flames.', 'This demonstrates that efficacy is high.']) {
    const a = clone(Q4_CORRECTED); a.limitations[0].text = bad;
    assert.ok(check('Q4', a).errors.some((e) => /banned claim wording/.test(e)), bad);
  }
});

test('unsupported numbers and suppressant-efficacy claims are rejected', () => {
  const a = clone(Q4_CORRECTED); a.key_findings[2].text = 'FLEX has 731 tests with initial O2 strictly above 0.30.';
  assert.ok(check('Q4', a).errors.some((e) => /numbers not found in evidence pack: 731/.test(e)));
  const b = clone(Q4_CORRECTED); b.direct_answer = 'FLEX demonstrates suppression by CO2 in habitat atmospheres.';
  assert.ok(check('Q4', b).errors.some((e) => /banned claim wording/.test(e)));
  const c = clone(Q4_CORRECTED); c.limitations = [{ text: 'none', citations: ['LIM-999'] }];
  const ec = check('Q4', c).errors;
  assert.ok(ec.some((e) => /limitation 0: citation not in evidence pack: LIM-999/.test(e)));
});

test('measured_data must come from the investigation the finding names', () => {
  const a = clone(Q1_GOOD); a.key_findings[0].citations = ['PSI-98:sample:S1'];
  assert.ok(check('Q1', a).errors.some((e) => /finding 0: cited measured_data evidence belongs to PSI-98, not to PSI-99/.test(e)));
});

// ---------- 3. Q1 retrieval and answer guidance ----------
test('Q1 retrieval: solid-material investigations with their records; FLEX (liquid droplets) not pulled in by "lunar habitat"', () => {
  const { pack, selected, cls } = buildPack(Q.Q1);
  assert.deepEqual([...selected].sort(), ['PSI-101', 'PSI-98', 'PSI-99']);
  assert.ok(!selected.includes('PSI-69'));
  assert.ok(pack.records['PSI-99'].length && pack.records['PSI-98'].length, 'SAFFIRE records present');
  assert.ok(pack.passages.some((p) => p.id.startsWith('PSI-99:')) && pack.passages.some((p) => p.id.startsWith('PSI-101:')), 'each selected investigation keeps a passage');
  assert.ok(pack.limitations.some((l) => l.id === 'LIM-001'));
  assert.equal(cls.mustBeInsufficient, false); assert.equal(cls.asksWhichInvestigations, true); assert.equal(cls.mentionsPartialGravityContext, true);
});

test('Q1: an answer that only says lunar data is absent is rejected; a substantive one passes', () => {
  assert.equal(checkRC('Q1', Q1_LUNAR_ONLY).ok, true, 'the release candidate accepted the non-answer');
  assert.ok(check('Q1', Q1_LUNAR_ONLY).errors.some((e) => /name at least one investigation/.test(e)));
  assert.deepEqual(check('Q1', Q1_GOOD), { ok: true, errors: [] });
});

test('Q1: the microgravity-vs-lunar limitation (LIM-001) is required', () => {
  const a = clone(Q1_GOOD); a.limitations = a.limitations.filter((l) => !l.citations.includes('LIM-001'));
  assert.ok(check('Q1', a).errors.some((e) => /must cite LIM-001/.test(e)));
});

test('Q1: SAFFIRE-I may cite the SAFFIRE-II DoD only because the store designates it as the series-level source', () => {
  assert.equal(check('Q1', Q1_GOOD).ok, true); // finding 2 names SAFFIRE-I and cites PSI-99:dod:p0:objective
  const a = clone(Q1_GOOD); a.key_findings[2] = { text: 'SAME-R aims to determine how rapidly a large scale fire grows in low-gravity.', evidence_class: 'plan_or_metadata', citations: ['PSI-99:dod:p0:objective'] };
  assert.ok(check('Q1', a).errors.some((e) => /belongs to PSI-99, not to PSI-101/.test(e)));
});

test('the system prompt tells the model how to answer Q1-type questions and how to label plan/DoD passages', () => {
  assert.match(SYSTEM, /plan_or_metadata/);
  assert.match(SYSTEM, /never label a plan or DoD statement as report_derived/);
  assert.match(SYSTEM, /even a negative one/);
  assert.match(SYSTEM, /absence of partial-gravity data is a limitation, not the whole answer/);
  assert.ok(JSON_SCHEMA.properties.key_findings.items.properties.evidence_class.enum.includes('plan_or_metadata'));
});

// ---------- 4. protect Q3, Q5, Q6 ----------
test('Q3 (SAME-R): retrieval unchanged from the release candidate and a valid answer passes on both versions', () => {
  const a = buildPack(Q.Q3), b = buildPackRC(Q.Q3);
  assert.deepEqual(a.selected, b.selected); assert.deepEqual([...a.ids].sort(), [...b.ids].sort());
  assert.deepEqual(a.pack.passages, b.pack.passages); assert.deepEqual(a.pack.limitations, b.pack.limitations); assert.deepEqual(a.pack.calculations, b.pack.calculations);
  assert.deepEqual(check('Q3', Q3_GOOD), { ok: true, errors: [] });
  assert.equal(checkRC('Q3', Q3_GOOD).ok, true);
});

for (const qid of ['Q5', 'Q6']) {
  test(`${qid}: retrieval unchanged; only insufficient_evidence citing LIM-001 is accepted`, () => {
    const a = buildPack(Q[qid]), b = buildPackRC(Q[qid]);
    assert.equal(a.cls.mustBeInsufficient, true);
    assert.deepEqual(a.selected, b.selected); assert.deepEqual([...a.ids].sort(), [...b.ids].sort()); assert.deepEqual(a.pack.passages, b.pack.passages);
    assert.deepEqual(check(qid, INSUFFICIENT), { ok: true, errors: [] });
    const answered = { ...clone(INSUFFICIENT), status: 'answered', key_findings: [{ text: 'No investigation has partial-gravity data.', evidence_class: 'calculated', citations: ['calc:partial_gravity'] }] };
    assert.ok(check(qid, answered).errors.includes('this question class must be reported as insufficient_evidence or partial'));
    const noLim = { ...clone(INSUFFICIENT), limitations: [{ text: 'Not enough data.', citations: ['LIM-016'] }] };
    assert.ok(check(qid, noLim).errors.includes('must cite LIM-001'));
  });

  test(`${qid}: end to end with a mock model, an "answered" reply falls back and a correct reply is served`, async () => {
    const bad = await handleAsk(Q[qid], mockEnv([{ ...clone(INSUFFICIENT), status: 'answered', key_findings: [{ text: 'Data exist.', evidence_class: 'interpretation', citations: [] }] }]));
    assert.equal(bad.mode, 'fallback'); assert.equal(bad.fallback.reason_code, 'validation_failed'); assert.match(bad.fallback.note, /LIM-001/);
    const good = await handleAsk(Q[qid], mockEnv([INSUFFICIENT]));
    assert.equal(good.mode, 'model'); assert.equal(good.answer.status, 'insufficient_evidence');
  });
}

// ---------- 5. evidence-only fallback and retry behaviour ----------
test('model output rejected twice -> evidence-only fallback, no AI text served', async () => {
  const seen = [];
  const r = await handleAsk(Q.Q4, mockEnv([Q4_ORIGINAL], seen));
  assert.equal(seen.length, 2);
  assert.equal(r.mode, 'fallback'); assert.equal(r.fallback.reason_code, 'validation_failed'); assert.equal(r.answer, undefined);
  assert.match(r.fallback.generated_by, /No AI model was used/); assert.match(r.message, /not an AI answer/);
  assert.ok(r.validation.errors.some((e) => /banned claim wording/.test(e)));
  assert.ok(r.fallback.retrieved.passages.length > 0 && r.fallback.retrieved.limitations.some((l) => l.id === 'LIM-001'));
  assert.ok(r.evidence.passages.every((p) => typeof p.kind === 'string'), 'evidence sheet labels passage kinds');
});

test('a rejected first attempt gets specific repair hints, and a legitimate second attempt is served', async () => {
  for (const [qid, bad, good] of [['Q2', Q2_ORIGINAL, Q2_CORRECTED], ['Q4', Q4_ORIGINAL, Q4_CORRECTED], ['Q1', Q1_LUNAR_ONLY, Q1_GOOD]]) {
    const seen = [];
    const r = await handleAsk(Q[qid], mockEnv([bad, good], seen));
    assert.equal(r.mode, 'model', qid); assert.equal(r.validation.attempts, 2, qid);
    const retry = seen[1].messages[0].content;
    assert.match(retry, /previous answer was rejected/, qid);
    if (qid !== 'Q1') assert.match(retry, /must be labelled plan_or_metadata/, qid);
    if (qid === 'Q4') assert.match(retry, /including negative ones/);
    if (qid === 'Q1') assert.match(retry, /supporting_investigations/);
  }
});

test('a model that "fixes" a rejection by inventing a report citation still falls back', async () => {
  const invented = clone(Q2_ORIGINAL); invented.key_findings[0].citations = ['PSI-99:report:p1:sample-card'];
  const r = await handleAsk(Q.Q2, mockEnv([Q2_ORIGINAL, invented]));
  assert.equal(r.mode, 'fallback'); assert.ok(r.validation.errors.some((e) => /citation not in evidence pack: PSI-99:report:p1:sample-card/.test(e)));
});
