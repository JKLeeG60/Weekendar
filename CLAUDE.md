# Weekendar — Claude Code 작업 안내

팀의 주간 일정(월~금)을 한 표에서 공유하는 웹앱. 개인 일정·할 일, 팀 대화, 팀장 동의제, 휴대폰 알림까지 포함.
배포: https://weekendar-eight.vercel.app (체험 모드: 주소 뒤에 `?demo`)

## 반드시 지킬 작업 규칙
1. **git 명령 실행 금지** (add / commit / push / reset / checkout 등). 필요하면 명령어만 제시하고, 사용자가 동의한 뒤에 실행한다.
2. **테스트를 통과시키려고 테스트 코드나 기대값을 바꾸지 않는다.** 실패하면 원인을 먼저 보고하고, 새 기능을 추가하기 전에 반드시 먼저 물어본다.
3. **요청받지 않은 파일의 리팩터링·포맷 변경 금지.**
4. 코드를 고치기 전에 **무엇을 어떻게 바꿀지 3~5줄로 먼저 설명**한다.
5. 제안할 때는 **프로그래밍 초보자도 이해하기 쉽게** 배경과 기능을 5~10줄 이내로 설명한다.
6. 작업이 끝나면 **바뀐 화면을 PNG 그림(스크린샷)으로 보여 준다.** UI 변경은 가능하면 전·후 비교로.
7. 비밀값(Supabase secret / service_role 키, DB 비밀번호, 구글 Client Secret, VAPID 비공개 키, PUSH_SECRET)은 **요청하거나 화면에 출력하지 않는다.** 공개 값(프로젝트 URL, publishable key, VAPID 공개 키)은 괜찮다.
8. 사용자에게는 한국어로, 쉬운 말로 답한다. 코드 주석도 한국어.

## 기술 구성
- **앱:** Vite + React 19 + TypeScript (strict, noUnusedLocals). 글꼴은 Pretendard(npm, 자체 호스팅).
- **서버/DB:** Supabase (서울 리전) — RLS + security definer 함수(RPC) + Realtime. Google 로그인.
- **배포:** Vercel. main 브랜치에 푸쉬하면 자동 배포.
- **Vercel 함수 (`api/`):**
  - `ics.ts` 캘린더 구독 피드 (`/cal/:token` → `/api/ics`)
  - `invite.ts` 초대 링크 미리보기 카드 (`/join/:code` → `/api/invite`)
  - `push.ts` 휴대폰 푸쉬 발송 (Supabase 트리거·pg_cron 이 호출)
- **Vercel 환경 변수(이름만):** `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `PUSH_SECRET`

## 폴더 구조
- `src/lib/store.tsx` — **체험 모드** 저장소(localStorage `weekendar-v1`). 저장소 인터페이스(`Store`)도 여기 정의.
- `src/lib/cloud.tsx` — **실서비스** 저장소(Supabase). `store.tsx` 와 같은 인터페이스를 구현.
  → 기능을 추가할 때는 **두 저장소를 모두** 고쳐야 한다.
- `src/lib/` — `types.ts`(데이터 타입), `events.ts`(반복·여러 날 일정 계산), `date.ts`(날짜·한국 공휴일), `ui.tsx`(화면 상태·모달·테마), `push.ts`(PWA·푸쉬), `invite.ts`, `ics.ts`, `chat.ts`
- `src/components/` — `TeamTable`(팀 주간표), `PersonalPanel`(내 일정·할 일), `Modals`(입력·상세·팀 관리 등), `Header`, `Mobile`(모바일 4탭), `Chat`, `Notifications`, `Onboarding`(로그인·팀 선택)
- `public/` — `sw.js`(서비스워커), `manifest.webmanifest`, `icons/`, `og-image.png`
- `supabase/` — `schema.sql`(전체) + `migration_NNN.sql`(변경분)

## DB 변경 규칙
- DB를 바꿀 때는 새 `supabase/migration_NNN.sql` 을 만들고, 같은 내용을 `schema.sql` 끝에도 덧붙인다.
- SQL은 **사용자가 Supabase SQL Editor에서 직접 실행**한다. 실행 전에 앱이 배포되면 오류가 나므로 **SQL 실행 → 커밋** 순서로 안내한다.
- 실행한 마이그레이션: 002, 003, 005~009, 011~013 (014는 실행 여부 확인 필요, 004는 없음, 010은 미배포 구글 캘린더 기능용으로 비워 둠)

## 주의할 점
- 한국 공휴일 규칙이 `src/lib/date.ts` 와 `api/push.ts` **두 곳**에 있다. 공휴일을 바꾸면 둘 다 고친다.
- 반복 일정은 공휴일에 건너뛴다. 여러 날 일정(`endDate`)은 종일 일정이며 반복·알림이 없다.
- 한글 입력(IME) 중 상태 저장으로 글자가 끊기지 않도록, 입력칸은 입력이 끝날 때(blur/Enter) 저장한다.
- 디자인은 애플 스타일(차분한 색, iOS 캘린더 같은 입력창). 데스크톱이 기본, 모바일은 적응형(`[data-mobile='true']`, `.m-app`).
- 홈 화면 앱(PWA)에서는 iOS 상단 흐림 효과가 있어 `@media (display-mode: standalone)` 에서 상단 여백을 더 준다.

## 자주 쓰는 명령
```bash
npm install        # 처음 한 번
npm run dev        # 개발 서버 (http://localhost:5173/?demo 로 체험 모드)
npm run build      # 타입 검사 + 빌드 (커밋 전에 확인)
```
