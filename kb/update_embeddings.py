from __future__ import annotations

import os
from typing import List, Tuple

from sqlalchemy import text
from kb.db import db_session
from kb.embed import embed_texts
from kb.jobs import start, finish


def _fetch_missing(kind: str, limit: int = 512) -> List[Tuple[int, str]]:
    with db_session() as s:
        if kind == "post":
            rows = s.execute(text(
                """
                SELECT p.post_id AS id, COALESCE(p.title,'') || '\n' || COALESCE(p.norm_text,'') AS text
                FROM sources_post p
                WHERE p.status = 'clean'
                AND NOT EXISTS (
                  SELECT 1 FROM embeddings e WHERE e.obj_type='post' AND e.obj_id=p.post_id
                )
                ORDER BY p.created_at DESC NULLS LAST
                LIMIT :lim
                """
            ), {"lim": limit}).fetchall()
        else:
            rows = s.execute(text(
                """
                SELECT m.doc_id AS id, COALESCE(m.title,'') || '\n' || COALESCE(m.summary,'') || '\n' || COALESCE(m.body_md,'') AS text
                FROM manual_doc m
                WHERE NOT EXISTS (
                  SELECT 1 FROM embeddings e WHERE e.obj_type='manual' AND e.obj_id=m.doc_id
                )
                ORDER BY m.updated_at DESC NULLS LAST
                LIMIT :lim
                """
            ), {"lim": limit}).fetchall()
    return [(r.id, r.text) for r in rows]


def _insert_embeddings(kind: str, ids: List[int], vecs: List[List[float]], model: str):
    dim = len(vecs[0]) if vecs else 0
    with db_session() as s:
        for obj_id, vec in zip(ids, vecs):
            s.execute(text(
                """
                INSERT INTO embeddings (obj_type, obj_id, model, dim, vec)
                VALUES (:t, :id, :m, :d, :v)
                ON CONFLICT (obj_type, obj_id) DO UPDATE SET
                  model=EXCLUDED.model, dim=EXCLUDED.dim, vec=EXCLUDED.vec, updated_at=now()
                """
            ), {"t": kind, "id": obj_id, "m": model, "d": dim, "v": vec})


def _chunk_text(text: str, max_chars: int = 800, overlap: int = 80) -> List[str]:
    """Lightweight chunker to avoid huge prompts; no extra deps."""
    t = text or ""
    if len(t) <= max_chars:
        return [t]
    out: List[str] = []
    start = 0
    while start < len(t):
        end = min(len(t), start + max_chars)
        out.append(t[start:end])
        if end >= len(t):
            break
        start = end - overlap
    return out


def run(kind: str):
    jid = start(f"embed_{kind}")
    try:
        provider = os.getenv("EMBED_PROVIDER", "GOOGLE").upper()
        model = os.getenv("EMBED_MODEL", "text-embedding-004" if provider == "GOOGLE" else "text-embedding-3-large")
        max_chars = int(os.getenv("KB_EMBED_MAX_CHARS", "800"))
        overlap = max(40, max_chars // 10)
        total = 0
        while True:
            batch = _fetch_missing(kind, limit=256)
            if not batch:
                break
            ids: List[int] = []
            vecs: List[List[float]] = []
            for obj_id, text_val in batch:
                chunks = _chunk_text(text_val, max_chars=max_chars, overlap=overlap)
                emb_chunks = embed_texts(chunks)
                if not emb_chunks:
                    continue
                avg = [sum(col) / len(emb_chunks) for col in zip(*emb_chunks)]
                ids.append(obj_id)
                vecs.append(avg)
            if ids:
                _insert_embeddings(kind, ids, vecs, model)
                total += len(ids)
                print(f"[emb] upserted {len(ids)} {kind} embeddings (dim={len(vecs[0]) if vecs else 0})")
        finish(jid, "done", {"upserted": total, "kind": kind, "model": model, "provider": provider})
        if total == 0:
            print(f"[emb] no missing {kind}")
        else:
            print(f"[emb] total upserted {total} {kind}")
    except Exception as e:  # pragma: no cover
        finish(jid, "error", {"error": str(e), "kind": kind})
        raise


if __name__ == "__main__":
    run("manual")
    run("post")
