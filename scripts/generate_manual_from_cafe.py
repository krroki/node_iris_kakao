#!/usr/bin/env python3
"""
수집된 카페 데이터(JSON)로 메뉴얼(Markdown) 생성기

입력: data/naver_cafe/<cafe_id>/menu_*/collected.json
출력: docs/cafe_manuals/menu_<id>.md, docs/cafe_manuals/README.md
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import List, Optional, Tuple

# Optional OCR support (Tesseract + pytesseract)
try:
    import pytesseract  # type: ignore
    from PIL import Image  # type: ignore
    _HAS_OCR = True
except Exception:
    _HAS_OCR = False

CAFE_DIR = Path("data/naver_cafe")
OUT_DIR = Path("docs/cafe_manuals")


def fence(text: str, lang: str = "") -> str:
    return f"```{lang}\n{text}\n```\n"


def _ocr_image(p: Path, lang: str = "kor+eng") -> Optional[str]:
    if not _HAS_OCR:
        return None
    try:
        img = Image.open(str(p))
        txt = pytesseract.image_to_string(img, lang=lang)
        if isinstance(txt, str):
            txt = txt.strip()
        return txt or None
    except Exception:
        return None


def _looks_like_code(text: str) -> bool:
    s = text.strip()
    if not s:
        return False
    hits = 0
    for token in ("def ", "class ", "function ", "=>", "{}", "();", ";", "#include", "import ", "const ", "let ", "var ", "public ", "private ", "if (", "for (", "while (", "try:"):
        if token in s:
            hits += 1
    # 간단 휴리스틱: 토큰 2개 이상 또는 코드블록 풍 문자 빈도
    if hits >= 2:
        return True
    braces = sum(1 for c in s if c in "{}<>()[];:/\\")
    return braces >= max(8, len(s) // 20)


def summarize(detail: dict) -> str:
    title = detail.get("title", "(무제)")
    text = (detail.get("content_text") or "").strip()
    # 간단한 코드 감지: ``` 포함 또는 ';', '{', 'def ' 등의 패턴
    has_code = "```" in text or any(k in text for k in ["{", "}", ";", "def ", "function ", "class "])
    lines = [f"## {title}"]
    if text:
        # 너무 길면 앞부분만
        preview = text if len(text) < 1200 else text[:1200] + "\n..."
        lines.append(preview)
    if has_code:
        # 코드 fence로 감싸기(간단 추정)
        lines.append("\n(코드가 포함된 것으로 감지되었습니다.)\n")
    imgs: List[str] = detail.get("images") or []
    if imgs:
        lines.append("\n### 이미지\n")
        for p in imgs:
            rel = Path(p)
            if not rel.is_absolute():
                rel = Path("../../") / rel
            lines.append(f"![image]({rel.as_posix()})")
            # OCR 텍스트 추출(가능한 경우)
            ocr_txt = _ocr_image(Path(p))
            if ocr_txt:
                if _looks_like_code(ocr_txt):
                    lines.append("\n#### OCR 코드 추출\n")
                    lines.append(fence(ocr_txt, ""))
                else:
                    lines.append("\n#### OCR 텍스트\n")
                    lines.append(ocr_txt)
    return "\n\n".join(lines) + "\n\n"


def build_menu_md(cafe_id: str, menu_dir: Path) -> Path:
    data = json.loads((menu_dir / "collected.json").read_text(encoding="utf-8"))
    menu_id = data.get("menu_id")
    details = data.get("details") or []
    md_lines = [f"# 메뉴 {menu_id} 수집 요약", ""]
    for d in details:
        md_lines.append(summarize(d))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / f"menu_{menu_id}.md"
    out_path.write_text("\n".join(md_lines), encoding="utf-8")
    return out_path


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    index_lines = ["# 네이버 카페 메뉴얼(수집본)", ""]
    for cafe_dir in CAFE_DIR.glob("*"):
        if not cafe_dir.is_dir():
            continue
        for menu_dir in sorted(cafe_dir.glob("menu_*")):
            cj = menu_dir / "collected.json"
            if not cj.exists():
                continue
            md = build_menu_md(cafe_dir.name, menu_dir)
            index_lines.append(f"- [{menu_dir.name}]({md.as_posix()})")
    (OUT_DIR / "README.md").write_text("\n".join(index_lines) + "\n", encoding="utf-8")
    print("[INFO] 메뉴얼 생성 완료:", OUT_DIR)


if __name__ == "__main__":
    main()
