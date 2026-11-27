-- migration_039: 팀 주간표에 토·일 표시 (관리자가 팀 관리에서 켜고 끔)
-- · 팀 정보 수정 권한(관리자)은 이미 있어서 열 하나만 추가한다.
alter table public.teams add column if not exists show_weekend boolean not null default false;
