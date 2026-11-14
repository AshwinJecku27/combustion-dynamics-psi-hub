import asyncio,sys,os,tempfile
from pathlib import Path
# Run from anywhere: python3 src/test_playwright.py [path/to/index.html]
ROOT=Path(__file__).resolve().parent.parent
URL=(Path(sys.argv[1]).resolve() if len(sys.argv)>1 else ROOT/'index.html').as_uri()
TMP=tempfile.gettempdir()
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b=await p.chromium.launch(); pg=await b.new_page(viewport={'width':1100,'height':900}); errs=[]
        pg.on('pageerror',lambda e:errs.append('PAGEERR '+str(e))); pg.on('console',lambda m:errs.append('CONSOLE '+m.text) if m.type=='error' else None)
        await pg.goto(URL); await pg.wait_for_timeout(300)
        print('nav',await pg.locator('#nav button').count(),'render err',await pg.locator('#main .warn:has-text("Render error")').count())
        for i in range(6):
            await pg.locator('#nav button').nth(i).click(); await pg.wait_for_timeout(150)
            print(i,await pg.locator('#nav button.on').inner_text(),'cards',await pg.locator('.card').count(),'svg',await pg.locator('svg.chart').count(),'err',await pg.locator('#main .warn:has-text("Render error")').count())
        await pg.locator('#nav button').nth(1).click()
        nsub=await pg.locator('.sub2 button').count();print('subtabs',nsub)
        for k in range(nsub):
            await pg.locator('.sub2 button').nth(k).click();await pg.wait_for_timeout(150)
            print(' sub',k,await pg.locator('.sub2 button.on').inner_text(),'circles',await pg.locator('svg circle').count(),'bars',await pg.locator('.br,.prs').count(),'tables',await pg.locator('table').count(),'err',await pg.locator('#main .warn:has-text("Render error")').count())
        # FLEX filters
        await pg.locator('.sub2 button').nth(4).click()
        print('FLEX n:',await pg.locator('.n').inner_text())
        await pg.locator('select').nth(0).select_option('Methanol');print(' meth',await pg.locator('.n').inner_text())
        await pg.locator('select').nth(1).select_option('CO2');print(' co2',await pg.locator('.n').inner_text(),await pg.locator('svg circle').count())
        await pg.locator('select').nth(2).select_option('dx');print(' dx',await pg.locator('svg circle').count())
        await pg.locator('svg circle').first.hover();print(' tip:',(await pg.locator('.tip').inner_text()).replace('\n',' | ')[:200])
        # SAME-R
        await pg.locator('.sub2 button').nth(5).click();print('SR',await pg.locator('.n').inner_text())
        await pg.locator('select').nth(0).select_option('Kapton');print(' kapton',await pg.locator('.n').inner_text())
        await pg.locator('select').nth(1).select_option('3');print(' metric sigma ok',await pg.locator('.prs').count())
        # simulator
        await pg.locator('#nav button').nth(2).click()
        for i,n in enumerate(['Earth','Lunar','Spacesuit']):
            await pg.locator('.chip').nth(i).click();print(n,await pg.locator('.big').all_inner_texts())
        # comparator
        await pg.locator('#nav button').nth(3).click();print('cmp default',await pg.locator('thead th').all_inner_texts()); print((await pg.locator('.warn ul').inner_text())[:700])
        await pg.locator('.chip').nth(0).click();await pg.locator('.chip').nth(1).click();await pg.locator('.chip').nth(2).click();await pg.wait_for_timeout(100);print('cmp after toggles',await pg.locator('.chip.on').count())
        # ranker
        await pg.locator('#nav button').nth(0).click()
        for q in ['What does FLEX tell us about fire suppression in microgravity?','What can SAME-R tell us about smoke detection in spacecraft?','What does SAFFIRE-II add to our understanding of solid-material fire behavior?','Which experiments inform Moon Base fire safety at >30% O2 and 10.2 psi?','Which important questions remain unanswered?']:
            await pg.fill('.in',q);await pg.wait_for_timeout(450)
            t=await pg.locator('.inv b').first.inner_text(); sc=await pg.locator('.score').all_inner_texts()
            print('Q:',q[:50],'| top:',t[:40],sc[:3],'| ans cards',await pg.locator('.ans').count())
        # insights/align
        await pg.locator('#nav button').nth(4).click();print('insights cards',await pg.locator('.ins').count())
        await pg.locator('#nav button').nth(5).click();print('align cards',await pg.locator('.card').count())
        await pg.screenshot(path=os.path.join(TMP,'psi_a.png'),full_page=False)
        m=await b.new_page(viewport={'width':390,'height':800});m.on('pageerror',lambda e:errs.append('M '+str(e)))
        await m.goto(URL)
        for i in range(6):
            await m.locator('#nav button').nth(i).click();await m.wait_for_timeout(80)
            ov=await m.evaluate('document.documentElement.scrollWidth>innerWidth+2');print('mobile',i,'overflow',ov)
        print('ERRORS',errs); await b.close()
asyncio.run(main())
