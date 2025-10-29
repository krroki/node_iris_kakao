#!/usr/bin/env python3
"""
네이버 카페 접속 및 글 확인 스크립트
Playwright를 사용하여 자동 로그인 후 특정 글을 확인합니다.
"""

import os
import asyncio
from dotenv import load_dotenv
from playwright.async_api import async_playwright

# 환경변수 로드
load_dotenv('config/local.env')

async def access_naver_cafe():
    """네이버 카페에 접속하여 특정 글을 확인합니다."""

    naver_id = os.getenv('NAVER_ID')
    naver_pw = os.getenv('NAVER_PW')
    cafe_url = os.getenv('NAVER_CAFE_URL')
    target_url = "https://cafe.naver.com/f-e/cafes/29537083/articles/52109?boardtype=L&menuid=383&referrerAllArticles=false"

    if not all([naver_id, naver_pw]):
        print("❌ 네이버 계정 정보가 설정되지 않았습니다.")
        return False

    async with async_playwright() as p:
        # Chromium 브라우저 시작
        browser = await p.chromium.launch(headless=False)  # 화면 보이기
        context = await browser.new_context()
        page = await context.new_page()

        try:
            print("🔄 네이버 로그인 페이지로 이동...")
            await page.goto("https://nid.naver.com/nidlogin.login")
            await page.wait_for_timeout(2000)

            # 아이디 입력
            await page.fill('input[name="id"]', naver_id)
            print("✅ 아이디 입력 완료")

            # 비밀번호 입력
            await page.fill('input[name="pw"]', naver_pw)
            print("✅ 비밀번호 입력 완료")

            # 로그인 버튼 클릭
            await page.click('button[type="submit"]')
            print("🔄 로그인 버튼 클릭...")

            # 로그인 후 대기 및 모바일 인증 대기
            print("🔄 로그인 처리 중...")
            await page.wait_for_timeout(5000)

            # 모바일 인증이 필요한 경우 대기
            current_url = page.url
            if "nidlogin.login" in current_url:
                print("⚠️ 모바일 인증이 필요합니다")
                print("📱 모바일 인증을 진행해주세요...")
                print("⏳ 인증 완료 시 자동으로 진행됩니다")

                # 캡처 저장
                await page.screenshot(path="mobile_auth_waiting.png")
                print("📸 모바일 인증 대기 상태 스크린샷 저장: mobile_auth_waiting.png")

                # 로그인 성공까지 최대 120초 대기
                print("⏰ 로그인 성공 대기 시작 (최대 2분)...")
                for i in range(24):  # 24 * 5초 = 120초
                    await page.wait_for_timeout(5000)
                    current_url = page.url

                    if "nidlogin.login" not in current_url:
                        print("✅ 로그인 성공 확인!")
                        break

                    print(f"⏳ 대기 중... ({(i+1)*5}/120초)")

                # 최종 확인
                if "nidlogin.login" in current_url:
                    print("❌ 로그인 시간 초과")
                    await page.screenshot(path="login_timeout.png")
                    return False

            print("✅ 네이버 로그인 성공")

            # 카페 글로 이동
            print(f"🔄 카페 글로 이동: {target_url}")
            await page.goto(target_url)
            await page.wait_for_timeout(3000)

            # 페이지 제목 및 내용 확인
            title = await page.title()
            print(f"📄 페이지 제목: {title}")

            # 카페 글 내용 확인 시도
            try:
                # 글 제목 찾기
                title_element = await page.query_selector('.title_area')
                if title_element:
                    article_title = await title_element.text_content()
                    print(f"📝 글 제목: {article_title}")

                # 글 내용 찾기
                content_element = await page.query_selector('.se-main-container')
                if content_element:
                    content = await content_element.text_content()
                    print(f"📄 글 내용 (일부): {content[:200]}...")

                # 스크린샷 저장
                await page.screenshot(path="cafe_article.png", full_page=True)
                print("📸 카페 글 스크린샷 저장: cafe_article.png")

                return True

            except Exception as e:
                print(f"❌ 글 내용 확인 중 오류: {e}")
                await page.screenshot(path="cafe_article_error.png")
                return False

        except Exception as e:
            print(f"❌ 작업 중 오류 발생: {e}")
            await page.screenshot(path="error_screenshot.png")
            return False

        finally:
            await browser.close()

async def main():
    """메인 함수"""
    print("🚀 네이버 카페 접속 스크립트 시작")
    success = await access_naver_cafe()

    if success:
        print("✅ 카페 글 확인 성공")
    else:
        print("❌ 카페 글 확인 실패")

    print("🏁 스크립트 종료")

if __name__ == "__main__":
    asyncio.run(main())