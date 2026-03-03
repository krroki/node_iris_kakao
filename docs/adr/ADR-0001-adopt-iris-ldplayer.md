# ADR-0001: LDPlayer + IRIS 채택

## Meta

- **Date**: 2025-10-28
- **Status**: Deprecated (Superseded by ADR-0002)
- **Authors**: 사용자

## Context (배경)

- PC KakaoTalk UI 자동화는 스크롤/OCR 지연과 포커스 문제로 요구사항을 충족하지 못함
- 메시지 이벤트를 안정적으로 수신하고 빠르게 처리할 수 있는 대안이 필요함
- 커뮤니티에서 검증된 방식을 찾아야 함

## Options Considered (고려한 대안)

### Option A: PC KakaoTalk + UIA/OCR
- 설명: Windows UI Automation으로 PC 카카오톡 제어
- 장점: 별도 장치 불필요
- 단점: 스크롤/OCR 지연, 포커스 문제, 불안정

### Option B: LDPlayer + IRIS (선택됨 → 이후 폐기)
- 설명: 안드로이드 에뮬레이터(LDPlayer)에서 IRIS 프레임워크 사용
- 장점: 메시지/입장 이벤트를 문자열로 직접 수신, OCR 불필요
- 단점: 에뮬레이터 환경 제약, API 호환성 문제

## Decision (결정)

**LDPlayer(안드로이드 에뮬레이터) + IRIS 이벤트 프레임워크를 기반으로 모든 카카오톡 자동화를 구현한다.**

> **주의**: 본 결정은 ADR-0002로 대체되었습니다. 아래 내용은 과거 기록으로만 보존합니다.

## Consequences (결과)

### 긍정적 효과
- 메시지·입장 이벤트를 문자열로 직접 수신할 수 있어 OCR 불필요
- 명령어 처리/방송 등 기존 커뮤니티 사례가 풍부 (ponyobot, iris_bot 등)
- 다중 이벤트 스트림을 빠르게 처리, 명령어 응답 지연 수 초 이내

### 부정적 효과 / 리스크
- 에뮬레이터 대비 실제 단말 DB 구조 호환성 낮음
- 네트워크 구성이 실 환경과 상이

### 후속 작업 (폐기됨)
- ~~PC UIA 접근 금지. 관련 스크립트/코드는 제거 대상~~
- ~~LDPlayer/IRIS 설치, 버전 관리, 인스턴스 운영 문서 작성~~
- ~~멀티 인스턴스 전략과 계정 정책 준수 계획 수립~~

## Links

- Superseded by: [ADR-0002](ADR-0002-adopt-rooted-android-hyperv.md)
- 신규 설치 가이드: `docs/setup/iris-hyperv.md`
