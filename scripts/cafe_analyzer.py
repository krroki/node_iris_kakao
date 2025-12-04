#!/usr/bin/env python3
"""
네이버 카페 구조 분석기
카페의 HTML 구조를 파악하여 크롤링 전략 수립
"""

import os
import asyncio
from dotenv import load_dotenv
from playwright.async_api import async_playwright

# 환경변수 로드
load_dotenv('config/local.env')

async def analyze_cafe_structure():
    """카페 구조 분석"""

    naver_id = os.getenv('NAVER_ID')
    naver_pw = os.getenv('NAVER_PW')
    cafe_url = os.getenv('NAVER_CAFE_URL')

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
        context = await browser.new_context()
        page = await context.new_page()

        try:
            # 로그인
            print("🔄 네이버 로그인...")
            await page.goto("https://nid.naver.com/nidlogin.login")
            await page.fill('input[name="id"]', naver_id)
            await page.fill('input[name="pw"]', naver_pw)
            await page.click('button[type="submit"]')
            await page.wait_for_timeout(5000)

            # 모바일 인증 대기
            if "nidlogin.login" in page.url:
                print("📱 모바일 인증 대기...")
                for i in range(24):
                    await page.wait_for_timeout(5000)
                    if "nidlogin.login" not in page.url:
                        break

            # 카페 메인으로 이동
            print("🔄 카페 메인으로 이동...")
            await page.goto(cafe_url)
            await page.wait_for_timeout(3000)

            # 페이지 소스 저장
            html_content = await page.content()
            with open('cafe_main.html', 'w', encoding='utf-8') as f:
                f.write(html_content)
            print("📄 카페 메인 HTML 저장: cafe_main.html")

            # 게시판 링크 확인
            print("🔍 게시판 링크 확인...")

            # 다양한 선택자 시도
            selectors = [
                '.menu-list a',
                '.cafe-menu a',
                '.left-menu a',
                '.gnb-menu a',
                'nav a',
                '.navigation a',
                '[data-role="menu"] a',
                '.side-menu a',
                '.category-menu a'
            ]

            for selector in selectors:
                try:
                    elements = await page.query_selector_all(selector)
                    if elements:
                        print(f"✅ 선택자 '{selector}'에서 {len(elements)}개 요소 발견:")
                        for i, elem in enumerate(elements[:5]):
                            text = await elem.text_content()
                            href = await elem.get_attribute('href')
                            if text and href:
                                print(f"  {i+1}. {text.strip()} -> {href}")
                except Exception as e:
                    continue

            # 게시글 목록 확인
            print("\n🔍 게시글 목록 확인...")

            # 게시판으로 이동 시도
            board_urls = [
                f"{cafe_url}?boardtype=L",
                f"{cafe_url}/articles",
                f"{cafe_url}/board/L",
                f"{cafe_url}?menuid=383",  # 이전에 확인된 메뉴 ID
            ]

            for board_url in board_urls:
                try:
                    print(f"🔄 게시판 접속 시도: {board_url}")
                    await page.goto(board_url)
                    await page.wait_for_timeout(3000)

                    # 게시글 목록 선택자 시도
                    article_selectors = [
                        '.article-board tr',
                        '.board-list tr',
                        '.list-board tr',
                        '.cafe-board tr',
                        'table tr',
                        '.article-item',
                        '.list-item',
                        '[data-role="article-list"] *'
                    ]

                    for selector in article_selectors:
                        try:
                            elements = await page.query_selector_all(selector)
                            if elements:
                                print(f"✅ 게시글 선택자 '{selector}': {len(elements)}개")

                                # 첫 번째 요소의 구조 확인
                                first_elem = elements[0]
                                text = await first_elem.text_content()
                                print(f"  샘플 내용: {text[:100]}...")
                                break
                        except:
                            continue

                    # 스크린샷 저장
                    await page.screenshot(path=f"board_{board_url.split('?')[-1] or 'main'}.png")
                    print(f"📸 스크린샷 저장: board_{board_url.split('?')[-1] or 'main'}.png")

                except Exception as e:
                    print(f"게시판 접속 실패: {e}")
                    continue

            # 전체 페이지 스크린샷
            await page.screenshot(path="cafe_full_page.png", full_page=True)
            print("📸 전체 페이지 스크린샷 저장: cafe_full_page.png")

        except Exception as e:
            print(f"❌ 분석 오류: {e}")
            await page.screenshot(path="analysis_error.png")

        finally:
            await browser.close()

async def main():
    """메인 함수"""
    print("🔍 카페 구조 분석 시작")
    await analyze_cafe_structure()
    print("✅ 분석 완료")

if __name__ == "__main__":
    asyncio.run(main())