import asyncio
from dotenv import load_dotenv
import os
from playwright.async_api import async_playwright

load_dotenv('config/local.env')

ARTICLE_IDS = ['52546', '52150', '52108', '52109', '52060']
NAVER_ID = os.getenv('NAVER_ID')
NAVER_PW = os.getenv('NAVER_PW')

async def fetch(article_id: str):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context()
        page = await context.new_page()
        await page.goto('https://nid.naver.com/nidlogin.login', wait_until='domcontentloaded')
        await page.fill('input[name="id"]', NAVER_ID)
        await page.fill('input[name="pw"]', NAVER_PW)
        await page.click('button[type="submit"]')
        await page.wait_for_load_state('networkidle')
        await page.goto(f'https://cafe.naver.com/f-e/cafes/29537083/articles/{article_id}?menuid=383', wait_until='domcontentloaded')
        await asyncio.sleep(3)
        frame = page.frame(name='cafe_main')
        if frame:
            title = await frame.evaluate('document.querySelector(".ArticleTitle .title_text")?.innerText || ""')
            print(article_id, title.strip())
        else:
            print(article_id, 'no frame')
        await browser.close()

async def main():
    for aid in ARTICLE_IDS:
        await fetch(aid)

asyncio.run(main())
