// Deterministic grounding helpers for the validator. No model involved. Every check here only ADDS rejections.

// Substances and materials that occur in the evidence store. A finding that names one of them must cite at least one
// evidence item whose own text names it too (through any alias). Each alias list is applied to the claim AND to the
// cited evidence text, so "helium" is grounded by a passage that says "He", and "carbon dioxide" by "CO2".
// "He" is matched case-sensitively (so the pronoun "he" is not read as helium); everything else is case-insensitive.
// "cotton" is its own term: SAFFIRE-I's material string is "SIBAL Fabric" and never says cotton.
export const TERMS = {
  SF6: [/\bSF\s?6\b/i, /\bsul(?:f|ph)ur hexafluoride\b/i],
  helium: [/\bHe\b/, /\bhelium\b/i],
  CO2: [/\bCO\s?2\b/i, /CO₂/, /\bcarbon dioxide\b/i],
  N2: [/\bN2\b/, /N₂/, /\bnitrogen\b/i],
  heptane: [/\b(?:n-)?heptane\b/i],
  methanol: [/\bmethanol\b/i],
  methane: [/\bmethane\b/i, /\bCH4\b/],
  ethylene: [/\bethylene\b/i, /\bC2H4\b/],
  ethane: [/\bethane\b/i, /\bC2H6\b/],
  propane: [/\bpropane\b/i, /\bC3H8\b/],
  butane: [/\b(?:n-)?butane\b/i, /\bC4H10\b/],
  PMMA: [/\bPMMA\b/i, /\bpoly\(?methyl methacrylate\)?/i],
  Nomex: [/\bnomex\b/i],
  silicone: [/\bsilicones?\b/i],
  SIBAL: [/\bSIBAL\b/i, /\bcotton[- ]fib(?:er|re)[- ]?glass\b/i],
  cotton: [/\bcotton\b/i],
  Kapton: [/\bkapton\b/i],
  Teflon: [/\bteflon\b/i],
  Lampwick: [/\blamp[- ]?wick\b/i],
  Pyrell: [/\bpyrell\b/i],
};

export function termsIn(text) {
  return Object.entries(TERMS).filter(([, res]) => res.some((re) => re.test(text || ''))).map(([t]) => t);
}

// The text of every citable item in the pack, keyed by id: passage quote (+ the store's used_for note), record row,
// limitation, calculation, comparison rule, and investigation metadata (name, notes, observed fuels or materials).
// Record ids that the pack lists without content (e.g. inside a calculation's record_ids) have no text and ground nothing.
export function evidenceTexts(pack) {
  const m = new Map(); const add = (id, t) => m.set(id, ((m.get(id) || '') + ' ' + t).trim());
  for (const p of (pack && pack.passages) || []) add(p.id, `${p.quote} ${p.used_for || ''}`);
  for (const l of (pack && pack.limitations) || []) add(l.id, [l.title, l.description, l.what_is_not_known, l.interpretation_boundary].filter(Boolean).join(' '));
  for (const c of (pack && pack.calculations) || []) add(c.id, `${c.label} ${JSON.stringify(c.value)} ${c.method || ''}`);
  for (const r of (pack && pack.comparison_rules) || []) add(r.id, r.rule || '');
  for (const i of (pack && pack.investigations) || []) add(i.id, `${i.name} ${i.notes || ''} ${(i.observed_fuel_or_material_values || []).join(' ')}`);
  for (const rows of Object.values((pack && pack.records) || {})) for (const row of rows) { const id = String(row).split(' | ')[0]; add(id, row); }
  return m;
}

// Terms named in `text` that none of `citations` mentions.
export function ungroundedTerms(text, citations, texts) {
  const cited = (citations || []).map((c) => texts.get(c) || '').join(' \n ');
  return termsIn(text).filter((t) => !TERMS[t].some((re) => re.test(cited)));
}

// Chemical formulas (SF6, CO2, C4H10, H2O, CH4) carry digits that are not numerical claims. A token is stripped only if
// it is formula-shaped: one or more groups of a real element symbol followed by an optional subscript of at most two
// digits, with at least one digit. So SF6 and C4H10 are stripped, while "T1130", "X731", "Q1", "20 cm/s", "0.30",
// "600 s", "1-g", "10 mm" and "2-8" are left for the number check.
const ELEMENTS = new Set('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Ti Cr Mn Fe Co Ni Cu Zn Br Kr Ag I Xe'.split(' '));
const isFormula = (m) => /\d/.test(m) && (m.match(/[A-Z][a-z]?\d*/g) || []).join('') === m
  && m.match(/[A-Z][a-z]?\d*/g).every((g) => { const [, el, n] = g.match(/^([A-Z][a-z]?)(\d*)$/); return ELEMENTS.has(el) && n.length <= 2; });
export function stripFormulas(text) {
  return String(text).replace(/\b[A-Z][A-Za-z0-9]{0,15}\b/g, (m) => (isFormula(m) ? ' ' : m));
}

// The store describes every investigation as microgravity or low gravity (LIM-001). A sentence that mentions partial,
// reduced, lunar or Martian gravity is accepted only if it also states absence or negation (e.g. "no partial-gravity
// data", "do not establish lunar-gravity behaviour"). This is a sentence-level heuristic: it rejects affirmative
// statements such as "SAFFIRE-II provides partial-gravity data"; it cannot judge every negated sentence.
const GRAVITY = /\b(?:partial|reduced|lunar|martian|mars|moon)[- ]?gravity\b|\bhypogravity\b|\b(?:lunar|martian)[- ]g\b/i;
const NEGATION = /\b(?:no|not|none|never|neither|nor|without|absent|absence|lacks?|lacking|cannot|unavailable|missing|nothing|unknown|untested)\b|n't\b/i;
export function gravityWordingErrors(texts) {
  const out = [];
  for (const t of texts) for (const s of String(t || '').split(/(?<=[.!?;])\s+|\n+/)) if (GRAVITY.test(s) && !NEGATION.test(s)) out.push(`gravity wording: "${s.trim().slice(0, 90)}" mentions partial, lunar or Martian gravity without stating that no such data exist`);
  return out;
}

// Short machine-readable codes for validator messages (used in retry diagnostics).
const CODES = [[/not valid JSON/, 'json_invalid'], [/citation not in evidence pack|record id not in evidence pack|unknown investigation|not an investigation id/, 'citation_not_in_pack'],
  [/report_derived finding must cite/, 'report_citation_kind'], [/plan_or_metadata finding must cite/, 'plan_citation_kind'],
  [/measured_data finding must cite|calculated finding must cite|uncited|citations must be an array/, 'citation_kind'], [/evidence belongs to/, 'citation_wrong_investigation'],
  [/but none of its cited evidence/, 'ungrounded_term'], [/banned claim wording/, 'banned_wording'], [/gravity wording/, 'gravity_wording'],
  [/numbers not found/, 'unsupported_number'], [/LIM-001|cited limitation/, 'missing_limitation'], [/name at least one investigation/, 'missing_investigations'],
  [/insufficient_evidence|question class|status|answered without findings/, 'status_rule'], [/direct_answer|must be an array|text$|bad evidence_class|not an object/, 'schema']];
export function errorCode(msg) { const hit = CODES.find(([re]) => re.test(String(msg))); return hit ? hit[1] : 'other'; }
