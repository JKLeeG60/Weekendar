-- ───────── 설정: 못 끝낸 할 일을 다음 날로 넘기기 (migration_019) ─────────
-- 계정마다 저장한다 (PC와 휴대폰이 같은 설정). 기본은 켜짐 = 지금까지와 같은 동작.
-- 본인 행 수정 권한(profiles_update)은 이미 있다.
alter table public.profiles add column if not exists todo_carry boolean not null default true;
