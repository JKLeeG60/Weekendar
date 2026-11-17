-- ───────── 처음 사용 안내 (migration_018) ─────────
-- 처음 가입한 사람에게만 사용 안내 카드를 한 번 보여주기 위한 표시.
-- 이미 가입한 사람은 모두 "봤음"으로 두고, 앞으로 가입하는 사람만 false 로 시작한다.
-- 본인 행 수정 권한(profiles_update)은 이미 있다.
alter table public.profiles add column if not exists tutorial_seen boolean not null default false;
update public.profiles set tutorial_seen = true where created_at < now();
