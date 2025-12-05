import os
from pathlib import Path
from typing import List

from tenacity import retry, stop_after_attempt, wait_exponential

from kb.logging_util import get_logger

def _ensure_google_key():
    """Load GOOGLE_API_KEY from local env files as fallback for spawned services."""
    if os.getenv("GOOGLE_API_KEY"):
        return
    for name in (".env.kb", ".env.local", ".env"):
        p = (Path(__file__).resolve().parent.parent / name).resolve()
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("GOOGLE_API_KEY="):
                os.environ["GOOGLE_API_KEY"] = line.split("=", 1)[1].strip()
                return


def _ensure_openai_key():
    """Load OPENAI_API_KEY from local env files if not set."""
    if os.getenv("OPENAI_API_KEY"):
        return
    for name in (".env.kb", ".env.local", ".env"):
        p = (Path(__file__).resolve().parent.parent / name).resolve()
        if not p.exists():
            continue
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("OPENAI_API_KEY="):
                os.environ["OPENAI_API_KEY"] = line.split("=", 1)[1].strip()
                return


logger = get_logger("kb.embed")


@retry(stop=stop_after_attempt(int(os.getenv("KB_EMBED_RETRY", "2"))), wait=wait_exponential(min=0.5, max=4), reraise=True)
def embed_texts(texts: List[str]) -> List[List[float]]:
    """Return embeddings for a list of texts using provider from env.

    Supported providers:
      - GOOGLE (google-genai): set GOOGLE_API_KEY; model: text-embedding-004
      - OPENAI (openai): set OPENAI_API_KEY; model: text-embedding-3-large
    If neither is configured, returns zero vectors (for local dev).
    """
    provider = os.getenv("EMBED_PROVIDER", "OPENAI").upper()
    if provider == "GOOGLE":
        _ensure_google_key()
        try:
            from google import genai
        except Exception as e:  # pragma: no cover
            # 이전에는 침묵하고 0벡터를 반환했지만, 임베딩 품질 문제를 막기 위해 실패 시 바로 예외를 던진다.
            raise RuntimeError("google-genai import failed; 임베딩을 생성할 수 없습니다.") from e
        client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
        logger.info(f"embed {len(texts)} texts via Google")
        # embed_content는 단건 API라 리스트를 직접 순회한다. (batch_embed_contents는 preview라 보수적으로 사용)
        out_vecs: List[List[float]] = []
        for t in texts:
            resp = client.models.embed_content(model="text-embedding-004", contents=t)
            out_vecs.append(resp.embeddings[0].values)
        return out_vecs
    elif provider == "OPENAI":
        _ensure_openai_key()
        try:
            import openai  # type: ignore
        except Exception as e:  # pragma: no cover
            raise RuntimeError("openai 패키지 로드 실패; 임베딩을 생성할 수 없습니다.") from e
        openai.api_key = os.getenv("OPENAI_API_KEY")
        model = os.getenv("EMBED_MODEL", "text-embedding-3-large")
        logger.info(f"embed {len(texts)} texts via OpenAI model={model}")
        resp = openai.embeddings.create(model=model, input=texts, timeout=int(float(os.getenv("KB_HTTP_TIMEOUT", "6"))) )
        return [d.embedding for d in resp.data]
    else:
        return [[0.0] * 1536 for _ in texts]
