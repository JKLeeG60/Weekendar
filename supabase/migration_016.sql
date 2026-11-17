-- ───────── 사람별 화면 언어 (migration_016) ─────────
-- 앱에서 고른 언어(ko / en)를 저장해 두고, 휴대폰 푸쉬를 그 언어로 보낸다.
-- 비어 있으면 한국어로 보낸다. 본인 행 수정 권한(profiles_update)은 이미 있다.
alter table public.profiles add column if not exists lang text check (lang in ('ko', 'en'));
