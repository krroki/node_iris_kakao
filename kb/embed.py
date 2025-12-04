import os
from typing import List
from tenacity import retry, stop_after_attempt, wait_exponential
from kb.logging_util import get_logger
from pathlib import Path

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

logger = get_logger("kb.embed")


@retry(stop=stop_after_attempt(int(os.getenv("KB_EMBED_RETRY", "2"))), wait=wait_exponential(min=0.5, max=4), reraise=True)
def embed_texts(texts: List[str]) -> List[List[float]]:
    """Return embeddings for a list of texts using provider from env.

    Supported providers:
      - GOOGLE (google-genai): set GOOGLE_API_KEY; model: text-embedding-004
      - OPENAI (openai): set OPENAI_API_KEY; model: text-embedding-3-large
    If neither is configured, returns zero vectors (for local dev).
    """
    provider = os.getenv("EMBED_PROVIDER", "GOOGLE").upper()
    if provider == "GOOGLE":
        _ensure_google_key()
        try:
            from google import genai
        except Exception:  # pragma: no cover
            return [[0.0] * 1536 for _ in texts]
        client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
        logger.info(f"embed {len(texts)} texts via Google")
        out = client.models.embed_content(model="text-embedding-004", contents=texts)
        return [item.values for item in out.embeddings]
    elif provider == "OPENAI":
        try:
            import openai  # type: ignore
        except Exception:  # pragma: no cover
            return [[0.0] * 3072 for _ in texts]
        openai.api_key = os.getenv("OPENAI_API_KEY")
        model = os.getenv("EMBED_MODEL", "text-embedding-3-large")
        logger.info(f"embed {len(texts)} texts via OpenAI model={model}")
        resp = openai.embeddings.create(model=model, input=texts, timeout=int(float(os.getenv("KB_HTTP_TIMEOUT", "6"))) )
        return [d.embedding for d in resp.data]
    else:
        return [[0.0] * 1536 for _ in texts]
