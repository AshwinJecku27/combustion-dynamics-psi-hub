#!/usr/bin/env node
// Cross-checks the evidence store v1.1 data EMBEDDED in si/worker/src/bundle.js against what can be checked
// in this repository. It does NOT verify the evidence store itself: the original si-evidence/ files (and the
// file(s) whose SHA-256 is a77e5548...) were not supplied. See si/evidence/README.md.
//
// Comparison sources:
//  - the release candidate's own manifest (si-release/SHA256SUMS.txt) for the bundle file hash;
//  - the frozen v1 dashboard arrays (src/data.js, src/data2.js), a SEPARATE derivation from the same NASA PSI
//    source files made earlier in the project. Agreement shows consistency between the two derivations, not
//    correctness against the NASA files, which are not in the repository either.
//
// Run from the repository root:  node si/evidence/verify_embedded.mjs [--md out.md]
// Exit code 1 if any check FAILs. DIFF = a documented representational difference; INFO = recorded, not judged.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const STORE_SHA = 'a77e55486a4d25f0c284c3467b485f9cc3aeded142a285a9e346357870aed548';

export async function loadV1() {
  const code = (await readFile(path.join(ROOT, 'src/data.js'), 'utf8')) + '\n' + (await readFile(path.join(ROOT, 'src/data2.js'), 'utf8')) + '\n;({FD,CF,FL,SF2,DOD,IMG,FX,SR,SRM,SRT})';
  return vm.runInNewContext(code, {}, { timeout: 5000 });
}

export async function runChecks() {
  const out = []; const add = (area, check, status, detail) => out.push({ area, check, status, detail });
  const B = (await import(pathToFileURL(path.join(ROOT, 'si/worker/src/bundle.js')).href)).default;
  const V = await loadV1();
  const ids = new Set(B.all_record_ids); const idsOf = (p) => B.all_record_ids.filter((x) => x.startsWith(p + ':'));
  const setEq = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

  // 1. File integrity and pinning
  const manifest = await readFile(path.join(ROOT, 'si-release/SHA256SUMS.txt'), 'utf8');
  const want = (manifest.match(/^([0-9a-f]{64})\s+\.\/si-api\/src\/bundle\.js$/m) || [])[1];
  const got = sha(await readFile(path.join(ROOT, 'si/worker/src/bundle.js')));
  add('Integrity', 'si/worker/src/bundle.js SHA-256 equals the release candidate manifest entry', got === want ? 'PASS' : 'FAIL', got);
  add('Integrity', 'bundle declares store_version 1.1 and store_sha256 a77e5548…', B.store_version === '1.1' && B.store_sha256 === STORE_SHA ? 'PASS' : 'FAIL', `${B.store_version} / ${B.store_sha256}`);
  const html = await readFile(path.join(ROOT, 'si/dashboard/si.html'), 'utf8');
  add('Integrity', 'si/dashboard/si.html embeds the same store_sha256', html.includes(`"store_sha256":"${STORE_SHA}"`) ? 'PASS' : 'FAIL', '');
  add('Integrity', 'store_sha256 recomputed from the original store files', 'NOT VERIFIABLE', 'si-evidence/ (the hashed store files) was not supplied; the hash is a declared value only');

  // 2. Internal consistency
  const limIds = new Set(B.limitations.map((l) => l.id));
  const expectLims = Array.from({ length: 23 }, (_, i) => 'LIM-' + String(i + 1).padStart(3, '0'));
  add('Internal', 'limitations LIM-001…LIM-023 all present, no extras', setEq(limIds, new Set(expectLims)) ? 'PASS' : 'FAIL', `${limIds.size} limitations`);
  const refs = [...Object.values(B.small_investigation_records).flat().flatMap((r) => r.limitation_ids || [])];
  add('Internal', 'every limitation id referenced by embedded records exists', refs.every((x) => limIds.has(x)) ? 'PASS' : 'FAIL', `${refs.length} references`);
  const calcIds = B.calcs.flatMap((c) => c.record_ids || []);
  add('Internal', 'every record id cited by a calculation exists in all_record_ids', calcIds.every((x) => ids.has(x)) ? 'PASS' : 'FAIL', `${calcIds.length} citations`);
  add('Internal', 'all_record_ids and passage ids are unique', ids.size === B.all_record_ids.length && new Set(B.passages.map((p) => p.id)).size === B.passages.length ? 'PASS' : 'FAIL', `${ids.size} records, ${B.passages.length} passages`);
  for (const c of B.calcs.filter((c) => c.id.startsWith('calc:count:'))) {
    const inv = c.id.slice(11); const n = idsOf(inv).length; const st = B.investigations.find((i) => i.id === inv).stats.n_records;
    add('Internal', `${c.id}: value equals number of ${inv} record ids and investigation stats`, c.value.n_records === n && n === st ? 'PASS' : 'FAIL', `${c.value.n_records} / ${n} / ${st}`);
  }
  add('Internal', 'no investigation flags partial-gravity data as present (LIM-001)', B.investigations.every((i) => i.partial_gravity_data.present === false) && Array.isArray(B.calcs.find((c) => c.id === 'calc:partial_gravity').value) && B.calcs.find((c) => c.id === 'calc:partial_gravity').value.length === 0 ? 'PASS' : 'FAIL', '');

  // 3. Cross-derivation against the frozen v1 arrays
  const norm = (s) => String(s).replace(/\s+/g, '');
  // PSI-10
  const s10 = new Set(idsOf('PSI-10').map((x) => x.split(':')[2])); const v10 = new Set(V.FD.map((r) => norm(r[9])));
  add('PSI-10', 'all 147 v1 steady-flame test ids are store ids', [...v10].every((x) => s10.has(x)) && v10.size === 147 ? 'PASS' : 'FAIL', `${v10.size} v1 ids, ${s10.size} store ids`);
  add('PSI-10', 'store has 60 more rows than v1 (ramped rows, LIM-003)', s10.size - v10.size === 60 ? 'PASS' : 'FAIL', `${s10.size - v10.size} extra; field values of PSI-10 rows are not embedded and cannot be compared`);
  // PSI-159
  const s159 = new Set(idsOf('PSI-159').map((x) => x.split(':')[2])); const v159 = new Set(V.CF.map((r) => norm(r[9])));
  add('PSI-159', 'store test ids equal v1 ids (spaces removed, LIM-005)', setEq(s159, v159) ? 'PASS' : 'FAIL', `${s159.size} / ${v159.size}`);
  // PSI-69 FLEX
  const s69 = new Set(idsOf('PSI-69').map((x) => Number(x.split(':')[2]))); const v69 = new Set(V.FX.map((r) => r[0]));
  add('PSI-69', 'store test numbers equal v1 FLEX test numbers 1…274', setEq(s69, v69) && v69.size === 274 ? 'PASS' : 'FAIL', `${s69.size} / ${v69.size}`);
  const tid = (n) => 'PSI-69:test:' + String(n).padStart(3, '0');
  for (const [cid, pred] of [['calc:flex:o2_gt_0.30', (o) => o > 0.30 + 1e-12], ['calc:flex:o2_eq_0.30', (o) => Math.abs(o - 0.30) < 1e-12]]) {
    const c = B.calcs.find((x) => x.id === cid); const mine = new Set(V.FX.filter((r) => pred(r[4])).map((r) => tid(r[0])));
    add('PSI-69', `${cid} recomputed from v1 O2 column`, c.value === mine.size && setEq(new Set(c.record_ids), mine) ? 'PASS' : 'FAIL', `store ${c.value}, v1 ${mine.size}`);
  }
  add('PSI-69', 'FLEX "CO" column stays undefined / probable CO2 only (LIM-012)', /not defined/.test(B.limitations.find((l) => l.id === 'LIM-012').title) ? 'PASS' : 'FAIL', 'qualification unchanged; not resolvable without the FLEX data dictionary');
  // PSI-101 SAME-R
  const s101 = new Set(idsOf('PSI-101').map((x) => x.split(':')[2])); const v101 = new Set(V.SR.map((r) => `${r[1]}-${V.SRM[r[0]]}`));
  add('PSI-101', 'store row ids equal v1 SAME-R (test number + material) for 109 records', setEq(s101, v101) && v101.size === 109 ? 'PASS' : 'FAIL', `${s101.size} / ${v101.size}`);
  const bd = {}; V.SR.forEach((r) => { const k = `${V.SRM[r[0]]} | ${/a$/.test(r[1]) ? 'aged' : 'primary'}`; bd[k] = (bd[k] || 0) + 1; });
  const cb = B.calcs.find((x) => x.id === 'calc:samer:breakdown').value;
  add('PSI-101', 'calc:samer:breakdown recomputed from v1 (material x primary/aged)', JSON.stringify(Object.keys(cb).sort().map((k) => [k, cb[k]])) === JSON.stringify(Object.keys(bd).sort().map((k) => [k, bd[k]])) ? 'PASS' : 'FAIL', JSON.stringify(bd));
  // PSI-99 SAFFIRE-II: full field comparison
  const F = ['sample_number', 'material', 'thickness_raw', 'length_raw', 'width_raw', 'air_flow_raw', 'percent_o2_raw', 'ignition_power_raw', 'ignition_time_raw', 'burn_time_raw', 'flow_direction', 'ug_burn_length_raw', 'ug_spread_length_raw', 'g1_burn_length_raw', 'g1_spread_rate_raw', 'camera_1', 'camera_2'];
  const samples = B.small_investigation_records['PSI-99'].filter((r) => r.kind === 'sample'); let same = 0; const diffs = [];
  for (const row of V.SF2) {
    const s = samples.find((x) => x.fields.sample_number === row[0]); if (!s) { diffs.push(`${row[0]}: missing`); continue; }
    F.forEach((f, i) => { const a = row[i] == null ? null : String(row[i]); const b = s.fields[f] == null ? null : String(s.fields[f]); if (a === b) same++; else diffs.push(`${row[0]}.${f}: v1 ${JSON.stringify(a)} vs store ${JSON.stringify(b)}`); });
  }
  const onlyNa = diffs.every((d) => /: v1 null vs store "(n\/a|)"$/.test(d)); // missing-value representation only
  add('PSI-99', `9 samples x ${F.length} fields compared with v1 SF2`, samples.length === 9 && !diffs.length ? 'PASS' : onlyNa && samples.length === 9 ? 'DIFF' : 'FAIL', `${same} identical; ${diffs.length} differ${diffs.length ? ': ' + diffs.join('; ') : ''}${onlyNa && diffs.length ? ' (all are missing values: v1 null where the store keeps the raw "n/a" or empty string; no value disagrees)' : ''}`);
  add('PSI-99', 'CSV/DoD thickness disagreement kept unresolved (flag + LIM-009)', samples.filter((s) => s.flags.includes('PSI99_THICKNESS_CSV_DOD_MISMATCH')).length > 0 && /disagree/.test(B.limitations.find((l) => l.id === 'LIM-009').title) ? 'PASS' : 'FAIL', `${samples.filter((s) => s.flags.includes('PSI99_THICKNESS_CSV_DOD_MISMATCH')).length} samples flagged`);
  // PSI-98 SAFFIRE-I
  const p98 = B.small_investigation_records['PSI-98'].filter((r) => r.kind === 'sample');
  const app = await readFile(path.join(ROOT, 'src/app3.js'), 'utf8');
  const s1 = p98.find((r) => r.fields.sample_number === 'S1').fields, s2 = p98.find((r) => r.fields.sample_number === 'S2').fields;
  add('PSI-98', 'S1 concurrent 420 s, S2 opposed 70 s (as in the v1 dashboard)', s1.burn_time === '420' && s1.flow_direction === 'Concurrent' && s2.burn_time === '70' && s2.flow_direction === 'Opposed' && /420/.test(app) && /\b70\b/.test(app) ? 'PASS' : 'FAIL', '');
  add('PSI-98', 'thickness kept as raw "0.37", unit flagged disputed, no conversion (LIM-008)', [s1, s2].every((f) => f.thickness === '0.37') && p98.every((r) => r.flags.includes('PSI98_THICKNESS_UNIT_DISPUTED')) && /Do not convert/.test(B.limitations.find((l) => l.id === 'LIM-008').interpretation_boundary) ? 'PASS' : 'FAIL', 'unit remains unresolved');

  // 4. What cannot be checked here
  add('Not verifiable', 'report passages (34 quotes with page numbers) match the NASA PDFs', 'NOT VERIFIABLE', 'PDFs not in the repository');
  add('Not verifiable', 'field values of PSI-10, PSI-159, PSI-69 and PSI-101 records in the store', 'NOT VERIFIABLE', 'the bundle embeds only ids, stats and calculations for these investigations; the store record files were not supplied');
  add('Not verifiable', 'either derivation (store or v1 arrays) against the NASA CSV files', 'NOT VERIFIABLE', 'source CSVs not in the repository (data/README.md)');
  return out;
}

export function toMarkdown(rows) {
  const c = (s) => rows.filter((r) => r.status === s).length;
  const L = ['# Embedded evidence store v1.1: cross-check results', '', `Generated by \`node si/evidence/verify_embedded.mjs --md si/evidence/VERIFICATION_RESULTS.md\`. PASS ${c('PASS')}, DIFF ${c('DIFF')}, FAIL ${c('FAIL')}, NOT VERIFIABLE ${c('NOT VERIFIABLE')}.`, '',
    'These checks test the bundle against the release manifest, itself, and the frozen v1 dashboard arrays. They do **not** reproduce the store hash `a77e5548…` and do not compare anything with the original NASA files. See README.md in this folder.', '',
    '| Area | Check | Status | Detail |', '|---|---|---|---|'];
  rows.forEach((r) => L.push(`| ${r.area} | ${r.check} | ${r.status} | ${String(r.detail).replace(/\|/g, '\\|')} |`));
  return L.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const rows = await runChecks();
  rows.forEach((r) => console.log(`${r.status.padEnd(14)} ${r.area.padEnd(14)} ${r.check}${r.detail ? '  [' + String(r.detail).slice(0, 160) + ']' : ''}`));
  const i = process.argv.indexOf('--md'); if (i > 0) await writeFile(process.argv[i + 1], toMarkdown(rows));
  process.exit(rows.some((r) => r.status === 'FAIL') ? 1 : 0);
}
