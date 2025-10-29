import os
import asyncio
import json
from dataclasses import dataclass, asdict
from typing import List, Optional
from playwright.async_api import async_playwright, Page

@dataclass
class ArticleSummary:
    notice: bool
    badge: str
    title: str
    link: str
    comment_count: Optional[int]
    author: str
    level: str
    date: str
    views: str
    likes: Optional[str]
    article_id: Optional[str]

@dataclass
class ArticleDetail:
    article_id: str
    title: str
    author: str
    level: str
    date: str
    views: str
    likes: str
    comment_count: int
    content_text: str
    content_html: str
    comments: List[dict]

async def extract_board_rows(page: Page) -> List[ArticleSummary]:
    rows = await page.query_selector_all("tbody tr")
    summaries: List[ArticleSummary] = []
    for row in rows:
        cols = await row.query_selector_all("td")
        if not cols:
            continue
        badge_text = await cols[0].inner_text() if len(cols) > 0 else ""
        badge_text = badge_text.strip()
        notice = badge_text in ("필독", "공지")
        title_cell = cols[1] if len(cols) > 1 else None
        if not title_cell:
            continue
        link_el = await title_cell.query_selector("a.article")
        if not link_el:
            continue
        title_text = (await link_el.inner_text()).strip()
        link_href = await link_el.get_attribute("href")
        comment_el = await title_cell.query_selector("a.cmt")
        comment_count = None
        if comment_el:
            comment_text = (await comment_el.inner_text()).strip()
            if comment_text.startswith("[") and comment_text.endswith("]"):
                comment_count = int(comment_text[1:-1])
        author_cell = cols[2] if len(cols) > 2 else None
        author = level = ""
        if author_cell:
            info = (await author_cell.inner_text()).strip().split("\n")
            author = info[0] if info else ""
            level = info[1] if len(info) > 1 else ""
        date = await cols[3].inner_text() if len(cols) > 3 else ""
        views = await cols[4].inner_text() if len(cols) > 4 else ""
        likes = await cols[5].inner_text() if len(cols) > 5 else None
        article_id = None
        if link_href and "articles/" in link_href:
            article_id = link_href.rsplit("/", 1)[-1].split("?")[0]
        summaries.append(ArticleSummary(
            notice=notice,
            badge=badge_text,
            title=title_text,
            link=link_href,
            comment_count=comment_count,
            author=author,
            level=level,
            date=date.strip(),
            views=views.strip(),
            likes=likes.strip() if likes else None,
            article_id=article_id
        ))
    return summaries

async def wait_for_article_content(page: Page) -> Optional[str]:
    selectors = [
        "[data-role='viewer']",
        "[class*='Viewer']",
        "article",
        "#tc_contents",
        "._articleContent",
    ]
    for selector in selectors:
        el = await page.query_selector(selector)
        if el:
            html = await el.inner_html()
            if html.strip():
                return html
    return None

async def fetch_article_detail(page: Page, base_url: str, article_id: str) -> ArticleDetail:
    url = f"https://cafe.naver.com/f-e/cafes/29537083/articles/{article_id}?menuid=383"
    await page.goto(url)
    await page.wait_for_load_state("domcontentloaded")
    # 재시도
    content_html = None
    for attempt in range(5):
        await asyncio.sleep(1 + attempt)
        content_html = await wait_for_article_content(page)
        if content_html:
            break
    if not content_html:
        # fallback old style
        fallback_url = f"https://cafe.naver.com/ArticleRead.nhn?clubid=29537083&menuid=383&articleid={article_id}&page=1&referrerAllArticles=false"
        await page.goto(fallback_url)
        await page.wait_for_load_state("domcontentloaded")
        for attempt in range(5):
            await asyncio.sleep(1 + attempt)
            content_html = await wait_for_article_content(page)
            if content_html:
                break
    title = await page.title()
    author_el = await page.query_selector("[class*='Nickname']")
    author = await author_el.inner_text() if author_el else ""
    meta_el = await page.query_selector_all("[class*='ArticleInfo'] span")
    views = likes = date = ""
    for span in meta_el:
        text = (await span.inner_text()).strip()
        if "조회" in text:
            views = text
        elif "좋아요" in text:
            likes = text
        elif "." in text and "-" not in text:
            date = text
    comment_buttons = await page.query_selector_all("button[data-type='more-comment']")
    for btn in comment_buttons:
        try:
            await btn.click()
            await asyncio.sleep(1)
        except Exception:
            pass
    comments = []
    comment_nodes = await page.query_selector_all("[class*='CommentItem']")
    for node in comment_nodes:
        try:
            nickname_el = await node.query_selector("[class*='nickname']")
            nickname = await nickname_el.inner_text() if nickname_el else ""
            content_el = await node.query_selector("[class*='text']")
            comment_text = await content_el.inner_text() if content_el else ""
            date_el = await node.query_selector("time")
            comment_date = await date_el.get_attribute("datetime") if date_el else ""
            comments.append({
                "nickname": nickname.strip(),
                "text": comment_text.strip(),
                "date": comment_date,
            })
        except Exception:
            continue
    content_text = ""
    if content_html:
        content_text = content_html.replace("<", " <").replace(">", "> ")
    return ArticleDetail(
        article_id=article_id,
        title=title,
        author=author,
        level="",
        date=date,
        views=views,
        likes=likes,
        comment_count=len(comments),
        content_text=content_text.strip(),
        content_html=content_html or "",
        comments=comments,
    )

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
        await page.goto("https://cafe.naver.com/f-e/cafes/29537083/menus/383", wait_until='networkidle')
        summaries = await extract_board_rows(page)
        # 다음 페이지 버튼
        next_btn = await page.query_selector(".Pagination button.btn.number[aria-pressed='false']")
        summaries_page2 = []
        if next_btn:
            await next_btn.click()
            await page.wait_for_load_state('networkidle')
            await asyncio.sleep(2)
            summaries_page2 = await extract_board_rows(page)
        all_summaries = summaries + summaries_page2
        # 자세히 가져올 목록(공지+상위 일반글)
        detailed_articles = []
        detail_page = await context.new_page()
        for summary in all_summaries[:20]:
            if not summary.article_id:
                continue
            try:
                detail = await fetch_article_detail(detail_page, "https://cafe.naver.com/f-e", summary.article_id)
                detailed_articles.append(detail)
            except Exception as e:
                print("detail fetch failed", summary.article_id, e)
        data = {
            "summaries": [asdict(s) for s in all_summaries],
            "details": [asdict(d) for d in detailed_articles],
        }
        from pathlib import Path
        Path('data/naver_cafe').mkdir(parents=True, exist_ok=True)
        Path('data/naver_cafe/iris_guides.json').write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
        await browser.close()

asyncio.run(main())
