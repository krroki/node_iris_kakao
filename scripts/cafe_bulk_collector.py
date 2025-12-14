#!/usr/bin/env python3
"""
네이버 카페 다중 게시판 수집기 (Playwright)

기능
- NAVER_ID / NAVER_PW로 로그인
- 지정한 메뉴(게시판) 목록을 순회하며 n페이지 수집
- 글 목록 요약 + 글 상세(본문 텍스트/HTML) + 이미지 캡처(렌더링 기준)
- 결과를 data/naver_cafe/<cafe_id>/menu_<id>/ 에 JSON/PNG로 저장

사용법(예)
  NAVER_ID=... NAVER_PW=... python3 scripts/cafe_bulk_collector.py \
    --cafe 29537083 --menus 272 143 369 383 --pages 5 --detail 100

환경변수
- NAVER_ID, NAVER_PW (필수)
- NAVER_MAX_PAGES, NAVER_DETAIL_LIMIT (선택)

참고
- 이미지 다운로드는 각 img 요소를 element.screenshot()으로 캡처하여 저장(접근권한 문제 방지)
"""

from __future__ import annotations

import asyncio
import json
import os
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Sequence

from dotenv import load_dotenv
from playwright.async_api import Browser, Frame, Page, async_playwright

load_dotenv("config/local.env")


@dataclass
class ArticleSummary:
    article_id: str
    title: str
    link: str
    author: str
    date: str
    views: str
    comments: Optional[str]


@dataclass
class ArticleDetail:
    article_id: str
    title: str
    author: str
    date: str
    views: str
    content_text: str
    content_html: str
    images: List[str]


class CafeCollector:
    def __init__(
        self,
        naver_id: str,
        naver_pw: str,
        cafe_id: str,
        menu_ids: Sequence[str],
        max_pages: int = 2,
        detail_limit: int = 50,
        page_timeout_ms: int = 20000,
        frame_wait_ms: int = 6000,
        pending_timeout_ms: int = 60000,
        output_dir: Optional[Path] = None,
        log_file: Optional[Path] = None,
        manual_confirm_callback: Optional = None,
        detail_concurrency: int = 4,
        detail_flush_every: int = 10,
    ) -> None:
        self.naver_id = naver_id
        self.naver_pw = naver_pw
        self.cafe_id = cafe_id
        self.menu_ids = [str(m) for m in menu_ids]
        self.max_pages = max_pages
        self.detail_limit = detail_limit
        self.page_timeout_ms = max(2000, page_timeout_ms)
        self.frame_wait_ms = max(2000, frame_wait_ms)
        self.pending_timeout_ms = max(5000, pending_timeout_ms)
        self.output_dir = output_dir or Path("data/naver_cafe")
        self.detail_concurrency = max(1, detail_concurrency)
        self.detail_flush_every = max(1, detail_flush_every)
        self.log_fp: Optional[Path] = None
        if log_file:
            self.log_fp = log_file
        else:
            logs_dir = Path("logs") / "cafe"
            logs_dir.mkdir(parents=True, exist_ok=True)
            ts = datetime.utcnow().strftime("%Y%m%dT%H%M%S")
            self.log_fp = logs_dir / f"bulk_{ts}.log"
        self.manual_confirm_callback = manual_confirm_callback
        self._log_handle = self.log_fp.open("a", encoding="utf-8") if self.log_fp else None

    def _log(self, message: str) -> None:
        ts = datetime.utcnow().isoformat(timespec="seconds")
        msg = f"[{ts}] {message}"
        print(msg)
        if self._log_handle:
            self._log_handle.write(msg + "\n")
            self._log_handle.flush()

    async def _wait_manual_confirm(self, page: Page) -> None:
        start = datetime.utcnow()
        self._log("기기 인증 대기중(PENDING)")
        try:
            btn = await page.query_selector("#new\\.dontsave")
            if btn:
                await btn.click()
                self._log("기기 등록 안함 클릭")
                try:
                    await page.wait_for_load_state('networkidle')
                except Exception:
                    await page.wait_for_timeout(1000)
                if "deviceConfirm" not in page.url:
                    self._log("기기 인증 페이지 종료 감지")
                    return
        except Exception as e:
            self._log(f"기기 등록 안함 클릭 실패: {e}")
        screenshot_dir = (self.output_dir / "login_screens")
        screenshot_dir.mkdir(parents=True, exist_ok=True)
        shot_path = screenshot_dir / f"device_confirm_{start.strftime('%Y%m%dT%H%M%S')}.png"
        try:
            await page.screenshot(path=str(shot_path), full_page=True)
            self._log(f"기기 인증 스크린샷 저장: {shot_path}")
        except Exception as e:
            self._log(f"기기 인증 스크린샷 실패: {e}")
        try:
            html_path = screenshot_dir / f"device_confirm_{start.strftime('%Y%m%dT%H%M%S')}.html"
            html_content = await page.content()
            html_path.write_text(html_content, encoding="utf-8")
            self._log(f"기기 인증 HTML 저장: {html_path}")
        except Exception as e:
            self._log(f"기기 인증 HTML 저장 실패: {e}")
        if self.manual_confirm_callback:
            try:
                await self.manual_confirm_callback()
            except Exception as e:
                self._log(f"manual_confirm_callback 오류: {e}")
        while True:
            if (datetime.utcnow() - start).total_seconds() > self.pending_timeout_ms / 1000:
                raise TimeoutError("기기 인증 대기시간 초과")
            if "deviceConfirm" not in page.url:
                self._log("기기 인증 완료 감지")
                return
            await page.wait_for_timeout(1500)

    async def _login(self, page: Page) -> None:
        self._log("네이버 로그인 페이지 접속")
        await page.goto("https://nid.naver.com/nidlogin.login", wait_until="domcontentloaded")
        await page.fill('input[name="id"]', self.naver_id)
        await page.fill('input[name="pw"]', self.naver_pw)
        self._log("로그인 정보 입력 완료, 제출 중...")
        await page.click('button[type="submit"]')
        await page.wait_for_load_state('domcontentloaded')
        # 일부 계정은 신규기기 알림 팝업이 뜸
        try:
            if await page.query_selector("#new\\.dontsave"):
                await page.click("#new\\.dontsave")
                self._log("'이 기기 저장 안함' 처리")
        except Exception:
            pass
        await page.wait_for_load_state('networkidle')
        current_url = page.url
        self._log(f"로그인 이후 URL: {current_url}")
        if "deviceConfirm" in current_url:
            await self._wait_manual_confirm(page)

    async def _wait_frame(self, page: Page, name: str = "cafe_main") -> Optional[Frame]:
        for _ in range(20):
            fr = page.frame(name=name)
            if fr:
                return fr
            await asyncio.sleep(0.3)
        return None

    async def _extract_list(self, page: Page) -> List[ArticleSummary]:
        """(fallback) 메인 페이지에서 직접 목록을 찾는 구버전 로직. 실패 시 빈 리스트 반환."""
        try:
            await page.wait_for_selector("a.article", timeout=self.page_timeout_ms)
        except Exception:
            return []
        out: List[ArticleSummary] = []
        links = await page.query_selector_all("a.article")
        for link_el in links:
            try:
                link = await link_el.get_attribute("href") or ""
                title = (await link_el.inner_text()).strip()
                article_id = ""
                if "/articles/" in link:
                    article_id = link.split("/articles/")[-1].split("?")[0]
                else:
                    digits = "".join([c for c in link if c.isdigit()])
                    article_id = digits or ""
                if article_id and title:
                    out.append(ArticleSummary(article_id=article_id, title=title, link=link, author="", date="", views="", comments=None))
            except Exception:
                continue
        return out

    async def _extract_list_frame(self, fr: Frame) -> List[ArticleSummary]:
        """cafe_main 프레임 내부에서 목록 추출"""
        out: List[ArticleSummary] = []
        try:
            # 게시글 링크는 /articles/<id> 형태의 href를 가짐
            await fr.wait_for_selector('a[href*="/articles/"]', timeout=self.frame_wait_ms)
        except Exception:
            return out
        links = await fr.query_selector_all('a[href*="/articles/"]')
        seen = set()
        for link_el in links:
            try:
                link = await link_el.get_attribute("href") or ""
                title = (await link_el.inner_text()).strip()
                article_id = ""
                if "/articles/" in link:
                    article_id = link.split("/articles/")[-1].split("?")[0]
                else:
                    digits = "".join([c for c in link if c.isdigit()])
                    article_id = digits or ""
                if article_id:
                    if article_id in seen:
                        continue
                    seen.add(article_id)
                if article_id and title:
                    out.append(ArticleSummary(article_id=article_id, title=title, link=link, author="", date="", views="", comments=None))
            except Exception:
                continue
        return out

    async def _extract_detail(self, browser: Browser, menu_id: str, summary: ArticleSummary, out_dir: Path) -> Optional[ArticleDetail]:
        url = f"https://cafe.naver.com/f-e/cafes/{self.cafe_id}/articles/{summary.article_id}?menuid={menu_id}"
        page = await browser.new_page()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=self.page_timeout_ms)
            fr = await self._wait_frame(page, "cafe_main")
            scope = fr if fr is not None else page
            try:
                await scope.wait_for_selector("article, .Article, .ArticleContentBox, .cafe_detail_area", timeout=self.frame_wait_ms)
            except Exception:
                # fallback 대기
                await page.wait_for_timeout(1000)

            extract_js = """
            () => {
                const selectors = [
                    'article',
                    '.cafe_detail_area',
                    '.ArticleContentBox',
                    '.se-main-container',
                    '.content',
                    '#main-area',
                    '#app'
                ];
                for (const sel of selectors) {
                    const el = document.querySelector(sel);
                    if (el && el.innerText && el.innerText.trim().length > 0) {
                        return { text: el.innerText, html: el.innerHTML };
                    }
                }
                const body = document.body;
                return { text: body ? body.innerText : '', html: body ? body.innerHTML : '' };
            }
            """
            data = await scope.evaluate(extract_js)
            content_text = (data.get("text") or "")[:20000]
            content_html = data.get("html") or ""
            if fr is not None:
                img_elements = await fr.query_selector_all("article img, .se-viewer img, img")
            else:
                img_elements = await page.query_selector_all("article img, .se-viewer img, img")

            # 이미지 캡처(각 img 요소를 스크린샷)
            img_dir = out_dir / "images" / summary.article_id
            img_dir.mkdir(parents=True, exist_ok=True)
            imgs = img_elements
            saved: List[str] = []
            for idx, img in enumerate(imgs):
                try:
                    fname = f"{summary.article_id}_{idx+1:02d}.png"
                    fpath = img_dir / fname
                    await img.screenshot(path=str(fpath))
                    saved.append(str(fpath))
                except Exception:
                    continue
            # 이미지가 전혀 없으면 페이지 전체 스크린샷으로 대체
            if not saved:
                try:
                    fpath = img_dir / f"{summary.article_id}_full.png"
                    await page.screenshot(path=str(fpath), full_page=True)
                    saved.append(str(fpath))
                except Exception:
                    pass

            return ArticleDetail(
                article_id=summary.article_id,
                title=summary.title,
                author=summary.author,
                date=summary.date,
                views=summary.views,
                content_text=content_text or "",
                content_html=content_html or "",
                images=saved,
            )
        finally:
            await page.close()

    async def run(self) -> None:
        base_out = self.output_dir / self.cafe_id
        base_out.mkdir(parents=True, exist_ok=True)
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True)
                page = await browser.new_page()
                await self._login(page)
                for menu_id in self.menu_ids:
                    self._log(f"메뉴 {menu_id} 수집 시작")

                    menu_dir = base_out / f"menu_{menu_id}"
                    menu_dir.mkdir(parents=True, exist_ok=True)
                    detail_dir = menu_dir / "details"
                    detail_dir.mkdir(parents=True, exist_ok=True)
                    collected_path = menu_dir / "collected.json"

                    existing_summary_list: List[dict] = []
                    existing_summary_map: Dict[str, dict] = {}
                    existing_detail_map: Dict[str, dict] = {}
                    if collected_path.exists():
                        try:
                            current = json.loads(collected_path.read_text(encoding="utf-8"))
                        except Exception:
                            current = {}
                        for record in current.get("summaries", []) or []:
                            if not isinstance(record, dict):
                                continue
                            aid = record.get("article_id")
                            if not aid:
                                continue
                            existing_summary_list.append(record)
                            existing_summary_map[aid] = record
                        for record in current.get("details", []) or []:
                            if not isinstance(record, dict):
                                continue
                            aid = record.get("article_id")
                            if not aid:
                                continue
                            existing_detail_map[aid] = record

                    summaries: List[ArticleSummary] = []
                    seen_ids: set[str] = set()
                    page_idx = 1
                    empty_count = 0
                    known_ids = set(existing_summary_map.keys())
                    while True:
                        if self.max_pages > 0 and page_idx > self.max_pages:
                            break
                        list_url = f"https://cafe.naver.com/f-e/cafes/{self.cafe_id}/menus/{menu_id}?page={page_idx}"
                        await page.goto(list_url, wait_until="domcontentloaded", timeout=self.page_timeout_ms)
                        fr = await self._wait_frame(page, "cafe_main")
                        if fr is not None:
                            try:
                                await fr.wait_for_selector("a", timeout=self.frame_wait_ms)
                            except Exception:
                                pass
                            s = await self._extract_list_frame(fr)
                        else:
                            s = await self._extract_list(page)

                        new_items: List[ArticleSummary] = []
                        updated_items: List[ArticleSummary] = []
                        for item in s:
                            if not item.article_id or item.article_id in seen_ids:
                                continue
                            seen_ids.add(item.article_id)
                            if item.article_id in known_ids:
                                updated_items.append(item)
                            else:
                                new_items.append(item)
                                known_ids.add(item.article_id)
                        if new_items or updated_items:
                            summaries.extend(updated_items + new_items)
                            added = len(new_items)
                            updated = len(updated_items)
                            parts = []
                            if added:
                                parts.append(f"신규 {added}건")
                            if updated:
                                parts.append(f"업데이트 {updated}건")
                            summary_state = ", ".join(parts)
                            self._log(
                                f"메뉴 {menu_id} 페이지 {page_idx}: {summary_state} (누적 {len(summaries)})"
                            )
                            empty_count = 0 if new_items else empty_count
                        else:
                            empty_count += 1
                            self._log(
                                f"메뉴 {menu_id} 페이지 {page_idx}: 신규 게시글 없음 (연속 {empty_count})"
                            )

                        if empty_count >= 2:
                            self._log(f"메뉴 {menu_id}: 연속 빈 페이지 탐지, 목록 수집 종료")
                            break

                        page_idx += 1

                    summary_list = existing_summary_list[:]
                    summary_map = existing_summary_map.copy()
                    for summary in summaries:
                        record = asdict(summary)
                        aid = record.get("article_id")
                        if not aid:
                            continue
                        if aid in summary_map:
                            summary_map[aid] = record
                            for idx, existing in enumerate(summary_list):
                                if existing.get("article_id") == aid:
                                    summary_list[idx] = record
                                    break
                        else:
                            summary_map[aid] = record
                            summary_list.append(record)

                    self._write_collected(collected_path, menu_id, summary_list, existing_detail_map)

                    existing_detail_ids = set(existing_detail_map.keys())
                    pending_summaries: List[ArticleSummary] = []
                    for record in summary_list:
                        aid = record.get("article_id")
                        if not aid or aid in existing_detail_ids:
                            continue
                        pending_summaries.append(
                            ArticleSummary(
                                article_id=aid,
                                title=record.get("title", ""),
                                link=record.get("link", ""),
                                author=record.get("author", ""),
                                date=record.get("date", ""),
                                views=record.get("views", ""),
                                comments=record.get("comments"),
                            )
                        )

                    limit_count = self.detail_limit if self.detail_limit > 0 else len(pending_summaries)
                    if limit_count and pending_summaries:
                        targets = pending_summaries[:limit_count]
                        existing_detail_map = await self._collect_details(
                            browser,
                            menu_id,
                            targets,
                            menu_dir,
                            summary_list,
                            existing_detail_map,
                            collected_path,
                        )
                    else:
                        self._log(
                            f"메뉴 {menu_id}: 상세 수집 대상 없음 (요약 {len(summary_list)}건, 기존 상세 {len(existing_detail_map)})"
                        )

                    self._write_collected(collected_path, menu_id, summary_list, existing_detail_map)
                    self._log(
                        f"메뉴 {menu_id}: 목록 {len(summary_list)}건, 상세 {len(existing_detail_map)}건 저장 -> {collected_path}"
                    )
                    self._log(f"메뉴 {menu_id} 수집 종료")
            await browser.close()
            self._log("브라우저 종료")
        finally:
            if self._log_handle:
                self._log_handle.close()
                self._log_handle = None

    def _write_collected(
        self,
        collected_path: Path,
        menu_id: str,
        summary_list: List[dict],
        detail_map: Dict[str, dict],
    ) -> None:
        summary_copy = list(summary_list)
        detail_list: List[dict] = []
        seen: set[str] = set()
        for record in summary_copy:
            aid = record.get("article_id")
            if not aid:
                continue
            detail = detail_map.get(aid)
            if detail:
                detail_list.append(detail)
                seen.add(aid)
        for aid, detail in detail_map.items():
            if aid not in seen:
                detail_list.append(detail)
        data = {
            "crawl_time": datetime.utcnow().isoformat(),
            "cafe_id": self.cafe_id,
            "menu_id": menu_id,
            "summaries": summary_copy,
            "details": detail_list,
        }
        collected_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    async def _collect_details(
        self,
        browser: Browser,
        menu_id: str,
        targets: List[ArticleSummary],
        menu_dir: Path,
        summary_list: List[dict],
        detail_map: Dict[str, dict],
        collected_path: Path,
    ) -> Dict[str, dict]:
        if not targets:
            return detail_map

        sem = asyncio.Semaphore(self.detail_concurrency)

        async def worker(index: int, summary: ArticleSummary):
            async with sem:
                try:
                    detail = await self._extract_detail(browser, menu_id, summary, menu_dir)
                    return index, detail, None
                except Exception as exc:  # pragma: no cover
                    return index, None, exc

        tasks = [asyncio.create_task(worker(idx, summary)) for idx, summary in enumerate(targets, 1)]
        completed = 0
        saved = 0
        try:
            for coro in asyncio.as_completed(tasks):
                index, detail, error = await coro
                completed += 1
                if detail:
                    detail_dict = asdict(detail)
                    detail_map[detail.article_id] = detail_dict
                    saved += 1
                    if saved % self.detail_flush_every == 0:
                        self._write_collected(collected_path, menu_id, summary_list, detail_map)
                        self._log(
                            f"메뉴 {menu_id}: 상세 {saved}건 수집 (진행 {completed}/{len(targets)})"
                        )
                elif error:
                    summary = targets[index - 1]
                    self._log(f"[WARN] 상세 수집 실패 {summary.article_id}: {error}")
            if saved and saved % self.detail_flush_every != 0:
                self._log(
                    f"메뉴 {menu_id}: 상세 {saved}건 수집 (진행 {completed}/{len(targets)})"
                )
            return detail_map
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            self._write_collected(collected_path, menu_id, summary_list, detail_map)



async def main() -> None:
    naver_id = os.getenv("NAVER_ID")
    naver_pw = os.getenv("NAVER_PW")
    if not naver_id or not naver_pw:
        raise SystemExit("NAVER_ID / NAVER_PW 환경변수가 필요합니다.")
    cafe_id = os.getenv("NAVER_CAFE_ID", "29537083")
    menus_env = os.getenv("NAVER_MENU_IDS", "")
    menus = [m.strip() for m in menus_env.split(",") if m.strip()] or ["272", "143", "369", "383"]
    max_pages = int(os.getenv("NAVER_MAX_PAGES", "3"))
    detail_limit = int(os.getenv("NAVER_DETAIL_LIMIT", "50"))
    pending_timeout = int(os.getenv("NAVER_PENDING_TIMEOUT_MS", "60000"))
    detail_concurrency = int(os.getenv("NAVER_DETAIL_CONCURRENCY", "4"))
    detail_flush_every = int(os.getenv("NAVER_DETAIL_FLUSH", "10"))
    page_timeout_ms = int(os.getenv("NAVER_PAGE_TIMEOUT_MS", "20000"))
    frame_wait_ms = int(os.getenv("NAVER_FRAME_WAIT_MS", "6000"))
    output_dir_env = os.getenv("NAVER_OUTPUT_DIR")
    output_dir = Path(output_dir_env) if output_dir_env else None

    collector = CafeCollector(
        naver_id=naver_id,
        naver_pw=naver_pw,
        cafe_id=cafe_id,
        menu_ids=menus,
        max_pages=max_pages,
        detail_limit=detail_limit,
        page_timeout_ms=page_timeout_ms,
        frame_wait_ms=frame_wait_ms,
        pending_timeout_ms=pending_timeout,
        output_dir=output_dir,
        detail_concurrency=detail_concurrency,
        detail_flush_every=detail_flush_every,
    )
    await collector.run()
    print("[INFO] 수집 완료:", f"data/naver_cafe/{cafe_id}")


if __name__ == "__main__":
    asyncio.run(main())
