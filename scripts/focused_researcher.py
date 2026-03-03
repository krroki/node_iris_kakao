#!/usr/bin/env python3
"""
집중 정보 수집기
특정 키워드에 집중하여 깊이 있는 정보 수집
"""

import os
import asyncio
from dotenv import load_dotenv
from playwright.async_api import async_playwright

# 환경변수 로드
load_dotenv('config/local.env')

async def focused_research():
    """집중 정보 수집"""

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

            print("✅ 로그인 완료!")

            # 카페로 이동
            await page.goto(cafe_url)
            await page.wait_for_timeout(5000)

            # 연구 키워드들
            research_keywords = [
                ("노루팅", "noruting 관련"),
                ("루팅", "android rooting"),
                ("IRIS 설치", "iris installation"),
                ("IRIS 설정", "iris configuration"),
                ("봇 개발", "bot development"),
                ("자동응답", "auto reply"),
                ("ChatGPT", "chatgpt integration"),
                ("API", "api usage"),
                ("템플릿", "template"),
                ("배포", "deployment")
            ]

            collected_info = []

            for keyword, category in research_keywords:
                print(f"\n🔍 키워드 연구: {keyword} ({category})")

                try:
                    # 카페 검색 기능 사용
                    await page.goto(cafe_url)
                    await page.wait_for_timeout(2000)

                    # 검색창 찾기 및 키워드 입력
                    search_found = False
                    search_selectors = [
                        'input[placeholder*="검색"]',
                        'input[type="search"]',
                        '.search-input',
                        'input[name="query"]'
                    ]

                    for selector in search_selectors:
                        try:
                            search_input = await page.query_selector(selector)
                            if search_input:
                                await search_input.fill(keyword)
                                await page.keyboard.press('Enter')
                                await page.wait_for_timeout(3000)
                                search_found = True
                                print(f"✅ '{keyword}' 검색 완료")
                                break
                        except:
                            continue

                    if search_found:
                        # 검색 결과 스크린샷
                        screenshot_name = f"search_{keyword.replace(' ', '_')}.png"
                        await page.screenshot(path=screenshot_name, full_page=True)
                        print(f"📸 검색 결과 저장: {screenshot_name}")

                        # 현재 페이지 URL 저장
                        current_url = page.url
                        collected_info.append({
                            'keyword': keyword,
                            'category': category,
                            'url': current_url,
                            'screenshot': screenshot_name
                        })

                        # 결과가 있는지 확인
                        content = await page.content()
                        if "검색결과가 없습니다" in content or "결과가 없습니다" in content:
                            print(f"⚠️ '{keyword}' 검색 결과 없음")
                        else:
                            print(f"✅ '{keyword}' 검색 결과 발견")

                    # 대기
                    await page.wait_for_timeout(2000)

                except Exception as e:
                    print(f"❌ '{keyword}' 검색 오류: {e}")
                    continue

            # 메인 게시판 탐색
            print("\n📋 메인 게시판 탐색...")

            # 다양한 게시판 URL 시도
            board_variants = [
                "?boardtype=L",
                "?menuid=383",
                "?search.sortType=createdAt",
                "?search.sortType=viewCount"
            ]

            for variant in board_variants:
                try:
                    board_url = f"{cafe_url}{variant}"
                    print(f"🔄 게시판 접속: {board_url}")

                    await page.goto(board_url)
                    await page.wait_for_timeout(3000)

                    # 스크린샷
                    board_screenshot = f"board_{variant.replace('?', '').replace('=', '_')}.png"
                    await page.screenshot(path=board_screenshot, full_page=True)
                    print(f"📸 게시판 스크린샷: {board_screenshot}")

                except Exception as e:
                    print(f"게시판 접속 오류: {e}")
                    continue

            # 수집된 정보 요약
            print(f"\n📊 수집된 정보 요약:")
            print(f"총 키워드 검색: {len(collected_info)}개")
            for info in collected_info:
                print(f"  - {info['keyword']} ({info['category']})")

            # 결과 저장
            import json
            with open('research_results.json', 'w', encoding='utf-8') as f:
                json.dump(collected_info, f, ensure_ascii=False, indent=2)

            print("\n✅ 연구 결과 저장: research_results.json")

        except Exception as e:
            print(f"❌ 연구 오류: {e}")
            await page.screenshot(path="research_error.png")

        finally:
            await browser.close()

async def main():
    """메인 함수"""
    print("🔬 집중 정보 연구 시작")
    await focused_research()
    print("✅ 집중 정보 연구 완료")

if __name__ == "__main__":
    asyncio.run(main())