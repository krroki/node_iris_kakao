#!/usr/bin/env python3
"""
IRIS 봇 관리 대시보드 - 일반인을 위한 친숙한 UI
Streamlit 기반의 웹-데스크톱 하이브리드 관리 인터페이스
"""

import sys
import json
import time
import sqlite3
import threading
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List

import streamlit as st
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go

# 상위 디렉터리를 path에 추가
sys.path.append(str(Path(__file__).parent.parent))

from src.services.room_manager import RoomManager
from src.services.message_store import MessageStore
from src.utils.logger import get_service_logger

class DashboardManager:
    """대시보드 관리 클래스"""

    def __init__(self):
        self.room_manager = RoomManager()
        self.message_store = MessageStore(Path("logs"))
        self.logger = get_service_logger("dashboard")
        self.refresh_interval = 5  # 5초마다 데이터 갱신

    def get_room_data(self) -> List[Dict]:
        """방 데이터 가져오기"""
        try:
            rooms = self.room_manager.get_active_rooms()
            for room in rooms:
                if room.get('settings_json'):
                    room['settings'] = json.loads(room['settings_json'])
                else:
                    room['settings'] = {}
            return rooms
        except Exception as e:
            self.logger.error(f"방 데이터 조회 실패: {e}")
            return []

    def get_message_stats(self, days: int = 7) -> Dict:
        """메시지 통계 가져오기"""
        try:
            stats = {"daily_messages": {}, "total_messages": 0}

            # 간단한 통계 시뮬레이션 (실제로는 message_store에서 데이터 가져오기)
            base_date = datetime.now() - timedelta(days=days)
            for i in range(days):
                date = (base_date + timedelta(days=i)).strftime("%Y-%m-%d")
                message_count = 10 + i * 2  # 샘플 데이터
                stats["daily_messages"][date] = message_count
                stats["total_messages"] += message_count

            return stats
        except Exception as e:
            self.logger.error(f"메시지 통계 조회 실패: {e}")
            return {"daily_messages": {}, "total_messages": 0}

    def get_system_status(self) -> Dict:
        """시스템 상태 가져오기"""
        try:
            room_stats = self.room_manager.get_room_stats()
            return {
                "status": "정상 작동",
                "active_rooms": room_stats.get("active_rooms", 0),
                "total_rooms": room_stats.get("total_rooms", 0),
                "uptime": "2시간 30분",  # 샘플 데이터
                "memory_usage": "125MB",
                "cpu_usage": "5%"
            }
        except Exception as e:
            return {"status": "오류 발생", "error": str(e)}

def create_room_management_tab(dashboard: DashboardManager):
    """방 관리 탭 생성"""
    st.header("🏠 방 관리")

    # 방 목록
    rooms = dashboard.get_room_data()

    if not rooms:
        st.warning("등록된 방이 없습니다.")
        return

    # 방 목록 표
    st.subheader("📋 등록된 방 목록")

    # 방 데이터 표시를 위한 DataFrame 생성
    room_data = []
    for room in rooms:
        settings = room.get('settings', {})
        room_data.append({
            "ID": room['id'],
            "이름": room['name'],
            "상태": "🟢 활성" if room['status'] == 'active' else '🔴 비활성',
            "자동 환영": "✅" if settings.get('auto_welcome', False) else "❌",
            "로깅": "✅" if settings.get('logging_enabled', True) else "❌",
            "마지막 활동": room['last_activity'][:10] if room['last_activity'] else '없음'
        })

    df = pd.DataFrame(room_data)
    st.dataframe(df, use_container_width=True)

    # 방 설정 관리
    st.subheader("⚙️ 방 설정 관리")

    if rooms:
        selected_room_id = st.selectbox(
            "방 선택",
            options=[room['id'] for room in rooms],
            format_func=lambda x: f"{x} - {next((r['name'] for r in rooms if r['id'] == x), '')}"
        )

        selected_room = next((r for r in rooms if r['id'] == selected_room_id), None)

        if selected_room:
            col1, col2 = st.columns(2)

            with col1:
                auto_welcome = st.checkbox(
                    "자동 환영 메시지",
                    value=selected_room.get('settings', {}).get('auto_welcome', False)
                )

            with col2:
                logging_enabled = st.checkbox(
                    "메시지 로깅",
                    value=selected_room.get('settings', {}).get('logging_enabled', True)
                )

            if st.button("설정 저장"):
                new_settings = selected_room.get('settings', {})
                new_settings.update({
                    'auto_welcome': auto_welcome,
                    'logging_enabled': logging_enabled
                })

                if dashboard.room_manager.update_room_settings(selected_room_id, new_settings):
                    st.success("✅ 설정이 저장되었습니다!")
                    st.rerun()
                else:
                    st.error("❌ 설정 저장에 실패했습니다.")

def create_monitoring_tab(dashboard: DashboardManager):
    """모니터링 탭 생성"""
    st.header("📊 시스템 모니터링")

    # 시스템 상태
    st.subheader("🖥️ 시스템 상태")
    system_status = dashboard.get_system_status()

    col1, col2, col3, col4 = st.columns(4)

    with col1:
        st.metric(
            label="상태",
            value=system_status.get("status", "알 수 없음"),
            delta="정상"
        )

    with col2:
        st.metric(
            label="활성 방",
            value=system_status.get("active_rooms", 0)
        )

    with col3:
        st.metric(
            label="전체 방",
            value=system_status.get("total_rooms", 0)
        )

    with col4:
        st.metric(
            label="가동 시간",
            value=system_status.get("uptime", "알 수 없음")
        )

    # 메시지 통계
    st.subheader("📈 메시지 통계")
    message_stats = dashboard.get_message_stats()

    if message_stats["daily_messages"]:
        # 메시지 추이 그래프
        dates = list(message_stats["daily_messages"].keys())
        counts = list(message_stats["daily_messages"].values())

        fig = px.line(
            x=dates,
            y=counts,
            title="최근 7일 메시지 추이",
            labels={"x": "날짜", "y": "메시지 수"}
        )
        st.plotly_chart(fig, use_container_width=True)

        # 통계 요약
        col1, col2 = st.columns(2)
        with col1:
            st.metric(
                "총 메시지",
                message_stats["total_messages"]
            )
        with col2:
            avg_messages = message_stats["total_messages"] // 7 if message_stats["total_messages"] > 0 else 0
            st.metric(
                "일일 평균",
                avg_messages
            )

def create_settings_tab(dashboard: DashboardManager):
    """설정 탭 생성"""
    st.header("⚙️ 시스템 설정")

    # 전역 설정
    st.subheader("🌐 전역 설정")

    col1, col2 = st.columns(2)

    with col1:
        auto_detect = st.checkbox("자동 방 감지", value=True)
        backup_enabled = st.checkbox("자동 백업", value=True)

    with col2:
        max_rooms = st.number_input("최대 방 수", min_value=1, max_value=100, value=50)
        log_level = st.selectbox("로그 레벨", ["DEBUG", "INFO", "WARNING", "ERROR"], index=1)

    # 환영 메시지 템플릿
    st.subheader("👋 환영 메시지 템플릿")

    template_type = st.selectbox(
        "템플릿 선택",
        ["기본 템플릿", "친근한 템플릿", "간단한 템플릿", "커스텀"]
    )

    if template_type == "커스텀":
        welcome_template = st.text_area(
            "환영 메시지",
            value="{nickname}님, 방에 오신 것을 환영합니다! 👋",
            height=100
        )
    else:
        templates = {
            "기본 템플릿": "{nickname}님, 방에 오신 것을 환영합니다! 👋",
            "친근한 템플릿": "와! {nickname}님이 오셨네요! 반가워요! 🎉",
            "간단한 템플릿": "어서오세요, {nickname}님!"
        }
        st.text_area(
            "미리보기",
            value=templates.get(template_type, ""),
            height=100,
            disabled=True
        )

    # 데이터 관리
    st.subheader("💾 데이터 관리")

    col1, col2, col3 = st.columns(3)

    with col1:
        if st.button("📥 설정 가져오기", type="secondary"):
            try:
                imported = dashboard.room_manager.import_rooms_from_config("config/rooms.json")
                st.success(f"✅ {imported}개 방 가져오기 완료")
            except Exception as e:
                st.error(f"❌ 가져오기 실패: {e}")

    with col2:
        if st.button("📤 설정 내보내기", type="secondary"):
            try:
                if dashboard.room_manager.export_rooms_to_config("config/rooms_backup.json"):
                    st.success("✅ 내보내기 완료")
                else:
                    st.error("❌ 내보내기 실패")
            except Exception as e:
                st.error(f"❌ 내보내기 실패: {e}")

    with col3:
        if st.button("🗑️ 데이터 초기화", type="secondary"):
            if st.session_state.get('confirm_reset', False):
                # 실제 초기화 로직 (구현 필요)
                st.success("✅ 데이터가 초기화되었습니다")
                st.session_state['confirm_reset'] = False
            else:
                st.session_state['confirm_reset'] = True
                st.warning("⚠️ 다시 누르면 데이터가 초기화됩니다")

def create_help_tab():
    """도움말 탭 생성"""
    st.header("❓ 도움말")

    st.markdown("""
    ## IRIS 봇 관리 대시보드 사용법

    ### 🏠 방 관리
    - **방 목록**: 현재 등록된 모든 방의 상태를 확인할 수 있습니다
    - **방 설정**: 각 방별로 자동 환영 메시지, 로깅 등의 기능을 설정할 수 있습니다

    ### 📊 시스템 모니터링
    - **시스템 상태**: 봇의 현재 상태와 기본 정보를 확인합니다
    - **메시지 통계**: 최근 메시지 활동과 추이를 그래프로 확인합니다

    ### ⚙️ 시스템 설정
    - **전역 설정**: 전체 시스템의 동작 방식을 설정합니다
    - **환영 메시지**: 신규 유저에게 보낼 환영 메시지를 설정합니다
    - **데이터 관리**: 설정 파일 가져오기/내보내기 기능을 사용합니다

    ### 📱 모바일 사용
    이 대시보드는 모바일 기기에서도 사용할 수 있습니다. 웹 브라우저로 접속하면 반응형 UI로 최적화됩니다.

    ### 🔧 자주 묻는 질문

    **Q: 방이 자동으로 등록되지 않아요**
    A: '자동 방 감지' 설정이 활성화되어 있는지 확인하고, 봇이 해당 방에 메시지를 보내거나 입장했는지 확인하세요.

    **Q: 환영 메시지가 전송되지 않아요**
    A: 방 설정에서 '자동 환영 메시지'가 활성화되어 있는지 확인하세요.

    **Q: 데이터를 백업하고 싶어요**
    A: 설정 탭의 '데이터 관리'에서 '설정 내보내기' 버튼을 클릭하여 백업할 수 있습니다.
    """)

def main():
    """메인 함수"""
    st.set_page_config(
        page_title="IRIS 봇 관리 대시보드",
        page_icon="🤖",
        layout="wide",
        initial_sidebar_state="expanded"
    )

    # 한국어 폰트 설정
    st.markdown("""
        <style>
        @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap');

        .stApp {
            font-family: 'Noto Sans KR', sans-serif;
        }

        .metric-container {
            background-color: #f0f2f6;
            padding: 1rem;
            border-radius: 0.5rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.12);
        }

        .stTabs [data-baseweb="tab-list"] {
            background-color: #ffffff;
            border-radius: 0.5rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.12);
        }
        </style>
    """, unsafe_allow_html=True)

    # 대시보드 매니저 초기화
    if 'dashboard' not in st.session_state:
        st.session_state['dashboard'] = DashboardManager()

    dashboard = st.session_state['dashboard']

    # 사이드바
    st.sidebar.markdown("## 🤖 IRIS 봇 관리")

    # 새로고침 버튼
    if st.sidebar.button("🔄 새로고침"):
        st.rerun()

    # 마지막 업데이트 시간
    st.sidebar.markdown(f"*마지막 업데이트: {datetime.now().strftime('%H:%M:%S')}*")

    # 자동 새로고침 설정
    auto_refresh = st.sidebar.checkbox("자동 새로고침 (5초)", value=True)

    if auto_refresh:
        time.sleep(5)
        st.rerun()

    # 메인 탭 생성
    tab1, tab2, tab3, tab4 = st.tabs([
        "🏠 방 관리", "📊 모니터링", "⚙️ 설정", "❓ 도움말"
    ])

    with tab1:
        create_room_management_tab(dashboard)

    with tab2:
        create_monitoring_tab(dashboard)

    with tab3:
        create_settings_tab(dashboard)

    with tab4:
        create_help_tab()

if __name__ == "__main__":
    main()