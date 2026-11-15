"""Headless browser test of the SI dashboard (si/dashboard/si.html, final product r7).
Written for repository integration; not part of the original release candidate.
Checks the four sections, accurate overview statistics, Ask SI in three states (unconfigured build; wired to the local
Worker wrapper with NO AI binding -> evidence-only fallback; wired to the wrapper's --mock-ai mode -> a canned answer that
passes the real validator), clickable sources, markup escaping, explorer search, insights content, no external requests,
and no horizontal overflow at 360-1440 px. The mock answer is a fixture, not a model: real Workers AI output is NOT tested.
Run from the repo root:  python3 si-integration/test_si_dashboard.py      Needs: pip install playwright, node >= 18.
"""
import asyncio, functools, http.server, json, re, socket, subprocess, sys, threading
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
BENCHMARKS = [l.split("text: '", 1)[1].rsplit("'", 1)[0] for l in (ROOT / 'si/worker/scripts/real_eval.mjs').read_text().splitlines() if l.strip().startswith("{ id: 'Q")]
SAFFIRE_Q = 'How did flow direction relate to burn time in the SAFFIRE samples?'
def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

async def answered(pg):
    await pg.wait_for_function("document.querySelector('#si-out') && document.querySelector('#si-out').innerText.length>60 && !/Retrieving evidence/.test(document.querySelector('#si-out').innerText)", timeout=15000)
    return await pg.locator('#si-out').inner_text()

async def main():
    web, api, mock = free_port(), free_port(), free_port()
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT)); handler.log_message = lambda *a: None
    httpd = http.server.ThreadingHTTPServer(('127.0.0.1', web), handler); threading.Thread(target=httpd.serve_forever, daemon=True).start()
    srv = [subprocess.Popen(['node', str(ROOT / 'si-integration/local_worker_server.mjs'), str(p)] + extra, stdout=subprocess.PIPE, text=True) for p, extra in ((api, []), (mock, ['--mock-ai']))]
    for s in srv: s.stdout.readline()
    fails = []
    def check(cond, msg):
        print(('PASS ' if cond else 'FAIL ') + msg)
        if not cond: fails.append(msg)
    url = f'http://127.0.0.1:{web}/si/dashboard/si.html'
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            # ---------- structure and overview ----------
            pg = await b.new_page(viewport={'width': 1280, 'height': 900}); errs, reqs = [], []
            pg.on('pageerror', lambda e: errs.append(str(e))); pg.on('request', lambda r: reqs.append(r.url))
            await pg.goto(url); await pg.wait_for_timeout(300)
            tabs = await pg.locator('#nav button').all_inner_texts()
            check(tabs == ['Overview', 'Ask SI', 'Investigations', 'Insights & Gaps'], f'four sections: {tabs}')
            check(await pg.locator('a.orig[href="index.html"]').count() == 1, 'secondary "Original dashboard" link -> index.html')
            ov = await pg.locator('#main').inner_text()
            check('Fire-safety insight from NASA microgravity combustion research' in ov, 'overview states the purpose in its headline')
            stats = await pg.locator('.stats b').all_inner_texts()
            check(stats == ['6', '797', '34', '23', '0'], f'overview statistics match the evidence store: {stats}')
            check('23 report · 7 test plan · 4 DoD' in ov, 'passage count is broken down by kind (not called "report quotes")')
            check('small, curated subset of NASA’s much larger PSI database' in ov, 'integrated library is distinguished from the whole PSI database')
            check(all(a in ov for a in ('Prevention', 'Detection', 'Suppression')) and 'SI’s classification' in ov, 'prevention / detection / suppression, labelled as SI classification')
            for i in range(4):
                await pg.locator('#nav button').nth(i).click(); await pg.wait_for_timeout(150)
                check(len(await pg.locator('#main').inner_text()) > 200, f'section {tabs[i]} renders content')
            # ---------- Ask SI: unconfigured ----------
            await pg.locator('#nav button').nth(1).click(); await pg.wait_for_timeout(150)
            chips = await pg.locator('#main button.chip').all_inner_texts()
            check(len(chips) >= 3 and not any(c in BENCHMARKS for c in chips), f'{len(chips)} example questions, none of them an internal benchmark')
            await pg.locator('#main button.chip').first.click()
            check(await pg.input_value('#si-q') == chips[0], 'an example only prefills the free-text box')
            await pg.fill('#si-q', 'What does FLEX tell us about fire suppression?'); await pg.click('#si-go'); await pg.wait_for_timeout(300)
            check('not configured' in await pg.locator('#si-out').inner_text(), 'unconfigured build says the service is not configured')
            check(not any('/v1/' in u for u in reqs), 'unconfigured build made no API request')
            check(all(u.startswith(f'http://127.0.0.1:{web}') for u in reqs), f'no external requests (fonts, CDNs, analytics): {[u for u in reqs if not u.startswith(f"http://127.0.0.1:{web}")]}')
            check(not errs, f'no page errors: {errs}')
            # ---------- Ask SI: evidence-only fallback (no AI binding) ----------
            p2 = await b.new_page(viewport={'width': 1280, 'height': 900}); e2 = []; p2.on('pageerror', lambda e: e2.append(str(e)))
            await p2.goto(url + f'?si_api=http://localhost:{api}'); await p2.locator('#nav button').nth(1).click(); await p2.wait_for_timeout(700)
            check('only retrieved evidence' in await p2.locator('#si-note').inner_text(), 'health call reached the Worker (model not configured)')
            await p2.fill('#si-q', 'Is there any actual lunar gravity combustion data available?'); await p2.click('#si-go'); out = await answered(p2)
            check('Evidence only · no AI model was used' in out and 'Not scored' in out, 'fallback is labelled as not AI and not scored')
            check('No. The current integrated PSI evidence store contains no actual partial-gravity' in out, 'fallback answers the partial-gravity question explicitly, store-scoped, in code-written words')
            check('LIM-001' in out and await p2.locator('#si-out .tag.ai').count() == 0, 'fallback cites LIM-001 and carries no AI-answer badge')
            check(not e2, f'no page errors (fallback): {e2}')
            # ---------- Ask SI: model answer (MOCK fixture through the real Worker pipeline) ----------
            p3 = await b.new_page(viewport={'width': 1280, 'height': 900}); e3 = []; p3.on('pageerror', lambda e: e3.append(str(e)))
            await p3.goto(url + f'?si_api=http://localhost:{mock}'); await p3.locator('#nav button').nth(1).click(); await p3.wait_for_timeout(500)
            await p3.fill('#si-q', SAFFIRE_Q); await p3.click('#si-go'); out = await answered(p3)
            check(all(t in out for t in ('AI answer', 'Passed code verification', 'Partial answer', 'Evidence support: Moderate')), 'answer badges: AI, verified, status, evidence support')
            heads = await p3.locator('#si-out h3').all_inner_texts()
            check(heads[:5] == ['What the evidence shows', 'Scientific interpretation', 'Experimental conditions', 'Limitations', 'Sources'], f'answer structure: {heads}')
            check('not a measured or reported result' in out and 'What the evidence cannot show' in out, 'interpretation is labelled; the evidence gap is stated')
            await p3.locator('#si-out details summary', has_text='How evidence support was determined').click()
            sup = await p3.locator('#si-out').inner_text()
            check('not a measure of whether the research is correct' in sup and 'Capped:' in sup and 'Not evaluated:' in sup, 'evidence-support breakdown explains components, cap and what it does not measure')
            await p3.locator('#si-out .cite', has_text='PSI-98:sample:S1').first.click(); await p3.wait_for_timeout(200)
            dlg = await p3.locator('#src').inner_text()
            check(await p3.evaluate("document.querySelector('#src').open") and 'SIBAL Fabric' in dlg and 'PSI98_THICKNESS_UNIT_DISPUTED' in dlg, 'a citation opens the exact record with its store flags')
            await p3.locator('#src .cite', has_text='LIM-008').click(); await p3.wait_for_timeout(150)
            check('thickness unit' in (await p3.locator('#src').inner_text()).lower(), 'source dialog links on to the explaining limitation (no error on a nested open)')
            await p3.keyboard.press('Escape'); await p3.wait_for_timeout(100)
            check(not await p3.evaluate("document.querySelector('#src').open"), 'Escape closes the source dialog')
            await p3.fill('#si-q', SAFFIRE_Q + ' markup test'); await p3.click('#si-go'); out = await answered(p3)
            check('<img src=x' in out and not await p3.evaluate('!!window.__xss') and await p3.locator('#si-out img').count() == 0, 'answer text is rendered as text: markup is not executed')
            check(not e3, f'no page errors (model answer): {e3}')
            # ---------- Investigations ----------
            p4 = await b.new_page(viewport={'width': 1280, 'height': 900}); await p4.goto(url); await p4.locator('#nav button').nth(2).click(); await p4.wait_for_timeout(150)
            async def listed(q):
                await p4.fill('#inv-q', q); await p4.wait_for_timeout(120); return await p4.locator('.list button').all_inner_texts()
            check([x.split('\n')[0] for x in await listed('smoke')] == ['PSI-101 · SAME-R'], 'search "smoke" finds SAME-R only')
            check([x.split('\n')[0] for x in await listed('PSI-69')] == ['PSI-69 · FLEX'], 'search by ID finds FLEX')
            check(len(await listed('airflow')) >= 2, 'topic search "airflow" finds the SAFFIRE investigations')
            await listed('zzzz'); check('No integrated investigation matches' in await p4.locator('#main').inner_text(), 'no-match search says so')
            await listed('SAFFIRE-II'); await p4.locator('.list button', has_text='PSI-99').click(); await p4.wait_for_timeout(100); det = await p4.locator('#main').inner_text()
            check('determine how rapidly a large scale fire grows in low-gravity' in det and 'PSI-99:dod:p0:objective' in det, 'objective is quoted from the store with its source')
            check('PSI99_THICKNESS_CSV_DOD_MISMATCH' in await p4.locator('#main').inner_html(), 'SAFFIRE-II CSV/DoD discrepancy flags remain visible in its records')
            await listed('ACME Flame'); check('Not stated in the passages held in the evidence store.' in await p4.locator('#main').inner_text(), 'no objective is invented where the files state none')
            nint = await p4.locator('#main').inner_text()
            check('E-FIELD Flames' in nint and 'not an actual lunar-gravity experiment' in nint and 'BASS' in nint, 'non-integrated research is listed as not integrated, with the E-FIELD caveat')
            await p4.fill('#inv-q', 'FLEX'); await p4.wait_for_timeout(100); await p4.locator('#main button', has_text='Ask SI about FLEX').click(); await p4.wait_for_timeout(150)
            check('FLEX' in await p4.input_value('#si-q'), '"Ask SI about" opens Ask SI with a prefilled question')
            # ---------- Insights ----------
            await p4.locator('#nav button').nth(3).click(); await p4.wait_for_timeout(150); ins = await p4.locator('#main').inner_text()
            check(all(a in ins for a in ('Prevention', 'Detection', 'Suppression', 'Space habitats')), 'insights cover prevention, detection, suppression and habitats')
            check('an intention, not a result' in ins and 'No suppressant efficacy is demonstrated' in ins, 'FLEX plan intent is not presented as demonstrated efficacy')
            check(await p4.locator('.chart svg').count() == 2 and 'Spacesuit' in ins and 'Lunar habitat' in ins, 'oxygen and pressure charts with labelled reference atmospheres')
            check('do not show which combinations were tested' in ins and 'challenge statement' in ins, 'chart states its limits and attributes the reference values')
            check(await p4.locator('.matrix .cite').count() >= 20, 'insight statements carry source links')
            # ---------- overflow ----------
            for w in (360, 390, 768, 1100, 1440):
                m = await b.new_page(viewport={'width': w, 'height': 800}); await m.goto(url); await m.wait_for_timeout(150); bad = []
                for i in range(4):
                    await m.locator('#nav button').nth(i).click(); await m.wait_for_timeout(80)
                    n = await m.locator('.list button').count() if i == 2 else 1
                    for k in range(n):
                        if i == 2: await m.locator('.list button').nth(k).click(); await m.wait_for_timeout(50)
                        if await m.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth + 1'): bad.append((i, k))
                check(not bad, f'no horizontal overflow at {w}px (4 sections, 6 investigations){": " + str(bad) if bad else ""}')
                await m.close()
            m = await b.new_page(viewport={'width': 390, 'height': 800}); await m.goto(url + f'?si_api=http://localhost:{mock}')
            await m.locator('#nav button').nth(1).click(); await m.fill('#si-q', SAFFIRE_Q); await m.click('#si-go'); await answered(m)
            check(not await m.evaluate('document.documentElement.scrollWidth > document.documentElement.clientWidth + 1'), 'no horizontal overflow at 390px with a full answer shown')
            await b.close()
    finally:
        for s in srv: s.terminate()
        httpd.shutdown()
    print(f'\n{len(fails)} failure(s)'); sys.exit(1 if fails else 0)

asyncio.run(main())
