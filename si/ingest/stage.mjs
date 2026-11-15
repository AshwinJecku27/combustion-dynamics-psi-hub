#!/usr/bin/env node
// Maintainer tool: STAGE a NASA PSI investigation for review. It never integrates anything.
//
// What it does
//   1. Requires a provenance file (source URLs, retrieval date and person, terms) and refuses to run without it.
//   2. Copies every original file byte-for-byte into <out>/<ID>/source/ and verifies SHA-256 before and after copying.
//   3. Profiles each CSV: encoding (valid UTF-8 or not), header, row and column counts, blank cells, numeric vs text
//      columns, approximate values ("~"), ranges ("a to b", "a - b"), leading-zero values ("037"), duplicate values in
//      the first column, header characters lost in encoding ("?"/U+FFFD), and byte-identical duplicate files.
//      Non-CSV files (PDF, DOCX, XLSX) are hashed and listed; no text is extracted from them.
//   4. Writes <out>/<ID>/manifest.json and <out>/<ID>/INGESTION_REPORT.md with every ambiguity listed as a decision
//      for a human and an unticked review checklist. Status is always "STAGED - NOT INTEGRATED".
// What it never does
//   - write to si/worker/src (the public evidence store bundle), the dashboards or any manifest outside <out>;
//   - convert units, repair values, fill blanks, merge duplicates or decide between conflicting sources.
// Integration into the evidence store is a separate, reviewed step: see si/ingest/README.md.
//
// Usage
//   node si/ingest/stage.mjs --id PSI-NN --source-dir <dir> --provenance <provenance.json> [--out si/ingest/staging]
//   node si/ingest/stage.mjs --verify si/ingest/staging/PSI-NN      (re-hash staged files against the manifest)
// Exit codes: 0 staged / verified; 2 bad arguments or provenance; 3 verification failed.
import { readFile, writeFile, mkdir, readdir, stat, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const TOOL_VERSION = '1.0.0';
export const REQUIRED_PROVENANCE = ['investigation_id', 'investigation_name', 'source_urls', 'retrieved_on', 'retrieved_by', 'terms_of_use'];
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export function checkProvenance(p) {
  const errs = [];
  if (!p || typeof p !== 'object') return ['provenance must be a JSON object'];
  for (const k of REQUIRED_PROVENANCE) if (p[k] === undefined || p[k] === null || p[k] === '' || (Array.isArray(p[k]) && !p[k].length)) errs.push(`provenance.${k} is required`);
  if (p.source_urls && (!Array.isArray(p.source_urls) || p.source_urls.some((u) => !/^https:\/\/\S+$/.test(u)))) errs.push('provenance.source_urls must be a list of https URLs');
  if (p.retrieved_on && !/^\d{4}-\d{2}-\d{2}$/.test(p.retrieved_on)) errs.push('provenance.retrieved_on must be YYYY-MM-DD');
  if (p.investigation_id && !/^PSI-\d+$/.test(p.investigation_id)) errs.push('provenance.investigation_id must look like PSI-NN');
  return errs;
}

// Minimal RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF). No type conversion.
export function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

const isValidUtf8 = (buf) => { try { new TextDecoder('utf-8', { fatal: true }).decode(buf); return true; } catch { return false; } };
const NUM = /^-?\d+(?:\.\d+)?$/;
export function profileCsv(buf) {
  const utf8 = isValidUtf8(buf);
  const text = utf8 ? buf.toString('utf8') : buf.toString('latin1');
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const header = rows[0] || [], body = rows.slice(1);
  const issues = [];
  if (!utf8) issues.push('File is not valid UTF-8 (profiled as latin1). Confirm the real encoding (often cp1252 or latin1) and record it; do not re-save the original.');
  if (header.some((h) => /\?|�/.test(h))) issues.push(`Header contains "?" or replacement characters, probably lost in encoding: ${header.filter((h) => /\?|�/.test(h)).join(' | ')}`);
  const widths = new Set(body.map((r) => r.length)); if (widths.size > 1 || (body[0] && body[0].length !== header.length)) issues.push(`Rows have inconsistent column counts (header ${header.length}; rows ${[...widths].join(', ')})`);
  const columns = header.map((name, j) => {
    const vals = body.map((r) => (r[j] ?? '').trim());
    const filled = vals.filter((v) => v !== '');
    const c = { name, blank: vals.length - filled.length, numeric: filled.filter((v) => NUM.test(v)).length, text: filled.filter((v) => !NUM.test(v)).length,
      approximate: filled.filter((v) => /^~/.test(v)).length, ranges: filled.filter((v) => /\d\s*(?:to|-)\s*\d/.test(v) && !NUM.test(v)).length,
      leading_zero: filled.filter((v) => /^0\d/.test(v)).length, examples_of_text: [...new Set(filled.filter((v) => !NUM.test(v)))].slice(0, 5) };
    if (c.numeric && c.text) issues.push(`Column "${name}" mixes numbers and text (${c.text} text values, e.g. ${c.examples_of_text.slice(0, 3).map((x) => JSON.stringify(x)).join(', ')}): decide how each is recorded; never coerce silently.`);
    if (c.approximate) issues.push(`Column "${name}" has ${c.approximate} approximate ("~") values: keep them flagged as approximate.`);
    if (c.ranges) issues.push(`Column "${name}" has ${c.ranges} range values: store both bounds; do not collapse to one value.`);
    if (c.leading_zero) issues.push(`Column "${name}" has ${c.leading_zero} value(s) with a leading zero and no decimal point (e.g. "037"): ambiguous; do not repair.`);
    if (c.blank) issues.push(`Column "${name}" has ${c.blank} blank cell(s): record as missing; do not fill from other files.`);
    if (!/[a-z]/i.test(name)) issues.push(`Column header ${JSON.stringify(name)} has no letters: its meaning must be documented.`);
    return c;
  });
  const first = body.map((r) => (r[0] ?? '').trim()).filter(Boolean); const seen = new Map(); first.forEach((v) => seen.set(v, (seen.get(v) || 0) + 1));
  const dups = [...seen].filter(([, n]) => n > 1).map(([v, n]) => `${v} (x${n})`);
  if (dups.length) issues.push(`First column "${header[0]}" has duplicate values: ${dups.slice(0, 10).join(', ')}. Keep every record; do not merge.`);
  return { encoding: utf8 ? 'utf-8' : 'not utf-8 (profiled as latin1)', rows: body.length, columns: header.length, header, column_profile: columns, duplicate_first_column_values: dups, issues };
}

async function listFiles(dir) { const out = []; for (const e of await readdir(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...await listFiles(p)); else out.push(p); } return out.sort(); }

export async function stage({ id, sourceDir, provenance, out, integratedIds = [] }) {
  const perrs = checkProvenance(provenance);
  if (provenance && provenance.investigation_id && provenance.investigation_id !== id) perrs.push(`provenance.investigation_id (${provenance.investigation_id}) does not match --id ${id}`);
  if (perrs.length) { const e = new Error('provenance incomplete:\n - ' + perrs.join('\n - ')); e.code = 2; throw e; }
  const dest = path.join(out, id), srcDest = path.join(dest, 'source');
  await mkdir(srcDest, { recursive: true });
  const files = [], byHash = new Map();
  for (const f of await listFiles(sourceDir)) {
    const rel = path.relative(sourceDir, f), before = await readFile(f), h = sha256(before), to = path.join(srcDest, rel);
    await mkdir(path.dirname(to), { recursive: true }); await copyFile(f, to);
    const after = sha256(await readFile(to));
    if (after !== h) { const e = new Error(`copy of ${rel} does not match the original`); e.code = 3; throw e; }
    const entry = { file: rel, bytes: before.length, sha256: h, duplicate_of: byHash.get(h) || null };
    if (!byHash.has(h)) byHash.set(h, rel);
    if (/\.csv$/i.test(rel)) entry.csv = profileCsv(before); else entry.note = 'Not profiled. Text is not extracted automatically; quote passages by hand with page or paragraph locators.';
    files.push(entry);
  }
  const issues = [];
  if (!files.length) issues.push('No source files were found.');
  if (integratedIds.includes(id)) issues.push(`${id} is already integrated in the evidence store: treat this as a candidate revision and document every difference.`);
  for (const f of files) { if (f.duplicate_of) issues.push(`${f.file} is byte-identical to ${f.duplicate_of}: count it once.`); for (const i of (f.csv && f.csv.issues) || []) issues.push(`${f.file}: ${i}`); }
  if (!files.some((f) => f.csv)) issues.push('No CSV data table was supplied: there are no records to integrate, only documents.');
  const manifest = { tool: 'si/ingest/stage.mjs', tool_version: TOOL_VERSION, status: 'STAGED - NOT INTEGRATED', investigation_id: id, provenance, files, issues };
  await writeFile(path.join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(path.join(dest, 'INGESTION_REPORT.md'), report(manifest));
  return manifest;
}

export function report(m) {
  const L = [`# Ingestion report: ${m.investigation_id} (${m.provenance.investigation_name})`, '', `**Status: ${m.status}.** Nothing in this folder is used by SI until the review and integration steps in \`si/ingest/README.md\` are completed and merged.`, '',
    '## Provenance', '', '| Field | Value |', '|---|---|', ...Object.entries(m.provenance).map(([k, v]) => `| ${k} | ${String(Array.isArray(v) ? v.join(' ') : v).replace(/\|/g, '\\|')} |`), '',
    '## Files and checksums (originals copied byte-for-byte into `source/`)', '', '| File | Bytes | SHA-256 | Note |', '|---|---|---|---|',
    ...m.files.map((f) => `| ${f.file} | ${f.bytes} | \`${f.sha256}\` | ${f.duplicate_of ? 'duplicate of ' + f.duplicate_of : f.csv ? `CSV: ${f.csv.rows} rows x ${f.csv.columns} columns, ${f.csv.encoding}` : 'not profiled'} |`), '',
    '## Decisions required (ambiguities found)', '', ...(m.issues.length ? m.issues.map((i) => `- [ ] ${i}`) : ['- None detected automatically. A human review is still required.']), '',
    '## Review checklist (all must be ticked by a reviewer before integration)', '',
    '- [ ] Source URLs open and the files match the checksums above.', '- [ ] Terms of use permit redistribution of derived records.',
    '- [ ] Every column is defined from the data dictionary (DoD); undefined columns are recorded as undefined, not guessed.',
    '- [ ] Units are taken from the source; disputed units are recorded as disputed, never converted.',
    '- [ ] Gravity regime is quoted from a source document with a locator; no partial-gravity claim without explicit data.',
    '- [ ] Every report statement to be used is quoted verbatim with file and page or paragraph.',
    '- [ ] New limitations (LIM-*) are written for every ambiguity above that remains unresolved.',
    '- [ ] Regression tests are added for the new records, passages and limitations.', ''];
  for (const f of m.files.filter((x) => x.csv)) {
    L.push(`## Column profile: ${f.file}`, '', '| Column | Blank | Numeric | Text | ~ | Ranges | Leading 0 | Text examples |', '|---|---|---|---|---|---|---|---|');
    for (const c of f.csv.column_profile) L.push(`| ${c.name.replace(/\|/g, '\\|')} | ${c.blank} | ${c.numeric} | ${c.text} | ${c.approximate} | ${c.ranges} | ${c.leading_zero} | ${c.examples_of_text.map((x) => x.replace(/\|/g, '\\|')).join('; ')} |`);
    L.push('');
  }
  return L.join('\n') + '\n';
}

export async function verify(dir) {
  const m = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8')); const bad = [];
  for (const f of m.files) { let h = null; try { h = sha256(await readFile(path.join(dir, 'source', f.file))); } catch { /* missing */ } if (h !== f.sha256) bad.push(f.file); }
  return { ok: bad.length === 0, changed_or_missing: bad };
}

async function main(argv) {
  const a = {}; for (let i = 0; i < argv.length; i++) { const k = argv[i]; if (!k.startsWith('--')) { console.error('unknown argument ' + k); return 2; } a[k.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; }
  if (a.verify) { const r = await verify(a.verify); console.log(r.ok ? 'verified: all staged files match the manifest' : 'VERIFICATION FAILED: ' + r.changed_or_missing.join(', ')); return r.ok ? 0 : 3; }
  if (!a.id || !a['source-dir'] || !a.provenance) { console.error('usage: node si/ingest/stage.mjs --id PSI-NN --source-dir <dir> --provenance <provenance.json> [--out si/ingest/staging]'); return 2; }
  const here = path.dirname(fileURLToPath(import.meta.url));
  let provenance; try { provenance = JSON.parse(await readFile(a.provenance, 'utf8')); } catch (e) { console.error('cannot read provenance: ' + e.message); return 2; }
  let integratedIds = []; try { integratedIds = (await import(pathToFileURL(path.join(here, '..', 'worker', 'src', 'bundle.js')).href)).default.investigations.map((i) => i.id); } catch { /* bundle not available */ }
  try {
    const m = await stage({ id: a.id, sourceDir: a['source-dir'], provenance, out: a.out || path.join(here, 'staging'), integratedIds });
    console.log(`${m.status}: ${m.files.length} file(s), ${m.issues.length} decision(s) required. Report: ${path.join(a.out || path.join(here, 'staging'), a.id, 'INGESTION_REPORT.md')}`); return 0;
  } catch (e) { console.error(e.message); return e.code || 2; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2)).then((c) => process.exit(c));
