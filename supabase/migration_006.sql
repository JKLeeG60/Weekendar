-- Weekendar 마이그레이션 6: 메시지 읽음 확인 (SQL Editor에서 Run)
-- 메시지마다 누가 언제 읽었는지 기록하고, 그 기록은 메시지를 보낸 사람만 볼 수 있다.

create table if not exists public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.message_reads enable row level security;

-- 조회: 그 메시지를 보낸 본인만
drop policy if exists message_reads_select on public.message_reads;
create policy message_reads_select on public.message_reads for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id and m.author_id = auth.uid()));
-- 기록은 아래 함수로만 (직접 insert/update/delete 불가)

-- 내가 읽은 메시지들을 기록 (같은 팀, 남이 보낸 메시지만, 처음 읽은 시각만 남김)
create or replace function public.mark_messages_read(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_active_member() then return; end if;
  insert into public.message_reads (message_id, user_id)
  select m.id, auth.uid() from public.messages m
  where m.id = any(p_ids) and m.team_id = public.my_team_id() and m.author_id <> auth.uid()
  on conflict do nothing;
end $$;
grant execute on function public.mark_messages_read(uuid[]) to authenticated;
