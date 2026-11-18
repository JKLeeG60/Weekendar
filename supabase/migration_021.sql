-- ───────── 설정: 내 단축키 (migration_021) ─────────
-- 바꾼 단축키만 저장 (예: {"chat":"KeyK"}). 비어 있으면 기본 단축키. 본인 행 수정 권한은 이미 있다.
alter table public.profiles add column if not exists shortcuts jsonb not null default '{}'::jsonb;
