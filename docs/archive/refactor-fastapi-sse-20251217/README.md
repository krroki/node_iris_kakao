# archive/refactor-fastapi-sse-20251217 (로컬 태그 아카이브)

이 디렉터리는 과거 로컬 브랜치 `refactor/fastapi-sse`의 tip(태그 `archive/refactor-fastapi-sse-20251217`)을
**원격에 안전하게 보관**하기 위한 “텍스트 아카이브”입니다.

## 왜 이런 아카이브가 필요한가?

- 해당 태그가 가리키는 커밋 히스토리에는 `logs/*.log`, `frida-server`, `*.apk`, `venv`, `db.sqlite` 같은 **100MB 초과 파일**이 포함되어 있었습니다.
- GitHub는 100MB 초과 blob을 푸시할 수 없으므로, 태그/브랜치를 그대로 원격에 올리면 pre-receive에서 거부됩니다.

따라서 이 아카이브는 “대용량/로컬 산출물/비밀값”을 제외하고,
코드/문서 변경만 패치 형태로 저장합니다.

## 구성

- `commits.oneline.txt` / `commits.full.txt`
  - `main..archive/refactor-fastapi-sse-20251217` 범위의 커밋 목록
- `patches/*.patch`
  - 위 범위의 변경을 **코드/문서 위주**로 `git format-patch`로 만든 패치
  - 생성 시 아래를 제외합니다:
    - `web/.next*`, `web/node_modules`, `web/test-results`
    - `kb/db.sqlite`
    - 템플릿 이미지 assets(`**/assets/**`, `*.png/*.jpg/*.jpeg`)

## 복원 방법(참고)

별도 클론/워크트리에서 이 패치들을 적용하려면:

```bash
git apply docs/archive/refactor-fastapi-sse-20251217/patches/*.patch
```

> 주의: 이 아카이브는 “대용량 파일/산출물”을 의도적으로 제외했으므로,
> 원본 브랜치를 1:1로 재구성하는 목적이 아니라 **코드/문서 변경 보관**이 목적입니다.
