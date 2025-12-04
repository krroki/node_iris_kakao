#!/usr/bin/env python3
"""IRIS 가이드 게시판 크롤러 (Playwright, iframe-aware for articles)."""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from playwright.async_api import Browser, Frame, Page, async_playwright

load_dotenv("config/local.env")


@dataclass
class ArticleSummary:
    article_id: str
    badge: str
    title: str
    link: str
    comment_count: Optional[int]
    author: str
    level: str
    date: str
    views: str
    likes: Optional[str]
    notice: bool


@dataclass
class ArticleDetail:
    article_id: str
    title: str
    author: str
    level: str
    date: str
    views: str
    likes: str
    content_text: str
    content_html: str
    comments: List[dict]


class IrisGuideCollector:
    def __init__(
        self,
        naver_id: str,
        naver_pw: str,
        cafe_id: str = "29537083",
        menu_id: str = "383",
        max_pages: int = 2,
        detail_limit: int = 25,
        detail_retry: int = 3,
        detail_wait_ms: int = 7000,
        page_timeout_ms: int = 15000,
        frame_wait_ms: int = 5000,
    ) -> None:
        self.naver_id = naver_id
        self.naver_pw = naver_pw
        self.cafe_id = cafe_id
        self.menu_id = menu_id
        self.max_pages = max_pages
        self.detail_limit = detail_limit
        self.detail_retry = max(1, detail_retry)
        self.detail_wait_ms = max(1000, detail_wait_ms)
        self.page_timeout_ms = max(1000, page_timeout_ms)
        self.frame_wait_ms = max(1000, frame_wait_ms)
        self.board_url = f"https://cafe.naver.com/f-e/cafes/{cafe_id}/menus/{menu_id}"

    async def _login(self, page: Page) -> None:
        await page.goto("https://nid.naver.com/nidlogin.login", wait_until="domcontentloaded")
        await page.fill('input[name="id"]', self.naver_id)
        await page.fill('input[name="pw"]', self.naver_pw)
        await page.click('button[type="submit"]')
        await page.wait_for_load_state('domcontentloaded')
        # 새로운 기기 확인 화면이 뜨는 경우 '등록안함'을 눌러 진행
        if await page.query_selector("#new\\.dontsave"):
            await page.click("#new\\.dontsave")
            await page.wait_for_load_state('networkidle')
        else:
            await page.wait_for_load_state('networkidle')

    @staticmethod
    async def _extract_board_rows(page: Page) -> List[ArticleSummary]:
        await page.wait_for_selector("tbody tr")
        rows = await page.query_selector_all("tbody tr")
        summaries: List[ArticleSummary] = []
        for row in rows:
            cols = await row.query_selector_all("td")
            if not cols:
                continue
            badge_text = (await cols[0].inner_text()).strip() if len(cols) > 0 else ""
            notice = badge_text in {"필독", "공지"}
            title_cell = cols[1] if len(cols) > 1 else None
            if title_cell is None:
                continue
            link_el = await title_cell.query_selector("a.article")
            if link_el is None:
                continue
            title_text = (await link_el.inner_text()).strip()
            link_href = await link_el.get_attribute("href") or ""
            article_id = ""
            if "articles/" in link_href:
                article_id = link_href.rsplit("/", 1)[-1].split("?")[0]
            comment_el = await title_cell.query_selector("a.cmt")
            comment_count = None
            if comment_el:
                comment_text = (await comment_el.inner_text()).strip()
                if comment_text.startswith("[") and comment_text.endswith("]"):
                    try:
                        comment_count = int(comment_text[1:-1])
                    except ValueError:
                        comment_count = None
            author_cell = cols[2] if len(cols) > 2 else None
            author = level = ""
            if author_cell:
                info_lines = (await author_cell.inner_text()).strip().split("\n")
                author = info_lines[0] if info_lines else ""
                level = info_lines[1] if len(info_lines) > 1 else ""
            date = (await cols[3].inner_text()).strip() if len(cols) > 3 else ""
            views = (await cols[4].inner_text()).strip() if len(cols) > 4 else ""
            likes = (await cols[5].inner_text()).strip() if len(cols) > 5 else ""
            summaries.append(
                ArticleSummary(
                    article_id=article_id,
                    badge=badge_text,
                    title=title_text,
                    link=link_href,
                    comment_count=comment_count,
                    author=author,
                    level=level,
                    date=date,
                    views=views,
                    likes=likes if likes else None,
                    notice=notice,
                )
            )
        return summaries

    async def _collect_board(self, browser: Browser) -> List[ArticleSummary]:
        page = await browser.new_page()
        await self._login(page)
        await page.goto(self.board_url, wait_until="domcontentloaded")
        await asyncio.sleep(2)
        collected: List[ArticleSummary] = []
        seen: set[str] = set()
        current_page = 1
        while current_page <= self.max_pages:
            summaries = await self._extract_board_rows(page)
            for summary in summaries:
                if not summary.article_id or summary.article_id in seen:
                    continue
                seen.add(summary.article_id)
                collected.append(summary)
            current_page += 1
            next_button = await page.query_selector(
                ".Pagination button.btn.number:not([aria-pressed='true'])"
            )
            if not next_button:
                break
            await next_button.click()
            await asyncio.sleep(2)
        await page.close()
        return collected

    @staticmethod
    async def _wait_for_frame(page: Page, name: str, timeout_ms: int) -> Optional[Frame]:
        deadline = asyncio.get_event_loop().time() + timeout_ms / 1000
        while asyncio.get_event_loop().time() < deadline:
            frame = page.frame(name=name)
            if frame is not None:
                return frame
            await asyncio.sleep(0.2)
        return None

    @staticmethod
    async def _ensure_content_loaded(frame: Frame, timeout_ms: int) -> None:
        deadline = asyncio.get_event_loop().time() + timeout_ms / 1000
        last_error: Optional[Exception] = None
        while asyncio.get_event_loop().time() < deadline:
            try:
                element = await frame.wait_for_selector(
                    ".article_viewer .content",
                    state="attached",
                    timeout=500,
                )
                if element:
                    html = (await element.inner_html()).strip()
                    if html:
                        return
            except Exception as exc:  # pylint: disable=broad-except
                last_error = exc
            await asyncio.sleep(0.5)
        if last_error:
            raise last_error
        raise TimeoutError("Article content did not load before timeout")

    @staticmethod
    async def _expand_all_comments(frame: Frame) -> None:
        buttons = await frame.query_selector_all("button")
        for btn in buttons:
            try:
                label = (await btn.inner_text()).strip()
            except Exception:
                continue
            if "더보기" in label or "댓글" in label:
                try:
                    await btn.click()
                    await asyncio.sleep(1)
                except Exception:
                    continue

    async def _fetch_article_detail(self, browser: Browser, article_id: str) -> Optional[ArticleDetail]:
        url = f"https://cafe.naver.com/f-e/cafes/{self.cafe_id}/articles/{article_id}?menuid={self.menu_id}"
        last_error: Optional[Exception] = None
        for attempt in range(self.detail_retry):
            page = await browser.new_page()
            try:
                await page.goto(
                    url,
                    wait_until="domcontentloaded",
                    timeout=self.page_timeout_ms,
                )
                frame = await self._wait_for_frame(page, "cafe_main", self.frame_wait_ms)
                if frame is None:
                    raise TimeoutError("cafe_main frame not available")
                await self._ensure_content_loaded(frame, self.detail_wait_ms)
                await self._expand_all_comments(frame)
                data = await frame.evaluate(
                    """() => {
                        const qs = (sel) => document.querySelector(sel);
                        const qsa = (sel) => Array.from(document.querySelectorAll(sel));
                        const text = (el) => el ? el.innerText.trim() : '';
                        const title = text(qs('.ArticleTitle .title_text'));
                        const author = text(qs('.nickname'));
                        const level = text(qs('.nick_level'));
                        const info = qsa('.article_info span').map(el => el.innerText.trim());
                        const date = info.find(v => v.includes('.')) || '';
                        const views = info.find(v => v.includes('조회')) || '';
                        const likes = info.find(v => v.includes('좋아요')) || '';
                        const viewer = qs('.article_viewer .content');
                        const contentText = viewer ? viewer.innerText : '';
                        const contentHTML = viewer ? viewer.innerHTML : '';
                        const comments = qsa('[class*=CommentItem]').map(el => ({
                            nickname: text(el.querySelector('[class*=nickname]')),
                            text: text(el.querySelector('[class*=text]')),
                            date: text(el.querySelector('time')),
                        }));
                        return {title, author, level, date, views, likes, contentText, contentHTML, comments};
                    }"""
                )
                await page.close()
                if not data or not data.get("title"):
                    raise ValueError("Article detail missing title")
                return ArticleDetail(
                    article_id=article_id,
                    title=data.get("title", ""),
                    author=data.get("author", ""),
                    level=data.get("level", ""),
                    date=data.get("date", ""),
                    views=data.get("views", ""),
                    likes=data.get("likes", ""),
                    content_text=data.get("contentText", ""),
                    content_html=data.get("contentHTML", ""),
                    comments=data.get("comments", []),
                )
            except Exception as exc:  # pylint: disable=broad-except
                last_error = exc
                await page.close()
                await asyncio.sleep(0.5 * (attempt + 1))
            else:
                break
        if last_error:
            raise last_error
        return None

    async def run(self) -> dict:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            summaries = await self._collect_board(browser)
            detail_targets = [s for s in summaries if s.article_id][: self.detail_limit]
            details: List[ArticleDetail] = []
            detail_errors: List[dict] = []
            for summary in detail_targets:
                try:
                    detail = await self._fetch_article_detail(browser, summary.article_id)
                    if detail:
                        details.append(detail)
                    else:
                        detail_errors.append(
                            {
                                "article_id": summary.article_id,
                                "reason": "empty-detail",
                            }
                        )
                except Exception as exc:  # pylint: disable=broad-exception-caught
                    detail_errors.append(
                        {
                            "article_id": summary.article_id,
                            "error": repr(exc),
                        }
                    )
                    details.append(
                        ArticleDetail(
                            article_id=summary.article_id,
                            title=summary.title,
                            author=summary.author,
                            level=summary.level,
                            date=summary.date,
                            views=summary.views,
                            likes=summary.likes or "",
                            content_text=f"[ERROR] {exc}",
                            content_html="",
                            comments=[],
                        )
                    )
            await browser.close()
        return {
            "crawl_time": datetime.utcnow().isoformat(),
            "board_url": self.board_url,
            "summaries": [asdict(s) for s in summaries],
            "details": [asdict(d) for d in details],
            "meta": {
                "detail_targets": len(detail_targets),
                "detail_success": len([d for d in details if not d.content_text.startswith("[ERROR]")]),
                "detail_errors": detail_errors,
                "detail_retry": self.detail_retry,
                "detail_wait_ms": self.detail_wait_ms,
            },
        }


async def main() -> None:
    naver_id = os.getenv("NAVER_ID")
    naver_pw = os.getenv("NAVER_PW")
    if not naver_id or not naver_pw:
        raise SystemExit("NAVER_ID / NAVER_PW 환경변수가 필요합니다.")
    collector = IrisGuideCollector(
        naver_id=naver_id,
        naver_pw=naver_pw,
        max_pages=int(os.getenv("NAVER_MAX_PAGES", "2")),
        detail_limit=int(os.getenv("NAVER_DETAIL_LIMIT", "20")),
        detail_retry=int(os.getenv("NAVER_DETAIL_RETRY", "3")),
        detail_wait_ms=int(os.getenv("NAVER_IFRAME_WAIT_MS", "7000")),
        page_timeout_ms=int(os.getenv("NAVER_PAGE_TIMEOUT_MS", "15000")),
        frame_wait_ms=int(os.getenv("NAVER_FRAME_WAIT_MS", "5000")),
    )
    data = await collector.run()
    output_dir = Path("data/naver_cafe")
    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / "iris_guides.json"
    json_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[INFO] 수집 결과 저장: {json_path}")
    meta = data.get("meta", {})
    detail_success = meta.get("detail_success", 0)
    detail_targets = meta.get("detail_targets", 0)
    print(f"[INFO] 상세 본문 수집: {detail_success}/{detail_targets}건 (재시도 {meta.get('detail_retry')})")


if __name__ == "__main__":
    asyncio.run(main())

