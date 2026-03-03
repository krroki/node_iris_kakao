#!/usr/bin/env python3
"""List available Gemini models for the current API key.

Usage:
  GEMINI_API_KEY=... python3 scripts/list_gemini_models.py
  # or the runner will try config/gemini.key automatically
"""
from __future__ import annotations

import os

API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    # try config/gemini.key
    try:
        with open("config/gemini.key", "r", encoding="utf-8") as f:
            API_KEY = f.readline().strip()
    except Exception:
        API_KEY = None

if not API_KEY:
    raise SystemExit("GEMINI_API_KEY가 없습니다. 환경변수 또는 config/gemini.key를 설정하세요.")

models = []
errors = []

try:
    from google import genai as genai_new
    client = genai_new.Client(api_key=API_KEY)
    try:
        for m in client.models.list():
            name = getattr(m, "name", None) or getattr(m, "model", None) or str(m)
            models.append(str(name))
    except Exception as e:
        errors.append(f"new-sdk: {e}")
except Exception as e:
    errors.append(f"new-sdk import: {e}")

if not models:
    try:
        import google.generativeai as genai
        genai.configure(api_key=API_KEY)
        try:
            # older SDK: use list_models()
            for m in genai.list_models():
                name = getattr(m, "name", None) or str(m)
                models.append(str(name))
        except Exception as e:
            errors.append(f"legacy-sdk: {e}")
    except Exception as e:
        errors.append(f"legacy-sdk import: {e}")

if models:
    print("[사용 가능한 모델 목록]")
    for n in models:
        print("-", n)
else:
    print("[오류] 모델 목록을 가져오지 못했습니다.")
    for em in errors:
        print(" ", em)

