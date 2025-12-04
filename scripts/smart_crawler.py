#!/usr/bin/env python3
"""
스마트 카페 크롤러
JavaScript 렌더링 페이지와 네이버 카페 최신 구조에 최적화
"""

import os
import asyncio
import json
from datetime import datetime
from dotenv import load_dotenv
from playwright.async_api import async_playwright

# 환경변수 로드
load_dotenv('config/local.env')

async def smart_crawl_cafe():
    """스마트 카페 크롤링"""

    naver_id = os.getenv('NAVER_ID')
    naver_pw = os.getenv('NAVER_PW')
    cafe_url = os.getenv('NAVER_CAFE_URL')

    collected_data = {
        'crawl_time': datetime.now().isoformat(),
        'iris_articles': [],
        'noruting_articles': [],
        'installation_guides': [],
        'bot_tutorials': [],
        'technical_posts': []
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

            # 카페 메인으로 이동 및 대기
            print("🔄 카페 메인으로 이동...")
            await page.goto(cafe_url)
            await page.wait_for_timeout(5000)  # JS 렌더링 대기

            # 검색 기능 활용
            search_keywords = ['IRIS', 'iris', '아이리스', '설치', '설정', '봇', '자동응답', '노루팅', '루팅']

            for keyword in search_keywords:
                print(f"🔍 키워드 검색: {keyword}")

                try:
                    # 검색창 찾기
                    search_selectors = [
                        'input[placeholder*="검색"]',
                        'input[type="search"]',
                        '.search-input',
                        '#search-input',
                        'input[name="query"]',
                        'input[name="q"]'
                    ]

                    search_input = None
                    for selector in search_selectors:
                        try:
                            search_input = await page.query_selector(selector)
                            if search_input:
                                print(f"✅ 검색창 발견: {selector}")
                                break
                        except:
                            continue

                    if search_input:
                        await search_input.fill(keyword)
                        await page.keyboard.press('Enter')
                        await page.wait_for_timeout(3000)

                        # 검색 결과 분석
                        await analyze_search_results(page, collected_data, keyword)

                        # 뒤로가기
                        await page.go_back()
                        await page.wait_for_timeout(2000)

                except Exception as e:
                    print(f"검색 오류 ({keyword}): {e}")
                    continue

            # 직접 URL 방식으로 게시판 접근 시도
            board_urls = [
                f"{cafe_url}?boardtype=L",
                f"{cafe_url}?search.sortType=createdAt",
                f"{cafe_url}?search.query=IRIS"
            ]

            for board_url in board_urls:
                try:
                    print(f"🔄 게시판 직접 접속: {board_url}")
                    await page.goto(board_url)
                    await page.wait_for_timeout(5000)

                    # 페이지 소스에서 게시글 링크 추출
                    content = await page.content()
                    import re

                    # 네이버 카페 게시글 URL 패턴
                    article_pattern = r'https://cafe\.naver\.com/f-e/[^\s"]+/articles/\d+'
                    articles = re.findall(article_pattern, content)

                    print(f"📄 발견된 게시글: {len(articles)}개")

                    # 중복 제거
                    unique_articles = list(set(articles))
                    print(f"📄 고유 게시글: {len(unique_articles)}개")

                    # 상위 게시글만 방문
                    for article_url in unique_articles[:10]:
                        try:
                            print(f"📖 글 읽기: {article_url}")
                            await page.goto(article_url)
                            await page.wait_for_timeout(3000)

                            # 글 정보 추출
                            article_info = await extract_article_info(page)
                            if article_info:
                                categorize_article(collected_data, article_info, keyword)

                            await page.wait_for_timeout(1000)

                        except Exception as e:
                            print(f"글 읽기 오류: {e}")
                            continue

                    await page.wait_for_timeout(2000)

                except Exception as e:
                    print(f"게시판 접속 오류: {e}")
                    continue

            # 결과 저장
            with open('smart_cafe_data.json', 'w', encoding='utf-8') as f:
                json.dump(collected_data, f, ensure_ascii=False, indent=2)

            print_results(collected_data)
            return collected_data

        except Exception as e:
            print(f"❌ 크롤링 오류: {e}")
            await page.screenshot(path="smart_crawler_error.png")
            return None

        finally:
            await browser.close()

async def analyze_search_results(page, collected_data, keyword):
    """검색 결과 분석"""
    try:
        # 다양한 게시글 선택자 시도
        article_selectors = [
            '.article-item',
            '.list-item',
            '[data-article-id]',
            '.cafe-article',
            '.search-result-item',
            'a[href*="articles/"]'
        ]

        for selector in article_selectors:
            try:
                elements = await page.query_selector_all(selector)
                if elements:
                    print(f"✅ 검색 결과 발견 ({selector}): {len(elements)}개")

                    for element in elements[:5]:  # 상위 5개만
                        try:
                            # 링크 추출
                            if element.tag_name == 'a':
                                article_url = await element.get_attribute('href')
                            else:
                                link_elem = await element.query_selector('a[href*="articles/"]')
                                if link_elem:
                                    article_url = await link_elem.get_attribute('href')
                                else:
                                    continue

                            if article_url and 'articles/' in article_url:
                                # 제목 추출
                                title = await element.text_content()
                                print(f"  📝 {title[:50]}...")

                                # 상세 정보 수집을 위해 나중에 방문할 리스트에 추가
                                collected_data['iris_articles'].append({
                                    'title': title.strip(),
                                    'url': article_url,
                                    'keyword': keyword
                                })

                        except Exception as e:
                            continue
                    break
            except:
                continue

    except Exception as e:
        print(f"검색 결과 분석 오류: {e}")

async def extract_article_info(page):
    """게시글 정보 추출"""
    try:
        # 제목
        title_selectors = [
            '.title_area',
            '.article-title',
            '.board-title',
            'h1', 'h2', 'h3',
            '.tit_area'
        ]

        title = "제목 없음"
        for selector in title_selectors:
            try:
                elem = await page.query_selector(selector)
                if elem:
                    title = await elem.text_content()
                    title = title.strip()
                    if title and len(title) > 3:
                        break
            except:
                continue

        # 내용
        content_selectors = [
            '.se-main-container',
            '.article-content',
            '.board-content',
            '.post-content',
            '#postContent'
        ]

        content = "내용 없음"
        for selector in content_selectors:
            try:
                elem = await page.query_selector(selector)
                if elem:
                    content = await elem.text_content()
                    content = content.strip()
                    if content and len(content) > 10:
                        content = content[:1000] + "..." if len(content) > 1000 else content
                        break
            except:
                continue

        # 작성자
        author_selectors = [
            '.nickname',
            '.author',
            '.writer',
            '.user-id'
        ]

        author = "작성자 없음"
        for selector in author_selectors:
            try:
                elem = await page.query_selector(selector)
                if elem:
                    author = await elem.text_content()
                    author = author.strip()
                    if author:
                        break
            except:
                continue

        return {
            'title': title,
            'content': content,
            'author': author,
            'url': page.url
        }

    except Exception as e:
        print(f"글 정보 추출 오류: {e}")
        return None

def categorize_article(collected_data, article_info, keyword):
    """게시글 분류"""
    title = article_info['title'].lower()
    content = article_info['content'].lower()

    # IRIS 관련
    if any(kw in title + content for kw in ['iris', '아이리스', '설치', '설정', '환경']):
        if '설치' in title + content:
            collected_data['installation_guides'].append(article_info)
        else:
            collected_data['iris_articles'].append(article_info)

    # 노루팅 관련
    elif any(kw in title + content for kw in ['노루팅', 'noruting', '루팅', 'root']):
        collected_data['noruting_articles'].append(article_info)

    # 봇 튜토리얼
    elif any(kw in title + content for kw in ['봇', '자동응답', '챗봇', '메신저봇']):
        collected_data['bot_tutorials'].append(article_info)

    # 기술 포스트
    elif any(kw in title + content for kw in ['개발', '코딩', '프로그래밍', 'api', '소스']):
        collected_data['technical_posts'].append(article_info)

def print_results(collected_data):
    """결과 출력"""
    print("\n" + "="*50)
    print("📊 크롤링 결과 요약")
    print("="*50)
    print(f"🎯 IRIS 관련 글: {len(collected_data['iris_articles'])}개")
    print(f"🔧 설치 가이드: {len(collected_data['installation_guides'])}개")
    print(f"🤖 봇 튜토리얼: {len(collected_data['bot_tutorials'])}개")
    print(f"🔒 노루팅 관련: {len(collected_data['noruting_articles'])}개")
    print(f"💻 기술 포스트: {len(collected_data['technical_posts'])}개")

async def main():
    """메인 함수"""
    print("🚀 스마트 카페 크롤링 시작")
    data = await smart_crawl_cafe()

    if data:
        print("✅ 데이터 수집 완료")
    else:
        print("❌ 데이터 수집 실패")

if __name__ == "__main__":
    asyncio.run(main())