#!/usr/bin/env python3
"""
IRIS 가이드 게시판 모든 글 수집기 v2
F-E 카페 IRIS 가이드 게시판의 모든 글과 댓글을 수집합니다.
"""

import os
import asyncio
import json
from datetime import datetime
from dotenv import load_dotenv
from playwright.async_api import async_playwright

# 환경변수 로드
load_dotenv('config/local.env')

async def collect_iris_guides():
    """IRIS 가이드 게시판의 모든 글과 댓글 수집"""

    naver_id = os.getenv('NAVER_ID')
    naver_pw = os.getenv('NAVER_PW')

    collected_data = {
        'crawl_time': datetime.now().isoformat(),
        'board_url': 'https://cafe.naver.com/f-e/cafes/29537083/menus/383',
        'posts': []
    }

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False)
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

            # 로그인 후 대기
            await page.wait_for_timeout(5000)

            # 먼저 카페 메인으로 이동
            print("🔄 카페 메인으로 이동...")
            await page.goto("https://cafe.naver.com/f-e")
            await page.wait_for_timeout(3000)

            # 메뉴 383 (IRIS 가이드)으로 이동
            print("🔄 IRIS 가이드 게시판으로 이동...")
            await page.goto("https://cafe.naver.com/f-e?menu=383")
            await page.wait_for_timeout(3000)

            # 페이지 소스 확인 및 스크린샷
            page_title = await page.title()
            print(f"📄 페이지 제목: {page_title}")

            # 게시글이 있는지 확인하기 위해 여러 선택자 시도
            selectors_to_try = [
                '.article-board tbody tr',
                '.board-list tbody tr',
                '.cafe-article-list tbody tr',
                'table tbody tr',
                '[class*="article"] tr'
            ]

            posts_found = False
            for selector in selectors_to_try:
                try:
                    print(f"🔍 선택자 시도: {selector}")
                    posts_data = await page.evaluate(f"""
                        () => {{
                            const elements = document.querySelectorAll('{selector}');
                            const posts = [];

                            elements.forEach((element, index) => {{
                                const titleElement = element.querySelector('a[class*="title"], a[class*="article"], .title, .article');
                                const linkElement = element.querySelector('a[href*="article"]');

                                if (titleElement && linkElement) {{
                                    posts.push({{
                                        index: index,
                                        title: titleElement.textContent.trim(),
                                        url: linkElement.href,
                                        html: element.outerHTML.substring(0, 200)
                                    }});
                                }}
                            }});

                            return posts;
                        }}
                    """)

                    if posts_data:
                        print(f"✅ {len(posts_data)}개의 게시글 발견 (선택자: {selector})")
                        posts_found = True

                        # 처음 5개 게시글만 상세 수집
                        for i, post in enumerate(posts_data[:5]):
                            try:
                                print(f"📖 {i+1}/{len(posts_data)}: {post['title']}")

                                # 게시글 상세 페이지로 이동
                                new_page = await context.new_page()
                                await new_page.goto(post['url'])
                                await new_page.wait_for_timeout(3000)

                                # 상세 내용 수집
                                content_data = await new_page.evaluate("""
                                    () => {
                                        const titleElement = document.querySelector('.title_area, h1, .title');
                                        const contentElement = document.querySelector('.se-main-container, .content, .article-content');
                                        const authorElement = document.querySelector('.author, .writer');
                                        const dateElement = document.querySelector('.date, .time');

                                        // 댓글 수집
                                        const comments = [];
                                        const commentElements = document.querySelectorAll('.comment_area, .comment, .reply');

                                        commentElements.forEach(comment => {
                                            const commentAuthor = comment.querySelector('.nickname, .author, .comment-author');
                                            const commentContent = comment.querySelector('.text, .content, .comment-content');

                                            if (commentAuthor && commentContent) {
                                                comments.push({
                                                    author: commentAuthor.textContent.trim(),
                                                    content: commentContent.textContent.trim()
                                                });
                                            }
                                        });

                                        return {
                                            title: titleElement ? titleElement.textContent.trim() : '',
                                            content: contentElement ? contentElement.innerHTML.substring(0, 1000) : '',
                                            author: authorElement ? authorElement.textContent.trim() : '',
                                            date: dateElement ? dateElement.textContent.trim() : '',
                                            comments: comments
                                        };
                                    }
                                """);

                                post.update(content_data)
                                collected_data['posts'].append(post)

                                await new_page.close()
                                await page.wait_for_timeout(1000)

                            except Exception as e:
                                print(f"❌ 게시글 상세 수집 실패: {e}")
                                continue

                        break

                except Exception as e:
                    print(f"❌ 선택자 {selector} 실패: {e}")
                    continue

            if not posts_found:
                print("❌ 게시글을 찾지 못했습니다. 페이지 구조를 확인해주세요.")

                # 페이지 HTML 일부 저장
                page_html = await page.content()
                with open('debug_page.html', 'w', encoding='utf-8') as f:
                    f.write(page_html)
                print("📁 debug_page.html 파일로 페이지 소스 저장")

            # 수집된 데이터 저장
            with open('iris_guide_data.json', 'w', encoding='utf-8') as f:
                json.dump(collected_data, f, ensure_ascii=False, indent=2)

            print(f"✅ 총 {len(collected_data['posts'])}개의 게시글 수집 완료")

        except Exception as e:
            print(f"❌ 에러 발생: {e}")
            # 스크린샷 찍기
            await page.screenshot(path="error_screenshot.png")
            print("📸 error_screenshot.png 저장됨")

        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(collect_iris_guides())