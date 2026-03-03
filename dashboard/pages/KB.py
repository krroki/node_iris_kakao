import os
import requests
import pandas as pd
import streamlit as st

st.set_page_config(page_title="카페 지식베이스", layout="wide")
st.title("카페 지식베이스")

KB_URL = os.getenv("KB_URL", "http://127.0.0.1:8610")

col_a, col_b, col_c = st.columns(3)
with col_a:
    if st.button("수집 실행(ingest)"):
        try:
            r = requests.post(f"{KB_URL}/run", json={"task": "collect"}, timeout=5)
            st.success(f"수집 시작: {r.json()}")
        except Exception as e:
            st.error(f"실행 실패: {e}")
with col_b:
    if st.button("임베딩 업데이트"):
        try:
            r = requests.post(f"{KB_URL}/run", json={"task": "embed"}, timeout=5)
            st.success(f"임베딩 시작: {r.json()}")
        except Exception as e:
            st.error(f"실행 실패: {e}")
with col_c:
    if st.button("매뉴얼화 실행"):
        try:
            r = requests.post(f"{KB_URL}/run", json={"task": "manual"}, timeout=5)
            st.success(f"매뉴얼화 시작: {r.json()}")
        except Exception as e:
            st.error(f"실행 실패: {e}")

st.divider()
st.subheader("상태 요약")

try:
    r = requests.get(f"{KB_URL}/stats", timeout=5)
    r.raise_for_status()
    data = r.json()
except Exception as e:
    st.error(f"KB 서비스에 연결할 수 없습니다: {e}")
    st.info("KB API를 먼저 실행하세요: windows/kb_service.ps1")
    st.stop()

counts = data.get("counts", {})
jobs = data.get("jobs", [])

col1, col2, col3, col4 = st.columns(4)
col1.metric("포스트", counts.get("posts", 0))
col2.metric("매뉴얼", counts.get("manuals", 0))
col3.metric("임베딩(포스트)", counts.get("emb_posts", 0))
col4.metric("임베딩(매뉴얼)", counts.get("emb_manuals", 0))

st.subheader("최근 잡 실행")
if jobs:
    df = pd.DataFrame(jobs)
    st.dataframe(df, use_container_width=True)
else:
    st.info("잡 실행 로그가 없습니다.")

st.caption(f"KB_URL = {KB_URL}")

