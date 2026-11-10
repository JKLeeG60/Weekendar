# Weekendar

팀 주간예정사항 공유 + 개인 일정/To-do 웹앱 (PC 모니터 전용).

## 실행
```bash
npm install
npm run dev      # 개발 서버
npm run build    # 타입 체크 + 프로덕션 빌드
```
- 현재는 **브라우저 localStorage** 에 저장되는 체험 모드입니다. 첫 화면의 "데모 계정"으로 관리자/팀장/팀원 화면을 전환해볼 수 있습니다.
- 주소 뒤에 `?reset` 을 붙이면 데이터가 초기화됩니다. (`?date=2026-10-07` 로 특정 주를 바로 열 수 있음)

## 구조
- `src/lib/store.tsx` 데이터 계층. 이 파일의 액션 시그니처를 유지한 채 내부를 Supabase 호출로 바꾸면 화면 코드는 그대로 동작합니다.
- `src/lib/date.ts` 날짜/공휴일(임시 샘플) 유틸. 정식 출시 전에 공휴일 데이터를 교체하세요.
- `src/components/` 화면: Onboarding(로그인·팀 선택), TeamTable(팀 주간표), PersonalPanel(개인 일정·To-do), Modals(일정/요청/팀 관리), Notifications

## 다음 단계 (Supabase 연결 시)
1. Google 로그인 → `login()` 대체
2. 테이블/RLS 생성 (기획안 5장 참고): todos 는 owner 만 접근, events 는 공유 ON 만 팀에 노출
3. 요청 수락(`decideRequest`)은 서버 함수(RPC)로 처리
4. Pretendard 폰트는 CDN 대신 자체 호스팅 권장
