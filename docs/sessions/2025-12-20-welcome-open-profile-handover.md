# 2025-12-20 Welcome 오픈프로필 닫기/프로필 변경 확인 핸드오프

## 배경(SSOT)

- 결정 문서: `docs/adr/ADR-0045-welcome-open-profile-guide-first-image-no-reminders.md`
- 설정(SSOT): `node-iris-app/config/runtime.json` → `welcome.openProfileCloseGuide`

## 목표(정확한 동작 정의)

- 입장 시
  - Welcome 텍스트 + 하트스샷 가이드 이미지(1장) 발신
  - 오픈프로필 닫기 안내는 “입장 직후” 발신 금지(첫 이미지 트리거에서만)
- 첫 이미지 업로드(입장 후 15분 내) 시
  - 오픈프로필(닫기 안내 대상)이면
    - “오픈프로필 닫기 안내(멘션 텍스트 + 가이드 이미지 1장)” 발신
    - 닫힘 확인(폴링) 후 “확인 멘션” 1회 발신
  - 오픈프로필이 아니면
    - “감사합니다 …” Reply(type=26) 1회 발신
- 프로필 닫힘 확인 시(확인 멘션)
  - 닉네임이 카카오 기본닉이면 `confirmTextKakaoDefaultNickname`(“마지막으로 닉네임 변경만…”) 사용
  - 기본닉이 아니면 `welcome.followUp.replies[0]`(감사 멘트) 우선, 없으면 `confirmText` 사용

## 발견된 문제 & 조치(2025-12-21 반영)

1) **재입장 시 “오픈프로필 닫기 안내”가 스킵되는 문제**
- 원인: `OPEN_PROFILE_GUIDE_DEDUP`가 `roomId:userId`(24h)로 묶여, 같은 날 재입장 후 첫 이미지에서도 “이미 안내함”으로 처리됨
- 조치: dedup key를 **join 세션 기준(`roomId:userId:joinedAt`)** 으로 변경
  - 파일: `node-iris-app/src/workers/welcome_worker.ts`

2) **프로필 변경 감지 후 기본닉 분기(confirmTextKakaoDefaultNickname)가 누락되는 케이스**
- 원인: 확인(폴링) 시점에 DB nickname이 불안정/지연/깨짐인 경우가 있어, “현재 닉네임이 기본닉인지” 판별이 실패할 수 있음
- 조치: `feedType=2`(프로필 변경) 이벤트의 `nickName`으로 pending confirmation의 `userName`을 갱신한 뒤 즉시 확인 로직을 재실행
  - 파일: `node-iris-app/src/workers/welcome_worker.ts`
  - 추가 보강: IRIS `open_chat_member`를 `involved_chat_id`/`link_id`로 모두 조회한 뒤 `_id`가 가장 큰 row를 사용하도록 수정(최신 닉네임 반영률 개선)

## 운영 검증(테스트방에서만)

- Talk-API(멘션/Reply) 검증:
  - `python scripts/verify_talkapi_auth_candidates.py --chat-id <테스트방> --confirm-send --auth-header-file data/talkapi_auth.txt --apply-runtime`
- 오픈프로필 안내/확인 검증:
  - 테스트방에서 “오픈프로필 상태”로 재입장 → 첫 이미지 업로드
  - “닫기 안내”가 발신되는지 확인
  - 프로필을 닫은 뒤, 닉네임이 기본닉이면 “마지막으로 닉네임 변경만…” 멘트가 나오는지 확인
  - 닉네임이 기본닉이 아니면 “감사합니다 …” 멘트가 나오는지 확인
