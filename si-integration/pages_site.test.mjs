// Offline checks of the GitHub Pages artifact built by si-integration/build_pages_site.sh (as .github/workflows/pages.yml does).
// No network, no deployment. Run: node --test si-integration/pages_site.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'si-integration', 'build_pages_site.sh');
const V1_SHA = 'cfbbc812c59652ee3d2ecc8c27ce705fd051e440431a46f6454f0204e9d9d12c'; // frozen original dashboard (SHA256SUMS.txt)
const sha = (b) => createHash('sha256').update(b).digest('hex');
const build = (out, api) => spawnSync('bash', [SCRIPT, out], { env: { PATH: process.env.PATH, ...(api !== undefined ? { SI_API_BASE: api } : {}) }, encoding: 'utf8' });
async function files(dir, pre = '') { const o = []; for (const e of await readdir(dir, { withFileTypes: true })) { const r = pre + e.name; if (e.isDirectory()) o.push(...await files(path.join(dir, e.name), r + '/')); else o.push(r); } return o.sort(); }
async function withTmp(fn) { const d = await mkdtemp(path.join(os.tmpdir(), 'pages-')); try { return await fn(d); } finally { await rm(d, { recursive: true, force: true }); } }

test('default build (no SI_API_BASE): root byte-identical, SI at /si/, Ask SI left unconfigured', () => withTmp(async (d) => {
  const out = path.join(d, '_site'); const r = build(out);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(await files(out), ['index.html', 'si/index.html'], 'artifact holds exactly the two pages');
  const rootPage = await readFile(path.join(out, 'index.html'));
  assert.ok(rootPage.equals(await readFile(path.join(ROOT, 'index.html'))), 'root page byte-identical to index.html');
  assert.equal(sha(rootPage), V1_SHA, 'root page matches the frozen v1 checksum');
  const src = await readFile(path.join(ROOT, 'si', 'dashboard', 'si.html'), 'utf8');
  const si = await readFile(path.join(out, 'si', 'index.html'), 'utf8');
  assert.equal(si, src.replace("href:'index.html'", "href:'../index.html'"), 'only the Original-dashboard link differs from si/dashboard/si.html');
  assert.ok(!si.includes("href:'index.html'"), 'no link that would point /si/ at itself');
  assert.match(si, /__SI_API_BASE__/, 'placeholder kept: Ask SI sends nothing until configured');
}));

test('configured build: the Worker origin replaces the placeholder and nothing else changes', () => withTmp(async (d) => {
  const out = path.join(d, '_site'); const api = 'https://psi-si-api.example.workers.dev';
  const r = build(out, api); assert.equal(r.status, 0, r.stderr);
  const src = await readFile(path.join(ROOT, 'si', 'dashboard', 'si.html'), 'utf8');
  const si = await readFile(path.join(out, 'si', 'index.html'), 'utf8');
  assert.equal(si, src.replace("href:'index.html'", "href:'../index.html'").split('__SI_API_BASE__').join(api));
  assert.equal(sha(await readFile(path.join(out, 'index.html'))), V1_SHA);
}));

test('empty SI_API_BASE (unset repository variable) behaves as unconfigured', () => withTmp(async (d) => {
  const out = path.join(d, '_site'); assert.equal(build(out, '').status, 0);
  assert.match(await readFile(path.join(out, 'si', 'index.html'), 'utf8'), /__SI_API_BASE__/);
}));

test('bad Worker addresses and an existing output directory are refused, writing nothing', () => withTmp(async (d) => {
  for (const bad of ['http://psi-si-api.example.workers.dev', 'https://x.workers.dev/', 'https://x.workers.dev/v1', 'https://x.dev#y', "https://x.dev'"]) {
    const out = path.join(d, 'b' + Math.random().toString(36).slice(2));
    const r = build(out, bad); assert.notEqual(r.status, 0, bad); assert.match(r.stderr, /https origin/);
    await assert.rejects(readdir(out), undefined, 'nothing written for ' + bad);
  }
  const existing = path.join(d, 'exists'); await mkdir(existing);
  assert.notEqual(build(existing).status, 0); assert.deepEqual(await readdir(existing), []);
}));

test('no Worker address is hard-coded: it comes only from the SI_API_BASE Actions variable at build time', async () => {
  for (const f of ['si/dashboard/si.html', '.github/workflows/pages.yml', 'si-integration/build_pages_site.sh', 'index.html']) {
    const t = await readFile(path.join(ROOT, f), 'utf8');
    const real = (t.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/gi) || []).filter((u) => !/\.example\.workers\.dev$/i.test(u)); // documentation examples allowed
    assert.deepEqual(real, [], f);
  }
  assert.match(await readFile(path.join(ROOT, 'si', 'dashboard', 'si.html'), 'utf8'), /__SI_API_BASE__/);
});

test('pages.yml: same triggers and deploy actions; staging uses the build script with the optional repository variable', async () => {
  const y = await readFile(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.match(y, /on:\n  push:\n    branches: \[main\]\n  workflow_dispatch:\n/);
  assert.match(y, /run: bash si-integration\/build_pages_site\.sh _site\n/);
  assert.match(y, /SI_API_BASE: \$\{\{ vars\.SI_API_BASE \}\}/);
  assert.doesNotMatch(y, /secrets\./, 'no secrets in the Pages workflow');
  assert.match(y, /uses: actions\/upload-pages-artifact@v3\n        with:\n          path: _site\n/);
  assert.match(y, /uses: actions\/deploy-pages@v4/);
  assert.match(y, /pages: write\n  id-token: write/);
});
