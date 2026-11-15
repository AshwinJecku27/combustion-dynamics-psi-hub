// Tests for the maintainer staging tool (si/ingest/stage.mjs). Temporary directories only; never touches the store.
// Run: node --test si/ingest/
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, rm, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stage, verify, checkProvenance, parseCsv, profileCsv } from './stage.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.join(HERE, '..', 'worker', 'src', 'bundle.js');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const PROV = { investigation_id: 'PSI-900', investigation_name: 'Test Investigation', source_urls: ['https://example.org/psi/900'], retrieved_on: '2026-11-15', retrieved_by: 'maintainer', terms_of_use: 'test fixture' };
// cp1252/latin1 byte 0xB5 (micro sign) makes this invalid UTF-8, like the real SAFFIRE-II and FLEX files
const CSV = Buffer.concat([Buffer.from('Test,Material,Thickness (mm),O2 (%),Burn time,?-g note\r\n1,PMMA,037,~ 21.5,145 s,x\r\n2,,0.33,21.5 - 21.7,Insignificant,\r\n2,Silicone,1.02,22.1,900,y'), Buffer.from([0xB5]), Buffer.from('\r\n')]);
async function fixture() {
  const d = await mkdtemp(path.join(os.tmpdir(), 'si-ingest-')); const src = path.join(d, 'src'); await mkdir(src);
  await writeFile(path.join(src, 'table.csv'), CSV); await writeFile(path.join(src, 'table (1).csv'), CSV); await writeFile(path.join(src, 'DoD.docx'), 'binary-ish');
  return { d, src, out: path.join(d, 'staging') };
}

test('provenance is required and checked', () => {
  assert.deepEqual(checkProvenance(PROV), []);
  const e = checkProvenance({ ...PROV, source_urls: ['http://insecure.example'], retrieved_on: '15/11/2026', terms_of_use: '' });
  assert.ok(e.includes('provenance.terms_of_use is required') && e.some((x) => /https URLs/.test(x)) && e.some((x) => /YYYY-MM-DD/.test(x)));
  assert.deepEqual(checkProvenance(null), ['provenance must be a JSON object']);
});

test('CSV parsing keeps values exactly as written (quotes, CRLF, no coercion)', () => {
  assert.deepEqual(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n037,~1\n'), [['a', 'b'], ['x, y', 'say "hi"'], ['037', '~1']]);
});

test('profiling flags encoding, lost header characters, mixed types, ~, ranges, leading zeros, blanks and duplicates', () => {
  const p = profileCsv(CSV); const all = p.issues.join('\n');
  assert.match(p.encoding, /not utf-8/);
  for (const re of [/not valid UTF-8/, /"\?" or replacement characters/, /"Burn time" mixes numbers and text/, /approximate \("~"\)/, /range values/, /leading zero/, /"Material" has 1 blank/, /duplicate values: 2 \(x2\)/])
    assert.match(all, re);
  assert.equal(p.rows, 3); assert.ok(!/inconsistent column counts/.test(all));
});

test('staging copies originals byte-for-byte, records checksums, flags duplicate files, and never integrates', async () => {
  const { d, src, out } = await fixture(); const bundleBefore = sha(await readFile(BUNDLE));
  try {
    const m = await stage({ id: 'PSI-900', sourceDir: src, provenance: PROV, out });
    assert.equal(m.status, 'STAGED - NOT INTEGRATED');
    for (const f of m.files) assert.equal(sha(await readFile(path.join(out, 'PSI-900', 'source', f.file))), sha(await readFile(path.join(src, f.file))));
    assert.ok(m.issues.some((i) => /byte-identical/.test(i)));
    assert.ok(m.files.find((f) => f.file === 'DoD.docx').note.includes('not extracted'));
    const rep = await readFile(path.join(out, 'PSI-900', 'INGESTION_REPORT.md'), 'utf8');
    assert.match(rep, /STAGED - NOT INTEGRATED/); assert.match(rep, /- \[ \] Units are taken from the source/); assert.match(rep, /https:\/\/example.org\/psi\/900/);
    assert.deepEqual((await readdir(path.join(out, 'PSI-900'))).sort(), ['INGESTION_REPORT.md', 'manifest.json', 'source']);
    assert.equal(sha(await readFile(BUNDLE)), bundleBefore, 'the public evidence store is untouched');
  } finally { await rm(d, { recursive: true, force: true }); }
});

test('verification detects a changed staged file', async () => {
  const { d, src, out } = await fixture();
  try {
    await stage({ id: 'PSI-900', sourceDir: src, provenance: PROV, out });
    assert.deepEqual(await verify(path.join(out, 'PSI-900')), { ok: true, changed_or_missing: [] });
    await writeFile(path.join(out, 'PSI-900', 'source', 'table.csv'), 'edited');
    assert.deepEqual((await verify(path.join(out, 'PSI-900'))).changed_or_missing, ['table.csv']);
  } finally { await rm(d, { recursive: true, force: true }); }
});

test('refuses incomplete or mismatched provenance; flags an already-integrated ID', async () => {
  const { d, src, out } = await fixture();
  try {
    await assert.rejects(stage({ id: 'PSI-900', sourceDir: src, provenance: { ...PROV, retrieved_by: '' }, out }), /retrieved_by is required/);
    await assert.rejects(stage({ id: 'PSI-901', sourceDir: src, provenance: PROV, out }), /does not match --id PSI-901/);
    const m = await stage({ id: 'PSI-99', sourceDir: src, provenance: { ...PROV, investigation_id: 'PSI-99' }, out, integratedIds: ['PSI-99'] });
    assert.ok(m.issues.some((i) => /already integrated/.test(i)));
  } finally { await rm(d, { recursive: true, force: true }); }
});

test('CLI: missing provenance exits 2 and writes nothing; --verify exits 3 on tampering', async () => {
  const { d, src, out } = await fixture(); const cli = path.join(HERE, 'stage.mjs');
  try {
    assert.equal(spawnSync(process.execPath, [cli, '--id', 'PSI-900', '--source-dir', src, '--out', out]).status, 2);
    await writeFile(path.join(d, 'prov.json'), JSON.stringify(PROV));
    assert.equal(spawnSync(process.execPath, [cli, '--id', 'PSI-900', '--source-dir', src, '--provenance', path.join(d, 'prov.json'), '--out', out]).status, 0);
    await writeFile(path.join(out, 'PSI-900', 'source', 'DoD.docx'), 'x');
    assert.equal(spawnSync(process.execPath, [cli, '--verify', path.join(out, 'PSI-900')]).status, 3);
  } finally { await rm(d, { recursive: true, force: true }); }
});
