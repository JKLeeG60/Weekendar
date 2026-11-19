-- migration_025: 이번 주 목표 + 월요일 "이번 주 시작" 카드
-- Supabase SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전합니다.

-- ① 이번 주 목표: 할 일과는 따로 저장한다 (넘기기 설정과 무관하게 그 주에만 보임)
--    week = 그 주의 월요일 날짜. 한 주에 목표는 하나. 본인만 읽고 쓴다 (팀원에게는 보이지 않음).
create table if not exists public.week_goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  week date not null,
  title text not null check (char_length(title) between 1 and 100),
  done boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner_id, week)
);
alter table public.week_goals enable row level security;
drop policy if exists week_goals_own on public.week_goals;
create policy week_goals_own on public.week_goals for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ② "이번 주 시작" 카드를 마지막으로 보여준 주(그 주의 월요일). 같은 주에는 다시 띄우지 않는다.
--    본인 행 수정 권한(profiles_update)은 이미 있다.
alter table public.profiles add column if not exists week_card_seen date;

-- 목표가 바뀌면 PC와 폰 화면에 바로 반영되게 (이미 켜져 있으면 무시)
do $$ begin
  alter publication supabase_realtime add table public.week_goals;
exception when duplicate_object then null; end $$;
