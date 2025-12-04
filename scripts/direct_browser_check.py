#!/usr/bin/env python3
"""
직접 브라우저를 열어서 카페 구조 확인
"""

import os
import asyncio
from dotenv import load_dotenv
from playwright.async_api import async_playwright

# 환경변수 로드
load_dotenv('config/local.env')

async def check_cafe_structure():
    """카페 구조 직접 확인"""

    naver_id = os.getenv('NAVER_ID')
    naver_pw = os.getenv('NAVER_PW')

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False, slow_mo=1000)
        context = await browser.new_context()
        page = await context.new_page()

        try:
            print("🔄 네이버 로그인...")
            await page.goto("https://nid.naver.com/nidlogin.login")
            await page.fill('input[name="id"]', naver_id)
            await page.fill('input[name="pw"]', naver_pw)
            await page.click('button[type="submit"]')
            await page.wait_for_timeout(5000)

            print("🔄 F-E 카페 메인으로 이동...")
            await page.goto("https://cafe.naver.com/f-e")
            await page.wait_for_timeout(3000)

            print("🔄 직접 메뉴 찾아보기...")

            # 페이지가 완전히 로드될 때까지 대기
            await page.wait_for_load_state('networkidle')

            # 현재 URL 확인
            current_url = page.url
            print(f"📍 현재 URL: {current_url}")

            # 개발자 콘솔에서 직접 확인
            await page.evaluate("""
                () => {
                    console.log('=== 페이지 분석 시작 ===');

                    // 모든 링크 확인
                    const links = document.querySelectorAll('a');
                    console.log('전체 링크 수:', links.length);

                    // 메뉴 관련 링크 찾기
                    const menuLinks = [];
                    links.forEach(link => {
                        const href = link.href;
                        const text = link.textContent.trim();
                        if (href && (href.includes('menu=383') || text.includes('IRIS') || text.includes('가이드'))) {
                            menuLinks.push({href, text});
                        }
                    });

                    console.log('IRIS 관련 메뉴:', menuLinks);

                    // 혹시 다른 방식으로 접근
                    if (menuLinks.length > 0) {
                        console.log('첫 번째 IRIS 메뉴 클릭:', menuLinks[0].href);
                        window.location.href = menuLinks[0].href;
                    }
                }
            """)

            await page.wait_for_timeout(5000)

            # 다시 확인
            final_url = page.url
            print(f"📍 최종 URL: {final_url}")

            print("✅ 브라우저를 30초간 유지합니다. 직접 확인해주세요...")
            await page.wait_for_timeout(30000)

        except Exception as e:
            print(f"❌ 에러: {e}")

        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(check_cafe_structure())