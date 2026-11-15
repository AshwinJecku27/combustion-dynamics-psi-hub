"""Headless smoke test for the SI dashboard (si/dashboard/si.html, corrected release r3).
The original release candidate file (si-release/dashboard/si.html) is kept unchanged and is known to overflow at 390 px.
Written during repository integration; NOT the release candidate's own test suite.
Checks: four sections render without page errors; 'Original dashboard' link targets index.html;
unconfigured build refuses to call any API; with ?si_api=http://localhost:PORT the page talks to the
release-candidate Worker code (local Node wrapper, NO AI binding) and renders the evidence-only fallback.
Real Workers AI output is NOT tested here.
Run from the repo root:  python3 si-integration/test_si_dashboard.py
Needs: pip install playwright (version matching your installed Chromium), node >= 18.
"""
import asyncio, functools, http.server, socket, subprocess, sys, threading, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
BENCHMARKS = [l.split("text: '",1)[1].rsplit("'",1)[0] for l in (ROOT / 'si/worker/scripts/real_eval.mjs').read_text().splitlines() if l.strip().startswith("{ id: 'Q")]
assert len(BENCHMARKS) == 6, BENCHMARKS
def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

async def main():
    web_port, api_port = free_port(), free_port()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    handler.log_message = lambda *a: None
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', web_port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    api = subprocess.Popen(['node', str(ROOT / 'si-integration/local_worker_server.mjs'), str(api_port)], stdout=subprocess.PIPE, text=True)
    api.stdout.readline()
    fails = []
    def check(cond, msg):
        print(('PASS ' if cond else 'FAIL ') + msg)
        if not cond: fails.append(msg)
    page_url = f'http://127.0.0.1:{web_port}/si/dashboard/si.html'
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            pg = await b.new_page(viewport={'width': 1100, 'height': 900}); errs = []; reqs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.on('request', lambda r: reqs.append(r.url))
            await pg.goto(page_url); await pg.wait_for_timeout(300)
            tabs = await pg.locator('#nav button').all_inner_texts()
            check(tabs == ['Intelligence Overview', 'Ask SI', 'Investigation Explorer', 'Comparisons & Insights'], f'four sections: {tabs}')
            check(await pg.locator('#nav a[href="index.html"]').count() == 1, 'Original dashboard link -> index.html')
            for i in range(4):
                await pg.locator('#nav button').nth(i).click(); await pg.wait_for_timeout(150)
                check(len(await pg.locator('#main').inner_text()) > 50, f'section {i} renders content')
            body = (await pg.locator('body').inner_text()).lower()
            check('partial-gravity' in body or 'partial gravity' in body, 'partial-gravity limitation visible')
            await pg.locator('#nav button').nth(1).click()
            await pg.fill('#si-q', 'What does FLEX tell us about fire suppression?'); await pg.click('#si-go'); await pg.wait_for_timeout(300)
            check('not configured' in (await pg.locator('#si-out').inner_text()), 'unconfigured build shows "not configured"')
            check(not any('/v1/' in u for u in reqs), 'unconfigured build made no API request')
            check(not errs, f'no page errors (unconfigured): {errs}')
            # Wired to the local Worker wrapper
            pg2 = await b.new_page(viewport={'width': 1100, 'height': 900}); errs2 = []
            pg2.on('pageerror', lambda e: errs2.append(str(e)))
            await pg2.goto(page_url + f'?si_api=http://localhost:{api_port}'); await pg2.wait_for_timeout(300)
            await pg2.locator('#nav button').nth(1).click(); await pg2.wait_for_timeout(800)
            check('only retrieved evidence' in (await pg2.locator('#si-note').inner_text()), 'health call reached Worker (model not configured note)')
            await pg2.fill('#si-q', 'Is there any actual lunar gravity combustion data available?'); await pg2.click('#si-go')
            await pg2.wait_for_function("document.querySelector('#si-out') && !/Retrieving evidence/.test(document.querySelector('#si-out').innerText) && document.querySelector('#si-out').innerText.length>40", timeout=10000)
            out = await pg2.locator('#si-out').inner_text()
            check('No AI model was used' in out or 'not an AI answer' in out, 'fallback rendered and labelled as not AI')
            check('LIM-001' in out, 'partial-gravity question cites LIM-001')
            check(not errs2, f'no page errors (wired): {errs2}')
            # Horizontal overflow: every section, and every investigation in the Explorer, at phone, tablet and desktop widths
            for w in (360, 390, 768, 1100, 1440):
                m = await b.new_page(viewport={'width': w, 'height': 800}); await m.goto(page_url); await m.wait_for_timeout(200); bad = []
                for i in range(4):
                    await m.locator('#nav button').nth(i).click(); await m.wait_for_timeout(100)
                    n = await m.locator('.list button').count() if i == 2 else 1
                    for k in range(n):
                        if i == 2: await m.locator('.list button').nth(k).click(); await m.wait_for_timeout(60)
                        if await m.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth + 1'): bad.append((i, k))
                check(not bad, f'no horizontal overflow at {w}px (4 sections, 6 investigations){": " + str(bad) if bad else ""}')
                await m.close()
            # Ask SI answer area at phone width (fallback lists citation chips with long ids)
            m = await b.new_page(viewport={'width': 390, 'height': 800}); await m.goto(page_url + f'?si_api=http://localhost:{api_port}')
            await m.locator('#nav button').nth(1).click(); await m.fill('#si-q', 'What does SAME-R reveal about smoke particle characteristics?'); await m.click('#si-go')
            await m.wait_for_function("document.querySelector('#si-out').innerText.length>40 && !/Retrieving evidence/.test(document.querySelector('#si-out').innerText)", timeout=10000)
            check(not await m.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth + 1'), 'no horizontal overflow at 390px with an evidence-only answer shown')
            await m.close()
            # Ask SI is open-ended: a free-text box, no menu of the internal benchmark questions (si/worker/scripts/real_eval.mjs)
            m = await b.new_page(viewport={'width': 1100, 'height': 900}); await m.goto(page_url + f'?si_api=http://localhost:{api_port}')
            await m.locator('#nav button').nth(1).click(); await m.wait_for_timeout(200)
            ask_text = await m.locator('#main').inner_text()
            check(await m.locator('textarea#si-q').count() == 1 and await m.locator('textarea#si-q').is_editable(), 'Ask SI has an editable free-text question box')
            check('Example questions' not in ask_text and await m.locator('#main button.link').count() == 0, 'Ask SI shows no canned question menu')
            check(not any(q in ask_text for q in BENCHMARKS), 'internal benchmark questions are not shown to the public')
            own = 'How long did the PMMA samples burn compared with the silicone samples?'
            await m.fill('#si-q', own); await m.click('#si-go')
            await m.wait_for_function("document.querySelector('#si-out').innerText.length>40 && !/Retrieving evidence/.test(document.querySelector('#si-out').innerText)", timeout=10000)
            out = await m.locator('#si-out').inner_text()
            check('Retrieved evidence only' in out and 'Data description (DoD) statement' in out, 'a user-written question reaches the Worker and source passages are labelled by kind')
            await m.close()
            # Desktop rendering versus the original release candidate. r3 changes only (a) the Ask SI section and (b) the
            # Explorer's passage labels (test-plan and DoD statements were all headed "Report quotes"). Everything else
            # must be pixel-identical; the Explorer must be text-identical once the new labels are removed.
            import hashlib, re
            def unlabel(t):
                t = t.replace('Source passages (', 'Report quotes (').replace('No source passages are stored', 'No report quotes are stored')
                return re.sub(r'\[(Report quote \(context\)|Report quote|Test plan statement \(intent, not a result\)|Data description \(DoD\) statement)\] ', '', t)
            async def shots(url):
                pg3 = await b.new_page(viewport={'width': 1100, 'height': 900}); await pg3.goto(url); await pg3.wait_for_timeout(200); px, tx = {}, {}
                for i in (0, 2, 3):
                    await pg3.locator('#nav button').nth(i).click(); await pg3.wait_for_timeout(100)
                    n = await pg3.locator('.list button').count() if i == 2 else 1
                    for k in range(n):
                        if i == 2: await pg3.locator('.list button').nth(k).click(); await pg3.wait_for_timeout(60)
                        px[(i, k)] = hashlib.sha256(await pg3.screenshot(full_page=True)).hexdigest(); tx[(i, k)] = await pg3.locator('#main').inner_text()
                await pg3.close(); return px, tx
            (pa, ta), (pc, tc) = await shots(f'http://127.0.0.1:{web_port}/si-release/dashboard/si.html'), await shots(page_url)
            fixed = [v for v in pa if v[0] != 2]
            check(len(fixed) == 2 and all(pa[v] == pc[v] for v in fixed), 'desktop 1100px: Overview and Comparisons pixel-identical to the release candidate')
            ex = [v for v in pa if v[0] == 2]
            check(len(ex) == 6 and all(unlabel(tc[v]) == ta[v] for v in ex), 'Explorer (6 investigations): text identical to the release candidate apart from passage-kind labels')
            check(all('Test plan statement' in tc[v] for v in ex if 'FLEX' in tc[v].split('\n')[0] or 'PSI-69:plan' in tc[v]) and any('Test plan statement' in tc[v] for v in ex), 'FLEX test-plan passages are no longer labelled as report quotes')
            await b.close()
    finally:
        api.terminate(); httpd.shutdown()
    print(f'\n{len(fails)} failure(s)'); sys.exit(1 if fails else 0)

asyncio.run(main())
