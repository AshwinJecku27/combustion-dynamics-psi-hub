// Code verifier: the model is never the authority. Anything not supported by the EvidencePack is rejected.
const STATUS = ['answered', 'partial', 'insufficient_evidence'];
const CLASSES = ['measured_data', 'report_derived', 'calculated', 'interpretation'];
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
  const cite = (arr, where) => { if (!isArr(arr)) { errs.push(where + ': citations must be an array'); return; } arr.forEach((c) => { if (!isStr(c) || !ids.has(c)) errs.push(`${where}: citation not in evidence pack: ${String(c).slice(0, 60)}`); }); };
  const texts = [ans.direct_answer, ans.insufficient_evidence_reason || ''];
  ans.key_findings.forEach((f, i) => {
    if (!f || !isStr(f.text)) return errs.push(`finding ${i}: text`);
    if (!CLASSES.includes(f.evidence_class)) errs.push(`finding ${i}: bad evidence_class`);
    cite(f.citations, `finding ${i}`); texts.push(f.text);
    const c = f.citations || [];
    if (f.evidence_class === 'calculated' && !c.some((x) => x.startsWith('calc:'))) errs.push(`finding ${i}: calculated finding must cite a calc:* id`);
    if (f.evidence_class === 'report_derived' && !c.some((x) => x.includes(':report:'))) errs.push(`finding ${i}: report_derived finding must cite a report passage`);
    if (f.evidence_class === 'measured_data' && !c.some((x) => /^PSI-\d+:(test|sample|row|ref|dod|note)/.test(x) || x.startsWith('calc:'))) errs.push(`finding ${i}: measured_data finding must cite a record or calc`);
    if (f.evidence_class !== 'interpretation' && c.length === 0) errs.push(`finding ${i}: uncited`);
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
  const all = texts.join(' \n ');
  BANNED.forEach((re) => { if (re.test(all)) errs.push('banned claim wording: ' + re); });
  const set = packNumberSet(pack), qn = new Set(numbers(question));
  const bad = [...new Set(numbers(all))].filter((n) => !numberSupported(n, set, qn));
  if (bad.length) errs.push('numbers not found in evidence pack: ' + bad.slice(0, 6).join(', '));
  return { ok: errs.length === 0, errors: errs };
}
