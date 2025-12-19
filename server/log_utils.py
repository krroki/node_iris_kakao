from __future__ import annotations

import json
import os
from datetime import datetime, timezone
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
# Allow overriding the app base (useful when the repository is mirrored on Windows)
import os as _os
_override = _os.environ.get("IRIS_APP_BASE")
APP_BASE = Path(_override) if _override else (ROOT / "node-iris-app")
DEFAULT_LOGS_DIR = APP_BASE / "data" / "logs"
AVATAR_DIR = APP_BASE / "data" / "room_avatars"
RUNTIME_JSON = APP_BASE / "config" / "runtime.json"
TEMPLATES_BASE = APP_BASE / "config" / "templates"


def get_logs_dir() -> Path:
    p = os.environ.get("IRIS_LOGS_DIR", "").strip()
    if p:
        cand = Path(p)
        if cand.exists():
            return cand
    return DEFAULT_LOGS_DIR


def parse_line(line: str):
    try:
        obj = json.loads(line)
        snap = obj.get("snapshot", {})
        payload = obj.get("payload", {}) if isinstance(obj, dict) else {}
        # Skip debug records to avoid duplicate-like entries in UI feeds
        ptype0 = str(payload.get("type") or "")
        if ptype0 == "message_debug":
            return None
        sender_name = snap.get("senderName") or str(snap.get("senderId"))
        text = snap.get("messageText")
        if not isinstance(text, str):
            text = ""

        # Special: render welcome test dry-run records in UI logs
        if ptype0 in ("welcome_test_dry_run", "welcome_test_dry_run_failed"):
            try:
                reason = str(payload.get("reason") or "").strip()
                tpl = str(payload.get("template") or "").strip()
                nick = str(payload.get("nicknameClass") or "").strip()
                source = str(payload.get("source") or "").strip()
                set_key = str(payload.get("setKey") or "").strip()
                pick = str(payload.get("pick") or "").strip()
                imgs = payload.get("images")
                img_count = len(imgs) if isinstance(imgs, list) else 0

                parts = ["welcome:test"]
                if reason:
                    parts.append(f"DRY_RUN:{reason}")
                if tpl:
                    parts.append(f"tpl={tpl}")
                if nick:
                    parts.append(f"nick={nick}")
                if source:
                    parts.append(f"src={source}")
                if set_key:
                    parts.append(f"set={set_key}")
                if pick:
                    parts.append(f"pick={pick}")
                if img_count:
                    parts.append(f"images={img_count}")

                header = "[" + "][".join(parts) + "]"
                if ptype0 == "welcome_test_dry_run":
                    body = payload.get("text")
                    if isinstance(body, str) and body.strip():
                        text = header + "\n" + body
                    else:
                        text = header
                else:
                    err = str(payload.get("error") or "").strip()
                    text = header + (f"\nERROR: {err}" if err else "")
            except Exception:
                pass
        mentions: list[str] = []
        if text in (None, "", "[object Object]"):
            ptxt = payload.get("text") if isinstance(payload, dict) else None
            rawjson = payload.get("rawJson") if isinstance(payload, dict) else None
            # If we have structured rawJson, prefer extracting from it
            if isinstance(rawjson, dict):
                try:
                    if isinstance(rawjson.get('msg'), str) and rawjson.get('msg') and rawjson.get('msg') != '[object Object]':
                        text = rawjson.get('msg')
                    elif isinstance(rawjson.get('display_original'), str) and rawjson.get('display_original'):
                        text = rawjson.get('display_original')
                    elif isinstance(rawjson.get('text'), str) and rawjson.get('text'):
                        text = rawjson.get('text')
                    elif isinstance(rawjson.get('segments'), list) and rawjson.get('segments'):
                        parts = []
                        for s in rawjson.get('segments'):
                            t = ''
                            if isinstance(s, dict):
                                stype = str(s.get('type') or '').lower()
                                if stype == 'mention':
                                    name = s.get('name') or s.get('at') or s.get('text')
                                    if isinstance(name, str) and name.strip():
                                        val = name.strip()
                                        if val not in mentions:
                                            mentions.append(val)
                                if isinstance(s.get('text'), str) and s.get('text'):
                                    t = s.get('text')
                                elif isinstance(s.get('at'), str) and s.get('at'):
                                    t = '@' + s.get('at')
                                elif isinstance(s.get('name'), str) and s.get('name'):
                                    t = '@' + s.get('name')
                            if t: parts.append(t)
                        if parts:
                            text = ''.join(parts)
                except Exception:
                    pass
                # Attachment-based heuristics (photo/video/emoji, etc.)
                try:
                    att = rawjson.get('attachment') if isinstance(rawjson, dict) else None
                    if isinstance(att, dict) and (not text or text.strip() == "" or text == "[object Object]"):
                        if 'imageUrls' in att or str(att.get('type','')).lower() in ('image','photo','27'):
                            text = '사진'
                        elif 'videoUrls' in att or str(att.get('type','')).lower() in ('video','movie','30'):
                            text = '동영상'
                        elif 'miniemoticon' in att or str(att.get('type','')).lower() in ('miniemoticon','emoji'):
                            text = '이모티콘'
                except Exception:
                    pass
            if isinstance(ptxt, str) and ptxt.strip() and ptxt.strip() != "[object Object]":
                text = ptxt.strip()
            elif isinstance(payload.get("raw"), str) and payload.get("raw").strip():
                raw = payload.get("raw").strip()
                # Try to extract msg=... from raw dump like: Message(id=..., type=1, msg=...)
                m = re.search(r"msg=(?:\"([^\"]*)\"|([^,\)]*))", raw)
                if m:
                    text = (m.group(1) or m.group(2) or "").strip()
                else:
                    text = raw
            ptype = str(payload.get("type") or "")
            if ptype in ("join", "leave"):
                text = f"{ptype.upper()}: {sender_name}".strip()
            # If still empty, try non-rawJson attachment heuristic
            if (not text or text.strip()=="") and isinstance(payload, dict):
                try:
                    att2 = payload.get('attachment')
                    if isinstance(att2, dict):
                        if 'imageUrls' in att2:
                            text = '사진'
                        elif 'videoUrls' in att2:
                            text = '동영상'
                except Exception:
                    pass
        # Always attempt to extract mentions from rawJson (even if text is already present)
        try:
            rawjson2 = payload.get("rawJson") if isinstance(payload, dict) else None
            if isinstance(rawjson2, dict):
                # segments
                if isinstance(rawjson2.get('segments'), list):
                    for s in rawjson2.get('segments'):
                        if isinstance(s, dict):
                            stype = str(s.get('type') or '').lower()
                            if stype == 'mention':
                                name = s.get('name') or s.get('at') or s.get('text')
                                if isinstance(name, (str, int)):
                                    val = str(name).strip()
                                    if val and val not in mentions:
                                        mentions.append(val)
                # mentions array
                if isinstance(rawjson2.get('mentions'), list):
                    for m in rawjson2.get('mentions'):
                        if isinstance(m, dict):
                            cand = m.get('text') or m.get('at') or m.get('id')
                            if isinstance(cand, (str, int)):
                                val = str(cand).strip()
                                if val and val not in mentions:
                                    mentions.append(val)
                # attachment.mentions (seen on Kakao payloads)
                if not mentions:
                    att = rawjson2.get('attachment')
                    if isinstance(att, dict) and isinstance(att.get('mentions'), list) and att.get('mentions'):
                        # Heuristic: extract phrases between '@' markers as display names
                        # 예: "@노래하는 춘식이 @박스에 들어간 춘식이"
                        #  -> ["노래하는 춘식이", "박스에 들어간 춘식이"]
                        try:
                            pattern = r"@([^@]+?)(?=@|$)"
                            for m in re.finditer(pattern, text or '' or ''):
                                val = (m.group(1) or '').strip()
                                if not val:
                                    continue
                                # 너무 긴 꼬리를 줄이기 위해 첫 번째 개행/강한 구두점 이전까지만 사용
                                val = re.split(r'[\\n!?]', val, maxsplit=1)[0].strip()
                                if val and val not in mentions:
                                    mentions.append(val)
                        except Exception:
                            pass
        except Exception:
            pass
        # Build a stable UID for deduplication across transports/UI merges
        try:
            rawjson_id = None
            try:
                rj = payload.get("rawJson") if isinstance(payload, dict) else None
                if isinstance(rj, dict) and rj.get("id") is not None:
                    rawjson_id = str(rj.get("id"))
            except Exception:
                rawjson_id = None
            rid = str(snap.get("roomId"))
            mid = str(snap.get("messageId")) if snap.get("messageId") is not None else ""
            sender_id = str(snap.get("senderId")) if snap.get("senderId") is not None else ""
            norm_text = re.sub(r"\s+", " ", str(text or "")).strip()
            if rawjson_id:
                uid = f"m:{rawjson_id}"
            elif mid:
                uid = f"m:{mid}"
            else:
                # Fallback: text-based fingerprint (room+sender+text)
                uid = f"t:{rid}|{sender_id or sender_name}|{norm_text}"
        except Exception:
            uid = None

        image_urls = None
        try:
            # Expose minimal image data to SSE consumers (feature workers)
            # while keeping payload small.
            rawjson3 = payload.get("rawJson") if isinstance(payload, dict) else None
            if isinstance(rawjson3, dict):
                att3 = rawjson3.get("attachment")
                if isinstance(att3, dict):
                    iu = att3.get("imageUrls")
                    if isinstance(iu, list):
                        image_urls = [str(x).strip() for x in iu if str(x).strip()]
                    elif isinstance(iu, str) and iu.strip():
                        image_urls = [iu.strip()]
            if not image_urls and isinstance(payload, dict):
                att4 = payload.get("attachment")
                if isinstance(att4, dict):
                    iu2 = att4.get("imageUrls")
                    if isinstance(iu2, list):
                        image_urls = [str(x).strip() for x in iu2 if str(x).strip()]
                    elif isinstance(iu2, str) and iu2.strip():
                        image_urls = [iu2.strip()]
                    # IRIS message payloads often store a single image URL under `attachment.url`/`thumbnailUrl`.
                    # Expose it as imageUrls=[...] so announcement/broadcast workers can forward media.
                    if not image_urls:
                        cand: list[str] = []
                        # Prefer the original URL. Only fall back to thumbnail when original is missing.
                        primary: list[str] = []
                        fallback: list[str] = []
                        for key in ("url", "originalUrl", "original_url"):
                            v = att4.get(key)
                            if isinstance(v, str) and v.strip():
                                primary.append(v.strip())
                        if not primary:
                            for key in ("thumbnailUrl", "thumbnail_url"):
                                v = att4.get(key)
                                if isinstance(v, str) and v.strip():
                                    fallback.append(v.strip())
                        cand.extend(primary if primary else fallback)
                        for key in ("urls", "urlList", "imageUrlList", "imageURLs"):
                            v = att4.get(key)
                            if isinstance(v, list):
                                for x in v:
                                    s = str(x).strip()
                                    if s:
                                        cand.append(s)
                        if cand:
                            # keep order + dedupe + cap (avoid large SSE payloads)
                            seen: set[str] = set()
                            out_urls: list[str] = []
                            for u in cand:
                                if u in seen:
                                    continue
                                seen.add(u)
                                out_urls.append(u)
                                if len(out_urls) >= 10:
                                    break
                            # Drop thumbnail variants if we have at least one non-thumbnail URL.
                            if len(out_urls) > 1:
                                non_thumb = [u for u in out_urls if "convert=resize" not in u]
                                if non_thumb:
                                    out_urls = non_thumb
                            image_urls = out_urls if out_urls else None
        except Exception:
            image_urls = None

        out = {
            "ts": obj.get("timestamp"),
            "roomId": str(snap.get("roomId")),
            "roomName": snap.get("roomName") or str(snap.get("roomId")),
            "sender": sender_name,
            "senderId": str(snap.get("senderId") or ""),
            "senderName": snap.get("senderName") or sender_name,
            "text": text,
            "mid": snap.get("messageId"),
            "payloadType": ptype0,
            "messageType": payload.get("messageType") if isinstance(payload, dict) else None,
            # welcome-worker가 join 배치 구성을 할 수 있도록, member_joined 이벤트에는 entrants를 함께 노출한다.
            "entrants": payload.get("entrants") if (ptype0 == "member_joined" and isinstance(payload, dict)) else None,
            "mentions": mentions,
            "uid": uid,
        }
        if image_urls:
            out["imageUrls"] = image_urls
        return out
    except Exception:
        return None


def ts_to_ms(ts: str) -> int:
    try:
        dt = datetime.fromisoformat((ts or '').replace('Z', '+00:00'))
        return int(dt.timestamp() * 1000)
    except Exception:
        return 0


def list_room_dirs():
    logs_dir = get_logs_dir()
    if logs_dir.exists():
        return sorted([p for p in logs_dir.iterdir() if p.is_dir()])
    return []


def list_rooms():
    """Return list of rooms with id and best-effort name (from last line)."""
    rooms = []
    logs_dir = get_logs_dir()
    for d in list_room_dirs():
        rid = d.name
        name = rid
        files = sorted((logs_dir / rid).glob("*.log"))
        # 로그 파일이 없는(빈) 디렉터리는 UI에서 노이즈이므로 숨긴다.
        if not files:
            continue
        if files:
            try:
                lines = files[-1].read_text(encoding="utf-8", errors="ignore").splitlines()
                if lines:
                    obj = json.loads(lines[-1])
                    snap = obj.get("snapshot", {}) if isinstance(obj, dict) else {}
                    name = snap.get("roomName") or rid
            except Exception:
                pass
        rooms.append({"roomId": rid, "roomName": name})
    return rooms


def find_avatar_path(room_id: str) -> Path | None:
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)
    for ext in (".jpg", ".jpeg", ".png", ".webp"):
        p = AVATAR_DIR / f"{room_id}{ext}"
        if p.exists():
            return p
    return None


def load_runtime() -> dict:
    if RUNTIME_JSON.exists():
        try:
            data = json.loads(RUNTIME_JSON.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                data = {}
        except Exception:
            data = {}
    else:
        data = {}
    data.setdefault("safeMode", True)
    data.setdefault("allowedRoomIds", [])
    data.setdefault("excludedRoomIds", [])
    data.setdefault("features", {})
    data.setdefault("welcomeTemplateName", "default")
    # New style: feature → template name mapping
    tbf = data.get("templateByFeature")
    if not isinstance(tbf, dict):
        tbf = {}
    # Backward compatibility: mirror legacy welcomeTemplateName
    if "welcome" not in tbf and isinstance(data.get("welcomeTemplateName"), str):
        tbf["welcome"] = data.get("welcomeTemplateName")
    data["templateByFeature"] = tbf

    # course ops (legacy roster-worker send gate)
    co = data.get("courseOps")
    if not isinstance(co, dict):
        co = {}
    if not isinstance(co.get("sendEnabled"), bool):
        co["sendEnabled"] = False
    data["courseOps"] = co
    return data


def save_runtime(cfg: dict) -> None:
    RUNTIME_JSON.parent.mkdir(parents=True, exist_ok=True)
    RUNTIME_JSON.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")


# Templates helpers
def list_templates(category: str | None = None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    base = TEMPLATES_BASE
    if category:
        cats = [category]
    else:
        cats = [p.name for p in base.glob('*') if p.is_dir()]
    for cat in cats:
        cdir = base / cat
        if not cdir.exists():
            continue
        for p in cdir.glob('*.json'):
            try:
                data = json.loads(p.read_text(encoding='utf-8'))
            except Exception:
                data = {"title": p.stem, "content": "", "category": cat}
            out.append({
                "category": cat,
                "name": p.stem,
                "title": data.get("title") or p.stem,
            })
    out.sort(key=lambda x: (x.get('category',''), x.get('name','')))
    return out


def load_template(category: str, name: str) -> dict:
    p = TEMPLATES_BASE / category / f"{name}.json"
    if not p.exists():
        raise FileNotFoundError
    try:
        data = json.loads(p.read_text(encoding='utf-8'))
    except Exception:
        data = {"title": name, "content": "", "category": category}
    # normalize
    data.setdefault("title", name)
    data.setdefault("content", "")
    data.setdefault("category", category)
    data.setdefault("images", [])
    data.setdefault("mentions", [])
    return data


def save_template(category: str, name: str, data: dict) -> dict:
    cdir = TEMPLATES_BASE / category
    cdir.mkdir(parents=True, exist_ok=True)
    data = dict(data)
    data.setdefault("title", name)
    data.setdefault("content", "")
    data["category"] = category
    if not isinstance(data.get("images"), list):
        data["images"] = []
    if not isinstance(data.get("mentions"), list):
        data["mentions"] = []
    p = cdir / f"{name}.json"
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    return data


def delete_template(category: str, name: str) -> None:
    p = TEMPLATES_BASE / category / f"{name}.json"
    if p.exists():
        p.unlink()


def assets_dir_for(category: str, name: str) -> Path:
    return TEMPLATES_BASE / category / "assets" / name


def tail_room(room_id: str, limit: int):
    logs_dir = get_logs_dir()
    d = logs_dir / str(room_id)
    files = sorted(d.glob("*.log"))
    if not files:
        return []
    last = files[-1]
    try:
        lines = last.read_text(encoding="utf-8", errors="ignore").splitlines()
        out = []
        seen_mid: set[str] = set()
        last_time_key: dict[tuple[str, str], int] = {}
        DEDUP_WINDOW_MS = 2000
        # 최근 24시간 이내만 보여주기 위한 컷오프
        now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
        cutoff_ms = now_ms - 24 * 60 * 60 * 1000
        for ln in lines[-max(limit, 1) * 20:]:
            rec = parse_line(ln)
            if rec:
                # 24시간보다 오래된 레코드는 UI에 노출하지 않는다.
                tms = ts_to_ms(rec.get("ts") or "")
                if tms and tms < cutoff_ms:
                    continue
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
    # truncate/dedup
    out = []
    seen_mid: set[str] = set()
    last_time_key: dict[tuple[str, str], int] = {}
    DEDUP_WINDOW_MS = 2000
    now_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    cutoff_ms = now_ms - 24 * 60 * 60 * 1000
    for r in items:
        tms = ts_to_ms(r.get('ts') or '')
        if tms and tms < cutoff_ms:
            continue
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


def apply_keyword_filter(entries: list[dict], inc: list[str], exc: list[str], limit: int) -> list[dict]:
    out: list[dict] = []
    for r in entries:
        blob = (str(r.get('roomName', '')) + ' ' + str(r.get('sender', '')) + ' ' + str(r.get('text', ''))).lower()
        if inc and not any(k in blob for k in inc):
            continue
        if exc and any(k in blob for k in exc):
            continue
        out.append(r)
        if len(out) >= limit:
            break
    return out


def tail_bulk(room_ids: list[str], limit: int) -> dict[str, list[dict[str, Any]]]:
    result: dict[str, list[dict[str, Any]]] = {}
    for rid in room_ids:
        rid_str = str(rid).strip()
        if not rid_str:
            continue
        result[rid_str] = tail_room(rid_str, limit)
    return result
