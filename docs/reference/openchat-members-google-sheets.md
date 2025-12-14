# 오픈채팅 멤버(닉네임) Google Sheets 업서트

## 목표

IRIS DB에 로딩된 오픈채팅 멤버 목록(`db2.open_chat_member`)을 Google Sheets에 **upsert**한다.

---

## 1) 완전성(“하나도 빠짐없이”)에 대한 현실적인 제약

- 멤버 목록의 단일 소스는 IRIS DB의 `db2.open_chat_member`이다.
- 대형 방은 **단말(카카오톡 앱)에서 ‘멤버 목록’을 열고 스크롤**을 해야 `open_chat_member`가 충분히 채워질 수 있다.
- 따라서 “DB에 아직 로딩되지 않은 멤버”는 기술적으로 업서트할 수 없다.

이 프로젝트는 **폴백 금지** 원칙을 따르므로,
`loadedMembersCount < activeMembersCount`이면 기본 동작은 **즉시 실패(중단)**한다.

---

## 2) 사전 준비(멤버 DB 채우기)

1) 멤버 DB 강제 로딩(송신 없음)

`pwsh scripts/openchat_load_members.ps1 -RoomId <ROOM_ID> -Scrolls 600`

2) 로딩 상태 확인

- 대시보드(3100) 방 카드의 “멤버 보기”에서 `DB N명 / 실시간 N명` 비교
- 또는 스냅샷 저장: `python scripts/iris_members_snapshot.py --rooms <ROOM_ID> --output logs/analysis/iris_members_snapshot.json`

---

## 3) Google Sheets 업서트(서비스 계정 권장)

### 3.1) 왜 API key만으로는 안 되는가?

Google Sheets “쓰기”는 OAuth2가 필요하다.  
API key는 주로 **공개 데이터 읽기**에만 쓰이며, 업서트(쓰기)는 불가하다.

### 3.2) 서비스 계정 준비

1) GCP에서 Service Account 생성
2) JSON 키 파일 다운로드
3) 스프레드시트 문서에 **서비스 계정 이메일을 Editor로 공유**
4) JSON 키 파일 경로를 환경변수로 지정
   - `GOOGLE_APPLICATION_CREDENTIALS=C:\dev\12.kakao\data\gcp_service_account.json`

> `data/`는 gitignore에 포함되어 있어 키 파일이 실수로 커밋되는 것을 방지한다.
>
> 편의: 키 파일을 `data/gcp_service_account.json`에 두면, 스크립트가 기본값으로 자동 사용한다(별도 env 없이도 동작).

### 3.3) (권장) 시트 타겟 “1회 등록”(로컬 config)

매번 `--spreadsheet-id`를 입력하기 싫다면, 로컬 config를 1회 저장해둔다.

- 저장 위치(기본): `data/openchat_members_sheets.json` (gitignore)
- 등록 명령:
  - `python scripts/sync_openchat_members_to_sheets.py --init-config --spreadsheet-id <SHEET_ID_OR_URL> --sheet-name members`

이후에는 `--room-id`만으로 실행 가능하다.

### 3.4) 실행

1) 1회성 실행(인자 지정):

`python scripts/sync_openchat_members_to_sheets.py --room-id <ROOM_ID> --spreadsheet-id <SHEET_ID_OR_URL> --sheet-name members`

2) 등록 후 실행(로컬 config 사용):

`python scripts/sync_openchat_members_to_sheets.py --room-id <ROOM_ID>`

기본 업서트 스키마(헤더):
- `roomId`, `roomName`, `userId`, `nickname`
- `linkId`, `memberType`, `profileType`, `linkMemberType`, `profileLinkId`
- `privilege`, `report`, `enc`
- `profileImageUrl`, `fullProfileImageUrl`, `originalProfileImageUrl`
- `updatedAt`

---

## 4) 관련 파일

- 스크롤 로딩: `scripts/openchat_load_members.ps1`
- 스냅샷: `scripts/iris_members_snapshot.py`
- 업서트: `scripts/sync_openchat_members_to_sheets.py`
- 명령어 인덱스(SSOT): `docs/reference/verification-commands.md`
