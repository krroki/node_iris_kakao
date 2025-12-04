import os
import asyncio
from playwright.async_api import async_playwright

ARTICLE_ID = "52546"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()
        await page.goto("https://nid.naver.com/nidlogin.login", wait_until="domcontentloaded")
        await page.fill("input[name='id']", os.environ['NAVER_ID'])
        await page.fill("input[name='pw']", os.environ['NAVER_PW'])
        await page.click("button[type='submit']")
        await page.wait_for_load_state('networkidle')
        await page.goto(f"https://cafe.naver.com/f-e/cafes/29537083/articles/{ARTICLE_ID}?menuid=383", wait_until='networkidle')
        await asyncio.sleep(3)
        frame = page.frame(name="cafe_main")
        classes = await frame.evaluate('Array.from(new Set(Array.from(document.querySelectorAll("*"))\n  .flatMap(el => Array.from(el.classList || []))))')
        print(classes[:100])
        await browser.close()

asyncio.run(main())
