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
        data = await frame.evaluate('''() => {
            const qs = (sel) => document.querySelector(sel);
            const qsa = (sel) => Array.from(document.querySelectorAll(sel));
            const text = (el) => el ? el.innerText.trim() : '';
            const title = text(qs('.ArticleTitle .title_text'));
            const author = text(qs('.nickname'));
            const level = text(qs('.nick_level'));
            const info = qsa('.article_info span').map(el => el.innerText.trim());
            const contentEl = qs('.article_viewer .content');
            const contentText = contentEl ? contentEl.innerText : '';
            const contentHTML = contentEl ? contentEl.innerHTML : '';
            const comments = qsa('[class*=CommentItem]').map(el => ({
                nickname: text(el.querySelector('[class*=nickname]')),
                text: text(el.querySelector('[class*=text]')),
                date: text(el.querySelector('time')),
            }));
            return {title, author, level, info, contentText, contentHTMLLength: contentHTML.length, commentCount: comments.length};
        }''')
        print(data)
        await browser.close()

asyncio.run(main())
