# CourseOps v2 콘솔(Vercel) 배포 + go.yoorang.kr 연결

이 문서는 `courseops/console/`을 **Vercel 새 프로젝트로 배포**하고,
`go.yoorang.kr` 서브도메인을 연결하는 절차를 정리한다.

> 전제: 카카오/Redroid 수집은 12.kakao(로컬)에서만 수행한다.  
> Vercel에는 “콘솔 UI + API + DB(상태/메모/잡)”만 올린다.

---

## 1) Vercel 프로젝트 생성(새 프로젝트)

1. Vercel → `Add New...` → `Project`
2. Git 저장소 선택(12.kakao)
3. **Root Directory**: `courseops/console`
4. Framework: Next.js(자동 감지)
5. Deploy

---

## 2) 환경 변수(Vercel Project → Settings → Environment Variables)

`courseops/console/.env.example` 기준으로 아래를 설정한다.

- `COURSEOPS_SHARED_PASSWORD`
  - 공용 비밀번호(로그인에 사용)
- `COURSEOPS_ADMIN_NAMES`
  - 새 강의 등록 관리자 이름 목록(콤마로 구분)
- `COURSEOPS_SESSION_SECRET`
  - 세션 서명용 시크릿(길게 랜덤)
- `DATABASE_URL`
  - Postgres 접속 URL
- `GOOGLE_SERVICE_ACCOUNT_JSON`
  - Google Sheets 읽기용 서비스 계정 JSON(문자열 1개)
- `COURSEOPS_AGENT_TOKEN`  
  - 로컬 에이전트 인증 토큰(콘솔/에이전트 동일)

---

## 3) DB 초기화(스키마 생성)

스키마 파일: `courseops/console/sql/schema.sql`

초기화는 아래 중 하나로 수행한다.

### 옵션 A) Supabase CLI로 새 프로젝트 생성(권장)

1. 조직 확인
   - `supabase orgs list`
2. 프로젝트 생성(예: Seoul)
   - `supabase projects create courseops --org-id <ORG_ID> --region ap-northeast-2 --db-password <DB_PASSWORD> --output json --yes`
3. `DATABASE_URL` 준비(Supabase 권장: pooler)
   - 기본(직접): `postgresql://postgres:<DB_PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres`
   - 권장(pooler/서버리스): `postgresql://postgres.<PROJECT_REF>:<DB_PASSWORD>@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?sslmode=require`
   - ⚠️ 일부 환경(IPv6 미지원)에서는 `db.<PROJECT_REF>.supabase.co`가 IPv4(A 레코드)가 없어 연결이 실패할 수 있다.
     이 경우 **pooler**를 사용한다.
4. 스키마 적용
   - `courseops/console`에서 `DATABASE_URL` 설정 후 `npm run db:init`

### 옵션 B) 로컬에서 init 스크립트 실행(권장)

1. `courseops/console`에서 의존성 설치
2. `DATABASE_URL`을 실제 DB로 설정
3. `npm run db:init` 실행

### 옵션 C) DB 콘솔에서 schema.sql 실행

DB 제공자 콘솔(Supabase/Neon/Vercel Postgres 등)에서 `schema.sql` 내용을 실행한다.

---

## 4) go.yoorang.kr 도메인 연결(DNS)

1. Vercel 프로젝트 → Settings → Domains
2. `go.yoorang.kr` 추가
3. Vercel이 보여주는 DNS 안내를 그대로 적용한다.

### 일반적으로(서브도메인) 필요한 DNS 레코드

- 타입: `CNAME`
- Host/Name: `go`
- Value/Target: `cname.vercel-dns.com`

주의:
- `go.yoorang.kr`에 기존 레코드(A/CNAME)가 있으면 충돌할 수 있으니 제거/정리한다.
- 일부 환경에서는 “소유권 확인(TXT)” 레코드가 추가로 필요할 수 있다.  
  → Vercel 화면에 표시된 값을 그대로 추가한다.

---

## 5) 로컬 에이전트 실행(12.kakao PC)

에이전트는 `courseops/agent/`를 사용한다.

필수 환경 변수:
- `COURSEOPS_CONSOLE_BASE_URL=https://go.yoorang.kr`
- `COURSEOPS_AGENT_TOKEN=<콘솔과 동일>`

실행:
- `cd courseops/agent`
- `npm start`

운영에서는 Watchdog/스케줄러로 “항상 떠 있도록” 보장한다.
