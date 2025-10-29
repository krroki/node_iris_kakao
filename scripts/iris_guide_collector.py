#!/usr/bin/env python3
"""
IRIS 가이드 게시판 모든 글 수집기
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

            # IRIS 가이드 게시판으로 이동
            print("🔄 IRIS 가이드 게시판으로 이동...")
            await page.goto("https://cafe.naver.com/f-e/cafes/29537083/menus/383")
            await page.wait_for_timeout(3000)

            # 게시글 목록 수집
            print("📋 게시글 목록 수집 중...")
            posts_data = await page.evaluate("""
                () => {
                    const posts = [];
                    const articleElements = document.querySelectorAll('.article-board tr[data-article-id]');

                    articleElements.forEach(element => {
                        const titleElement = element.querySelector('.article');
                        const authorElement = element.querySelector('.author');
                        const dateElement = element.querySelector('.date');

                        if (titleElement) {
                            posts.push({
                                article_id: element.getAttribute('data-article-id'),
                                title: titleElement.textContent.trim(),
                                author: authorElement ? authorElement.textContent.trim() : '',
                                date: dateElement ? dateElement.textContent.trim() : '',
                                url: titleElement.href
                            });
                        }
                    });

                    return posts;
                }
            """)

            print(f"✅ {len(posts_data)}개의 게시글 발견")

            # 각 게시글 상세 내용 수집
            for i, post in enumerate(posts_data[:10]):  # 처음 10개만 테스트
                try:
                    print(f"📖 {i+1}/{len(posts_data)}: {post['title']}")

                    # 새 탭에서 게시글 열기
                    new_page = await context.new_page()
                    await new_page.goto(post['url'])
                    await new_page.wait_for_timeout(3000)

                    # 게시글 내용 수집
                    content_data = await new_page.evaluate("""
                        () => {
                            const titleElement = document.querySelector('.title_area');
                            const contentElement = document.querySelector('.se-main-container');
                            const authorElement = document.querySelector('.author');
                            const dateElement = document.querySelector('.date');

                            // 댓글 수집
                            const comments = [];
                            const commentElements = document.querySelectorAll('.comment_area');

                            commentElements.forEach(comment => {
                                const commentAuthor = comment.querySelector('.comment_nickname');
                                const commentContent = comment.querySelector('.comment_text');
                                const commentDate = comment.querySelector('.comment_date_time');

                                if (commentAuthor && commentContent) {
                                    comments.push({
                                        author: commentAuthor.textContent.trim(),
                                        content: commentContent.textContent.trim(),
                                        date: commentDate ? commentDate.textContent.trim() : ''
                                    });
                                }
                            });

                            return {
                                title: titleElement ? titleElement.textContent.trim() : '',
                                content: contentElement ? contentElement.innerHTML : '',
                                author: authorElement ? authorElement.textContent.trim() : '',
                                date: dateElement ? dateElement.textContent.trim() : '',
                                comments: comments
                            };
                        }
                    """)

                    # 수집된 데이터 병합
                    post.update(content_data)
                    collected_data['posts'].append(post)

                    await new_page.close()
                    await page.wait_for_timeout(1000)  # 요청 간격

                except Exception as e:
                    print(f"❌ 게시글 수집 실패: {e}")
                    continue

            # 수집된 데이터 저장
            with open('iris_guide_data.json', 'w', encoding='utf-8') as f:
                json.dump(collected_data, f, ensure_ascii=False, indent=2)

            print(f"✅ 총 {len(collected_data['posts'])}개의 게시글 수집 완료")
            print("📁 iris_guide_data.json 파일로 저장되었습니다.")

        except Exception as e:
            print(f"❌ 에러 발생: {e}")

        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(collect_iris_guides())