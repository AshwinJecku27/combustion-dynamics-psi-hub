// Shared, deterministic helpers about investigation identity and source-passage kinds. No model involved.
// Used by retrieval (explicit-name narrowing) and by the validator (citation/investigation consistency).
import B from './bundle.js';

// Explicit names of each integrated investigation. Generic words ("SAFFIRE", "ACME", "SAME") are deliberately not
// here: they name a family, not one investigation. SAFFIRE-I must not match the prefix of SAFFIRE-II.
export const EXPLICIT_NAMES = {
  'PSI-10': /\bpsi-10\b|\bflame design\b/i,
  'PSI-159': /\bpsi-159\b|\bcfi-g\b|\bcool flames investigation\b/i,
  'PSI-98': /\bpsi-98\b|\bsaffire[- ]?(?:i|1)(?![\w-])/i,
  'PSI-99': /\bpsi-99\b|\bsaffire[- ]?(?:ii|2)(?![\w-])/i,
  'PSI-69': /\bpsi-69\b|\bflex\b/i,
  'PSI-101': /\bpsi-101\b|\bsame-r\b|\bsamer\b/i,
};

export function namedInvestigations(text) {
  return Object.entries(EXPLICIT_NAMES).filter(([, re]) => re.test(text || '')).map(([id]) => id);
}

// Source-passage kinds in the evidence store (bundle.js passages[].kind).
export const REPORT_KINDS = new Set(['report_finding', 'report_context']);
export const PLAN_OR_METADATA_KINDS = new Set(['plan_statement', 'dod_statement']);
export const KIND_LABEL = { report_finding: 'NASA report', report_context: 'NASA report (context)', plan_statement: 'Test plan (intent, not results)', dod_statement: 'Data description document (DoD)' };

// Which investigation(s) a cited id is evidence about. null = not attributable to one investigation (neutral).
export function ownerOf(id) {
  if (typeof id !== 'string') return null;
  let m = id.match(/^(PSI-\d+):/); if (m) return m[1];
  m = id.match(/^calc:count:(PSI-\d+)$/); if (m) return m[1];
  if (id.startsWith('calc:flex')) return 'PSI-69';
  if (id.startsWith('calc:samer')) return 'PSI-101';
  return null;
}

// Sources the evidence store itself designates for an investigation. PSI-98 has no document of its own; the store
// cites the SAFFIRE-II DoD as the series-level source for its gravity regime (gravity_regime.passage_ids).
export const ACCEPTED_SOURCE_OWNERS = Object.fromEntries(B.investigations.map((i) => [i.id,
  new Set([i.id, ...((i.gravity_regime && i.gravity_regime.passage_ids) || []).map(ownerOf).filter(Boolean)])]));

// Count of source passages per kind for each investigation, so the model can see that e.g. SAFFIRE-II has no report.
export const PASSAGES_BY_KIND = Object.fromEntries(B.investigations.map((i) => {
  const ps = B.passages.filter((p) => p.id.startsWith(i.id + ':'));
  return [i.id, { report: ps.filter((p) => REPORT_KINDS.has(p.kind)).length, test_plan: ps.filter((p) => p.kind === 'plan_statement').length, dod: ps.filter((p) => p.kind === 'dod_statement').length }];
}));
