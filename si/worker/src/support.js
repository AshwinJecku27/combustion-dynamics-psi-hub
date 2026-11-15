// Evidence Support: a deterministic, explainable indicator of how well a VALIDATED answer is supported by the evidence
// retrieved from the current evidence store. It does NOT measure whether the underlying research is correct, whether a
// cited passage semantically entails a claim (no such check exists here), or the probability that a claim is true.
//
// Only components that can be computed exactly from the answer, the evidence pack and the store are used:
//   citation_coverage      statements (findings + experimental conditions) that cite at least one evidence item
//   direct_evidence        findings resting on measured records, NASA report passages or code calculations
//                          (not on test-plan/DoD statements or interpretation)
//   question_coverage      investigations NAMED in the question that are covered by at least one citation (n/a if none)
//   conditions_documented  at least one cited experimental condition
//   limitations_linked     cited investigations that have one of their own store limitations cited
// Gates and caps (a high value can never override them):
//   - not a validated model answer (fallback, rejection)          -> not scored
//   - status insufficient_evidence                                -> "Insufficient evidence"
//   - status partial                                              -> at most "Moderate"
//   - a statement relies on a cited record's unresolved discrepancy (the record is flagged mismatch / disputed unit /
//     ambiguous / indeterminate for a quantity the statement mentions, by keyword) -> at most "Moderate"
// Levels: Strong = every component met (n/a components ignored); Moderate = coverage >= 3/4, at least one direct
// finding and, if the question names investigations, at least half covered; otherwise Limited.
import B from './bundle.js';
import { namedInvestigations, ownerOf, ACCEPTED_SOURCE_OWNERS } from './investigations.js';

export const LEVELS = { strong: 'Strong evidence support', moderate: 'Moderate evidence support', limited: 'Limited evidence support', insufficient: 'Insufficient evidence', not_scored: 'Not scored' };
const DIRECT = new Set(['measured_data', 'report_derived', 'calculated']);
// Discrepancy flags in the store, and the words that show a claim relies on the flagged quantity (keyword match).
const FLAG_TOPICS = [[/THICKNESS/, /thick/i], [/FLOW/, /flow|cm\/s|velocity/i], [/O2|OXYGEN/, /\bO2\b|oxygen/i],
  [/CAMERA/, /camera|image/i], [/MATERIAL_BLANK/, /material|silicone|sibal|pmma|nomex|cotton|fabric/i]];
const DISCREPANT = /MISMATCH|DISPUTED|AMBIGUOUS|INDETERMINATE|ANOMALY|NOT_SINGLE_VALUE|MATERIAL_BLANK/;
const UNIVERSAL = new Set(B.limitations.filter((l) => l.investigations.length === B.investigations.length).map((l) => l.id));
const LIM_INV = Object.fromEntries(B.limitations.map((l) => [l.id, new Set(l.investigations)]));
const NOT_EVALUATED = [
  'Whether each cited passage or record semantically supports the exact wording of its claim (only identity, kind, investigation and named-material checks are made).',
  'Contradictions between sources beyond the discrepancy flags recorded in the evidence store.',
  'Whether the underlying NASA results are scientifically correct or complete.',
];

const frac = (n, d) => ({ n, d, value: d ? n / d : null });
export function evidenceSupport(ans, ctx = {}) {
  const { pack = {}, question = '', mode = 'model', validated = true } = ctx;
  if (mode !== 'model' || !validated || !ans) return { level: 'not_scored', label: LEVELS.not_scored, reason: 'Only validated AI answers are scored. Evidence-only responses are shown without a score.', components: [], caps: [], not_evaluated: NOT_EVALUATED };
  if (ans.status === 'insufficient_evidence') return { level: 'insufficient', label: LEVELS.insufficient, reason: 'The answer states that the evidence store cannot answer this question.', components: [], caps: [], not_evaluated: NOT_EVALUATED };

  const findings = ans.key_findings || [], conds = ans.experimental_conditions || [];
  const statements = [...findings, ...conds];
  const cites = (x) => (Array.isArray(x.citations) ? x.citations : []);
  const coverage = frac(statements.filter((s) => cites(s).length > 0).length, statements.length);
  const direct = frac(findings.filter((f) => DIRECT.has(f.evidence_class)).length, findings.length);

  const allCites = [...statements.flatMap(cites), ...(ans.limitations || []).flatMap(cites), ...(ans.supporting_investigations || []).flatMap((s) => s.record_ids || [])];
  const owners = new Set(allCites.map(ownerOf).filter(Boolean));
  const named = namedInvestigations(question);
  const qcov = named.length ? frac(named.filter((n) => [...owners].some((o) => (ACCEPTED_SOURCE_OWNERS[n] || new Set([n])).has(o))).length, named.length) : null;
  const condsCited = conds.some((c) => cites(c).length > 0);

  const citedInv = new Set([...owners, ...(ans.supporting_investigations || []).map((s) => s.investigation_id)].filter((x) => /^PSI-\d+$/.test(x)));
  const limCited = new Set((ans.limitations || []).flatMap(cites).filter((c) => /^LIM-/.test(c) && !UNIVERSAL.has(c)));
  const specificExists = (inv) => B.limitations.some((l) => !UNIVERSAL.has(l.id) && l.investigations.includes(inv));
  const needLim = [...citedInv].filter(specificExists);
  const limLinked = needLim.length ? frac(needLim.filter((inv) => [...limCited].some((l) => LIM_INV[l] && LIM_INV[l].has(inv))).length, needLim.length) : null;

  const rows = new Map(Object.values(pack.records || {}).flat().map((r) => [String(r).split(' | ')[0], String(r)]));
  // A cited record's discrepancy counts only if the citing statement mentions the flagged quantity.
  const relies = (s, id) => (rows.get(id).split(' | flags: ')[1] || '').split(',').filter((f) => DISCREPANT.test(f))
    .some((f) => FLAG_TOPICS.some(([flag, words]) => flag.test(f) && words.test(s.text || '')));
  const discrepant = [...new Set(statements.flatMap((s) => cites(s).filter((id) => rows.has(id) && relies(s, id))))];

  const components = [
    { id: 'citation_coverage', label: 'Statements with cited evidence', ...coverage, met: coverage.d > 0 && coverage.n === coverage.d, explanation: 'Findings and experimental conditions that cite at least one item from the evidence store.' },
    { id: 'direct_evidence', label: 'Findings resting on measured, report or calculated evidence', ...direct, met: direct.d > 0 && direct.value >= 0.5, explanation: 'Measured records, NASA report passages and code calculations count as direct; test-plan/DoD statements and interpretation do not. Met at one half or more.' },
    { id: 'question_coverage', label: 'Investigations named in the question that are cited', ...(qcov || { n: null, d: null, value: null }), applicable: !!qcov, met: qcov ? qcov.n === qcov.d : null, explanation: 'Applies only when the question names investigations.' },
    { id: 'conditions_documented', label: 'Experimental conditions cited', n: condsCited ? 1 : 0, d: 1, value: condsCited ? 1 : 0, met: condsCited, explanation: 'At least one experimental condition (gravity regime, material, flow, oxygen, pressure, ...) with a citation.' },
    { id: 'limitations_linked', label: 'Cited investigations with their own limitation cited', ...(limLinked || { n: null, d: null, value: null }), applicable: !!limLinked, met: limLinked ? limLinked.n === limLinked.d : null, explanation: 'Each cited investigation that has investigation-specific limitations should have one of them cited (LIM-001 alone does not count).' },
  ];
  const applicable = components.filter((c) => c.applicable !== false);
  let level = applicable.every((c) => c.met) ? 'strong'
    : coverage.value >= 0.75 && direct.n > 0 && (!qcov || qcov.value >= 0.5) ? 'moderate' : 'limited';
  const caps = [];
  const cap = (why) => { caps.push(why); if (level === 'strong') level = 'moderate'; };
  if (ans.status === 'partial') cap('The answer is marked partial: part of the question is not answered by the evidence.');
  if (discrepant.length) cap(`A statement relies on a quantity with an unresolved source discrepancy in: ${discrepant.join(', ')}.`);
  return { level, label: LEVELS[level], components, caps, discrepant_records: discrepant, not_evaluated: NOT_EVALUATED };
}
