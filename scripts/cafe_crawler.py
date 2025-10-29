#!/usr/bin/env python3
"""
네이버 카페 전체 글 크롤러
IRIS 관련 정보 및 노루팅 관련 글 수집
"""

import os
import asyncio
import json
from datetime import datetime
from dotenv import load_dotenv
from playwright.async_api import async_playwright

# 환경변수 로드
load_dotenv('config/local.env')

async def crawl_cafe_articles():
    """카페 전체 글 크롤링"""

    naver_id = os.getenv('NAVER_ID')
    naver_pw = os.getenv('NAVER_PW')
    cafe_url = os.getenv('NAVER_CAFE_URL')

    collected_data = {
        'crawl_time': datetime.now().isoformat(),
        'iris_articles': [],
        'noruting_articles': [],
        'other_articles': [],
        'categories': {}
    }

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
                    print(f"⏳ 인증 대기 중... ({(i+1)*5}/120초)")

            # 카페 메인으로 이동
            print("🔄 카페 메인으로 이동...")
            await page.goto(cafe_url)
            await page.wait_for_timeout(3000)

            # 카테고리 정보 수집
            try:
                menu_elements = await page.query_selector_all('.menu-item a')
                for element in menu_elements:
                    menu_text = await element.text_content()
                    menu_url = await element.get_attribute('href')
                    if menu_text and menu_url:
                        collected_data['categories'][menu_text] = menu_url
                        print(f"📂 카테고리: {menu_text}")
            except Exception as e:
                print(f"카테고리 수집 오류: {e}")

            # 게시판 목록 확인
            boards = ['L', 'C']  # 일반게시판, 공지사항 등

            for board_type in boards:
                print(f"📋 {board_type} 게시판 글 목록 수집...")

                # 여러 페이지 크롤링
                for page_num in range(1, 6):  # 1~5페이지
                    board_url = f"{cafe_url}?boardtype={board_type}&page={page_num}"

                    try:
                        await page.goto(board_url)
                        await page.wait_for_timeout(2000)

                        # 글 목록 추출
                        articles = await page.query_selector_all('.article-board .article')

                        for article in articles:
                            try:
                                # 글 제목
                                title_elem = await article.query_selector('.article-title a')
                                if not title_elem:
                                    continue

                                title = await title_elem.text_content()
                                article_url = await title_elem.get_attribute('href')

                                # 작성자
                                author_elem = await article.query_selector('.article-nickname')
                                author = await author_elem.text_content() if author_elem else "Unknown"

                                # 작성일
                                date_elem = await article.query_selector('.article-date')
                                date = await date_elem.text_content() if date_elem else "Unknown"

                                # 조회수
                                view_elem = await article.query_selector('.article-view')
                                views = await view_elem.text_content() if view_elem else "0"

                                article_data = {
                                    'title': title.strip(),
                                    'url': article_url,
                                    'author': author.strip(),
                                    'date': date.strip(),
                                    'views': views.strip(),
                                    'board_type': board_type
                                }

                                # 키워드 기반 분류
                                title_lower = title.lower()
                                if any(keyword in title_lower for keyword in ['iris', '아이리스', 'ir', '설치', '설정', '환경']):
                                    article_data['category'] = 'IRIS'
                                    collected_data['iris_articles'].append(article_data)
                                    print(f"🎯 IRIS 관련 글: {title[:50]}...")
                                elif any(keyword in title_lower for keyword in ['노루팅', 'noruting', '루팅', 'root']):
                                    article_data['category'] = '노루팅'
                                    collected_data['noruting_articles'].append(article_data)
                                    print(f"🔒 노루팅 관련 글: {title[:50]}...")
                                else:
                                    article_data['category'] = '기타'
                                    collected_data['other_articles'].append(article_data)

                            except Exception as e:
                                continue

                        print(f"✅ {board_type} 게시판 {page_num}페이지 완료")

                    except Exception as e:
                        print(f"{board_type} 게시판 {page_num}페이지 오류: {e}")
                        continue

            # IRIS 관련 글 상세 내용 수집
            print("🎯 IRIS 관련 글 상세 내용 수집...")
            for i, article in enumerate(collected_data['iris_articles'][:10]):  # 상위 10개만 상세 수집
                try:
                    print(f"📖 글 읽는 중: {article['title'][:30]}...")
                    await page.goto(article['url'])
                    await page.wait_for_timeout(2000)

                    # 글 내용 추출
                    content_elem = await page.query_selector('.se-main-container')
                    if content_elem:
                        content = await content_elem.text_content()
                        collected_data['iris_articles'][i]['content'] = content[:1000] + "..." if len(content) > 1000 else content

                        # 댓글도 수집
                        comments = []
                        comment_elements = await page.query_selector_all('.comment-list .comment-item')
                        for comment_elem in comment_elements[:5]:  # 상위 5개 댓글만
                            try:
                                comment_text = await comment_elem.text_content()
                                if comment_text:
                                    comments.append(comment_text.strip())
                            except:
                                continue
                        collected_data['iris_articles'][i]['comments'] = comments

                    await page.wait_for_timeout(1000)

                except Exception as e:
                    print(f"글 내용 수집 오류: {e}")
                    continue

            # 노루팅 관련 글 상세 내용 수집
            print("🔒 노루팅 관련 글 상세 내용 수집...")
            for i, article in enumerate(collected_data['noruting_articles']):
                try:
                    print(f"📖 글 읽는 중: {article['title'][:30]}...")
                    await page.goto(article['url'])
                    await page.wait_for_timeout(2000)

                    content_elem = await page.query_selector('.se-main-container')
                    if content_elem:
                        content = await content_elem.text_content()
                        collected_data['noruting_articles'][i]['content'] = content[:1000] + "..." if len(content) > 1000 else content

                except Exception as e:
                    print(f"글 내용 수집 오류: {e}")
                    continue

            # 데이터 저장
            with open('cafe_data.json', 'w', encoding='utf-8') as f:
                json.dump(collected_data, f, ensure_ascii=False, indent=2)

            print(f"✅ 크롤링 완료!")
            print(f"📊 IRIS 관련 글: {len(collected_data['iris_articles'])}개")
            print(f"🔒 노루팅 관련 글: {len(collected_data['noruting_articles'])}개")
            print(f"📄 기타 글: {len(collected_data['other_articles'])}개")

            return collected_data

        except Exception as e:
            print(f"❌ 크롤링 오류: {e}")
            return None

        finally:
            await browser.close()

async def main():
    """메인 함수"""
    print("🚀 네이버 카페 전체 글 크롤링 시작")
    data = await crawl_cafe_articles()

    if data:
        print("✅ 데이터 수집 완료")
    else:
        print("❌ 데이터 수집 실패")

if __name__ == "__main__":
    asyncio.run(main())