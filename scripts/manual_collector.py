#!/usr/bin/env python3
"""
수동 정보 수집기
직접 URL을 통해 중요한 글들을 방문하여 정보 수집
"""

import os
import asyncio
from dotenv import load_dotenv
from playwright.async_api import async_playwright

# 환경변수 로드
load_dotenv('config/local.env')

# 중요한 글 URL들 (수동으로 수집)
important_urls = [
    "https://cafe.naver.com/f-e/cafes/29537083/articles/52109?boardtype=L&menuid=383&referrerAllArticles=false",  # 25년 7월 기준 Iris 설치 방법
]

async def collect_manual_info():
    """수동 정보 수집"""

    naver_id = os.getenv('NAVER_ID')
    naver_pw = os.getenv('NAVER_PW')

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

            print("✅ 로그인 완료!")

            # 각 URL 방문
            for i, url in enumerate(important_urls):
                print(f"\n📖 {i+1}번째 글 방문: {url}")

                try:
                    await page.goto(url)
                    await page.wait_for_timeout(3000)

                    # 제목 확인
                    title = await page.title()
                    print(f"📝 제목: {title}")

                    # 스크린샷 저장
                    screenshot_name = f"article_{i+1}_screenshot.png"
                    await page.screenshot(path=screenshot_name, full_page=True)
                    print(f"📸 스크린샷 저장: {screenshot_name}")

                    # 내용 추출 시도
                    content_selectors = [
                        '.se-main-container',
                        '.article-content',
                        '.board-content',
                        '#postContent'
                    ]

                    content_found = False
                    for selector in content_selectors:
                        try:
                            content_elem = await page.query_selector(selector)
                            if content_elem:
                                content = await content_elem.text_content()
                                if content and len(content) > 50:
                                    # 내용 저장
                                    with open(f"article_{i+1}_content.txt", "w", encoding="utf-8") as f:
                                        f.write(f"제목: {title}\n")
                                        f.write(f"URL: {url}\n")
                                        f.write(f"내용:\n\n{content}")
                                    print(f"📄 내용 저장: article_{i+1}_content.txt")
                                    content_found = True
                                    break
                        except:
                            continue

                    if not content_found:
                        print("⚠️ 내용을 추출하지 못했습니다")

                    # 댓글 확인
                    try:
                        comment_selectors = [
                            '.comment-list',
                            '.reply-list',
                            '.comments'
                        ]

                        for selector in comment_selectors:
                            comments = await page.query_selector_all(selector)
                            if comments:
                                print(f"💬 댓글 발견: {len(comments)}개")
                                break
                    except:
                        pass

                    # 다음 글로 넘어가기 전 대기
                    print("⏳ 3초 후 다음 글로...")
                    await page.wait_for_timeout(3000)

                except Exception as e:
                    print(f"❌ 글 방문 오류: {e}")
                    continue

            print("\n✅ 모든 글 방문 완료!")

            # 카페 메인으로 이동하여 최신 글 목록 확인
            print("\n🔄 카페 메인으로 이동...")
            await page.goto("https://cafe.naver.com/f-e/cafes/29537083")
            await page.wait_for_timeout(5000)

            # 스크린샷 저장
            await page.screenshot(path="cafe_main_recent.png", full_page=True)
            print("📸 카페 메인 스크린샷 저장: cafe_main_recent.png")

            # 검색창 사용 시도
            print("\n🔍 검색 기능 테스트...")
            search_terms = ["IRIS", "설치", "노루팅"]

            for term in search_terms:
                try:
                    # 검색창 찾기
                    search_inputs = await page.query_selector_all('input[type="search"], input[placeholder*="검색"]')

                    if search_inputs:
                        search_input = search_inputs[0]
                        await search_input.fill(term)
                        await page.keyboard.press('Enter')
                        await page.wait_for_timeout(3000)

                        print(f"🔍 '{term}' 검색 완료")
                        await page.screenshot(path=f"search_{term}.png")
                        print(f"📸 검색 결과 스크린샷: search_{term}.png")

                        # 뒤로가기
                        await page.go_back()
                        await page.wait_for_timeout(2000)

                except Exception as e:
                    print(f"검색 오류 ({term}): {e}")
                    continue

        except Exception as e:
            print(f"❌ 전체 작업 오류: {e}")
            await page.screenshot(path="manual_collector_error.png")

        finally:
            await browser.close()

async def main():
    """메인 함수"""
    print("🚀 수동 정보 수집 시작")
    await collect_manual_info()
    print("✅ 수동 정보 수집 완료")

if __name__ == "__main__":
    asyncio.run(main())