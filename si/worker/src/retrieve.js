// Deterministic retrieval: no model involved. Builds an EvidencePack from the pinned bundle.
import B from './bundle.js';
import { namedInvestigations, PASSAGES_BY_KIND } from './investigations.js';
import { materialSources } from './grounding.js';

const ALIASES = {
  'PSI-10': ['acme', 'flame design', 'extinction temperature', 'normal flame', 'inverse flame', 'ethylene', 'propane', 'burner', 'radiative extinction', 'psi-10'],
  'PSI-159': ['cool flame', 'cfi-g', 'ethane', 'butane', 'psi-159', 'pci'],
  'PSI-98': ['saffire-i', 'saffire-1', 'saffire i', 'psi-98', 'saffire'],
  'PSI-99': ['saffire-ii', 'saffire ii', 'saffire-2', 'saffire', 'silicone', 'sibal', 'pmma', 'nomex', 'cotton', 'psi-99', 'burn', 'burning', 'solid', 'material', 'materials', 'fabric', 'flow', 'thickness', 'spacecraft fire'],
  'PSI-69': ['flex', 'droplet', 'suppress', 'suppression', 'suppressant', 'methanol', 'heptane', 'diluent', 'helium', 'co2', 'gaseous', 'psi-69', 'extinguish'],
  'PSI-101': ['same-r', 'same r', 'smoke', 'particle', 'detect', 'aerosol', 'psi-101', 'aging', 'aged', 'kapton', 'teflon', 'lampwick', 'pyrell'],
};
const SOLID = ['solid', 'material', 'materials', 'fabric', 'teflon', 'silicone', 'cotton', 'lampwick'];
const LIQUID = /droplet|liquid|heptane|methanol|\bfuel\b|flex|suppress|diluent|extinguish/;
const BROADEN = /\b(other|others|compare|compared|comparison|versus|vs\.?|besides|related|similar|alongside)\b/;
const STOP = new Set('the a an of and or in to is are was were what does do can it for on with this that how which about from by at as be tell me show there any our'.split(' '));
const tok = (s) => (s.toLowerCase().match(/[a-z0-9][a-z0-9.\-]*/g) || []).filter((t) => !STOP.has(t));

function bm25(docs, q) { // tiny BM25 over short documents; deterministic
  const N = docs.length, df = {}, tf = docs.map((d) => { const m = {}; d.forEach((t) => (m[t] = (m[t] || 0) + 1)); Object.keys(m).forEach((t) => (df[t] = (df[t] || 0) + 1)); return m; });
  const avg = docs.reduce((a, d) => a + d.length, 0) / N || 1;
  return docs.map((d, i) => q.reduce((s, t) => { if (!tf[i][t]) return s; const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5)); const f = tf[i][t]; return s + idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.length / avg)); }, 0));
}

export function classify(question) {
  const q = question.toLowerCase();
  const asksPartialGravityData = /(partial|lunar|moon|mars|martian|reduced)[ -]*(gravity|g\b)|lunar habitat|hypogravity/.test(q) && /(data|dataset|measure|tests?|exist|available|have|any)/.test(q) && /(is there|are there|do we have|any|does the|exist|available|actual)/.test(q);
  const asksValidatedRisk = /(probab|likelihood|chance|risk)/.test(q) && /(valid|establish|quantif|calculate|determine|certif|safe)/.test(q);
  const asksSafetyGuarantee = /(is it safe|guarantee|certif)/.test(q);
  // Not used to force insufficiency. asksWhichInvestigations: the answer must name investigations from the pack.
  // mentionsPartialGravityContext: the answer must cite LIM-001 (microgravity results do not establish lunar/Martian behaviour).
  const asksWhichInvestigations = /\bwhich (investigations?|experiments?|datasets?|studies|tests)\b|\b(most )?relevant (investigations?|experiments?|datasets?|studies)\b|\bwhat (investigations?|experiments?|datasets?|studies) (are|is)\b/.test(q);
  const mentionsPartialGravityContext = /lunar|\bmoon\b|\bmars\b|martian|partial[ -]?gravity|reduced[ -]?gravity|hypogravity|habitat/.test(q);
  return { mustBeInsufficient: asksPartialGravityData || asksValidatedRisk || asksSafetyGuarantee, asksPartialGravityData, asksValidatedRisk, asksSafetyGuarantee, asksWhichInvestigations, mentionsPartialGravityContext };
}

export function buildPack(question) {
  const q = question.toLowerCase(), qt = tok(question);
  const cls = classify(question);
  const score = {};
  for (const [id, al] of Object.entries(ALIASES)) score[id] = al.reduce((s, a) => s + (q.includes(a) ? (a.length > 5 ? 2 : 1) : 0), 0);
  if (SOLID.some((w) => q.includes(w))) { score['PSI-99'] += 2; score['PSI-98'] += 1; score['PSI-101'] += 1; }
  const solidFocus = SOLID.some((w) => q.includes(w)) && !LIQUID.test(q);
  // FLEX is liquid-droplet combustion (LIM-016): a habitat/lunar mention alone does not make it relevant to a solid-material question.
  if (/lunar|habitat|moon|partial|mars/.test(q)) { if (!solidFocus) score['PSI-69'] += 1; score['PSI-99'] += 1; }
  let ranked = Object.entries(score).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  let selected = ranked.filter(([, s]) => s > 0).slice(0, 4).map(([id]) => id);
  // A question that names investigations explicitly (e.g. "SAFFIRE-II") is about those investigations. Keyword spill-over
  // (e.g. "materials" -> SAME-R) would otherwise fill the pack with other investigations' passages that the model could
  // mis-cite. Not applied when the question asks to compare or to look beyond the named ones.
  const named = namedInvestigations(question);
  if (named.length && !BROADEN.test(q)) selected = named;
  const general = selected.length === 0 || cls.mustBeInsufficient;
  if (general) selected = B.investigations.map((i) => i.id);
  const invs = B.investigations.filter((i) => selected.includes(i.id));

  // passages: BM25 over quote+used_for, restricted to selected investigations, plus top overall
  const pdocs = B.passages.map((p) => tok(p.quote + ' ' + (p.used_for || '') + ' ' + p.id));
  const ps = bm25(pdocs, qt);
  const ranked_p = B.passages.map((p, i) => ({ p, s: ps[i] + Math.min(p.quote.length, 200) / 400 + (selected.includes(p.id.split(':')[0]) ? 0.5 : 0) }))
    .filter((x) => selected.includes(x.p.id.split(':')[0]) && x.s > 0.5).sort((a, b) => b.s - a.s || a.p.id.localeCompare(b.p.id));
  let passages;
  if (general) passages = ranked_p.slice(0, 8).map((x) => x.p); // unchanged for whole-store (insufficient-evidence) questions
  else { // every selected investigation keeps its best passage, so one investigation cannot crowd out another's sources
    const first = selected.map((id) => ranked_p.find((x) => x.p.id.split(':')[0] === id)).filter(Boolean);
    passages = [...first, ...ranked_p.filter((x) => !first.includes(x))].slice(0, 8).sort((a, b) => b.s - a.s || a.p.id.localeCompare(b.p.id)).map((x) => x.p);
  }

  // limitations: mandatory inclusion for selected investigations (+LIM-001 always), ranked by BM25, capped
  const ldocs = B.limitations.map((l) => tok(l.title + ' ' + l.description));
  const ls = bm25(ldocs, qt);
  let lims = B.limitations.map((l, i) => ({ l, s: ls[i] + (l.id === 'LIM-001' ? 100 : 0) + (l.investigations.some((x) => selected.includes(x)) && !l.investigations.every((x) => B.investigations.length === l.investigations.length) ? 1 : 0) }))
    .filter((x) => x.l.id === 'LIM-001' || x.l.investigations.some((id) => selected.includes(id)))
    .sort((a, b) => b.s - a.s || a.l.id.localeCompare(b.l.id)).slice(0, general ? 8 : 10).map((x) => x.l);
  if (selected.includes('PSI-69') && !lims.some((l) => l.id === 'LIM-016')) lims.push(B.limitations.find((l) => l.id === 'LIM-016'));
  const trim = (l) => ({ id: l.id, title: l.title, description: l.description.slice(0, 450), what_is_not_known: l.what_is_not_known, interpretation_boundary: l.interpretation_boundary });

  const calcWanted = (c) => c.id === 'calc:partial_gravity' || selected.some((s) => c.id === 'calc:count:' + s) || (c.id.startsWith('calc:flex') && selected.includes('PSI-69')) || (c.id === 'calc:samer:breakdown' && selected.includes('PSI-101'));
  const calcs = B.calcs.filter(calcWanted).map((c) => ({ ...c, record_ids: c.record_ids.slice(0, 20), record_ids_total: c.record_ids.length }));
  // A "which investigations are relevant" question needs what each investigation tested, not every row: it gets the
  // experiment ('sample') records only, without DoD rows, CSV notes and reference rows. This keeps the pack, and the
  // model's answer, small enough to finish inside the per-call time budget (first live evaluation: Q1 timed out).
  const keepRow = (r) => !cls.asksWhichInvestigations || r.kind === 'sample';
  const small = {}; for (const id of selected) if (B.small_investigation_records[id] && !general) small[id] = B.small_investigation_records[id].filter(keepRow);
  const rules = B.comparison_rules.filter((r) => ['CR-01', 'CR-20', 'CR-21', 'CR-22'].includes(r.id) || (selected.includes('PSI-98') && r.id === 'CR-17') || (selected.includes('PSI-99') && r.id === 'CR-19'));
  const invOut = invs.map((i) => ({ id: i.id, name: i.name, notes: i.notes, gravity_regime: i.gravity_regime && i.gravity_regime.statement, gravity_basis: i.gravity_regime && i.gravity_regime.status, partial_gravity_data_present: i.partial_gravity_data.present, source_passages_by_kind: PASSAGES_BY_KIND[i.id], source_files: i.source_files, observed_fuel_or_material_values: i.observed_fuel_or_material_values, stats: i.stats }));

  const smallIds = Object.values(small).flat().map((r) => r.id);
  const smallCompact = Object.fromEntries(Object.entries(small).map(([k, v]) => [k, v.map((r) => r.id + ' | ' + r.kind + ' | ' + Object.entries(r.fields).filter(([, x]) => x !== null && x !== '').map(([a, b]) => a + ': ' + b).join('; ') + (r.flags.length ? ' | flags: ' + r.flags.join(',') : ''))]));
  const pack = { store_sha256: B.store_sha256, question_class: cls, investigations: invOut, passages, limitations: lims.map(trim), calculations: calcs, records: smallCompact, comparison_rules: rules,
    identifier_groups: !cls.asksWhichInvestigations && selected.some((s) => ['PSI-69', 'PSI-101'].includes(s)) ? (B.identifier_groups.items || B.identifier_groups.groups || B.identifier_groups) : undefined };
  // Relevance questions name materials across several investigations (live run #3: Q1 named silicone, Kapton and Pyrell
  // with citations that never mention them). Give the model the exact ids that name each material in this pack.
  if (cls.asksWhichInvestigations) pack.material_sources = materialSources(pack);
  const ids = new Set();
  invOut.forEach((i) => ids.add(i.id)); passages.forEach((p) => ids.add(p.id)); lims.forEach((l) => ids.add(l.id)); rules.forEach((r) => ids.add(r.id));
  calcs.forEach((c) => { ids.add(c.id); c.record_ids.forEach((r) => ids.add(r)); });
  smallIds.forEach((r) => ids.add(r));
  const grp = JSON.stringify(pack.identifier_groups || '');
  (grp.match(/IG-[A-Za-z0-9_\-]+/g) || []).forEach((g) => ids.add(g));
  return { pack, ids, selected, general, cls };
}
