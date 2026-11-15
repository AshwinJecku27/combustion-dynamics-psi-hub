"""Browser test of the GitHub Pages artifact (si-integration/build_pages_site.sh, as run by .github/workflows/pages.yml).
Serves the built artifact under the same base path as GitHub Pages (/combustion-dynamics-psi-hub/) on 127.0.0.1 and checks
that / is the original dashboard, /si/ is the SI dashboard, and the links between them resolve. Offline; deploys nothing.
Run from the repo root: python3 si-integration/test_pages_site.py   (needs pip install playwright, node not required)
"""
import asyncio, functools, hashlib, http.server, os, shutil, subprocess, sys, tempfile, threading
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
BASE = '/combustion-dynamics-psi-hub/'
V1_SHA = 'cfbbc812c59652ee3d2ecc8c27ce705fd051e440431a46f6454f0204e9d9d12c'

async def main():
    tmp = Path(tempfile.mkdtemp(prefix='pages-site-')); site = tmp / BASE.strip('/')
    env = {k: v for k, v in os.environ.items() if k != 'SI_API_BASE'}
    subprocess.run(['bash', str(ROOT / 'si-integration/build_pages_site.sh'), str(site)], check=True, env=env)
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(tmp)); handler.log_message = lambda *a: None
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler); port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    origin = f'http://127.0.0.1:{port}'; fails = []
    def check(cond, msg):
        print(('PASS ' if cond else 'FAIL ') + msg)
        if not cond: fails.append(msg)
    try:
        check(hashlib.sha256((site / 'index.html').read_bytes()).hexdigest() == V1_SHA, 'artifact root page has the frozen v1 checksum')
        async with async_playwright() as p:
            b = await p.chromium.launch()
            pg = await b.new_page(viewport={'width': 1100, 'height': 900}); errs = []; reqs = []
            pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('request', lambda r: reqs.append(r.url))
            # Root: the original dashboard, as before
            r = await pg.goto(origin + BASE); await pg.wait_for_timeout(300)
            check(r.status == 200 and (await r.body()) == (ROOT / 'index.html').read_bytes(), f'{BASE} serves index.html byte-for-byte')
            check('Habitat Simulator' in await pg.locator('body').inner_text(), f'{BASE} renders the original dashboard')
            # /si/ : the SI dashboard
            r = await pg.goto(origin + BASE + 'si/'); await pg.wait_for_timeout(300)
            check(r.status == 200, f'{BASE}si/ returns 200')
            tabs = await pg.locator('#nav button').all_inner_texts()
            check(tabs == ['Overview', 'Ask SI', 'Investigations', 'Insights & Gaps'], f'{BASE}si/ renders the SI dashboard: {tabs}')
            for i in range(4):
                await pg.locator('#nav button').nth(i).click(); await pg.wait_for_timeout(120)
                check(len(await pg.locator('#main').inner_text()) > 50, f'SI section {i} renders at /si/')
            await pg.locator('#nav button').nth(1).click()
            await pg.fill('#si-q', 'What did SAFFIRE-II record for PMMA?'); await pg.click('#si-go'); await pg.wait_for_timeout(300)
            check('not configured' in await pg.locator('#si-out').inner_text(), 'unconfigured build: Ask SI says the service is not configured')
            check(all(u.startswith(origin) for u in reqs), f'no request leaves the site (no API call, no external asset): {[u for u in reqs if not u.startswith(origin)]}')
            check(not any(u.startswith(origin) and r'/v1/' in u for u in reqs), 'no /v1/ request')
            # Original-dashboard link from /si/ must reach the root dashboard, not /si/ itself
            href = await pg.locator('a.orig', has_text='Original dashboard').get_attribute('href')
            await pg.locator('a.orig', has_text='Original dashboard').click(); await pg.wait_for_load_state(); await pg.wait_for_timeout(300)
            check(pg.url == origin + BASE + 'index.html' and 'Habitat Simulator' in await pg.locator('body').inner_text(), f'"Original dashboard" link ({href}) opens the root dashboard: {pg.url}')
            # /si without a trailing slash redirects to /si/ (as GitHub Pages does)
            r = await pg.goto(origin + BASE + 'si'); await pg.wait_for_timeout(200)
            check(pg.url == origin + BASE + 'si/' and await pg.locator('#nav button').count() == 4, f'{BASE}si redirects to {BASE}si/')
            check(not errs, f'no page errors: {errs}')
            # Phone width: no horizontal overflow at /si/
            m = await b.new_page(viewport={'width': 390, 'height': 800}); await m.goto(origin + BASE + 'si/'); await m.wait_for_timeout(200)
            check(not await m.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth + 1'), 'no horizontal overflow at 390px on /si/')
            await b.close()
    finally:
        httpd.shutdown(); shutil.rmtree(tmp, ignore_errors=True)
    print(f'\n{len(fails)} failure(s)'); sys.exit(1 if fails else 0)

asyncio.run(main())
