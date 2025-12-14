#!/usr/bin/env python3
"""
카페 회원 예상 질문 20개에 대해 KB /ask_llm 응답을 일괄 점검한다.

목표:
- 라우팅(도메인/일반상식) 확인
- 링크 정책(중복/근거 없는 링크/정보없음에 링크 부착) 확인
- 가독성(불필요 헤더/금지 문구/과도한 길이) 확인

사용:
  python scripts/eval_rag_20_questions.py --base-url http://127.0.0.1:8610
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass, field
from typing import Any, Iterable

import requests


GENERAL_PREFIX = "가이드라인에는 없지만, 일반 상식으로 답변드립니다."


def _extract_urls(text: str) -> list[str]:
    if not text:
        return []
    urls = re.findall(r"https?://[^\s)]+", text)
    # trailing punctuation cleanup
    cleaned: list[str] = []
    for u in urls:
        u2 = u.rstrip(".,;:)]}»\"'")
        cleaned.append(u2)
    return cleaned


def _has_duplicate_urls(urls: list[str]) -> bool:
    seen: set[str] = set()
    for u in urls:
        if u in seen:
            return True
        seen.add(u)
    return False


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "")).strip().lower()


def _is_no_info_answer(answer: str) -> bool:
    """사실상 '자료 없음/확인 불가'만 말하는 답변인지 판별한다.

    NOTE:
    - 부분 답변(예: 숫자/정책은 답하고, 일부만 '확인 불가'라고 명시)은 no-info로 취급하지 않는다.
    """
    a_raw = (answer or "").strip()
    if not a_raw:
        return True
    a = _normalize(a_raw)
    flat = re.sub(r"\s+", "", a)
    pat = re.compile(r"(찾지못|확인불가|자료기준|자료부족|정보없음|관련자료를찾지못|kb응답|오류가발생|모른)")

    if not pat.search(flat):
        return False

    # 아주 짧은 no-info 문구는 그대로 no-info로 취급
    if len(flat) <= 50:
        return True

    # 줄 단위로 보았을 때, 모든 유의미한 라인이 no-info 계열이면 no-info로 취급
    lines = [l.strip() for l in a_raw.splitlines() if l and l.strip()]
    if not lines:
        return True
    no_info_lines = 0
    for l in lines:
        lflat = re.sub(r"\s+", "", l.lower())
        if pat.search(lflat):
            no_info_lines += 1
    if no_info_lines == len(lines):
        return True

    # 그 외(부분 답변 + 일부 확인 불가)는 no-info가 아님
    return False


def _urls_supported_by_sources(urls: list[str], manuals: list[dict[str, Any]], posts: list[dict[str, Any]]) -> list[str]:
    supported: set[str] = set()
    # posts
    for p in posts or []:
        u = str(p.get("url") or "").strip()
        if u:
            supported.add(u)
    # manuals text contains links
    manual_blobs: list[str] = []
    for m in manuals or []:
        manual_blobs.append(str(m.get("summary") or ""))
        manual_blobs.append(str(m.get("body_md") or ""))
        manual_blobs.append(str(m.get("title") or ""))
    blob = "\n".join(manual_blobs)
    for u in urls:
        if u in supported or (u and u in blob):
            supported.add(u)
    missing = [u for u in urls if u not in supported]
    return missing


@dataclass
class Case:
    name: str
    query: str
    context_tags: list[str] = field(default_factory=lambda: ["dinohighclass"])
    model: str | None = None
    expect_mode: str | None = None  # diag.mode
    expect_general: bool | None = None
    expect_posts_min: int | None = None
    expect_menu_ids_any_of: list[int] | None = None
    expect_text_contains_any: list[str] | None = None
    expect_text_not_contains_any: list[str] | None = None
    expect_url_count: int | None = None
    # 링크를 요구하는 질문일 때, "URL 제공" 또는 "자료 없음(링크 없음)" 중 하나면 PASS 처리
    expect_link_or_no_docs: bool = False


CASES: list[Case] = [
    Case(
        name="포인트 차이",
        query="일반반이랑 비지니스반 포인트 차이가 얼마야?",
        expect_mode="price_policy",
        expect_text_contains_any=["50만", "500,000", "50 만"],
        expect_url_count=0,
    ),
    Case(
        name="수강료",
        query="사알못 일반반/비지니스반 수강료(가격) 얼마야?",
        expect_mode="price_policy",
        expect_text_contains_any=["177", "255"],
        expect_url_count=0,
    ),
    Case(
        name="얼리버드 포인트",
        query="12/3 얼리버드 조건이면 포인트가 얼마나 추가돼?",
        expect_mode="price_policy",
        expect_text_contains_any=["30만", "300,000", "30 만"],
        expect_url_count=0,
    ),
    Case(
        name="무이자 12개월 납부액",
        query="무이자 12개월로 결제하면 일반반/비지니스반 월 납부액이 얼마야?",
        expect_mode="price_policy",
        expect_text_contains_any=["14만", "21만", "14 만", "21 만"],
        expect_url_count=0,
    ),
    Case(
        name="정규 강의 구성",
        query="정규 강의는 총 몇 회로 진행돼?",
        expect_general=False,
    ),
    Case(
        name="가장 최근 강의",
        query="가장 최근에 진행한 강의가 뭐야?",
        expect_mode="latest_lecture",
        expect_menu_ids_any_of=[23, 42],
        expect_url_count=1,
    ),
    Case(
        name="무료특강 신청 링크",
        query="이번 주 무료특강 신청 링크 있어?",
        expect_menu_ids_any_of=[23],
    ),
    Case(
        name="사알못 다시보기 링크",
        query="사알못 무료특강 다시보기 링크 줘",
        expect_menu_ids_any_of=[23, 32],
    ),
    Case(
        name="날짜 지정 다시보기",
        query="12월 3일 무료특강 다시보기 링크 알려줘",
        # 강한 키워드(다시보기)+날짜 매칭 결과가 없을 수 있으므로 "자료 없음" 응답도 허용한다.
        # (대신 잘못된 링크/추측 금지)
    ),
    Case(
        name="무료특강 후기",
        query="무료특강 후기 중에 최근 글 하나만 알려줘",
        expect_menu_ids_any_of=[32],
    ),
    Case(
        name="카페 운영자 꿀팁",
        query="카페 운영자의 꿀팁 최신 글 있어?",
        expect_menu_ids_any_of=[51],
    ),
    Case(
        name="회원 꿀팁",
        query="디하클 회원의 꿀팁 중 최근 글 링크 알려줘",
        expect_menu_ids_any_of=[136],
    ),
    Case(
        name="수익 인증",
        query="개인 수익 인증 게시판에서 최근 글 링크 하나만",
        expect_menu_ids_any_of=[206],
    ),
    Case(
        name="수강생 인터뷰",
        query="수강생 인터뷰 중에 최근 글 하나 알려줘",
        expect_menu_ids_any_of=[245],
    ),
    Case(
        name="주차별 하이라이트",
        query="주차별 하이라이트 최근 글 하나만 알려줘",
        expect_menu_ids_any_of=[48],
    ),
    Case(
        name="Sajulab 로그인",
        query="사주랩 로그인은 어떻게 해?",
        context_tags=["dinohighclass", "sajulab"],
        expect_general=False,
    ),
    Case(
        name="Sajulab 결과 PDF",
        query="사주랩 결과 PDF는 어디서 확인/다운로드해?",
        context_tags=["dinohighclass", "sajulab"],
        expect_general=False,
    ),
    Case(
        name="유튜브 수익창출(일반상식)",
        query="유튜브 수익창출 기준 알려줘",
        expect_general=True,
        expect_url_count=0,
    ),
    Case(
        name="파이썬 venv(일반상식)",
        query="파이썬 가상환경(venv) 만드는 방법 알려줘",
        expect_general=True,
        expect_url_count=0,
    ),
    Case(
        name="정책/운영 경계 질문",
        query="오픈채팅방에서 공지 메시지 전달 규칙이 뭐야?",
        expect_general=False,
    ),
]


# "창의적" 예상 질문 20개 (훈련/예시 문항과 겹치지 않게 구성)
CASES_CREATIVE: list[Case] = [
    Case(
        name="카페 등업 신청/조건",
        query="디하클 카페 등업은 어디에서 신청하고 조건이 뭐야?",
        expect_general=False,
        expect_mode="membership_policy",
        expect_text_contains_any=["댓글 3개", "자동 등업"],
        expect_url_count=0,
    ),
    Case(
        name="등업 심사 기간",
        query="등업 신청하면 승인까지 보통 얼마나 걸려?",
        expect_general=False,
        expect_mode="membership_policy",
        expect_text_contains_any=["확인 불가"],
        expect_url_count=0,
    ),
    Case(
        name="필독 공지 링크",
        query="카페 가입 후 필독 공지(규칙) 링크 하나만 알려줘",
        expect_general=False,
        expect_link_or_no_docs=True,
    ),
    Case(
        name="닉네임 변경 영향",
        query="카페 닉네임을 바꾸면 수강생 확인/입장에 영향 있어?",
        expect_general=False,
    ),
    Case(
        name="강의 시작 안내 수신 경로",
        query="정규강의 시작 안내(줌/라이브 링크)는 어디로 받아? 카페/카톡/이메일 중 뭐야?",
        expect_general=False,
    ),
    Case(
        name="강의 시간/시간표",
        query="정규강의는 보통 몇 시에 시작하고 몇 시간 진행돼?",
        expect_general=False,
    ),
    Case(
        name="결제 수단",
        query="정규강의 결제는 카드 결제도 돼? 무통장만 가능해?",
        expect_general=False,
    ),
    Case(
        name="영수증/세금계산서",
        query="강의 결제 후 영수증/현금영수증/세금계산서 발급 받을 수 있어?",
        expect_general=False,
    ),
    Case(
        name="환불/양도 가능 여부",
        query="강의 결제 후 환불이나 타인 양도(양도권) 가능해?",
        expect_general=False,
    ),
    Case(
        name="재수강/재등록",
        query="예전에 수강했는데 재수강 할인이나 재등록 방법이 있어?",
        expect_general=False,
    ),
    Case(
        name="보너스 구성",
        query="강의 구매하면 보너스 프로그램/자료는 뭐가 포함돼?",
        expect_general=False,
    ),
    Case(
        name="다시보기 시청 기간",
        query="다시보기(녹화본) 시청 가능한 기간이 정해져 있어?",
        expect_general=False,
    ),
    Case(
        name="정규강의 녹화본 제공 여부",
        query="정규강의도 다시보기(녹화본) 제공돼? 제공 방식이 뭐야?",
        expect_general=False,
    ),
    Case(
        name="과제/실습 제출",
        query="강의 과제/실습은 어디에 제출해? 카페 글/오픈채팅/구글폼 중 뭐야?",
        expect_general=False,
    ),
    Case(
        name="질문/피드백 채널",
        query="강의 질문은 어디로 하면 돼? 댓글/오픈채팅/채널톡 중 공식 채널이 뭐야?",
        expect_general=False,
    ),
    Case(
        name="오픈채팅 닉네임 규칙",
        query="오픈채팅방 닉네임은 카페 닉네임이랑 맞춰야 해? 규칙이 있어?",
        expect_general=False,
    ),
    Case(
        name="사주랩 계정 생성",
        query="사주랩 계정은 어디서 만들고, 이메일로 가입해? 카카오로 가입해?",
        context_tags=["dinohighclass", "sajulab"],
        expect_general=False,
    ),
    Case(
        name="사주랩 사용법 매뉴얼 링크",
        query="사주랩 사용법 매뉴얼/가이드 링크 있으면 하나만 알려줘",
        context_tags=["dinohighclass", "sajulab"],
        expect_general=False,
        expect_link_or_no_docs=True,
    ),
    Case(
        name="사주랩 포인트 추가 충전",
        query="사주랩 포인트는 추가 충전/추가 구매할 수 있어? 방법 알려줘",
        context_tags=["dinohighclass", "sajulab"],
        expect_general=False,
    ),
    Case(
        name="네이버 카페 새글 알림(일반상식)",
        query="네이버 카페에서 특정 게시판 새글 알림 설정하는 방법 알려줘",
        context_tags=[],
        expect_general=True,
        expect_url_count=0,
    ),
]

# 455330144472802 방 로그 기반 회귀 케이스
CASES_ROOM455: list[Case] = [
    Case(
        name="(455) 마케터제이",
        query="마케터제이 누구야?",
        expect_general=False,
        expect_posts_min=1,
    ),
    Case(
        name="(455) 룰루랄라릴리",
        query="룰루랄라릴리 누구야?",
        expect_general=False,
        expect_posts_min=1,
    ),
    Case(
        name="(455) 캡컷 유료버전",
        query="캡컷 유료버전 얼마야?",
        expect_general=False,
        expect_posts_min=1,
        # 가격 질문은 숫자/원 단위가 포함되어야 한다(정확한 금액은 변동 가능하므로 하드코딩 금지)
        expect_text_contains_any=["원"],
    ),
]

# 다양한 엣지 케이스 (의도/형식/오탈자/복합 요구)
CASES_EDGE: list[Case] = [
    # --- 접두어/공백/문장부호 변형 ---
    Case(
        name="접두어+공백 변형",
        query="?   디하클    마케터제이   누구야??",
        expect_general=False,
        expect_posts_min=1,
    ),
    Case(
        name="접두어 없이 시작(디하클)",
        query="디하클 룰루랄라릴리 누구야",
        expect_general=False,
        expect_posts_min=1,
    ),
    Case(
        name="영문 혼용 엔티티",
        query="capcut pro 가격 얼마야?",
        expect_general=False,
        expect_posts_min=1,
        expect_text_contains_any=["원"],
    ),

    # --- 날짜 표기 다양성 ---
    Case(
        name="날짜 12.3 다시보기",
        query="12.3 무료특강 다시보기 링크",
        expect_general=False,
        expect_link_or_no_docs=True,
    ),
    Case(
        name="날짜 12/03 다시보기",
        query="12/03 무료특강 다시보기 링크 알려줘",
        expect_general=False,
        expect_link_or_no_docs=True,
    ),
    Case(
        name="날짜 한글+붙여쓰기",
        query="12월3일무료특강 다시보기 링크",
        expect_general=False,
        expect_link_or_no_docs=True,
    ),

    # --- 복합 의도(요약+링크/최근+조건) ---
    Case(
        name="최근 공지+필독",
        query="카페 공지 중 필독/규칙 글 링크 하나만",
        expect_general=False,
        expect_link_or_no_docs=True,
    ),
    Case(
        name="최근 후기 2개",
        query="무료특강 후기 최근 글 2개만 링크",
        expect_general=False,
        expect_menu_ids_any_of=[32],
    ),
    Case(
        name="정규강의 신청 최근 링크",
        query="정규 강의 신청 게시판에서 가장 최근 글 링크",
        expect_general=False,
        expect_menu_ids_any_of=[42],
        expect_link_or_no_docs=True,
    ),

    # --- 오탈자/표기 흔들림 ---
    Case(
        name="비즈니스/비지니스 혼용",
        query="비즈니스반이랑 비지니스반 포인트 차이 뭐야?",
        expect_mode="price_policy",
        expect_text_contains_any=["포인트 차이", "50만", "500,000"],
        expect_url_count=0,
    ),
    Case(
        name="무이자 표기 흔들림",
        query="무이자 12개월로 하면 일반반 월얼마/비지니스 월얼마?",
        expect_mode="price_policy",
        expect_text_contains_any=["12개월", "월"],
        expect_url_count=0,
    ),

    # --- Sajulab (강제 도메인) ---
    Case(
        name="Sajulab 포인트 추가구매",
        query="사주랩 포인트 추가 구매/충전은 어떻게 해?",
        context_tags=["dinohighclass", "sajulab"],
        expect_general=False,
        expect_posts_min=0,
    ),
    Case(
        name="Sajulab 결과 PDF (오탈자)",
        query="사주랩 결과 pdf 다운은 어디서해?",
        context_tags=["dinohighclass", "sajulab"],
        expect_general=False,
    ),

    # --- 제외 게시판(강사들의 꿀팁) ---
    Case(
        name="강사 꿀팁 제외",
        query="강사 꿀팁 최신 글 있어?",
        expect_mode="disabled_board",
        expect_url_count=0,
    ),

    # --- 일반 상식(웹 검색 경로) ---
    Case(
        name="유튜브 수익화 (일반상식, 접두어 포함)",
        query="?디하클 유튜브 수익창출 조건 알려줘",
        expect_general=True,
        expect_url_count=0,
    ),
    Case(
        name="카톡 알림 설정(플랫폼 사용법)",
        query="카카오톡 오픈채팅 알림이 안와. 설정 어디서 봐?",
        expect_general=True,
        expect_url_count=0,
    ),

    # --- 지식은 있으나 질문이 애매한 경우(추측 금지) ---
    Case(
        name="가장 최근 강의(영문/특수문자)",
        query="가장 최근 강의 뭐야!!!",
        expect_mode="latest_lecture",
        expect_url_count=1,
    ),
    Case(
        name="마케터제이 채널/활동(추측 금지)",
        query="마케터제이 인스타/스레드 링크 있어?",
        expect_general=False,
        expect_posts_min=1,
        # 임의 외부 링크(인스타/스레드 등) 환각 방지: 있으면 반드시 카페 자료 근거여야 하므로
        # (KB가 자료에 없는 URL은 제거하므로, 결과적으로 이 문자열이 남는지로 안전 확인)
        expect_text_not_contains_any=["instagram.com", "threads.net"],
    ),

    # --- 커뮤니티/게시판 라우팅 ---
    Case(
        name="자유게시판 최근 글",
        query="자유게시판 최신 글 1개만",
        expect_general=False,
        expect_menu_ids_any_of=[33],
        expect_link_or_no_docs=True,
    ),
    Case(
        name="수익 인증 최근 글",
        query="수익인증 게시판 최신글 링크",
        expect_general=False,
        expect_menu_ids_any_of=[206],
        expect_link_or_no_docs=True,
    ),
]


# "카페 회원 관점" 예상 질문 20개
# - 훈련/예시 문항과 표현이 겹치지 않게, 실제 운영 중 자주 나올 만한 질문으로 구성
# - 일부는 '플랫폼 사용법(네이버/카카오톡/오픈채팅)' 성격이라 일반 상식(웹 검색) 경로로 기대한다.
CASES_MEMBER: list[Case] = [
    Case(
        name="오픈채팅 알림 끄기(일반상식)",
        query="카카오톡 오픈채팅방 알림 끄는 방법 알려줘",
        expect_general=True,
        expect_url_count=0,
    ),
    Case(
        name="유튜브 YPP 수익창출 조건(일반상식)",
        query="유튜브 파트너 프로그램(YPP) 수익창출 조건이 뭐야?",
        expect_general=True,
        expect_url_count=0,
    ),
    Case(
        name="네이버 카페 링크 복사(일반상식)",
        query="네이버 카페 앱에서 게시글 링크(URL) 복사하는 방법 알려줘",
        expect_general=True,
        expect_url_count=0,
    ),
    Case(
        name="네이버 카페 내가 쓴 글 보기(일반상식)",
        query="네이버 카페에서 내가 작성한 글만 모아보는 방법 있어?",
        expect_general=True,
        expect_url_count=0,
    ),
    Case(
        name="hostname -I 두 IP 의미(일반상식)",
        query="리눅스에서 hostname -I 했는데 IP가 두 개 나오면 각각 무슨 의미야?",
        expect_general=True,
        expect_url_count=0,
    ),
    Case(
        name="윈도우 portproxy 확인(일반상식)",
        query="윈도우에서 netsh interface portproxy 설정 확인하는 방법 알려줘",
        expect_general=True,
        expect_url_count=0,
    ),
    Case(
        name="이벤트 공지 최신 링크",
        query="이벤트 공지에서 최근 글 링크 하나만",
        expect_menu_ids_any_of=[47],
        expect_link_or_no_docs=True,
    ),
    Case(
        name="전체 공지 최신 링크",
        query="회원 대상 전체 공지에서 가장 최근 공지 글 링크 하나만",
        expect_menu_ids_any_of=[1],
        expect_link_or_no_docs=True,
    ),
    Case(
        name="성장 일기 최신 링크",
        query="디하클 성장 일기에서 최근 글 링크 하나만",
        expect_menu_ids_any_of=[62],
        expect_link_or_no_docs=True,
    ),
    Case(
        name="강사 꿀팁 최신 링크",
        query="강사들의 꿀팁 게시판에서 최근 글 링크 하나만",
        expect_mode="disabled_board",
        expect_text_contains_any=["제외", "수집", "조회"],
        expect_url_count=0,
    ),
    Case(
        name="자유게시판 IRIS 관련 글",
        query="자유게시판에서 IRIS 관련 글 링크 하나만",
        expect_menu_ids_any_of=[33],
        expect_link_or_no_docs=True,
    ),
    Case(
        name="정규 강의 신청 최신 링크",
        query="정규 강의 신청 게시판에서 최근 모집/신청 공지 링크 하나만",
        expect_menu_ids_any_of=[42],
        expect_link_or_no_docs=True,
    ),
    Case(
        name="무료 특강 신청 최신 링크",
        query="무료 특강 신청 게시판에서 최신 신청 공지 링크 하나만",
        expect_menu_ids_any_of=[23],
        expect_link_or_no_docs=True,
    ),
    Case(
        name="회원 꿀팁 자동화 관련 글",
        query="디하클 회원의 꿀팁 게시판에서 자동화 관련 글 링크 하나만",
        expect_menu_ids_any_of=[136],
        expect_link_or_no_docs=True,
    ),
    Case(
        name="이용 가이드 시작 글",
        query="디하클 이용 가이드에서 처음 읽어야 하는 글 링크 하나만",
        expect_menu_ids_any_of=[192],
        expect_link_or_no_docs=True,
    ),
    Case(
        name="등업 조건(가입인사)",
        query="가입인사 글이랑 댓글 3개면 자동 등업되는게 맞아?",
        expect_general=False,
        expect_mode="membership_policy",
        expect_text_contains_any=["댓글 3개", "자동 등업"],
        expect_url_count=0,
    ),
    Case(
        name="등업 이후 글 삭제 영향",
        query="가입인사 글을 나중에 삭제하면 등업이 풀려? 다시 해야 돼?",
        expect_general=False,
        expect_mode="membership_policy",
        expect_text_contains_any=["자동 등업"],
        expect_url_count=0,
    ),
    Case(
        name="수익 인증 예시 글",
        query="개인 수익 인증 게시판에서 수익 인증 예시 글 링크 하나만",
        expect_menu_ids_any_of=[206],
        expect_link_or_no_docs=True,
    ),
    Case(
        name="수강생 인터뷰 글",
        query="수강생 인터뷰 게시판에서 인터뷰 글 하나만 링크로 줘",
        expect_menu_ids_any_of=[245],
        expect_link_or_no_docs=True,
    ),
    Case(
        name="주차별 하이라이트(주차 포함)",
        query="주차별 하이라이트에서 1주차/2주차 같은 주차가 들어간 글 하나만 링크로 줘",
        expect_menu_ids_any_of=[48],
        expect_link_or_no_docs=True,
    ),
]


# "창의적(2)" 예상 질문 20개
# - 이전 스위트와 겹치는 표현을 최대한 피하고, 실제 카페 회원이 던질 만한 문장/오탈자/복합 의도를 포함한다.
CASES_CREATIVE2: list[Case] = [
    Case(
        name="강사 소개(룰루랄라릴리)",
        query="룰루랄라릴리 어떤 사람/강사야? 카페 글 기준으로만 소개해줘",
        expect_general=False,
        expect_mode="entity_intro",
        expect_posts_min=1,
    ),
    Case(
        name="운영자 소개(마케터제이)",
        query="마케터제이 정체가 뭐야? 운영자/대표 맞아?",
        expect_general=False,
        expect_mode="entity_intro",
        expect_posts_min=1,
    ),
    Case(
        name="강사 꿀팁(제외 확인)",
        query="강사들의 꿀팁 게시판은 왜 조회가 안돼? 최근 글 볼 수 없어?",
        expect_general=False,
        expect_mode="disabled_board",
        expect_url_count=0,
    ),
    Case(
        name="이번달 무료특강 신청 3개",
        query="이번달 무료특강 신청 글 최근 3개만 링크로 줘",
        expect_general=False,
        expect_menu_ids_any_of=[23],
        expect_link_or_no_docs=True,
    ),
    Case(
        name="후기에서 오픈채팅 언급",
        query="무료특강 후기 중에 오픈채팅 얘기 나오는 글 있으면 링크 하나만",
        expect_general=False,
        expect_menu_ids_any_of=[32],
        expect_link_or_no_docs=True,
    ),
    Case(
        name="정규강의 신청 최신 1개",
        query="정규강의 신청 공지에서 가장 최근 글 링크 하나만",
        expect_general=False,
        expect_menu_ids_any_of=[42],
        expect_link_or_no_docs=True,
    ),
    Case(
        name="수익 인증 작성 기준",
        query="수익 인증 게시판 글 올릴 때 제목/본문에 어떤 정보 써야 해? 기준이 있어?",
        expect_general=False,
    ),
    Case(
        name="하이라이트 자동화 키워드",
        query="주차별 하이라이트에서 자동화 관련 글 하나만 추천(링크)해줘",
        expect_general=False,
        expect_menu_ids_any_of=[48],
        expect_link_or_no_docs=True,
    ),
    Case(
        name="회원 꿀팁(캡컷)",
        query="회원 꿀팁 게시판에 캡컷 관련 팁 글 있으면 링크 하나만",
        expect_general=False,
        expect_menu_ids_any_of=[136],
        expect_link_or_no_docs=True,
    ),
    Case(
        name="캡컷 프로 가격(카페 기준)",
        query="캡컷 프로 가격 얼마야? 디하클 카페 글 기준으로만 알려줘",
        expect_general=False,
        expect_posts_min=1,
        expect_text_contains_any=["원"],
    ),
    Case(
        name="오픈채팅 입장 링크/경로",
        query="수강생 오픈채팅방 들어가는 링크는 보통 어디에 올라와? 카페에서 찾는 경로 알려줘",
        expect_general=False,
    ),
    Case(
        name="무료특강 다시보기 구매/시청",
        query="무료특강 다시보기는 어떻게 구매하고 어디서 시청해? 절차가 정해져 있어?",
        expect_general=False,
    ),
    Case(
        name="오늘 무료특강 다시보기 업로드",
        query="오늘 진행한 무료특강 다시보기는 언제 올라와?",
        expect_general=False,
        expect_link_or_no_docs=True,
    ),
    Case(
        name="강의명(고유명)만 질문",
        query="쇼츠투벤츠가 뭐야? 디하클 강의/프로그램 이름이야?",
        expect_general=False,
    ),
    Case(
        name="다시 보기(띄어쓰기)",
        query="사알못 무료특강 다시 보기 링크 있어?",
        expect_general=False,
        expect_link_or_no_docs=True,
    ),
    Case(
        name="가격+포인트 1줄 요약",
        query="일반반이랑 비즈니스반 차이를 수강료/포인트 기준으로 한 줄로 정리해줘",
        expect_general=False,
        expect_mode="price_policy",
        expect_url_count=0,
    ),
    Case(
        name="무이자 할부 범위",
        query="무이자 할부는 최대 몇 개월까지 가능해? 카드사 제한도 있어?",
        expect_general=False,
    ),
    Case(
        name="Sajulab 포인트 잔액 확인",
        query="사주랩에서 내 포인트 잔액은 어디서 확인해?",
        context_tags=["dinohighclass", "sajulab"],
        expect_general=False,
    ),
    Case(
        name="수강생 인터뷰 최근 2개",
        query="수강생 인터뷰 게시판에서 최근 글 2개만 링크로 줘",
        expect_general=False,
        expect_menu_ids_any_of=[245],
        expect_link_or_no_docs=True,
    ),
    Case(
        name="가입 인사 메뉴명",
        query="가입 인사 글은 어디 메뉴에 써? 메뉴명 기준으로 알려줘",
        expect_general=False,
        expect_mode="membership_policy",
        expect_url_count=0,
    ),
]


def _menu_ids_from_posts(posts: list[dict[str, Any]]) -> list[int]:
    out: set[int] = set()
    for p in posts or []:
        mid = p.get("menu_id")
        if isinstance(mid, int):
            out.add(mid)
        else:
            try:
                if mid is not None:
                    out.add(int(mid))
            except Exception:
                pass
    return sorted(out)


def _banned_phrases() -> list[str]:
    # 운영자가 싫어하는 헤더/문구(예: "최근 카페에서의 핵심 1가지를 요약해요")
    return [
        "최근 카페에서의",
        "핵심 1가지를 요약해요",
        "더 자세한 내용은 아래 버튼",
        "링크:",
    ]


def _call(base_url: str, case: Case, timeout: int, llm_model_override: str | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"query": case.query, "top_k": 6}
    if case.context_tags:
        payload["context_tags"] = case.context_tags
    if llm_model_override and str(llm_model_override).strip():
        payload["model"] = str(llm_model_override).strip()
    elif case.model:
        payload["model"] = case.model
    t0 = time.time()
    resp = requests.post(f"{base_url}/ask_llm", json=payload, timeout=timeout)
    took = time.time() - t0
    try:
        data = resp.json()
    except Exception:
        data = {"ok": False, "raw": resp.text}
    return {"status": resp.status_code, "took": took, "data": data}


def _ensure_health(base_url: str) -> None:
    r = requests.get(f"{base_url}/health", timeout=5)
    if r.status_code != 200:
        raise SystemExit(f"[ERROR] KB health fail: {base_url} -> {r.status_code}")


def _evaluate(case: Case, data: dict[str, Any]) -> tuple[bool, list[str]]:
    errors: list[str] = []

    if not data.get("ok"):
        return False, [f"ok=false: {str(data)[:200]}"]

    answer = str(data.get("answer") or "")
    diag = data.get("diag") or {}
    mode = str(diag.get("mode") or "")
    manuals = data.get("manuals") or []
    posts = data.get("posts") or []

    # banned phrases
    ans_l = answer.lower()
    for bp in _banned_phrases():
        if bp.lower() in ans_l:
            errors.append(f"금지 문구 포함: '{bp}'")

    # urls
    urls = _extract_urls(answer)
    if case.expect_url_count is not None and len(urls) != case.expect_url_count:
        errors.append(f"URL 개수 불일치: 기대 {case.expect_url_count}, 실제 {len(urls)}")
    if _has_duplicate_urls(urls):
        errors.append("URL 중복 포함")

    # no-info shouldn't contain link
    if _is_no_info_answer(answer) and urls:
        errors.append("정보 없음/오류 계열인데 URL이 포함됨")

    # 링크를 요구하는 질문: URL이 없으면 '자료 없음'이어야 한다.
    if case.expect_link_or_no_docs:
        if not urls and not _is_no_info_answer(answer):
            errors.append("링크 요청인데 URL도 없고, 자료 없음 안내도 아님")

    # source-backed urls (only for domain answers)
    if urls and mode != "general_out_of_scope":
        missing = _urls_supported_by_sources(urls, manuals, posts)
        # SSOT 결정적 답변(cafe_profile)은 공식 카페 URL을 sources 없이도 포함할 수 있다.
        if mode == "cafe_profile":
            cafe_url = str(diag.get("cafe_url") or "").strip()
            if cafe_url:
                missing = [u for u in missing if u != cafe_url]
        if missing:
            errors.append(f"근거 없는 URL 포함: {missing[:2]}")

    # mode expectation
    if case.expect_mode and mode != case.expect_mode:
        errors.append(f"mode 불일치: 기대 {case.expect_mode}, 실제 {mode}")

    # general expectation
    if case.expect_general is True:
        if mode != "general_out_of_scope":
            errors.append(f"일반상식 기대인데 mode={mode}")
        if not answer.startswith(GENERAL_PREFIX):
            errors.append("일반상식 프리픽스 누락")
        if urls:
            errors.append("일반상식 답변에 URL 포함")
    elif case.expect_general is False:
        if answer.startswith(GENERAL_PREFIX):
            errors.append("도메인 답변인데 일반상식 프리픽스로 시작")

    # posts min expectation (도메인 회귀 방지)
    if case.expect_posts_min is not None:
        try:
            posts_len = len(posts) if isinstance(posts, list) else 0
        except Exception:
            posts_len = 0
        if posts_len < int(case.expect_posts_min):
            errors.append(f"근거 게시글 부족: 기대 >= {case.expect_posts_min}, 실제 {posts_len}")

    # menu expectation
    if case.expect_menu_ids_any_of:
        actual = _menu_ids_from_posts(posts)
        if not actual:
            errors.append(f"게시글 결과 없음(기대 메뉴 {case.expect_menu_ids_any_of})")
        elif not set(actual).intersection(set(case.expect_menu_ids_any_of)):
            errors.append(f"메뉴ID 불일치: 기대 {case.expect_menu_ids_any_of}, 실제 {actual}")

    # contains expectation
    if case.expect_text_contains_any:
        if not any(k in answer for k in case.expect_text_contains_any):
            errors.append(f"필수 키워드 누락(중 하나): {case.expect_text_contains_any}")

    if case.expect_text_not_contains_any:
        bad = [k for k in case.expect_text_not_contains_any if k and k in answer]
        if bad:
            errors.append(f"금지 키워드 포함: {bad[:3]}")

    # rough readability: 너무 길면 경고
    if len(answer) > 1800:
        errors.append(f"답변이 너무 김(len={len(answer)})")

    return len(errors) == 0, errors


def _print_case_result(idx: int, case: Case, status: int, took: float, ok: bool, errors: list[str], data: dict[str, Any]) -> None:
    diag = data.get("diag") or {}
    mode = diag.get("mode") if isinstance(diag, dict) else None
    posts = data.get("posts") or []
    menus = _menu_ids_from_posts(posts)
    urls = _extract_urls(str(data.get("answer") or ""))
    head = f"[{idx:02d}] {'PASS' if ok else 'FAIL'} {case.name} ({took:.2f}s, HTTP {status}, mode={mode}, menus={menus}, urls={len(urls)})"
    print(head)
    if not ok:
        for e in errors:
            print(f"  - {e}")
        ans = str(data.get("answer") or "")
        preview = ans if len(ans) <= 600 else ans[:600] + " ..."
        print("  --- answer preview ---")
        print("  " + preview.replace("\n", "\n  "))
        if urls:
            print("  --- urls ---")
            for u in urls:
                print("  " + u)
    print()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", default="http://127.0.0.1:8610")
    ap.add_argument("--timeout", type=int, default=90)
    ap.add_argument("--suite", choices=["trained", "creative", "creative2", "member", "room455", "edge", "all"], default="trained")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--dump-md", default="", help="마크다운 결과를 파일로 저장(질문/응답/메타 포함)")
    ap.add_argument("--llm-model", default="", help="KB /ask_llm model 오버라이드(예: gpt-4.1)")
    args = ap.parse_args()

    try:
        _ensure_health(args.base_url)
    except Exception as e:
        print(str(e))
        return 2

    results: list[dict[str, Any]] = []
    passed = 0
    failed = 0

    if args.suite == "trained":
        cases = CASES
        suite_title = "trained"
    elif args.suite == "creative":
        cases = CASES_CREATIVE
        suite_title = "creative"
    elif args.suite == "creative2":
        cases = CASES_CREATIVE2
        suite_title = "creative2"
    elif args.suite == "member":
        cases = CASES_MEMBER
        suite_title = "member"
    elif args.suite == "room455":
        cases = CASES_ROOM455
        suite_title = "room455"
    elif args.suite == "edge":
        cases = CASES_EDGE
        suite_title = "edge"
    else:
        cases = CASES + CASES_CREATIVE + CASES_CREATIVE2 + CASES_MEMBER + CASES_ROOM455 + CASES_EDGE
        suite_title = "all"

    print(f"=== RAG 점검 시작 ({suite_title}, {args.base_url}) ===\n")
    md_lines: list[str] = []
    if args.dump_md:
        md_lines.append(f"# RAG 점검 결과 ({suite_title})\n")
        md_lines.append(f"- base_url: `{args.base_url}`")
        if args.llm_model:
            md_lines.append(f"- llm_model: `{args.llm_model}`")
        md_lines.append(f"- 생성 시각: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    for idx, case in enumerate(cases, start=1):
        res = _call(args.base_url, case, args.timeout, args.llm_model)
        status = int(res["status"])
        took = float(res["took"])
        data = res["data"]
        ok, errors = _evaluate(case, data if isinstance(data, dict) else {"ok": False, "raw": str(data)})
        _print_case_result(idx, case, status, took, ok, errors, data if isinstance(data, dict) else {"ok": False})

        if args.dump_md:
            d = data if isinstance(data, dict) else {"ok": False, "raw": str(data)}
            diag = d.get("diag") or {}
            mode = (diag.get("mode") if isinstance(diag, dict) else None) or ""
            answer = str(d.get("answer") or "").strip()
            manuals = d.get("manuals") or []
            posts = d.get("posts") or []
            menus = _menu_ids_from_posts(posts) if isinstance(posts, list) else []
            urls = _extract_urls(answer)
            md_lines.append(f"## {idx:02d}. {case.name}")
            md_lines.append(f"- 질문: {case.query}")
            md_lines.append(f"- context_tags: `{', '.join(case.context_tags or [])}`")
            md_lines.append(f"- HTTP: {status} / took: {took:.2f}s / mode: `{mode}` / menus: `{menus}` / urls: {len(urls)}")
            md_lines.append(f"- 판정: {'PASS' if ok else 'FAIL'}")
            if errors:
                md_lines.append(f"- 오류: {', '.join(errors)}")
            md_lines.append("")
            md_lines.append("### 답변")
            md_lines.append("```")
            md_lines.append(answer)
            md_lines.append("```")
            if urls:
                md_lines.append("### URL")
                for u in urls:
                    md_lines.append(f"- {u}")
            if manuals:
                md_lines.append("### 근거(매뉴얼)")
                for m in manuals[:3]:
                    md_lines.append(f"- {str(m.get('title') or '').strip()}")
            if posts:
                md_lines.append("### 근거(게시글)")
                for p in posts[:3]:
                    title = str(p.get("title") or "").strip()
                    url = str(p.get("url") or "").strip()
                    pid = p.get("post_id")
                    md_lines.append(f"- {pid}: {title} ({url})")
            md_lines.append("")

        results.append(
            {
                "idx": idx,
                "name": case.name,
                "query": case.query,
                "context_tags": case.context_tags,
                "status": status,
                "took": took,
                "ok": ok,
                "errors": errors,
                "mode": (data.get("diag") or {}).get("mode") if isinstance(data, dict) else None,
                "menus": _menu_ids_from_posts(data.get("posts") or []) if isinstance(data, dict) else [],
            }
        )
        if ok:
            passed += 1
        else:
            failed += 1

    print("=" * 60)
    print(f"결과: {passed}/{len(cases)} PASS, {failed} FAIL")
    if args.json:
        print(json.dumps(results, ensure_ascii=False, indent=2))

    if args.dump_md:
        try:
            import pathlib

            out = pathlib.Path(args.dump_md)
            out.parent.mkdir(parents=True, exist_ok=True)
            # Windows PowerShell(5.1)에서도 깨지지 않도록 BOM 포함 UTF-8로 저장한다.
            out.write_text("\n".join(md_lines).strip() + "\n", encoding="utf-8-sig")
            print(f"\n[OK] 마크다운 결과 저장: {out}")
        except Exception as e:
            print(f"\n[WARN] 마크다운 저장 실패: {e}")

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
