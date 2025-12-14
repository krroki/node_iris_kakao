from bs4 import BeautifulSoup, FeatureNotFound
import hashlib
import re


def html_to_text(html: str) -> str:
    # NOTE: lxml이 없을 수 있으므로(특히 Windows 환경) html.parser로 폴백한다.
    try:
        soup = BeautifulSoup(html or "", "lxml")
    except FeatureNotFound:
        soup = BeautifulSoup(html or "", "html.parser")
    # Keep line breaks for block elements
    for br in soup.find_all(["br", "p", "div", "li", "h1", "h2", "h3", "h4"]):
        br.append("\n")
    text = soup.get_text(" ", strip=True)
    # normalize spaces
    text = re.sub(r"[ \t\x0b\x0c\r]+", " ", text)
    text = re.sub(r"\n{2,}", "\n", text)
    return text.strip()


def sha256(s: str) -> str:
    return hashlib.sha256((s or "").encode("utf-8")).hexdigest()


def make_dedup_key(title: str, author: str | None, created_at_iso: str | None, links: list[str] | None) -> str:
    parts = [title or "", author or "", created_at_iso or ""]
    if links:
        parts.extend(sorted(set(links)))
    return sha256("|".join(parts))
