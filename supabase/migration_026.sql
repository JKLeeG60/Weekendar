-- migration_026: 날짜별 메모 (마크다운, 본인만 보기)
-- Supabase SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전합니다.

create table if not exists public.memos (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  body text not null default '' check (char_length(body) <= 20000),
  updated_at timestamptz not null default now(),
  primary key (owner_id, date)
);

-- 본인만 읽고 쓰기 (팀원에게 노출되지 않음)
alter table public.memos enable row level security;
drop policy if exists memos_own on public.memos;
create policy memos_own on public.memos for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
