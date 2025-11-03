#!/usr/bin/env python3
"""
Node-Iris 대시보드 (이미지 시안 유사 스타일)
- 상단 상태 카드(IRIS 연결, 활성 방 수, Messages/sec, Errors)
- 방 카드 그리드 + 썸네일 + 기능 토글(환영/브로드캐스트/스케줄) + 최근 로그
- 안전모드/허용방 + 브로드캐스트 큐 + .env 미리보기
- Windows 봇 실행/중지/상태 버튼

실행: python -m streamlit run dashboard/ui_node_iris.py
"""

from __future__ import annotations
import json
import os
import time
from pathlib import Path
from datetime import datetime, timedelta
from typing import List, Dict, Any, Tuple, Optional

import streamlit as st
import requests
import streamlit.components.v1 as components


# -----------------------------
# Path resolution
# -----------------------------
def resolve_app_base() -> Path:
    env_dir = Path(os.environ.get("NODE_IRIS_APP_DIR", "")).expanduser()
    if env_dir and (env_dir / "package.json").exists():
        return env_dir
    wsl_win = Path("/mnt/c/dev/node-iris-app")
    if (wsl_win / "package.json").exists():
        return wsl_win
    script_dir = Path(__file__).resolve().parent
    repo_root = script_dir.parent
    repo_app = repo_root / "node-iris-app"
    if (repo_app / "package.json").exists():
        return repo_app
    cwd_app = Path.cwd() / "node-iris-app"
    if (cwd_app / "package.json").exists():
        return cwd_app
    return repo_root


APP_BASE = resolve_app_base()
# Hardening: if resolve failed, force repo_root/node-iris-app
try:
    if not (APP_BASE / "package.json").exists():
        _cand = Path(__file__).resolve().parent.parent / "node-iris-app"
        if (_cand / "package.json").exists():
            APP_BASE = _cand
except Exception:
    pass
RUNTIME_JSON = APP_BASE / "config" / "runtime.json"
ENV_PATH = APP_BASE / ".env"
BROADCAST_DB = APP_BASE / "data" / "broadcast-queue.json"
LOGS_DIR = APP_BASE / "data" / "logs"
BOT_LOG = APP_BASE / "bot.log"
BOT_LOG_NEW = APP_BASE / "bot_new.log"


# -----------------------------
# Data helpers (cached)
# -----------------------------
@st.cache_data(ttl=5.0)
def load_runtime() -> Dict[str, Any]:
    if RUNTIME_JSON.exists():
        try:
            return json.loads(RUNTIME_JSON.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"safeMode": True, "allowedRoomIds": [], "features": {}}


def save_runtime(cfg: Dict[str, Any]) -> None:
    RUNTIME_JSON.parent.mkdir(parents=True, exist_ok=True)
    RUNTIME_JSON.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    load_runtime.clear()


@st.cache_data(ttl=5.0)
def list_room_dirs() -> List[Path]:
    if not LOGS_DIR.exists():
        return []
    return sorted([p for p in LOGS_DIR.iterdir() if p.is_dir()])


@st.cache_data(ttl=5.0)
def discover_rooms() -> Dict[str, Dict[str, Any]]:
    rooms: Dict[str, Dict[str, Any]] = {}
    for room_dir in list_room_dirs():
        rid = room_dir.name
        files = sorted(room_dir.glob("*.log"))
        if not files:
            rooms[rid] = {"roomId": rid, "roomName": rid}
            continue
        last = files[-1]
        try:
            lines = last.read_text(encoding="utf-8").splitlines()
            if lines:
                obj = json.loads(lines[-1])
                rn = obj.get("snapshot", {}).get("roomName") or rid
                rooms[rid] = {"roomId": rid, "roomName": rn}
            else:
                rooms[rid] = {"roomId": rid, "roomName": rid}
        except Exception:
            rooms[rid] = {"roomId": rid, "roomName": rid}
    return rooms


def tail_room_logs(rid: str, n: int = 8) -> List[str]:
    room_dir = LOGS_DIR / rid
    files = sorted(room_dir.glob("*.log"))
    if not files:
        return []
    last = files[-1]
    try:
        lines = last.read_text(encoding="utf-8").splitlines()
        return lines[-n:]
    except Exception:
        return []

def parse_log_line(line: str) -> Optional[Dict[str, Any]]:
    try:
        obj = json.loads(line)
        ts = obj.get("timestamp")
        snap = obj.get("snapshot", {})
        rid = str(snap.get("roomId"))
        txt = snap.get("messageText")
        sname = snap.get("senderName") or snap.get("senderId")
        rname = snap.get("roomName") or rid
        return {"ts": ts, "roomId": rid, "roomName": rname, "sender": sname, "text": txt, "raw": obj}
    except Exception:
        return None

def tail_global_logs(n: int = 60) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    for d in list_room_dirs():
        files = sorted(d.glob("*.log"))
        if not files:
            continue
        last = files[-1]
        try:
            lines = last.read_text(encoding="utf-8", errors="ignore").splitlines()
            for line in lines[-200:]:
                rec = parse_log_line(line)
                if rec:
                    items.append(rec)
        except Exception:
            continue
    items.sort(key=lambda o: o.get("ts") or "", reverse=True)
    return items[:n]

def filter_log_records(
    recs: List[Dict[str, Any]],
    room_id: Optional[str] = None,
    include_kw: Optional[str] = None,
    exclude_kw: Optional[str] = None,
    limit: int = 80,
) -> List[Dict[str, Any]]:
    inc = [s.strip().lower() for s in (include_kw or "").split() if s.strip()]
    exc = [s.strip().lower() for s in (exclude_kw or "").split() if s.strip()]
    out: List[Dict[str, Any]] = []
    seen = set()
    for r in recs:
        if room_id and str(r.get("roomId")) != str(room_id):
            continue
        blob = " ".join(
            [
                str(r.get("roomName") or ""),
                str(r.get("sender") or ""),
                str(r.get("text") or ""),
            ]
        ).lower()
        if inc and not any(k in blob for k in inc):
            continue
        if exc and any(k in blob for k in exc):
            continue
        mid = r.get("mid") if isinstance(r, dict) else None
        key = (mid or r.get("ts"), str(r.get("roomId")), r.get("sender"), r.get("text"))
        if key in seen:
            continue
        seen.add(key)
        out.append(r)
        if len(out) >= limit:
            break
    return out

def room_stats(rid: str) -> Tuple[Optional[str], int]:
    """Return (last_timestamp_iso, today_count) for a room based on latest log file.
    Lightweight: scans up to last 400 lines of the last log file.
    """
    room_dir = LOGS_DIR / rid
    files = sorted(room_dir.glob("*.log"))
    if not files:
        return (None, 0)
    last = files[-1]
    try:
        lines = last.read_text(encoding="utf-8", errors="ignore").splitlines()
        lines = lines[-400:]
        last_ts = None
        today_prefix = datetime.utcnow().strftime("%Y-%m-%d")
        today_count = 0
        for line in lines:
            rec = parse_log_line(line)
            if not rec:
                continue
            ts = rec.get("ts")
            if ts:
                last_ts = ts
                if ts.startswith(today_prefix):
                    today_count += 1
        return (last_ts, today_count)
    except Exception:
        return (None, 0)


def load_broadcast_queue() -> List[Dict[str, Any]]:
    if not BROADCAST_DB.exists():
        return []
    try:
        return json.loads(BROADCAST_DB.read_text(encoding="utf-8"))
    except Exception:
        return []


def save_broadcast_queue(items: List[Dict[str, Any]]) -> None:
    BROADCAST_DB.parent.mkdir(parents=True, exist_ok=True)
    BROADCAST_DB.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")


def enqueue_broadcast(channels: List[str], message: str) -> Dict[str, Any]:
    import uuid
    now = int(datetime.utcnow().timestamp() * 1000)
    task = {
        "id": str(uuid.uuid4()),
        "channels": [str(c) for c in channels],
        "payload": {"type": "text", "message": message},
        "status": "pending",
        "attempts": 0,
        "createdAt": now,
        "scheduledAt": now,
    }
    items = load_broadcast_queue()
    items.append(task)
    save_broadcast_queue(items)
    return task


def load_env_preview() -> Dict[str, str]:
    keys = ["IRIS_URL", "IRIS_HOST", "WELCOME_TEMPLATE", "SAFE_MODE", "ALLOWED_ROOM_IDS"]
    result = {k: "" for k in keys}
    if not ENV_PATH.exists():
        return result
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        if not line or line.strip().startswith("#"):
            continue
        if "=" in line:
            k, v = line.split("=", 1)
            k = k.strip(); v = v.strip()
            if k in result:
                result[k] = v
    return result


# -----------------------------
# Metrics / status
# -----------------------------
def _is_wsl() -> bool:
    try:
        return "microsoft" in Path("/proc/sys/kernel/osrelease").read_text().lower()
    except Exception:
        return False

def _windows_host_ip() -> str | None:
    try:
        for line in Path("/etc/resolv.conf").read_text().splitlines():
            if line.startswith("nameserver "):
                return line.split()[1].strip()
    except Exception:
        pass
    return None

def iris_status(env: Dict[str, str]) -> Tuple[str, str]:
    url = env.get("IRIS_URL", "")
    if url and not url.startswith("http"):
        url = f"http://{url}"
    # If running in WSL and URL points to 127.0.0.1, route to Windows host IP so we can reach ADB forward
    try:
        from urllib.parse import urlparse, urlunparse
        parsed = urlparse(url) if url else None
        if parsed and _is_wsl() and parsed.hostname in {"127.0.0.1", "localhost"}:
            hip = _windows_host_ip()
            if hip:
                parsed = parsed._replace(netloc=f"{hip}:{parsed.port or 80}")
                url = urlunparse(parsed)
    except Exception:
        pass
    # Try multiple endpoints for robustness
    candidates: list[str] = []
    if url:
        candidates.append(url)
    # Prefer explicit Windows gateway when in WSL
    if _is_wsl():
        hip = _windows_host_ip()
        if hip:
            candidates.append(f"http://{hip}:5050")
            candidates.append(f"http://{hip}:5005")
            candidates.append(f"http://{hip}:3000")
    # Also try loopback variants
    candidates.extend(["http://127.0.0.1:5050", "http://127.0.0.1:5005", "http://127.0.0.1:3000"])  # last resort

    last_err = None
    for base in candidates:
        try:
            r = requests.get(f"{base}/config", timeout=4)
            if r.status_code == 200:
                return ("Connected", base)
            last_err = f"HTTP {r.status_code} at {base}"
        except Exception as e:
            last_err = f"{e} at {base}"
            # Windows-side probe if in WSL
            try:
                if _is_wsl():
                    ps = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
                    cmd = [ps, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
                           f"try {{ (Invoke-WebRequest -Uri '{base}/config' -TimeoutSec 3).StatusCode }} catch {{ 'ERR' }}"]
                    import subprocess
                    out = subprocess.check_output(cmd, stderr=subprocess.STDOUT).decode().strip()
                    if out.isdigit() and int(out) == 200:
                        return ("Connected", f"via Windows: {base}")
            except Exception:
                pass
    if not url:
        return ("Unknown", "IRIS_URL not set")
    return ("Disconnected", last_err or "unreachable")


def calc_messages_per_sec(window_sec: int = 60) -> float:
    now = datetime.utcnow()
    cutoff = now - timedelta(seconds=window_sec)
    count = 0
    for d in list_room_dirs():
        files = sorted((d).glob("*.log"))
        if not files:
            continue
        last = files[-1]
        try:
            for line in last.read_text(encoding="utf-8").splitlines()[-400:]:
                try:
                    obj = json.loads(line)
                    ts = datetime.fromisoformat(obj.get("timestamp").replace("Z", "+00:00"))
                    if ts >= cutoff:
                        count += 1
                except Exception:
                    continue
        except Exception:
            continue
    return round(count / max(window_sec, 1), 2)


def count_errors_24h() -> int:
    total = 0
    for p in [BOT_LOG, BOT_LOG_NEW]:
        if not p.exists():
            continue
        try:
            for line in p.read_text(encoding="utf-8", errors="ignore").splitlines()[-2000:]:
                if "error" in line.lower():
                    total += 1
        except Exception:
            pass
    return total


# -----------------------------
# Windows bot control helpers
# -----------------------------
def _ps_exec(args: List[str]) -> str:
    import subprocess
    try:
        out = subprocess.check_output(args, stderr=subprocess.STDOUT)
        return out.decode(errors="ignore").strip()
    except subprocess.CalledProcessError as e:
        return (e.output or b"").decode(errors="ignore").strip()


def bot_status_windows() -> str:
    ps = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
    script = "C:\\Users\\Public\\status_node_iris_bot.ps1"
    if not Path(script.replace("C:", "/mnt/c")).exists():
        return "UNKNOWN"
    return _ps_exec([ps, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script]) or "UNKNOWN"


def bot_start_windows() -> str:
    ps = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
    script = "C:\\Users\\Public\\run_node_iris_bot.ps1"
    return _ps_exec([ps, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script])


def bot_stop_windows() -> str:
    ps = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
    script = "C:\\Users\\Public\\stop_node_iris_bot.ps1"
    return _ps_exec([ps, "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script])


# -----------------------------
# UI
# -----------------------------
def render_css():
    st.markdown(
        """
        <style>
        /* Global Styles */
        .stApp {
            background: linear-gradient(135deg, #111c33 0%, #1d2d4a 100%);
            color: #f1f5f9;
            font-family: 'Inter', 'Segoe UI', sans-serif;
        }
        .stApp table {
            color: #f8fafc;
            background-color: #16233c;
        }
        .stApp th, .stApp td {
            color: #e2e8f0 !important;
            border-color: #334e7a !important;
        }
        .stApp h1, .stApp h2, .stApp h3, .stApp h4, .stApp h5, .stApp h6,
        .stApp p, .stApp span, .stApp label, .stApp li, .stApp div, .stApp button {
            color: #f8fafc;
        }
        .stApp a {
            color: #93c5fd;
        }
        .stApp .stSelectbox label, .stApp .stMultiSelect label {
            color: #dbeafe;
        }
        .stApp input, .stApp textarea, .stApp select {
            background-color: #1e293b !important;
            color: #f8fafc !important;
            border: 1px solid #475569 !important;
        }
        .stApp .stButton>button {
            background: linear-gradient(135deg, #3b82f6, #6366f1) !important;
            color: #f8fafc !important;
            border: none;
        }
        .stApp .stButton>button:hover {
            background: linear-gradient(135deg, #2563eb, #4f46e5) !important;
        }
        .stApp div[data-testid="stExpander"] {
            background: linear-gradient(135deg, #1c2d4d 0%, #16233c 100%);
            border: 1px solid #334e7a;
            border-radius: 12px;
        }
        .stTabs [role="tab"] {
            color: #e2e8f0 !important;
        }
        .stTabs [role="tab"][aria-selected="true"] {
            color: #fefefe !important;
            background: rgba(59, 130, 246, 0.2) !important;
            border-bottom: 2px solid #60a5fa !important;
        }

        /* Improved Metric Cards */
        .metric-card {
            background: linear-gradient(135deg, #1e2a44 0%, #152238 100%);
            border-radius: 16px;
            padding: 20px;
            color: #f8fafc;
            border: 1px solid #334e7a;
            box-shadow: 0 20px 45px rgba(15, 23, 42, 0.35);
            transition: all 0.3s ease;
            position: relative;
            overflow: hidden;
        }
        .metric-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 18px 32px rgba(15, 23, 42, 0.45);
            border-color: #4f6fa5;
        }
        .metric-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: linear-gradient(90deg, #3b82f6, #8b5cf6);
        }
        .metric-card h3, .metric-card h4, .metric-card p {
            color: #f8fafc !important;
        }

        /* Enhanced Room Cards */
        .room-card {
            background: linear-gradient(135deg, #1c2d4d 0%, #16233c 100%);
            border: 1px solid #334e7a;
            border-radius: 16px;
            padding: 20px;
            margin-bottom: 20px;
            box-shadow: 0 16px 30px rgba(15, 23, 42, 0.35);
            transition: all 0.3s ease;
        }
        .room-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 22px 36px rgba(15, 23, 42, 0.45);
            border-color: #4f6fa5;
        }
        .room-card h3, .room-card h4, .room-card p, .room-card span {
            color: #f1f5f9 !important;
        }
        .room-card-header {
            display: flex;
            align-items: center;
            margin-bottom: 12px;
        }
        .room-card-icon {
            width: 40px;
            height: 40px;
            border-radius: 12px;
            background: linear-gradient(135deg, #3b82f6, #8b5cf6);
            display: flex;
            align-items: center;
            justify-content: center;
            margin-right: 12px;
            font-size: 20px;
        }
        .room-badge {
            display: inline-block;
            padding: 4px 10px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 600;
            margin-left: 8px;
        }
        .room-badge.active {
            background: #14532d;
            color: #bbf7d0;
        }
        .room-badge.inactive {
            background: #3f2d20;
            color: #fed7aa;
        }

        /* Enhanced Template Cards */
        .template-card {
            background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
            border: 1px solid #334155;
            border-radius: 16px;
            padding: 18px;
            margin-bottom: 16px;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
            transition: all 0.3s ease;
            cursor: pointer;
        }
        .template-card:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
            border-color: #475569;
        }
        .template-card-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 10px;
        }
        .template-icon {
            width: 32px;
            height: 32px;
            border-radius: 8px;
            background: linear-gradient(135deg, #3b82f6, #8b5cf6);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-right: 10px;
        }

        /* Improved Pills/Tags */
        .pill {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 999px;
            background: #334155;
            color: #cbd5e1;
            margin-right: 8px;
            margin-bottom: 6px;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.2s ease;
            cursor: pointer;
        }
        .pill:hover {
            background: #475569;
            transform: scale(1.05);
        }
        .pill.clickable {
            background: #1e40af;
            color: #bfdbfe;
        }
        .pill.clickable:hover {
            background: #2563eb;
        }

        /* Enhanced Log Box */
        .logbox {
            background: #0a0f1a;
            border: 1px solid #334155;
            border-radius: 12px;
            padding: 12px;
            height: 100px;
            overflow: auto;
            color: #93c5fd;
            font-family: 'JetBrains Mono', 'Consolas', monospace;
            font-size: 13px;
            line-height: 1.6;
            box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.3);
        }
        .logbox::-webkit-scrollbar {
            width: 8px;
        }
        .logbox::-webkit-scrollbar-track {
            background: #1e293b;
            border-radius: 4px;
        }
        .logbox::-webkit-scrollbar-thumb {
            background: #475569;
            border-radius: 4px;
        }
        .logbox::-webkit-scrollbar-thumb:hover {
            background: #64748b;
        }

        /* Better Typography */
        .page-title {
            font-size: 28px;
            font-weight: 700;
            color: #f1f5f9;
            margin: 8px 0 16px;
            letter-spacing: -0.5px;
        }
        .section-title {
            font-size: 20px;
            font-weight: 600;
            color: #e2e8f0;
            margin: 20px 0 12px;
            display: flex;
            align-items: center;
        }
        .section-title::before {
            content: '';
            display: inline-block;
            width: 4px;
            height: 20px;
            background: linear-gradient(180deg, #3b82f6, #8b5cf6);
            margin-right: 10px;
            border-radius: 2px;
        }

        /* Improved Buttons */
        .stButton button {
            border-radius: 10px !important;
            font-weight: 500 !important;
            transition: all 0.2s ease !important;
            border: none !important;
        }
        .stButton button:hover {
            transform: translateY(-1px) !important;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3) !important;
        }

        /* Info boxes */
        .info-box {
            background: rgba(59, 130, 246, 0.1);
            border-left: 4px solid #3b82f6;
            padding: 12px 16px;
            border-radius: 8px;
            color: #bfdbfe;
            margin: 12px 0;
        }
        .warning-box {
            background: rgba(251, 191, 36, 0.1);
            border-left: 4px solid #fbbf24;
            padding: 12px 16px;
            border-radius: 8px;
            color: #fde68a;
            margin: 12px 0;
        }
        .success-box {
            background: rgba(34, 197, 94, 0.1);
            border-left: 4px solid #22c55e;
            padding: 12px 16px;
            border-radius: 8px;
            color: #bbf7d0;
            margin: 12px 0;
        }

        /* Character counter */
        .char-counter {
            text-align: right;
            color: #94a3b8;
            font-size: 12px;
            margin-top: 4px;
        }
        .char-counter.warning {
            color: #fbbf24;
        }
        .char-counter.error {
            color: #ef4444;
        }

        /* Divider */
        hr {
            border: none;
            height: 1px;
            background: linear-gradient(90deg, transparent, #334155, transparent);
            margin: 24px 0;
        }
        </style>
        """,
        unsafe_allow_html=True,
    )


def live_log_widget(room_id: Optional[str] = None, limit: int = 80, include: str = "", exclude: str = "", height: int = 260, interval_ms: int = 1000):
    # Pure client-side fetch (no rerun): polling API every 2s and updating DOM
    room_q = f"roomId={room_id}" if room_id else ""
    html = f"""
    <div id='live-log' style="background:#0a0f1a;border:1px solid #1f2937;border-radius:8px;padding:8px;height:{height}px;overflow:auto;color:#93c5fd;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;font-size:12px"></div>
    <script>
      const api = 'http://127.0.0.1:8510/logs';
      const params = new URLSearchParams();
      params.set('roomId','{room_id}');
      params.set('limit','{limit}');
      if ('{include}'.trim()) params.set('include','{include}');
      if ('{exclude}'.trim()) params.set('exclude','{exclude}');
      const box = document.getElementById('live-log');
      async function tick(){{
        try{{
          const r = await fetch(api + '?' + params.toString(), {{cache:'no-store'}});
          const data = await r.json();
          const lines = data.map(r => `[${{r.ts}}] (${{r.roomName}}) ${{r.sender}}: ${{r.text}}`);
          box.innerHTML = lines.join('<br>');
          box.scrollTop = box.scrollHeight;
        }}catch(e){{}}
      }}
      tick();
      setInterval(tick, %d);
    </script>
    """ % interval_ms
    components.html(html, height=height+20)


def page_dashboard():
    envv = load_env_preview()
    status, detail = iris_status(envv)
    active_rooms = len(discover_rooms())
    mps = calc_messages_per_sec(60)
    errs = count_errors_24h()

    # Improved metric cards with icons and status colors
    colm = st.columns([1,1,1,1])
    with colm[0]:
        status_icon = "🟢" if status == "Connected" else "🔴"
        status_color = "#22c55e" if status == "Connected" else "#ef4444"
        st.markdown(f"""
        <div class='metric-card'>
            <div style='display:flex;align-items:center;margin-bottom:8px;'>
                <span style='font-size:24px;margin-right:10px;'>{status_icon}</span>
                <b style='font-size:14px;color:#94a3b8;'>IRIS Connection</b>
            </div>
            <h3 style='margin:8px 0;color:{status_color};'>{status}</h3>
            <span style='font-size:12px;color:#64748b;'>{detail[:40]}...</span>
        </div>
        """, unsafe_allow_html=True)
    with colm[1]:
        st.markdown(f"""
        <div class='metric-card'>
            <div style='display:flex;align-items:center;margin-bottom:8px;'>
                <span style='font-size:24px;margin-right:10px;'>💬</span>
                <b style='font-size:14px;color:#94a3b8;'>Active Rooms</b>
            </div>
            <h3 style='margin:8px 0;color:#3b82f6;'>{active_rooms}</h3>
            <span style='font-size:12px;color:#64748b;'>Total conversations</span>
        </div>
        """, unsafe_allow_html=True)
    with colm[2]:
        mps_color = "#22c55e" if mps > 1 else "#64748b"
        st.markdown(f"""
        <div class='metric-card'>
            <div style='display:flex;align-items:center;margin-bottom:8px;'>
                <span style='font-size:24px;margin-right:10px;'>⚡</span>
                <b style='font-size:14px;color:#94a3b8;'>Messages/sec</b>
            </div>
            <h3 style='margin:8px 0;color:{mps_color};'>{mps}</h3>
            <span style='font-size:12px;color:#64748b;'>Last 60 seconds</span>
        </div>
        """, unsafe_allow_html=True)
    with colm[3]:
        err_color = "#ef4444" if errs > 5 else ("#fbbf24" if errs > 0 else "#22c55e")
        err_icon = "⚠️" if errs > 5 else ("⚡" if errs > 0 else "✅")
        st.markdown(f"""
        <div class='metric-card'>
            <div style='display:flex;align-items:center;margin-bottom:8px;'>
                <span style='font-size:24px;margin-right:10px;'>{err_icon}</span>
                <b style='font-size:14px;color:#94a3b8;'>Errors (24h)</b>
            </div>
            <h3 style='margin:8px 0;color:{err_color};'>{errs}</h3>
            <span style='font-size:12px;color:#64748b;'>System health</span>
        </div>
        """, unsafe_allow_html=True)

    # Debug info: show resolved IRIS_URL from .env
    st.caption(f"IRIS_URL from .env: {envv.get('IRIS_URL','(unset)')}")
    # 대시보드 자동 새로고침 제거(깜빡임 방지). 필요한 경우 카드별 미니 라이브 사용.
    st.markdown("<div class='section-title'>📚 Rooms</div>", unsafe_allow_html=True)
    rooms = discover_rooms()
    cfg = load_runtime()
    features: Dict[str, Any] = dict(cfg.get("features") or {})
    if not rooms:
        st.markdown("<div class='info-box'>💡 아직 수집된 방이 없습니다. 봇이 메시지를 한 번이라도 수신하면 자동으로 나타납니다.</div>", unsafe_allow_html=True)
        return

    cols = st.columns(2)
    i = 0
    for rid, info in rooms.items():
        with cols[i % 2]:
            last_ts, today_cnt = room_stats(rid)
            # Determine if room is active
            fl = features.get(rid, {})
            is_active = any(bool(v) for v in fl.values())
            badge_class = "active" if is_active else "inactive"
            badge_text = "활성" if is_active else "비활성"

            st.markdown(f"""
            <div class='room-card'>
                <div class='room-card-header'>
                    <div class='room-card-icon'>💬</div>
                    <div style='flex:1;'>
                        <h3 style='margin:0;color:#f1f5f9;font-size:18px;'>{info.get('roomName')}</h3>
                        <span class='room-badge {badge_class}'>{badge_text}</span>
                    </div>
                </div>
            """, unsafe_allow_html=True)

            meta = []
            if last_ts:
                meta.append(f"🕐 {last_ts[:16]}")
            meta.append(f"📊 오늘: {today_cnt}건")
            st.caption(f"ID: {rid}  |  " + "  ·  ".join(meta))

            thumb = APP_BASE / "data" / "room_avatars" / f"{rid}.jpg"
            if thumb.exists():
                st.image(str(thumb), use_column_width=True)

            fl = features.get(rid, {})
            c1, c2, c3, c4 = st.columns([1,1,1,1])
            with c1:
                w = st.toggle("환영 메시지", value=bool(fl.get("welcome", False)), key=f"wel_{rid}")
            with c2:
                b = st.toggle("브로드캐스트", value=bool(fl.get("broadcast", False)), key=f"brd_{rid}")
            with c3:
                s = st.toggle("스케줄/알림", value=bool(fl.get("schedules", False)), key=f"sch_{rid}")
            with c4:
                if st.button("저장", key=f"save_{rid}"):
                    features[rid] = {"welcome": w, "broadcast": b, "schedules": s}
                    allowed = sorted([rr for rr, fz in features.items() if any(bool(v) for v in (fz or {}).values())])
                    save_runtime({"safeMode": cfg.get("safeMode", True), "allowedRoomIds": allowed, "features": features})
                    st.success("저장됨")

            st.caption("최근 메시지 (실시간)")
            live_log_widget(room_id=rid, limit=20, include="", exclude="", height=160)

            st.markdown("</div>", unsafe_allow_html=True)
        i += 1

    # Recent Activity (All Rooms) section
    st.markdown("---")
    st.markdown("<div class='section-title'>📊 Recent Activity (All Rooms)</div>", unsafe_allow_html=True)
    live_log_widget(room_id=None, limit=80, include="", exclude="", height=260, interval_ms=1000)
    # 대시보드는 전체 rerun을 사용하지 않음(깜빡임 방지)


def page_templates():
    st.markdown("<div class='page-title'>템플릿 관리</div>", unsafe_allow_html=True)

    # Editor panel first if editing
    if st.session_state.get("edit_template"):
        st.markdown("← Back to Templates", unsafe_allow_html=True)
        if st.button("← Back to Templates", key="back_to_templates"):
            st.session_state.pop("edit_template", None)
            st.rerun()

        tpl_info = st.session_state["edit_template"]
        category = tpl_info.get("category", "welcome")
        name = tpl_info.get("name", "")
        base = APP_BASE / "config" / "templates" / category
        base.mkdir(parents=True, exist_ok=True)
        path = base / f"{name}.json"

        st.markdown(f"## Edit Template: {name}")

        col_left, col_right = st.columns([1, 1])

        with col_left:
            st.markdown("### 템플릿 이름")
            tpl_name = st.text_input("이름", value=name, key=f"name_{name}")

            st.markdown("### 카테고리")
            cat_options = ["자동 응답", "브로드캐스트", "스케줄"]
            cat_map = {"자동 응답": "welcome", "브로드캐스트": "broadcast", "스케줄": "schedule"}
            cat_reverse = {v: k for k, v in cat_map.items()}
            selected_cat = st.selectbox("카테고리", cat_options, index=cat_options.index(cat_reverse.get(category, "자동 응답")), key=f"cat_{name}")

            st.markdown("### 메시지 내용")
            raw = path.read_text(encoding="utf-8") if path.exists() else json.dumps({"title": name, "content": "", "category": category}, ensure_ascii=False, indent=2)
            try:
                tpl_data = json.loads(raw)
            except:
                tpl_data = {"title": name, "content": "", "category": category}

            # Initialize session state for content if not exists
            if f"tpl_content_{name}" not in st.session_state:
                st.session_state[f"tpl_content_{name}"] = tpl_data.get("content", "")

            content = st.text_area("메시지 내용", value=st.session_state[f"tpl_content_{name}"], height=200, key=f"content_area_{name}")
            st.session_state[f"tpl_content_{name}"] = content

            # Character counter
            char_count = len(content)
            char_class = "error" if char_count > 1000 else ("warning" if char_count > 500 else "")
            st.markdown(f"<div class='char-counter {char_class}'>{char_count} / 1000 자</div>", unsafe_allow_html=True)

            st.markdown("### 변수 삽입")
            st.caption("클릭하여 메시지에 변수를 삽입하세요")
            var_cols = st.columns(5)
            vars_list = [
                ("{{userName}}", "사용자명", "👤"),
                ("{{roomName}}", "방이름", "💬"),
                ("{{time}}", "시간", "🕐"),
                ("{{date}}", "날짜", "📅"),
                ("{{memberCount}}", "인원수", "👥")
            ]
            for idx, (var_syntax, var_label, var_icon) in enumerate(vars_list):
                with var_cols[idx]:
                    if st.button(f"{var_icon} {var_label}", key=f"var_{name}_{idx}", use_container_width=True):
                        st.session_state[f"tpl_content_{name}"] = content + var_syntax
                        st.rerun()

        with col_right:
            st.markdown("### 카카오톡 미리보기")
            # 카카오톡 스타일 미리보기
            preview_html = f"""
            <div style="background:#b2c7d9;padding:20px;border-radius:12px;font-family:sans-serif;">
                <div style="text-align:center;color:#555;font-size:12px;margin-bottom:10px;">관리봇</div>
                <div style="background:white;padding:12px 16px;border-radius:8px;box-shadow:0 1px 2px rgba(0,0,0,0.1);margin-bottom:8px;">
                    <div style="color:#333;font-size:14px;line-height:1.5;white-space:pre-wrap;">{content.replace('{{userName}}', 'UserName').replace('{{roomName}}', 'RoomName').replace('{{time}}', '5:09 PM').replace('{{date}}', '2025-11-01').replace('{{memberCount}}', '42')}</div>
                </div>
                <div style="text-align:right;color:#666;font-size:11px;">5:09 PM</div>
                <div style="display:flex;align-items:center;justify-content:flex-end;margin-top:16px;padding:8px;background:#fff;border-radius:8px;">
                    <input type="text" placeholder="메시지를 입력하세요" disabled style="flex:1;border:none;padding:6px;color:#999;" />
                    <span style="margin-left:8px;color:#999;">😊</span>
                    <span style="margin-left:8px;color:#999;">#</span>
                </div>
            </div>
            """
            components.html(preview_html, height=400)

            st.markdown("---")
            st.warning("⚠️ SAFE_MODE: Test Send는 실제로 메시지를 보내지 않습니다. (미리보기만)")

        st.markdown("---")
        cc1, cc2, cc3 = st.columns(3)
        with cc1:
            if st.button("💾 Save", key=f"save_{name}", use_container_width=True):
                new_cat = cat_map[selected_cat]
                new_base = APP_BASE / "config" / "templates" / new_cat
                new_base.mkdir(parents=True, exist_ok=True)
                new_path = new_base / f"{tpl_name}.json"
                tpl_data["title"] = tpl_name
                tpl_data["content"] = content
                tpl_data["category"] = new_cat
                new_path.write_text(json.dumps(tpl_data, ensure_ascii=False, indent=2), encoding="utf-8")
                if new_path != path and path.exists():
                    path.unlink()
                st.success("저장되었습니다")
                st.session_state.pop("edit_template", None)
                st.rerun()
        with cc2:
            if st.button("📤 Test Send", key=f"test_{name}", use_container_width=True):
                st.info("SAFE_MODE: 실제 전송은 비활성화되어 있습니다. 위 미리보기를 확인하세요.")
        with cc3:
            if st.button("❌ Cancel", key=f"cancel_{name}", use_container_width=True):
                st.session_state.pop("edit_template", None)
                st.rerun()
        return

    # Template list view - Improved search and controls
    col1, col2, col3 = st.columns([3, 1, 1])
    with col1:
        query = st.text_input("🔍 검색 템플릿", "", placeholder="Search templates...", label_visibility="collapsed")
    with col2:
        sort_order = st.selectbox("정렬", ["최신순", "이름순"], label_visibility="collapsed")
    with col3:
        if st.button("➕ 새 템플릿", type="primary", use_container_width=True):
            import uuid
            name = f"template_{uuid.uuid4().hex[:6]}"
            base = APP_BASE / "config" / "templates" / "welcome"
            base.mkdir(parents=True, exist_ok=True)
            (base / f"{name}.json").write_text(json.dumps({"title": name, "content": "", "category": "welcome"}, ensure_ascii=False, indent=2), encoding="utf-8")
            st.markdown("<div class='success-box'>✅ 새 템플릿이 생성되었습니다!</div>", unsafe_allow_html=True)
            st.rerun()

    # Category sections with icons
    categories = [
        ("자동 응답", "welcome", ["환영 메시지", "퇴장 메시지"], "👋"),
        ("브로드캐스트", "broadcast", ["공지사항"], "📢"),
        ("스케줄", "schedule", ["일일 요약"], "⏰")
    ]

    for cat_name, cat_key, subcats, cat_icon in categories:
        st.markdown(f"<div class='section-title'>{cat_icon} {cat_name}</div>", unsafe_allow_html=True)
        base = APP_BASE / "config" / "templates" / cat_key
        base.mkdir(parents=True, exist_ok=True)
        files = sorted((p for p in base.glob("*.json")), key=lambda x: x.stat().st_mtime, reverse=(sort_order == "최신순")) if base.exists() else []
        items = [p for p in files if (query.lower() in p.stem.lower())]

        if not items:
            st.markdown(f"<div class='info-box'>💡 아직 {cat_name} 템플릿이 없습니다. 새 템플릿을 만들어보세요!</div>", unsafe_allow_html=True)
            continue

        cols = st.columns(2)
        for idx, p in enumerate(items):
            with cols[idx % 2]:
                try:
                    data = json.loads(p.read_text(encoding="utf-8"))
                    title = data.get("title", p.stem)
                    content_preview = data.get("content", "")[:80]
                    char_count = len(data.get("content", ""))
                except:
                    title = p.stem
                    content_preview = ""
                    char_count = 0

                st.markdown(f"""
                <div class='template-card'>
                    <div class='template-card-header'>
                        <div>
                            <span class='template-icon'>{cat_icon}</span>
                            <strong style='font-size:16px;'>{title}</strong>
                        </div>
                        <span style='font-size:11px;color:#64748b;'>{char_count}자</span>
                    </div>
                    <p style='color:#94a3b8;font-size:13px;margin:8px 0;'>{content_preview}{"..." if len(content_preview) >= 80 else ""}</p>
                </div>
                """, unsafe_allow_html=True)

                c1, c2 = st.columns([1,1])
                with c1:
                    if st.button("✏️ 편집", key=f"edit_{cat_key}_{p.stem}", use_container_width=True):
                        st.session_state["edit_template"] = {"name": p.stem, "category": cat_key}
                        st.rerun()
                with c2:
                    if st.button("🗑️ 삭제", key=f"del_{cat_key}_{p.stem}", use_container_width=True):
                        p.unlink()
                        st.markdown("<div class='success-box'>✅ 템플릿이 삭제되었습니다.</div>", unsafe_allow_html=True)
                        st.rerun()


def page_logs():
    st.subheader("Logs")
    colA, colB, colC = st.columns([1,1,2])
    with colA:
        limit = st.slider("최대 행", min_value=20, max_value=200, value=80, step=10)
    with colB:
        rooms = discover_rooms()
        room_opts = ["(전체)"] + [f"{info.get('roomName')}|{rid}" for rid, info in rooms.items()]
        chosen = st.selectbox("방", room_opts, index=0)
        chosen_id = None if chosen == "(전체)" else chosen.split("|")[-1]
    with colC:
        inc = st.text_input("포함 키워드(공백구분)", value="")
        exc = st.text_input("제외 키워드(공백구분)", value="")

    st.markdown("#### 전체 최근 로그 (실시간)")
    live_log_widget(room_id=chosen_id, limit=limit, include=inc, exclude=exc, height=260, interval_ms=1000)

    sel_room = st.selectbox("방 상세보기", ["(선택)"] + [p.name for p in list_room_dirs()])
    if sel_room != "(선택)":
        lines = tail_room_logs(sel_room, 100)
        st.text("\n".join(lines))

    st.markdown("---")
    st.caption("봇 로그")
    content = ""
    for p in [BOT_LOG_NEW, BOT_LOG]:
        if p.exists():
            content += f"\n==== {p.name} ====\n" + p.read_text(encoding="utf-8", errors="ignore")[-5000:]
    st.text(content or "봇 로그 없음")
    # (no global rerun here; smooth/auto handled above)


def page_global():
    st.subheader("Global Settings")
    cfg = load_runtime()
    safe = st.toggle("SAFE_MODE (모든 전송 차단)", value=bool(cfg.get("safeMode", True)))
    allowed_raw = ",".join(cfg.get("allowedRoomIds", []) or [])
    allowed_edit = st.text_input("허용 방 ID(콤마)", value=allowed_raw)
    if st.button("저장"):
        new_cfg = {"safeMode": safe, "allowedRoomIds": [s.strip() for s in allowed_edit.split(",") if s.strip()], "features": cfg.get("features", {})}
        save_runtime(new_cfg)
        st.success("저장되었습니다")


def page_bot_control():
    st.subheader("봇 제어 (Windows)")
    st.caption("C:\\dev\\node-iris-app 에서 npm start / stop")
    colA, colB, colC, colD = st.columns(4)
    with colA:
        if st.button("봇 실행(Windows)"):
            res = bot_start_windows()
            st.info(res or "STARTED")
    with colB:
        if st.button("봇 중지(Windows)"):
            res = bot_stop_windows()
            st.info(res or "STOPPED")
    with colC:
        if st.button("상태 새로고침"):
            st.session_state["bot_status"] = bot_status_windows()
            st.rerun()
    with colD:
        if st.button("로그 열기(Windows)"):
            ps = "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
            _ps_exec([ps, "-NoProfile", "-Command", "Start-Process notepad.exe C:\\Users\\Public\\node-iris-bot.log"]) 
            st.success("열렸습니다 (notepad)")
    st.markdown("---")
    cur = st.session_state.get("bot_status") or bot_status_windows()
    st.metric("현재 상태", cur)


def main():
    st.set_page_config(page_title="Node-Iris 대시보드", page_icon="🤖", layout="wide")
    render_css()

    with st.sidebar:
        st.title("디하클·카카오봇")
        page = st.radio("", ["Dashboard", "Templates", "Logs", "Global Settings", "Bot Control"], label_visibility="collapsed")
        try:
            st.caption(f"App Path: {(APP_BASE).resolve()}")
            st.caption(f"Logs: {(APP_BASE / 'data' / 'logs').resolve()}")
        except Exception:
            st.caption(f"App Path: {APP_BASE}")

    if page == "Dashboard":
        page_dashboard()
    elif page == "Templates":
        page_templates()
    elif page == "Logs":
        page_logs()
    elif page == "Global Settings":
        page_global()
    elif page == "Bot Control":
        page_bot_control()


if __name__ == "__main__":
    main()
