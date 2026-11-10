-- Weekendar 마이그레이션 5: 팀 대화 (SQL Editor에서 Run)
-- 메시지는 같은 팀(승인된 구성원)만 읽고 쓰며, 실시간으로 전달된다.

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 1000),
  mentions uuid[] not null default '{}',
  mention_all boolean not null default false,
  ref jsonb,                         -- 첨부한 일정 요약 (제목, 날짜, 시간, 작성자 이름)
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists messages_team_time_idx on public.messages(team_id, created_at desc);

-- 사람마다 대화를 어디까지 읽었는지
create table if not exists public.chat_reads (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now()
);

-- 승인된(대기 아님) 구성원인지
create or replace function public.is_active_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and role <> 'pending')
$$;

alter table public.messages   enable row level security;
alter table public.chat_reads enable row level security;

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (team_id = public.my_team_id() and public.is_active_member());

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (author_id = auth.uid() and team_id = public.my_team_id() and public.is_active_member() and deleted_at is null);

drop policy if exists chat_reads_all on public.chat_reads;
create policy chat_reads_all on public.chat_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 내 메시지 삭제 (내용을 지우고 '삭제됨' 표시)
create or replace function public.delete_message(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.messages set body = '', ref = null, mentions = '{}', mention_all = false, deleted_at = now()
  where id = p_id and author_id = auth.uid();
  if not found then raise exception '내 메시지만 삭제할 수 있습니다'; end if;
end $$;
grant execute on function public.delete_message(uuid) to authenticated;

-- 실시간 전달 켜기 (이미 켜져 있으면 무시)
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
