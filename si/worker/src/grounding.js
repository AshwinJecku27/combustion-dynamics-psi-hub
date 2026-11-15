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

// For each substance or material the pack names, the ids of the records, source passages and calculations whose own
// text names it (limitations and investigation metadata are left out: they are context, not the exact source). Derived
// only from the pack's text, so it can never point at evidence the pack does not hold. A term with no entry has no
// exact source in the pack and must be omitted from findings.
export function materialSources(pack) {
  const texts = evidenceTexts(pack); const out = {};
  const exact = (id) => /^calc:/.test(id) || /^PSI-\d+:/.test(id);
  for (const [term, res] of Object.entries(TERMS)) {
    const ids = [...texts].filter(([id, t]) => exact(id) && res.some((re) => re.test(t))).map(([id]) => id);
    if (ids.length) out[term] = ids;
  }
  return out;
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

// The store describes every investigation as microgravity or low gravity (LIM-001); none is a partial-gravity
// experiment. Each mention of partial, reduced, lunar or Martian gravity must therefore be an explicit ABSENCE statement.
// The absence must be attached to that mention inside its own clause (clauses end at , ; : ( ) and at but / while /
// whereas / although / though / however / yet): a negation elsewhere in the sentence does not count. Accepted forms:
//   before the mention: "no / without / absence of / lack of [actual|lunar or|any ...] <mention>"; "..., not [actual] <mention>";
//                       "<subject> do(es)/did/is/are/... not <verb> [at|in|under|for] [any] <mention>"  (never/cannot too);
//                       "an empty list/set of <...> with <mention>"; "none of the investigations has <mention>";
//                       "no <investigation|experiment|dataset|file|record> <verb> [any] <mention>";
//   after the mention:  "<mention> [data|tests|...] is/are/was/were absent|unavailable|missing|not available|not tested|...",
//                       "<mention> ... does/do not exist"; "whether ... <mention> ... is not tested / is unknown".
// Everything else (affirmative, hedged or ambiguous, e.g. "limited partial-gravity data", "would need partial-gravity
// tests") is rejected; the model can always restate it in one of the accepted forms.
const GRAVITY = /\b(?:partial|reduced|lunar|martian|mars|moon)[- ]?gravity\b|\bhypogravity\b|\b(?:lunar|martian)[- ]g\b/gi;
const CLAUSE_END = /[,;:()]|\b(?:but|while|whereas|although|though|however|yet)\b/gi;
// Filler words may carry a suspended hyphen ("no actual lunar- or partial-gravity data").
const FILL = String.raw`(?:(?:actual|real|measured|true|direct|experimental|genuine|lunar|martian|mars|moon|or|and|nor|such|any|reduced|partial|combustion|fire)-?)`;
const PRE = [
  new RegExp(String.raw`\b(?:no|without|zero|absence of|lack of|lacks|lacking)\s+(?:${FILL}\s+){0,3}$`, 'i'),
  // "no data on combustion at lunar gravity", "no experiments conducted in partial gravity" (evaluation run #4, Q6)
  new RegExp(String.raw`\bno\s+(?:${FILL}\s+){0,2}(?:data|datasets?|measurements?|experiments?|tests?|results?|evidence|observations?|investigations?)\s+(?:(?:on|of|for|about)\s+(?:(?:${FILL}|flames?|burning)\s+){1,2})?(?:(?:obtained|collected|measured|conducted|performed|recorded|run)\s+)?(?:at|in|under|from|for|on)\s+(?:${FILL}\s+){0,2}$`, 'i'),
  new RegExp(String.raw`\b(?:rather than|instead of|as opposed to)\s+(?:${FILL}\s+){0,2}$`, 'i'), // "microgravity rather than lunar gravity"
  new RegExp(String.raw`\bnot\s+(?:${FILL}\s+){0,2}$`, 'i'), // contrast: "... in microgravity or low gravity, not partial gravity"
  new RegExp(String.raw`\b(?:(?:do|does|did|is|are|was|were|has|have|had|can|could|would|will)(?:n't|\s+not)|cannot|never)\s+(?:\w+ly\s+)?(?:contain|include|hold|have|provide|report|record|establish|predict|show|represent|reproduce|cover|test|measure|offer|give|simulate|study|address|involve|conducted|performed|run|done|carried out|made|tested|measured|recorded|studied|obtained|acquired|collected)(?:\s+(?:at|in|under|for|on|about))?\s+(?:any\s+)?(?:${FILL}\s+){0,2}$`, 'i'),
  new RegExp(String.raw`\bempty\s+(?:list|set|array|result)\s+(?:of\s+(?:[\w-]+\s+){0,3})?(?:with|having|that\s+(?:have|has|contain|report)|containing|reporting)\s+(?:any\s+)?(?:${FILL}\s+){0,2}$`, 'i'),
  new RegExp(String.raw`\bnone\s+of\s+(?:(?:them|these|those)|(?:the\s+)?(?:[\w-]+\s+){0,2}(?:investigations?|experiments?|datasets?|tests?|files?|records?))\s+(?:has|have|contains?|includes?|reports?|provides?|records?|holds?|(?:was|were)\s+(?:conducted|performed|run|done|carried out|tested)\s+(?:at|in|under))\s+(?:any\s+)?(?:${FILL}\s+){0,2}$`, 'i'),
  new RegExp(String.raw`\bno\s+(?:[\w-]+\s+){0,2}(?:investigations?|experiments?|datasets?|tests?|files?|records?)\s+(?:\w+ly\s+)?(?:has|have|contains?|includes?|reports?|provides?|records?|holds?|covers?|(?:was|were)\s+(?:conducted|performed|run|done|carried out|tested)\s+(?:at|in|under))\s+(?:any\s+)?(?:${FILL}\s+){0,2}$`, 'i'),
];
const POST = /^\s*(?:[\w-]+\s+){0,3}?(?:(?:is|are|was|were|remains?)\s+(?:absent|unavailable|missing|lacking|untested|unknown|not\s+(?:available|present|included|recorded|tested|known|measured|covered|established|part of|in))|(?:does|do|did)\s+not\s+exist|(?:does|do)n't\s+exist|(?:has|have)\s+not\s+been\s+(?:tested|measured|studied|recorded))\b/i;
const WHETHER = /^\s*whether\b/i;
const WHETHER_TAIL = /\b(?:is|are|remains?)\s+(?:not\s+(?:tested|known|established)|unknown|untested)\b/i;

function clauseAround(sentence, start, end) {
  let a = 0, b = sentence.length; CLAUSE_END.lastIndex = 0; let m;
  while ((m = CLAUSE_END.exec(sentence))) { if (m.index + m[0].length <= start) a = m.index + m[0].length; else if (m.index >= end) { b = m.index; break; } }
  return { pre: sentence.slice(a, start), post: sentence.slice(end, b), clause: sentence.slice(a, b) };
}
export function absenceStated(sentence, start, end) {
  const { pre, post, clause } = clauseAround(sentence, start, end);
  if (PRE.some((re) => re.test(pre))) return true;
  if (POST.test(post)) return true;
  return WHETHER.test(sentence) && WHETHER_TAIL.test(clause + sentence.slice(end));
}
// An absence statement covers THIS evidence store only. Claims about all research, anywhere or ever, are not supported
// by the store and are rejected even when phrased as absence.
const OVERCLAIM = /\b(?:anywhere|in the world|in existence|ever(?:\s+been)?|ha(?:s|ve) never been|no one|nobody|no (?:other )?(?:research|study|studies|scientist|agency))\b/i;
const sentences = (t) => String(t || '').split(/(?<=[.!?])\s+|\n+/);
export function gravityWordingErrors(texts) {
  const out = [];
  for (const t of texts) for (const s of sentences(t)) {
    GRAVITY.lastIndex = 0; let m, any = false;
    while ((m = GRAVITY.exec(s))) { any = true; if (!absenceStated(s, m.index, m.index + m[0].length)) { out.push(`gravity wording: "${s.trim().slice(0, 90)}" mentions ${m[0]} without an explicit statement that no such data exist`); any = false; break; } }
    if (any && OVERCLAIM.test(s)) out.push(`gravity wording: "${s.trim().slice(0, 90)}" claims more than this evidence store can show (absence applies to the integrated PSI evidence store only)`);
  }
  return out;
}
// True if the texts contain at least one partial/lunar/Martian-gravity mention stated as absent (see absenceStated).
export function statesGravityAbsence(texts) {
  for (const t of texts) for (const s of sentences(t)) { GRAVITY.lastIndex = 0; let m; while ((m = GRAVITY.exec(s))) if (absenceStated(s, m.index, m.index + m[0].length)) return true; }
  return false;
}

// Short machine-readable codes for validator messages (used in retry diagnostics).
const CODES = [[/not valid JSON/, 'json_invalid'], [/citation not in evidence pack|record id not in evidence pack|unknown investigation|not an investigation id/, 'citation_not_in_pack'],
  [/report_derived finding must cite/, 'report_citation_kind'], [/plan_or_metadata finding must cite/, 'plan_citation_kind'],
  [/measured_data finding must cite|calculated finding must cite|uncited|citations must be an array/, 'citation_kind'], [/evidence belongs to/, 'citation_wrong_investigation'],
  [/but none of its cited evidence/, 'ungrounded_term'], [/banned claim wording/, 'banned_wording'], [/gravity wording/, 'gravity_wording'],
  [/numbers not found/, 'unsupported_number'], [/must state explicitly that the evidence store contains no/, 'explicit_absence'], [/risk number/, 'risk_number'], [/LIM-001|cited limitation/, 'missing_limitation'], [/name at least one investigation/, 'missing_investigations'],
  [/insufficient_evidence|question class|status|answered without findings/, 'status_rule'], [/direct_answer|must be an array|text$|bad evidence_class|not an object/, 'schema']];
export function errorCode(msg) { const hit = CODES.find(([re]) => re.test(String(msg))); return hit ? hit[1] : 'other'; }
