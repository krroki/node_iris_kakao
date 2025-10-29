# Fetch Browser MCP 연동 가이드

이 문서는 무료로 사용할 수 있는 웹 검색 MCP인 `TheSethRose/Fetch-Browser`를 Codex 환경에 연동해 사용하는 방법을 정리한 것입니다. API 키가 필요 없고, 로컬에서 직접 실행하는 구조입니다.

## 1. 저장소 확인
- 저장 위치: `external/fetch-browser/`
- 원본 GitHub: https://github.com/TheSethRose/Fetch-Browser
- 주요 기능
  - Google 검색 결과 수집 (`google_search` 도구)
  - 임의의 URL에서 콘텐츠 추출 (`fetch_url` 도구)
  - 응답 형식: markdown / json / html / text
  - API 키 불필요 (헤드리스 브라우저 방식)

## 2. 로컬 빌드/설치 기록
저장소를 클론한 뒤, 다음 명령으로 의존성을 설치하고 빌드해 두었습니다.

```bash
cd external/fetch-browser
npm install
npm run build   # build/index.js 생성
```

`package.json`의 `build` 스크립트가 실행되면 `build/index.js`에 실행 가능한 MCP 서버 엔트리가 생깁니다.

## 3. Codex MCP 설정
`~/.codex/config.toml`에는 다음 항목이 추가되어 있습니다.

```toml
[mcp_servers.fetch_browser]
command = "node"
args = ["/home/glemfkcl/dev/12.kakao/external/fetch-browser/build/index.js"]
```

추가 환경 변수는 필요 없습니다. MCP 클라이언트를 재시작하면 `fetch_browser` 서버가 활성화됩니다.

## 4. 수동 실행 테스트 (선택)
아래 명령으로 MCP 서버를 수동 실행하면서 로그를 볼 수 있습니다.

```bash
node /home/glemfkcl/dev/12.kakao/external/fetch-browser/build/index.js
```

실행하면 STDIO를 통해 MCP 프로토콜을 기다리는 상태가 되며, `Ctrl+C`로 종료할 수 있습니다.

## 5. 제공 도구
- `google_search`  
  ```json
  {
    "query": "검색어",
    "responseType": "markdown",
    "maxResults": 10,
    "topic": "web"
  }
  ```
- `fetch_url`  
  ```json
  {
    "url": "https://example.com",
    "responseType": "markdown",
    "timeout": 30000
  }
  ```

### 응답 형식
- `markdown`, `json`, `html`, `text` 네 가지 형식 중 선택 가능.
- Google 뉴스 검색 등도 지원 (`topic: "news"`).

## 6. 참고
- README: `external/fetch-browser/readme.md`
- MIT License 기반 무료 사용 가능.
- 이후 의존성을 업데이트하려면 `npm install` 후 `npm run build`를 재실행하면 됩니다.
