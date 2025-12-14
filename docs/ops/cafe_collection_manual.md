# 네이버 카페 수집/메뉴얼 생성 매뉴얼

## 준비

1) 환경변수 설정(로그인 정보)

`config/local.env` 또는 셸 환경에 아래 값을 설정합니다.

```
NAVER_ID=your_id
NAVER_PW=your_password
NAVER_CAFE_ID=29537083
NAVER_MENU_IDS=272,143,369,383
NAVER_MAX_PAGES=5
NAVER_DETAIL_LIMIT=100
```

2) 파이썬/Playwright 설치(필요 시)

```
python3 -m pip install -r requirements.txt  # playwright 포함 시 직접 설치 필요
python3 -m pip install python-dotenv playwright
python3 -m playwright install chromium

선택: 이미지 OCR(코드 이미지 텍스트화)을 사용하려면

Ubuntu/Debian 계열 기준(WSL 포함):

```
sudo apt-get update && sudo apt-get install -y tesseract-ocr tesseract-ocr-eng tesseract-ocr-kor
```

프로젝트 venv에 파이썬 의존성 추가:

```
python3 -m pip install pillow pytesseract
```
```

## 수집 실행

```
python3 scripts/cafe_bulk_collector.py
# 또는 개별 파라미터 사용
python3 scripts/cafe_bulk_collector.py --help
```

실행이 완료되면 `data/naver_cafe/<cafe_id>/menu_<id>/collected.json` 과 이미지(`images/`)가 생성됩니다.

## 메뉴얼(Markdown) 생성

```
python3 scripts/generate_manual_from_cafe.py
```

결과는 `docs/cafe_manuals/` 하위에 `menu_<id>.md` 로 생성되며, `docs/cafe_manuals/README.md`에 인덱스가 갱신됩니다.

## 참고

- 이미지 파일은 접근 권한 문제를 피하기 위해 각 img 요소를 렌더링 기준 스크린샷으로 저장합니다.
- 코드가 이미지로만 제공되는 경우, 생성된 메뉴얼에서 해당 이미지 바로 아래에 OCR/코드 재작성 섹션을 수동으로 추가해 주세요. (자동 OCR은 기본 포함하지 않았지만, `pytesseract`를 추가해 확장 가능합니다.)
