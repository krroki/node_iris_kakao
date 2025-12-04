import os
import time
import uuid

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
import threading
import subprocess
import platform
import datetime as _dt

from kb.db import db_session
from kb.search import vector_search
from kb.logging_util import get_logger
from kb.auto_login import login_and_store
from kb.creds import save_creds, load_meta
from typing import List, Dict, Any, Optional
import re


app = FastAPI(title="Cafe KB Service")
log = get_logger("kb.service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AskRequest(BaseModel):
    query: str
    top_k: int = 6


class AskLlmRequest(BaseModel):
    query: str
    top_k: int = 4
    model: str | None = None  # gemini model name


@app.get("/health")
def health():
    return {"ok": True}


@app.post("/ask")
def ask(req: AskRequest):
    t0 = time.time()
    try:
        res = vector_search(req.query, top_k=req.top_k)
        return {"query": req.query, **res}
    finally:
        log.info(f"/ask qlen={len(req.query)} took={time.time()-t0:.3f}s")


def _ensure_gemini_client():
    key = os.getenv("GOOGLE_API_KEY") or os.getenv("GOOGLE_APIKEY") or os.getenv("GENAI_API_KEY")
    if not key:
        raise HTTPException(status_code=503, detail="missing_google_api_key")
    try:
        from google import genai  # type: ignore
    except Exception as e:  # pragma: no cover
        raise HTTPException(status_code=503, detail=f"google-genai not installed: {e}")
    return genai.Client(api_key=key)


def _load_manuals(ids: List[int]) -> List[Dict[str, Any]]:
    if not ids:
        return []
    with db_session() as s:
        rows = s.execute(text(
            "SELECT doc_id, title, summary, body_md, level, status, updated_at "
            "FROM manual_doc WHERE doc_id = ANY(:ids)"
        ), {"ids": ids}).mappings().all()
    return [dict(r) for r in rows]


def _load_posts(ids: List[int]) -> List[Dict[str, Any]]:
    if not ids:
        return []
    with db_session() as s:
        rows = s.execute(text(
            "SELECT post_id, menu_id, title, url, norm_text, author, created_at, status "
            "FROM sources_post WHERE post_id = ANY(:ids)"
        ), {"ids": ids}).mappings().all()
    return [dict(r) for r in rows]


def _shorten(txt: Optional[str], limit: int = 400) -> str:
    if not txt:
        return ""
    if len(txt) <= limit:
        return txt
    return txt[:limit] + "…"


# 강의 일정 질문 감지 (후기 제외하고 신청 게시판만 검색)
# Menu IDs: 23=무료특강신청, 32=무료특강후기, 42=정규강의신청
SCHEDULE_MENU_IDS = [23, 42]  # 신청 게시판만
REVIEW_MENU_IDS = [32]  # 후기 게시판
# 일정/후기 쿼리는 거리 임계값 완화 (일반 0.42 → 완화 0.8)
SCHEDULE_DIST_THRESHOLD = 0.8
# 강의 관련 모든 게시판 (신청 + 후기)
LECTURE_ALL_MENU_IDS = [23, 32, 42]

def _parse_date_keywords(query: str) -> Optional[tuple]:
    import datetime
    today = datetime.date.today()
    q = query.lower()
    if re.search(r'오늘|금일', q):
        return (today, today)
    if re.search(r'어제', q):
        return (today - datetime.timedelta(days=1), today - datetime.timedelta(days=1))
    if re.search(r'이번\s*주|금주', q):
        start = today - datetime.timedelta(days=today.weekday())
        return (start, start + datetime.timedelta(days=6))
    if re.search(r'지난\s*주|저번\s*주|전주', q):
        start = today - datetime.timedelta(days=today.weekday() + 7)
        return (start, start + datetime.timedelta(days=6))
    if re.search(r'다음\s*주|차주|내주', q):
        start = today + datetime.timedelta(days=(7 - today.weekday()))
        return (start, start + datetime.timedelta(days=6))
    m = re.search(r'최근\s*(\d+)\s*일', q)
    if m:
        return (today - datetime.timedelta(days=int(m.group(1))), today)
    if re.search(r'최근', q):
        return (today - datetime.timedelta(days=7), today)
    return None


def _get_recent_posts(menu_ids, limit=5, date_range=None):
    with db_session() as s:
        if date_range:
            start_date, end_date = date_range
            rows = s.execute(text(
                """SELECT post_id, menu_id, title, url, norm_text, author, created_at, status
                FROM sources_post WHERE menu_id = ANY(:menu_ids) AND status = 'clean'
                AND created_at::date >= :start_date AND created_at::date <= :end_date
                ORDER BY created_at DESC LIMIT :lim"""
            ), {"menu_ids": menu_ids, "start_date": start_date, "end_date": end_date, "lim": limit}).mappings().all()
        else:
            rows = s.execute(text(
                """SELECT post_id, menu_id, title, url, norm_text, author, created_at, status
                FROM sources_post WHERE menu_id = ANY(:menu_ids) AND status = 'clean'
                ORDER BY created_at DESC LIMIT :lim"""
            ), {"menu_ids": menu_ids, "lim": limit}).mappings().all()
    return [dict(r) for r in rows]


def _is_lecture_query(query: str) -> bool:
    return bool(re.search(r'강의|무강|특강|수업|레슨|클래스', query.lower()))




def _is_schedule_query(query: str) -> bool:
    """강의 일정/신청 관련 질문인지 감지 (후기 제외)"""
    q = query.lower()
    # 후기 관련 키워드가 있으면 False
    if re.search(r'후기|리뷰|평가|어땠|어때', q):
        return False
    # 일정/신청 관련 패턴
    schedule_patterns = [
        r'(오늘|내일|이번주|다음주|이번달|다음달|금주|차주).*?(강의|무강|특강)',
        r'(강의|무강|특강).*?(있나|있어|있니|언제|일정|신청)',
        r'(강의|무강|특강).*(뭐|뭘|무엇)',
        r'\d+월.*?(강의|무강|특강)',
        r'(강의|무강|특강).*?\d+월',
    ]
    for pattern in schedule_patterns:
        if re.search(pattern, q):
            return True
    return False


def _is_review_query(query: str) -> bool:
    """강의 후기/리뷰 관련 질문인지 감지"""
    q = query.lower()
    if re.search(r'후기|리뷰|평가|어땠|어때|소감|느낌|수강.*(후|평)', q):
        return True
    return False


def _build_prompt(query: str, manuals: List[Dict[str, Any]], posts: List[Dict[str, Any]]) -> str:
    lines = [
        "너는 디하클(디지털 하이클래스) 카페 운영/강의 정보를 알려주는 조력자야.",
        "아래 자료는 내부 카페 글과 매뉴얼 요약이다. 출처 번호나 괄호를 표시하지 말고, 한국어로 간결하게 답해.",
        "자료가 부족하면 모른다고 답하고 추측하지 마.",
        f"질문: {query}",
        "--- 자료 ---",
    ]
    idx = 1
    for m in manuals:
        lines.append(f"{idx}) [매뉴얼] {m.get('title','(제목없음)')}")
        lines.append(_shorten(m.get("summary") or m.get("body_md") or "", 700))
        idx += 1
    for p in posts:
        title = p.get("title") or "(제목없음)"
        url = p.get("url") or ""
        lines.append(f"{idx}) [게시글] {title}{' ' + url if url else ''}")
        lines.append(_shorten(p.get("norm_text") or "", 700))
        idx += 1
    lines.extend([
        "--- 지침 ---",
        "1) 아래 템플릿 레이아웃을 그대로 유지하고, 내용만 질문 맥락에 맞게 채운다.",
        "2) 항목이 하나뿐이면 첫 번째 블록만 쓰고 나머지는 생략한다. 없는 필드는 '정보 없음'으로 채운다.",
        "3) 같은 문장을 반복하거나 추가 안내/사용법/추가 질문 요청 문구를 넣지 않는다.",
        "4) 날짜·일정·가격은 자료에 있는 값만 그대로 사용하고, 없으면 '정보 없음'으로 명시한다.",
        "5) 대괄호는 한 번만 쓰고 반드시 닫는다. 링크는 한 줄에 깔끔하게 적으며 링크가 없으면 그 줄 자체를 생략한다.",
        "6) 항목 수는 질문 요구에 맞춰 유연하게 작성한다(요청 4개면 4개, 요청 2개면 2개, 요청이 없으면 3~4개 이내). 결과가 부족하면 있는 것만 보여준다.",
        "7) 서브불릿은 반드시 '  • ' 형식만 사용하고, 다른 기호(ㄴ, 번호, 별표 등)는 쓰지 않는다.",
        "--- 출력 템플릿 ---",
        "[디하클 최신 강의 소식]",
        "",
        "최근 카페에서의 핵심 {항목수}가지를 요약해요.",
        "",
        "- 🔥 {제목1} ({구분1})",
        "  • 주제: {주제1}",
        "  • 핵심/성과: {핵심1}",
        "  • 링크: {링크1}",  # 링크가 없으면 이 줄을 생략
        "",
        "- 🎯 {제목2} ({구분2})",  # 두 번째 항목이 없으면 블록 자체를 생략
        "  • 주제: {주제2}",
        "  • 핵심/성과: {핵심2}",
        "  • 링크: {링크2}",  # 링크가 없으면 이 줄을 생략
        "",
        "- 🧠 {제목3} ({구분3})",  # 세 번째 항목이 없으면 블록 자체를 생략
        "  • 주제: {주제3}",
        "  • 핵심/성과: {핵심3}",
        "  • 링크: {링크3}",
        "",
        "- 🚀 {제목4} ({구분4})",  # 네 번째 항목이 없으면 블록 자체를 생략
        "  • 주제: {주제4}",
        "  • 핵심/성과: {핵심4}",
        "  • 링크: {링크4}",
        "",
        "더 자세한 내용은 아래 버튼을 눌러 확인해 보세요!",
        "",
        "링크: {전체_링크}",  # 전체 링크가 없으면 이 줄도 생략
        "--- 추가 규칙 ---",
        "- 강의 질문이 아니어도 위 틀을 유지하되 제목·구분·주제·핵심을 질문에 맞게 변환한다(공지/운영/일정 등).",
        "- 전체_링크는 가장 관련성 높은 게시글 URL을 사용하고, 없으면 아예 출력하지 않는다.",
        "- 절대 '질문 형식을 맞춰 달라'는 안내 문구나 사용법 안내를 덧붙이지 말 것.",
        "- 출력에는 위에 정의한 항목/불릿/링크 줄 외의 텍스트(머리말, 꼬리말, 명령어 예시)를 추가하지 말 것.",
    ])
    return "\n".join(lines)


@app.post("/ask_llm")
def ask_llm(req: AskLlmRequest):
    t0 = time.time()
    try:
        # 일정 질문이면 신청 게시판(23, 42)만, 후기 질문이면 후기 게시판(32)만 검색
        menu_ids = None
        use_relaxed_threshold = False
        is_lecture_q = _is_lecture_query(req.query)
        date_range = _parse_date_keywords(req.query) if is_lecture_q else None

        if _is_schedule_query(req.query):
            menu_ids = SCHEDULE_MENU_IDS
            use_relaxed_threshold = True
            log.info(f"[ask_llm] schedule query detected, menu_ids={menu_ids}, date_range={date_range}")
        elif _is_review_query(req.query):
            menu_ids = REVIEW_MENU_IDS
            use_relaxed_threshold = True
            log.info(f"[ask_llm] review query detected, menu_ids={menu_ids}")

        search_res = vector_search(req.query, top_k=req.top_k, menu_ids=menu_ids)
        dist_threshold = SCHEDULE_DIST_THRESHOLD if use_relaxed_threshold else float(os.getenv("KB_DIST_MAX") or 0.42)

        def _filter_hits(rows: List[Dict[str, Any]], limit: int) -> List[Dict[str, Any]]:
            filtered = [r for r in rows if r.get("dist", 1.0) <= dist_threshold]
            return filtered[:limit]

        manuals_hit = _filter_hits(search_res.get("manuals", []), limit=2)
        posts_hit = _filter_hits(search_res.get("posts", []), limit=3)

        manual_ids = [int(m["doc_id"]) for m in manuals_hit if m.get("doc_id")]
        post_ids = [int(p["post_id"]) for p in posts_hit if p.get("post_id")]

        manuals = _load_manuals(manual_ids)
        posts = _load_posts(post_ids)
        link_hint = ""
        if posts:
            link_hint = posts[0].get("url") or ""

        # Fallback: 강의 질문인데 결과가 없거나, 날짜 특정 쿼리면 직접 조회
        is_fallback = False
        # 날짜 특정 강의 쿼리: vector search 결과와 무관하게 해당 날짜 게시물 직접 조회
        if is_lecture_q and date_range:
            log.info(f"[ask_llm] date-specific lecture query, fetching posts for {date_range}")
            fallback_menu_ids = LECTURE_ALL_MENU_IDS  # 항상 모든 강의 게시판 (신청+후기)
            date_posts = _get_recent_posts(fallback_menu_ids, limit=5, date_range=date_range)
            if date_posts:
                posts = date_posts  # 날짜 필터된 결과로 교체
                is_fallback = True
                link_hint = posts[0].get("url") or ""
                log.info(f"[ask_llm] date filter found {len(posts)} posts")
        # 일반 강의 질문인데 결과가 없으면 최신 강의글 제공
        if not manuals_hit and not posts_hit and is_lecture_q and not is_fallback:
            log.info(f"[ask_llm] no results for lecture query, using fallback")
            fallback_menu_ids = LECTURE_ALL_MENU_IDS if not menu_ids else menu_ids
            posts = _get_recent_posts(fallback_menu_ids, limit=5, date_range=None)
            is_fallback = True
            if posts:
                link_hint = posts[0].get("url") or ""
                log.info(f"[ask_llm] fallback found {len(posts)} recent posts")

        if not manuals and not posts:
            return {
                "ok": True,
                "query": req.query,
                "answer": "최근 90일 내에 질문과 직접 관련된 글을 찾지 못했습니다. 자료 수집 후 다시 시도해 주세요.",
                "model": None,
                "manuals": manuals,
                "posts": posts,
                "link_hint": link_hint,
                "took": time.time() - t0,
            }

        client = _ensure_gemini_client()
        model = req.model or os.getenv("KB_LLM_MODEL") or "models/gemini-2.5-flash"
        prompt = _build_prompt(req.query, manuals, posts)
        resp = client.models.generate_content(model=model, contents=prompt)
        answer = (getattr(resp, "text", None) or "").strip()
        if not answer:
            # some versions return candidates[0].content.parts[0].text
            try:
                cand = resp.candidates[0].content.parts[0].text  # type: ignore
                answer = cand.strip()
            except Exception:
                answer = ""
        if not answer:
            raise HTTPException(status_code=502, detail="empty_llm_answer")

        return {
            "ok": True,
            "query": req.query,
            "answer": answer,
            "model": model,
            "manuals": manuals,
            "posts": posts,
            "link_hint": link_hint,
            "took": time.time() - t0,
        }
    finally:
        log.info(f"/ask_llm qlen={len(req.query)} took={time.time()-t0:.3f}s")


@app.get("/stats")
def stats():
    try:
        with db_session() as s:
            posts = s.execute(text("SELECT count(*) FROM sources_post")).scalar() or 0
            manuals = s.execute(text("SELECT count(*) FROM manual_doc")).scalar() or 0
            emb_posts = s.execute(text("SELECT count(*) FROM embeddings WHERE obj_type='post'" )).scalar() or 0
            emb_manuals = s.execute(text("SELECT count(*) FROM embeddings WHERE obj_type='manual'" )).scalar() or 0
            jobs = s.execute(text(
                "SELECT job_id, job_type, status, started_at, finished_at, payload, result FROM job_log ORDER BY started_at DESC LIMIT 50"
            )).mappings().all()
            cookie_row = s.execute(text("SELECT updated_at FROM secrets WHERE key='CAFE_COOKIES'" )).first()
        return {
            "ok": True,
            "counts": {"posts": posts, "manuals": manuals, "emb_posts": emb_posts, "emb_manuals": emb_manuals},
            "jobs": [dict(r) for r in jobs],
            "cookies": {"present": bool(cookie_row), "updated_at": (cookie_row[0].isoformat() if cookie_row else None)},
        }
    except Exception as e:
        log.exception(f"/stats failed: {e}")
        return JSONResponse(status_code=503, content={"ok": False, "error": "db_unavailable", "detail": str(e)})


class ReindexRequest(BaseModel):
    mode: str = "incremental"  # or full


@app.post("/reindex")
def reindex(_: ReindexRequest):
    return {"status": "queued"}


class RunTaskRequest(BaseModel):
    task: str  # collect|embed|manual
    pages: int | None = None


@app.post("/run")
def run_task(req: RunTaskRequest):
    task = req.task.lower()
    if task not in {"collect", "embed", "manual"}:
        raise HTTPException(status_code=400, detail="invalid task")
    import sys
    root = os.path.dirname(os.path.dirname(__file__))
    ps_runner = os.path.join(root, "windows", "kb_task_runner.ps1")
    if platform.system() == "Windows" and os.path.exists(ps_runner):
        cmd = ["powershell", "-ExecutionPolicy", "Bypass", "-File", ps_runner, "-Task", task] + ([str(x) for x in (["-Pages", req.pages] if (req.pages or 0) > 0 else [])])
        log.info(f"spawn: {cmd}")
        subprocess.Popen(cmd, cwd=root, env=os.environ.copy())
        return {"status": "started", "via": "powershell", "task": task}
    mapping = {
        "collect": [sys.executable, os.path.join(root, "kb", "ingest.py")],
        "embed": [sys.executable, os.path.join(root, "kb", "update_embeddings.py")],
        "manual": [sys.executable, os.path.join(root, "kb", "manualize.py")],
    }
    log.info(f"spawn: {mapping[task]}")
    subprocess.Popen((mapping[task] + ([str(req.pages)] if False else [])), cwd=root, env=os.environ.copy())
    return {"status": "started", "via": "python", "task": task}


class CookiesIn(BaseModel):
    cookies: str


@app.post("/cookies")
def set_cookies(body: CookiesIn):
    ck = body.cookies.strip()
    if not ck:
        raise HTTPException(400, "empty cookies")
    with db_session() as s:
        s.execute(text(
            "INSERT INTO secrets(key,value,updated_at) VALUES('CAFE_COOKIES', :v, now())\n"
            "ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()"
        ), {"v": ck})
    os.environ["CAFE_COOKIES"] = ck
    log.info("cookies stored")
    return {"ok": True}


@app.post("/run_cookie")
def run_cookie():
    root = os.path.dirname(os.path.dirname(__file__))
    script = os.path.join(root, "scripts", "collect_cafe_cookies.js")
    if not os.path.exists(script):
        raise HTTPException(500, "collector script missing")
    log.info("launch cookie collector browser")
    env = os.environ.copy()
    env.setdefault("KB_URL", f"http://127.0.0.1:{os.getenv('PORT','8610')}")
    try:
        proc = subprocess.Popen(["node", script], cwd=root, env=env)
        log.info(f"cookie collector spawned pid={proc.pid}")
        return {"status": "started", "pid": proc.pid}
    except Exception as e:  # pragma: no cover
        log.exception(f"cookie collector spawn failed: {e}")
        raise HTTPException(500, "spawn_failed")


# --- Simple in-process scheduler (UI-togglable) ---
_SCHED = {
    "collect": {"interval": 0, "next": None, "proc": None},
    "embed":   {"interval": 0, "next": None, "proc": None},
    "manual":  {"interval": 0, "next": None, "proc": None},
}

def _spawn_task(task: str):
    try:
        run_task(RunTaskRequest(task=task))
        log.info(f"[sched] spawned {task}")
    except Exception as e:  # pragma: no cover
        log.exception(f"[sched] spawn {task} failed: {e}")


def _sched_loop():
    while True:
        now = _dt.datetime.utcnow()
        for task, cfg in list(_SCHED.items()):
            itv = int(cfg.get("interval") or 0)
            if itv <= 0:
                continue
            nxt = cfg.get("next")
            if not nxt or now >= nxt:
                _spawn_task(task)
                cfg["next"] = now + _dt.timedelta(seconds=itv)
        time.sleep(15)


@app.on_event("startup")
def _start_scheduler():
    t = threading.Thread(target=_sched_loop, name="kb-scheduler", daemon=True)
    t.start()


class ScheduleIn(BaseModel):
    task: str
    interval_minutes: int  # 0 to disable


@app.get("/schedule")
def get_schedule():
    out = {}
    for k, v in _SCHED.items():
        n = v.get("next")
        out[k] = {
            "interval_minutes": int((v.get("interval") or 0) // 60),
            "next": (n.isoformat() + "Z") if n else None,
        }
    return {"ok": True, "schedule": out}


@app.post("/schedule")
def set_schedule(body: ScheduleIn):
    task = body.task.lower()
    if task not in _SCHED:
        raise HTTPException(400, "invalid task")
    minutes = max(0, int(body.interval_minutes))
    _SCHED[task]["interval"] = minutes * 60
    _SCHED[task]["next"] = _dt.datetime.utcnow() + _dt.timedelta(seconds=_SCHED[task]["interval"]) if minutes else None
    log.info(f"[sched] set {task} every {minutes}m")
    return {"ok": True, "task": task, "interval_minutes": minutes}


@app.get("/posts")
def list_posts(limit: int = 50):
    lim = max(1, min(int(limit or 50), 200))
    with db_session() as s:
        rows = s.execute(text(
            """
            SELECT post_id, menu_id, title, url, created_at, status
            FROM sources_post
            WHERE status='clean'
            ORDER BY created_at DESC NULLS LAST, post_id DESC
            LIMIT :lim
            """
        ), {"lim": lim}).mappings().all()
    return {"ok": True, "posts": [dict(r) for r in rows]}


@app.get("/manuals")
def list_manuals(limit: int = 50):
    lim = max(1, min(int(limit or 50), 200))
    with db_session() as s:
        rows = s.execute(text(
            """
            SELECT doc_id, title, status, summary, updated_at
            FROM manual_doc
            ORDER BY updated_at DESC NULLS LAST, doc_id DESC
            LIMIT :lim
            """
        ), {"lim": lim}).mappings().all()
    return {"ok": True, "manuals": [dict(r) for r in rows]}


@app.get("/__whoami")
def whoami():
    return {"file": __file__}


@app.middleware("http")
async def log_requests(request: Request, call_next):
    req_id = str(uuid.uuid4())[:8]
    start = time.time()
    try:
        response = await call_next(request)
        return response
    except Exception as e:
        log.exception(f"req_id={req_id} path={request.url.path} error={e}")
        return JSONResponse(status_code=500, content={"error": "internal_error", "req_id": req_id})
    finally:
        dur = time.time() - start
        log.info(f"req_id={req_id} {request.method} {request.url.path} took={dur:.3f}s")


class LoginIn(BaseModel):
    id: str | None = None
    pw: str | None = None
    headless: bool | None = None
    channel: str | None = None


@app.post("/login")
def do_login(body: LoginIn):
    if body.id and body.pw:
        os.environ["NAVER_ID"] = body.id
        os.environ["NAVER_PW"] = body.pw
    # �⺻��: Windows������ â�� ���̵���(headless=false)
    if body.headless is not None:
        os.environ["KB_LOGIN_HEADLESS"] = "1" if body.headless else "0"
    else:
        os.environ["KB_LOGIN_HEADLESS"] = "0"
    if body.channel:
        os.environ["KB_LOGIN_CHANNEL"] = body.channel
    else:
        # �ý��� ũ�� �켱, ������ ��ũ��Ʈ���� ������ ����
        os.environ.setdefault("KB_LOGIN_CHANNEL", "chrome")
    ok = login_and_store()
    if not ok:
        raise HTTPException(500, "login_failed")
    return {"ok": True}


class CredsIn(BaseModel):
    id: str
    pw: str


@app.get("/creds")
def get_creds():
    return {"ok": True, **load_meta()}


@app.post("/creds")
def post_creds(body: CredsIn):
    try:
        save_creds(body.id, body.pw)
        return {"ok": True}
    except Exception as e:
        log.exception(f"save_creds failed: {e}")
        raise HTTPException(500, "save_failed")
