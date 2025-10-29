#!/usr/bin/env python3
"""
직접 수동으로 IRIS 가이드 게시판 글 수집
사용자가 직접 브라우저를 보면서 수집할 수 있도록 도와주는 스크립트
"""

import os
import asyncio
from dotenv import load_dotenv
from playwright.async_api import async_playwright

# 환경변수 로드
load_dotenv('config/local.env')

async def manual_collect_iris_posts():
    """사용자가 직접 수집할 수 있도록 브라우저 열어주기"""

    naver_id = os.getenv('NAVER_ID')
    naver_pw = os.getenv('NAVER_PW')

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False, slow_mo=2000)
        context = await browser.new_context()
        page = await context.new_page()

        try:
            print("🔄 네이버 로그인 중...")
            await page.goto("https://nid.naver.com/nidlogin.login")
            await page.wait_for_timeout(2000)

            await page.fill('input[name="id"]', naver_id)
            await page.fill('input[name="pw"]', naver_pw)
            print("✅ 로그인 정보 입력 완료")

            await page.click('button[type="submit"]')
            print("🔄 로그인 버튼 클릭...")

            await page.wait_for_timeout(5000)

            # 카페 메인으로 이동
            print("🔄 F-E 카페로 이동...")
            await page.goto("https://cafe.naver.com/f-e")
            await page.wait_for_timeout(3000)

            # 여러 URL 시도
            urls_to_try = [
                "https://cafe.naver.com/f-e?menu=383",
                "https://cafe.naver.com/f-e/cafes/29537083/menus/383",
                "https://cafe.naver.com/f-e/ArticleList.nhn?search.clubid=29537083&search.menuid=383",
                "https://cafe.naver.com/f-e?search.clubid=29537083&search.menuid=383"
            ]

            for i, url in enumerate(urls_to_try):
                print(f"🔗 URL 시도 {i+1}: {url}")
                await page.goto(url)
                await page.wait_for_timeout(5000)

                current_url = page.url
                print(f"📍 현재 URL: {current_url}")

                # 페이지에 게시글이 있는지 확인
                page_content = await page.content()

                # IRIS 관련 키워드가 있는지 확인
                if "IRIS" in page_content or "iris" in page_content:
                    print("✅ IRIS 관련 내용 발견!")
                    break
                else:
                    print("❌ 이 페이지에는 IRIS 관련 내용이 없습니다.")

            # 브라우저를 계속 열어둠
            print("🖥️ 브라우저를 열어둡니다. 직접 게시글들을 확인하고 내용을 복사해주세요.")
            print("⏱️ 5분간 대기합니다...")

            # 사용자가 직접 확인할 시간 제공
            await page.wait_for_timeout(300000)  # 5분

        except Exception as e:
            print(f"❌ 에러 발생: {e}")
            input("엔터를 누르면 계속합니다...")

        finally:
            await browser.close()

if __name__ == "__main__":
    print("🎯 IRIS 가이드 게시판 수집 도우치")
    print("📝 이 스크립트는 브라우저를 열어주면 직접 내용을 확인하고 수집할 수 있도록 도와줍니다.")
    print("=" * 50)

    asyncio.run(manual_collect_iris_posts())