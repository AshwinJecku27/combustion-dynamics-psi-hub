// Regression tests for the post-r3 audit fixes (evaluation run #2: Q1 timed out; Q4's SF6 statement was not clearly
// supported by its citations). No network, no Cloudflare account, no real model: model output is a MOCK.
// Run: npm test   (from si/worker)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPack } from '../src/retrieve.js';
import { validate, numbers, repairHints } from '../src/validate.js';
import { handleAsk, SYSTEM } from '../src/core.js';
import { makeProvider } from '../src/provider.js';
import { TERMS, termsIn, ungroundedTerms, evidenceTexts, stripFormulas, gravityWordingErrors, errorCode } from '../src/grounding.js';
import { QUESTIONS, classify, summarize, renderMarkdown, evaluate } from '../scripts/real_eval.mjs';

const Q = Object.fromEntries(QUESTIONS.map((q) => [q.id, q.text]));
const check = (qid, ans) => { const { pack, ids, cls } = buildPack(Q[qid]); return validate(ans, { ids, pack, cls, question: Q[qid] }); };
const clone = (x) => JSON.parse(JSON.stringify(x));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const Q4 = { status: 'partial', direct_answer: 'FLEX burned fuel droplets in diluted atmospheres; it does not establish suppressant efficacy.',
  key_findings: [{ text: 'The FLEX test plan states an intent to examine CO2, He and SF6 as agents.', evidence_class: 'plan_or_metadata', citations: ['PSI-69:plan:p5:agents'] }],
  supporting_investigations: [{ investigation_id: 'PSI-69', role: 'Droplet combustion in diluted atmospheres', record_ids: [] }], experimental_conditions: [],
  limitations: [{ text: 'The FLEX table has no SF6 column and no efficacy metric, so no SF6 results exist in this evidence.', citations: ['LIM-015'] }, { text: 'Condition similarity only, not habitat-level evidence.', citations: ['LIM-016'] }],
  insufficient_evidence_reason: 'FLEX records no suppressant-efficacy metric.' };
const Q2 = { status: 'answered', direct_answer: 'SAFFIRE-II burned one sample per condition; four silicone samples have burn time recorded as Insignificant.',
  key_findings: [{ text: 'Sample 2-8 (PMMA) has a burn time of 600 s.', evidence_class: 'measured_data', citations: ['PSI-99:sample:2-8'] }],
  supporting_investigations: [{ investigation_id: 'PSI-99', role: 'Solid-sample burns', record_ids: ['PSI-99:sample:2-8'] }], experimental_conditions: [],
  limitations: [{ text: 'One sample per condition.', citations: ['LIM-010'] }], insufficient_evidence_reason: '' };
const INSUFF = { status: 'insufficient_evidence', direct_answer: 'No integrated investigation contains partial-gravity combustion data, so this cannot be answered.',
  key_findings: [], supporting_investigations: [], experimental_conditions: [], limitations: [{ text: 'No partial-gravity data in any integrated investigation.', citations: ['LIM-001'] }],
  insufficient_evidence_reason: 'The evidence store has no lunar or Martian gravity combustion data.' };

// ---------- citation grounding: the false SF6 citation ----------
test('SF6 statement: accepted only when cited to the passage that names SF6', () => {
  assert.deepEqual(check('Q4', Q4), { ok: true, errors: [] });
  for (const wrong of ['PSI-69:plan:p8:table8', 'PSI-69:dod:p0:purpose', 'PSI-69:plan:p2:loi']) { // same investigation, never mention SF6
    const a = clone(Q4); a.key_findings[0].citations = [wrong];
    const e = check('Q4', a).errors;
    assert.ok(e.some((x) => /finding 0: names SF6 but none of its cited evidence mentions it/.test(x)), wrong);
    assert.ok(e.some((x) => /finding 0: names helium/.test(x)), 'He is not in ' + wrong);
  }
});

test('the store itself supports SF6 only in the plan passage and LIM-015 (no SF6 data)', () => {
  const { pack } = buildPack(Q.Q4); const t = evidenceTexts(pack);
  const withSF6 = [...t].filter(([, txt]) => TERMS.SF6.some((re) => re.test(txt))).map(([id]) => id).sort();
  assert.deepEqual(withSF6, ['LIM-015', 'PSI-69:plan:p5:agents']);
});

test('aliases: helium/He and carbon dioxide/CO2 ground each other; the pronoun "he" is not helium', () => {
  const a = clone(Q4); a.key_findings[0].text = 'The FLEX test plan states an intent to examine carbon dioxide, helium and sulfur hexafluoride.';
  assert.deepEqual(check('Q4', a), { ok: true, errors: [] });
  assert.deepEqual(termsIn('he said the CO column is undefined'), []);
  assert.deepEqual(termsIn('He and CO2 and N2 and nitrogen').sort(), ['CO2', 'N2', 'helium']);
  const m = new Map([['x', 'examines the efficacy of CO2 , He and SF6']]);
  assert.deepEqual(ungroundedTerms('carbon dioxide and helium', ['x'], m), []);
  assert.deepEqual(ungroundedTerms('nitrogen', ['x'], m), ['N2']);
});

test('materials: an unrelated same-investigation record does not ground a material claim', () => {
  assert.deepEqual(check('Q2', Q2), { ok: true, errors: [] });
  const a = clone(Q2); a.key_findings[0].citations = ['PSI-99:sample:2-1']; // silicone sample, same investigation
  assert.ok(check('Q2', a).errors.some((x) => /names PMMA but none of its cited evidence mentions it/.test(x)));
});

test('blank SAFFIRE-II materials are not filled in: 2-6 cannot be called SIBAL from its own record (LIM-011)', () => {
  const a = clone(Q2); a.key_findings[0] = { text: 'Sample 2-6 (SIBAL) has a burn time of 115 s.', evidence_class: 'measured_data', citations: ['PSI-99:sample:2-6'] };
  assert.ok(check('Q2', a).errors.some((x) => /names SIBAL/.test(x)));
  const dod = clone(Q2); dod.key_findings[0] = { text: 'The DoD lists S6 as SIBAL fabric; the CSV material field for sample 2-6 is blank.', evidence_class: 'measured_data', citations: ['PSI-99:dod:S6', 'PSI-99:sample:2-6'] };
  assert.deepEqual(check('Q2', dod), { ok: true, errors: [] }, 'explicit DoD attribution is allowed');
});

test('grounding applies to uncited interpretation findings and to experimental conditions', () => {
  const a = clone(Q2); a.key_findings.push({ text: 'Nomex appears harder to ignite than PMMA.', evidence_class: 'interpretation', citations: [] });
  const e = check('Q2', a).errors;
  assert.ok(e.some((x) => /finding 1: names Nomex/.test(x)) && e.some((x) => /finding 1: names PMMA/.test(x)));
  const c = clone(Q2); c.experimental_conditions = [{ text: 'Silicone samples were tested at 20 cm/s.', citations: ['PSI-99:sample:2-8'] }];
  assert.ok(check('Q2', c).errors.some((x) => /condition 0: names silicone/.test(x)));
  c.experimental_conditions[0].citations = ['PSI-99:sample:2-1'];
  assert.deepEqual(check('Q2', c), { ok: true, errors: [] });
});

// ---------- formula numbers ----------
test('chemical formulas are not numerical claims; real numbers next to them still are', () => {
  assert.deepEqual(numbers('SF6, C4H10, CO2, H2O, CH4, NaCl2 and S1C1'), []);
  assert.deepEqual(numbers('731 tests with SF6 at 0.30 O2, 20 cm/s, 600 s, 10 mm, N2 0.45'), [731, 0.3, 20, 600, 10, 0.45]);
  assert.equal(stripFormulas('Table 1, 1-g, 2.6 times'), 'Table 1, 1-g, 2.6 times');
  assert.deepEqual(numbers('T1130 and X731 and C1130'), [1130, 731, 1130], 'number-bearing labels that are not formulas stay checked');
  const a = clone(Q4); a.key_findings[0].text = 'The FLEX test plan states an intent to examine CO2, He and SF6 in 731 tests.';
  assert.ok(check('Q4', a).errors.some((x) => /numbers not found in evidence pack: 731$/.test(x)), 'only 731 is unsupported; SF6 contributes no 6');
});

// ---------- gravity terminology ----------
test('gravity wording: affirmative partial/lunar-gravity claims are rejected; statements of absence pass', () => {
  for (const bad of ['SAFFIRE-II provides partial-gravity data on burning.', 'These low-gravity tests are lunar gravity experiments.', 'SAME-R ran in reduced gravity.', 'FLEX droplets burned at Martian gravity.']) {
    const a = clone(Q2); a.key_findings[0].text = bad + ' Sample 2-8 (PMMA) has a burn time of 600 s.';
    assert.ok(check('Q2', a).errors.some((x) => /gravity wording/.test(x)), bad);
  }
  for (const ok of ['There is no partial-gravity combustion data.', 'Microgravity results do not establish lunar-gravity behaviour.', 'Lunar-gravity data are absent from the store.', "The store doesn't contain Martian gravity tests."])
    assert.deepEqual(gravityWordingErrors([ok]), [], ok);
});

for (const qid of ['Q5', 'Q6']) test(`${qid}: strict insufficient-evidence behaviour kept; low gravity may not be presented as partial gravity`, () => {
  assert.deepEqual(check(qid, INSUFF), { ok: true, errors: [] });
  const a = clone(INSUFF); a.direct_answer = 'SAFFIRE-II low-gravity tests are effectively partial-gravity experiments, but the data are limited.';
  const e = check(qid, a).errors; assert.ok(e.some((x) => /gravity wording/.test(x)), 'affirmative partial-gravity framing rejected');
  const b = clone(INSUFF); b.status = 'answered'; b.key_findings = [{ text: 'No investigation has partial-gravity data.', evidence_class: 'calculated', citations: ['calc:partial_gravity'] }];
  assert.ok(check(qid, b).errors.includes('this question class must be reported as insufficient_evidence or partial'));
});

test('prompt: planned vs completed, exact gravity regime, substance grounding and answer-size rules', () => {
  assert.match(SYSTEM, /Planned is not performed/);
  assert.match(SYSTEM, /gravity regime exactly as its gravity_regime field states/);
  assert.match(SYSTEM, /never call any of it reduced, partial, lunar or Martian gravity/);
  assert.match(SYSTEM, /must appear in one of the items that finding cites/);
  assert.match(SYSTEM, /at most 5 key_findings/);
  assert.ok(repairHints(['finding 0: names SF6 but none of its cited evidence mentions it']).some((h) => /plan, not a test/.test(h)));
  assert.ok(repairHints(['gravity wording: "x" mentions partial, lunar or Martian gravity without stating that no such data exist']).length);
});

// ---------- Q1 size ----------
test('Q1 (relevance question): pack carries experiment records only and no identifier groups; Q2 keeps full records', () => {
  const q1 = buildPack(Q.Q1).pack;
  assert.ok(Object.values(q1.records).flat().every((r) => / \| sample \| /.test(r)));
  assert.equal(q1.identifier_groups, undefined);
  assert.ok(JSON.stringify(q1).length < 22000);
  assert.equal(buildPack(Q.Q2).pack.records['PSI-99'].length, 24);
});

// ---------- deadline and per-call budget ----------
const slowAI = (ms, response, calls) => ({ run: async (_m, inp) => { calls.push(!!inp.response_format); await sleep(ms); return { response }; } });

test('a timed-out model call ends the request with a timeout fallback and no retry', async () => {
  const calls = [];
  const env = { SI_PROVIDER: 'workers_ai', SI_MODEL_TIMEOUT_MS: '60', SI_REQUEST_DEADLINE_MS: '1000', AI: { run: async (_m, inp) => { calls.push(1); return new Promise(() => {}); } } };
  const t = Date.now(); const r = await handleAsk(Q.Q1, env);
  assert.equal(r.mode, 'fallback'); assert.equal(r.fallback.reason_code, 'timeout'); assert.equal(calls.length, 1);
  assert.ok(Date.now() - t < 500);
});

test('the json_schema retry shares one per-call budget (no fresh 25 s for the schema-less call)', async () => {
  const env = { SI_PROVIDER: 'workers_ai', SI_MODEL_TIMEOUT_MS: '120', AI: { run: async (_m, inp) => { if (inp.response_format) { await sleep(80); throw new Error("JSON Mode couldn't be met"); } return new Promise(() => {}); } } };
  const p = makeProvider(env); const t = Date.now();
  await assert.rejects(p.generate({ system: 's', user: 'u' }), (e) => e.code === 'timeout');
  const took = Date.now() - t; assert.ok(took < 190, `took ${took} ms; budget 120 ms`);
  await assert.rejects(p.generate({ system: 's', user: 'u', timeoutMs: 30 }), (e) => e.code === 'timeout', 'a caller budget can shorten');
});

test('no retry is started when a full per-call budget no longer fits before the request deadline', async () => {
  const calls = [];
  const env = { SI_PROVIDER: 'workers_ai', SI_MODEL_TIMEOUT_MS: '100', SI_REQUEST_DEADLINE_MS: '150', AI: slowAI(70, 'not json', calls) };
  const r = await handleAsk(Q.Q3, env);
  assert.equal(calls.length, 1, 'only one model call'); assert.equal(r.mode, 'fallback'); assert.equal(r.fallback.reason_code, 'validation_failed');
  assert.equal(r.validation.retry_skipped, 'deadline'); assert.match(r.message, /not enough time to retry/);
  const calls2 = []; const r2 = await handleAsk(Q.Q3, { ...env, SI_REQUEST_DEADLINE_MS: '1000', AI: slowAI(10, 'not json', calls2) });
  assert.equal(calls2.length, 2, 'retry runs when time remains'); assert.equal(r2.validation.retry_skipped, undefined);
});

// ---------- retry diagnostics ----------
test('first-attempt objections are kept as structured diagnostics, without model text', async () => {
  const bad = clone(Q4); bad.key_findings[0].citations = ['PSI-69:plan:p8:table8'];
  let n = 0; const env = { SI_PROVIDER: 'workers_ai', AI: { run: async () => ({ response: n++ === 0 ? bad : Q4 }) } };
  const r = await handleAsk(Q.Q4, env);
  assert.equal(r.mode, 'model'); assert.equal(r.validation.attempts, 2);
  const d = r.validation.rejected_attempts; assert.equal(d.length, 1); assert.equal(d[0].attempt, 1);
  assert.ok(d[0].error_codes.includes('ungrounded_term')); assert.ok(d[0].errors.some((e) => /names SF6/.test(e)));
  assert.ok(!JSON.stringify(d).includes(bad.direct_answer), 'no model text in diagnostics');
  const both = await handleAsk(Q.Q4, { SI_PROVIDER: 'workers_ai', AI: { run: async () => ({ response: bad }) } });
  assert.equal(both.validation.rejected_attempts.length, 2);
  assert.equal(errorCode('banned claim wording: /x/'), 'banned_wording'); assert.equal(errorCode('numbers not found in evidence pack: 9'), 'unsupported_number');
});

// ---------- evaluation verdicts ----------
const resp = (qid, body) => classify({ ...QUESTIONS.find((q) => q.id === qid), rep: 1 }, { attempts: [{ http_status: 200, ms: 5, text: JSON.stringify(body) }] });
const model = (status, extra = {}) => ({ mode: 'model', model: { provider: 'workers_ai', name: 'm' }, answer: { ...INSUFF, status }, validation: { passed: true, attempts: 1, ...extra } });
const fb = (reason, extra = {}) => ({ mode: 'fallback', fallback: { reason_code: reason }, message: 'x', ...extra });

test('evaluation run #2 shape: a Q1 timeout makes the run INCOMPLETE, never PASS', () => {
  const R = [resp('Q1', fb('timeout')), resp('Q2', model('answered', { attempts: 2 })), resp('Q3', model('answered')), resp('Q4', model('partial', { attempts: 2 })), resp('Q5', model('insufficient_evidence')), resp('Q6', model('insufficient_evidence'))];
  assert.equal(R[0].evaluation, 'NOT_EVALUATED'); assert.match(R[0].evaluation_reason, /timeout/);
  const s = summarize({ results: R, target_is_local: false });
  assert.match(s.automated_verdict, /^INCOMPLETE \(1 of 6 question\(s\) NOT EVALUATED: Q1/); assert.doesNotMatch(s.automated_verdict, /PASS/);
  assert.deepEqual(s.counts, { PASS: 5, FAIL: 0, NOT_EVALUATED: 1 });
  const md = renderMarkdown({ target: 'https://x', started_at: 'a', finished_at: 'b', parameters: { questions: ['Q1'], reps: 1, delay_ms: 0, max_requests: 6 }, planned_requests: 6, results: R, summary: s, health: null });
  assert.match(md, /\| Q1 \| \*\*NOT EVALUATED\*\* \|/); assert.match(md, /5 PASS, 0 FAIL, 1 NOT EVALUATED/);
});

test('PASS, FAIL and NOT EVALUATED are distinct per question; all six benchmarks are reported', () => {
  const all = QUESTIONS.map((q) => resp(q.id, model(q.expect === 'insufficient_evidence' ? 'insufficient_evidence' : 'answered')));
  const s = summarize({ results: all, target_is_local: false });
  assert.match(s.automated_verdict, /^PASS/); assert.deepEqual(s.question_outcomes.map((q) => q.question_id), ['Q1', 'Q2', 'Q3', 'Q4', 'Q5', 'Q6']);
  const withFail = [...all.slice(0, 5), resp('Q6', model('answered'))];
  assert.match(summarize({ results: withFail, target_is_local: false }).automated_verdict, /^FAIL/);
  const rejected = [...all.slice(0, 1), resp('Q2', fb('validation_failed', { validation: { attempts: 2, errors: ['x'] } })), ...all.slice(2)];
  const s2 = summarize({ results: rejected, target_is_local: false });
  assert.equal(s2.question_outcomes[1].outcome, 'FAIL'); assert.match(s2.automated_verdict, /^FAIL/, 'a rejected model answer fails even once');
  for (const reason of ['timeout', 'rate_limited', 'provider_error', 'no_key']) assert.equal(evaluate(resp('Q3', fb(reason))).evaluation, 'NOT_EVALUATED', reason);
  assert.equal(evaluate({ outcome: 'network_error', expectation: 'answer', error: 'x' }).evaluation, 'NOT_EVALUATED');
});

test('rejected-attempt diagnostics from the Worker are recorded in the report', () => {
  const r = resp('Q2', model('answered', { attempts: 2, rejected_attempts: [{ attempt: 1, error_codes: ['report_citation_kind'], errors: ['finding 0: report_derived finding must cite a report passage'] }] }));
  assert.deepEqual(r.validator.errors_of_rejected_attempts[0].error_codes, ['report_citation_kind']);
  const s = summarize({ results: [r], target_is_local: false });
  const md = renderMarkdown({ target: 'https://x', started_at: 'a', finished_at: 'b', parameters: { questions: ['Q2'], reps: 1, delay_ms: 0, max_requests: 6 }, planned_requests: 1, results: [r], summary: s, health: null });
  assert.match(md, /Rejected attempts before this answer/); assert.match(md, /attempt 1: report_citation_kind/);
});
