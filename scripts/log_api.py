#!/usr/bin/env python3
import json
import os
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
APP_BASE = ROOT / "node-iris-app"
LOGS_DIR = APP_BASE / "data" / "logs"

def parse_line(line: str):
    try:
        obj = json.loads(line)
        snap = obj.get("snapshot", {})
        return {
            "ts": obj.get("timestamp"),
            "roomId": str(snap.get("roomId")),
            "roomName": snap.get("roomName") or str(snap.get("roomId")),
            "sender": snap.get("senderName") or str(snap.get("senderId")),
            "text": snap.get("messageText"),
            "mid": snap.get("messageId"),
        }
    except Exception:
        return None

def ts_to_ms(ts: str) -> int:
    try:
        # 2025-11-01T10:15:42.219Z -> aware datetime
        dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
        return int(dt.timestamp() * 1000)
    except Exception:
        return 0

def list_room_dirs():
    if LOGS_DIR.exists():
        return sorted([p for p in LOGS_DIR.iterdir() if p.is_dir()])
    return []

def tail_room(room_id: str, limit: int):
    d = LOGS_DIR / str(room_id)
    files = sorted(d.glob("*.log"))
    if not files:
        return []
    last = files[-1]
    try:
        lines = last.read_text(encoding="utf-8", errors="ignore").splitlines()
        out = []
        seen_mid = set()
        last_time_key = {}  # (sender,text) -> last_ms
        DEDUP_WINDOW_MS = 2000
        for ln in lines[-max(limit, 1)*20:]:  # read more slack to coalesce
            rec = parse_line(ln)
            if rec:
                mid = rec.get('mid')
                if mid:
                    if mid in seen_mid:
                        continue
                    seen_mid.add(mid)
                    out.append(rec)
                    continue
                sender = str(rec.get('sender'))
                text = str(rec.get('text'))
                tms = ts_to_ms(rec.get('ts') or '')
                lt = last_time_key.get((sender, text))
                if lt is not None and abs(tms - lt) <= DEDUP_WINDOW_MS:
                    # consider it duplicate burst
                    continue
                last_time_key[(sender, text)] = tms
                out.append(rec)
        return out[-limit:]
    except Exception:
        return []

def tail_all(limit: int):
    items = []
    for d in list_room_dirs():
        rid = d.name
        items.extend(tail_room(rid, limit))
    items.sort(key=lambda o: o.get("ts") or "", reverse=True)
    # de-dup again across merged list (mid or time window per sender/text)
    seen_mid = set()
    last_time_key = {}
    out = []
    DEDUP_WINDOW_MS = 2000
    for r in items:
        mid = r.get('mid')
        if mid:
            if mid in seen_mid:
                continue
            seen_mid.add(mid)
            out.append(r)
            continue
        sender = str(r.get('sender'))
        text = str(r.get('text'))
        tms = ts_to_ms(r.get('ts') or '')
        lt = last_time_key.get((sender, text))
        if lt is not None and abs(tms - lt) <= DEDUP_WINDOW_MS:
            continue
        last_time_key[(sender, text)] = tms
        out.append(r)
        if len(out) >= limit:
            break
    return out

class Handler(BaseHTTPRequestHandler):
    def _set_headers(self, code=200):
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path not in ('/logs', '/logs/'): 
            self._set_headers(404)
            self.wfile.write(b'{"error":"not_found"}')
            return
        qs = parse_qs(parsed.query)
        limit = int(qs.get('limit', ['80'])[0])
        room_id = qs.get('roomId', [None])[0]
        include_kw = qs.get('include', [''])[0].lower().strip()
        exclude_kw = qs.get('exclude', [''])[0].lower().strip()
        if room_id:
            recs = tail_room(room_id, limit*2)
        else:
            recs = tail_all(limit*2)
        # filter
        inc = [s for s in include_kw.split() if s]
        exc = [s for s in exclude_kw.split() if s]
        out = []
        for r in recs:
            blob = (str(r.get('roomName','')) + ' ' + str(r.get('sender','')) + ' ' + str(r.get('text',''))).lower()
            if inc and not any(k in blob for k in inc):
                continue
            if exc and any(k in blob for k in exc):
                continue
            out.append(r)
            if len(out) >= limit:
                break
        self._set_headers(200)
        self.wfile.write(json.dumps(out, ensure_ascii=False).encode('utf-8'))

def main():
    host = '127.0.0.1'
    port = int(os.environ.get('LOG_API_PORT', '8510'))
    httpd = HTTPServer((host, port), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()

if __name__ == '__main__':
    main()
