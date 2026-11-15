// Code verifier: the model is never the authority. Anything not supported by the EvidencePack is rejected.
import { namedInvestigations, ownerOf, ACCEPTED_SOURCE_OWNERS, REPORT_KINDS, PLAN_OR_METADATA_KINDS } from './investigations.js';
// plan_or_metadata: a statement from a test plan or a data-description document (DoD). These are not NASA report
// findings, and a plan states intent, not results; they get their own class instead of being passed off as report_derived.
const STATUS = ['answered', 'partial', 'insufficient_evidence'];
const CLASSES = ['measured_data', 'report_derived', 'plan_or_metadata', 'calculated', 'interpretation'];
const BANNED = [/\bproves?\b/i, /\bproven\b/i, /\bguarantee[sd]?\b/i, /\bvalidates? (the )?(habitat|fire safety|suppress)/i, /\bdemonstrates? (that )?(suppress|efficacy)/i];
const isStr = (x) => typeof x === 'string';
const isArr = (x) => Array.isArray(x);

function numbers(text) {
  const t = text.replace(/\b(PSI-\d+|LIM-\d+|CR-\d+|IG-[\w\-]+)\b/g, ' ').replace(/[A-Za-z]+:[\w:.\-\/]+/g, ' ').replace(/SAFFIRE-(I{1,3}|\d)|SAME-R|FLEX|CO2|O2|N2|C2H4|C3H8|H2O|PSI|\bII\b/g, ' ');
  return (t.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
}
export function packNumberSet(pack) {
  const s = new Set(); const txt = JSON.stringify(pack);
  (txt.match(/-?\d+(?:\.\d+)?/g) || []).forEach((n) => s.add(Number(n)));
  return s;
}
function numberSupported(n, set, qnums) {
  if (qnums.has(n)) return true;
  const eq = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a));
  for (const m of set) if (eq(n, m) || eq(n / 100, m) || eq(n * 100, m) || eq(n, Math.round(m * 100) / 100) || eq(n, Math.round(m * 10) / 10) || eq(n, Math.round(m))) return true;
  return false;
}

export function validate(ans, ctx) {
  const { ids, pack, cls, question } = ctx; const errs = [];
  if (!ans || typeof ans !== 'object') return { ok: false, errors: ['not an object'] };
  if (!STATUS.includes(ans.status)) errs.push('bad status');
  if (!isStr(ans.direct_answer) || ans.direct_answer.trim().length < 10) errs.push('direct_answer missing');
  for (const k of ['key_findings', 'supporting_investigations', 'experimental_conditions', 'limitations']) if (!isArr(ans[k])) errs.push(k + ' must be an array');
  if (errs.length) return { ok: false, errors: errs };
  const kindOf = new Map(((pack && pack.passages) || []).map((p) => [p.id, p.kind]));
  const cite = (arr, where) => { if (!isArr(arr)) { errs.push(where + ': citations must be an array'); return; } arr.forEach((c) => { if (!isStr(c) || !ids.has(c)) errs.push(`${where}: citation not in evidence pack: ${String(c).slice(0, 60)}`); }); };
  const texts = [ans.direct_answer, ans.insufficient_evidence_reason || ''];
  ans.key_findings.forEach((f, i) => {
    if (!f || !isStr(f.text)) return errs.push(`finding ${i}: text`);
    if (!CLASSES.includes(f.evidence_class)) errs.push(`finding ${i}: bad evidence_class`);
    cite(f.citations, `finding ${i}`); texts.push(f.text);
    const c = f.citations || [];
    if (f.evidence_class === 'calculated' && !c.some((x) => x.startsWith('calc:'))) errs.push(`finding ${i}: calculated finding must cite a calc:* id`);
    // Passage kind comes from the evidence pack itself (passages[].kind), not from the model's label.
    const reportCites = c.filter((x) => REPORT_KINDS.has(kindOf.get(x)));
    const planCites = c.filter((x) => PLAN_OR_METADATA_KINDS.has(kindOf.get(x)));
    const recordCites = c.filter((x) => isStr(x) && (/^PSI-\d+:(test|sample|row|ref|dod|note)/.test(x) && !kindOf.has(x) || x.startsWith('calc:')));
    if (f.evidence_class === 'report_derived' && !reportCites.length) errs.push(`finding ${i}: report_derived finding must cite a report passage` + (planCites.length ? ' (the cited passage is a test-plan or DoD statement, not a report)' : ''));
    if (f.evidence_class === 'plan_or_metadata' && !planCites.length) errs.push(`finding ${i}: plan_or_metadata finding must cite a test-plan or DoD passage`);
    if (f.evidence_class === 'measured_data' && !recordCites.length) errs.push(`finding ${i}: measured_data finding must cite a record or calc`);
    if (f.evidence_class !== 'interpretation' && c.length === 0) errs.push(`finding ${i}: uncited`);
    // The supporting citation must be evidence about the investigation the finding names (no borrowing another
    // investigation's passage or record to make a claim look supported).
    const support = f.evidence_class === 'report_derived' ? reportCites : f.evidence_class === 'plan_or_metadata' ? planCites : f.evidence_class === 'measured_data' ? recordCites : [];
    const named = namedInvestigations(f.text);
    if (named.length && support.length) {
      const owners = support.map(ownerOf);
      const ok = owners.some((o) => o === null || named.some((n) => (ACCEPTED_SOURCE_OWNERS[n] || new Set([n])).has(o)));
      if (!ok) errs.push(`finding ${i}: cited ${f.evidence_class} evidence belongs to ${[...new Set(owners)].join(', ')}, not to ${named.join(', ')} named in the finding`);
    }
  });
  ans.experimental_conditions.forEach((f, i) => { if (!f || !isStr(f.text)) return errs.push(`condition ${i}: text`); cite(f.citations, `condition ${i}`); texts.push(f.text); });
  ans.limitations.forEach((f, i) => { if (!f || !isStr(f.text)) return errs.push(`limitation ${i}: text`); cite(f.citations, `limitation ${i}`); texts.push(f.text); });
  ans.supporting_investigations.forEach((s, i) => {
    if (!s || !ids.has(s.investigation_id)) errs.push(`supporting ${i}: unknown investigation ${s && s.investigation_id}`);
    else if (!/^PSI-\d+$/.test(s.investigation_id)) errs.push(`supporting ${i}: not an investigation id`);
    if (!isArr(s.record_ids)) errs.push(`supporting ${i}: record_ids`); else s.record_ids.forEach((r) => { if (!ids.has(r)) errs.push(`supporting ${i}: record id not in evidence pack: ${String(r).slice(0, 60)}`); });
  });
  if (ans.status !== 'insufficient_evidence') {
    if (ans.key_findings.length === 0) errs.push('answered without findings');
    if (!ans.limitations.some((l) => (l.citations || []).some((c) => c.startsWith('LIM-')))) errs.push('must include at least one cited limitation (LIM-*)');
  } else if (!isStr(ans.insufficient_evidence_reason) || ans.insufficient_evidence_reason.trim().length < 10) errs.push('insufficient_evidence requires a reason');
  if (cls.mustBeInsufficient && ans.status === 'answered') errs.push('this question class must be reported as insufficient_evidence or partial');
  if (cls.mustBeInsufficient && !ans.limitations.some((l) => (l.citations || []).includes('LIM-001'))) errs.push('must cite LIM-001');
  else if (cls.mentionsPartialGravityContext && !ans.limitations.some((l) => (l.citations || []).includes('LIM-001'))) errs.push('question concerns lunar, Martian or habitat conditions: a limitation must cite LIM-001 (microgravity or normal-gravity evidence does not establish partial-gravity behaviour)');
  if (cls.asksWhichInvestigations && ans.status !== 'insufficient_evidence' && ans.supporting_investigations.length === 0) errs.push('question asks which investigations are relevant: name at least one investigation from the pack in supporting_investigations, with what it tested');
  const all = texts.join(' \n ');
  BANNED.forEach((re) => { if (re.test(all)) errs.push('banned claim wording: ' + re); });
  const set = packNumberSet(pack), qn = new Set(numbers(question));
  const bad = [...new Set(numbers(all))].filter((n) => !numberSupported(n, set, qn));
  if (bad.length) errs.push('numbers not found in evidence pack: ' + bad.slice(0, 6).join(', '));
  return { ok: errs.length === 0, errors: errs };
}

// Plain-language repair hints sent back to the model with the verifier's errors. They never relax a rule: they
// tell the model how to state the same evidence correctly, or to drop the claim.
export function repairHints(errors) {
  const e = (errors || []).join('\n'); const h = [];
  if (/report_derived finding must cite a report passage/.test(e)) h.push('report_derived is only for passages whose kind is report_finding or report_context (ids containing ":report:"). A statement from a test plan or a DoD passage (":plan:" or ":dod:") must be labelled plan_or_metadata. A value from a record is measured_data. If no passage or record in the pack supports a claim, remove the claim. Never cite a passage of another investigation, and never invent an id.');
  if (/plan_or_metadata finding must cite/.test(e)) h.push('plan_or_metadata must cite a passage whose id contains ":plan:" or ":dod:".');
  if (/evidence belongs to/.test(e)) h.push('Each finding must be supported by evidence from the investigation it names. Cite that investigation\'s own records or passages, or remove the finding.');
  if (/banned claim wording/.test(e)) h.push('The verifier rejects the words prove/proven/guarantee and "validate(s) [the] habitat / fire safety / suppression" and "demonstrate(s) suppression/efficacy" in ANY sentence, including negative ones. Rephrase, for example: "does not establish suppressant efficacy", "is condition similarity only, not habitat-level evidence".');
  if (/must cite LIM-001/.test(e)) h.push('Add a limitation citing LIM-001: no partial-gravity combustion data; microgravity results do not establish lunar or Martian behaviour.');
  if (/name at least one investigation/.test(e)) h.push('List the relevant investigations from the pack in supporting_investigations and say what each actually tested, citing its records or passages.');
  if (/numbers not found/.test(e)) h.push('Use only numbers that appear in the pack, exactly as written; do not calculate or convert.');
  return h;
}
