-- ───────── 1:1 대화 (migration_015) ─────────
-- 팀 대화 메시지에 "받는 사람"을 두면 그 두 사람만 보는 1:1 대화가 된다.
-- 팀장·관리자도 남의 1:1 대화는 볼 수 없다.

-- 받는 사람 (비어 있으면 팀 대화)
alter table public.messages add column if not exists recipient_id uuid references public.profiles(id) on delete cascade;
create index if not exists messages_dm_idx on public.messages(recipient_id, created_at desc) where recipient_id is not null;

-- 같은 팀의 승인된 구성원인지
create or replace function public.is_teammate(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = p_user and team_id = public.my_team_id() and role <> 'pending')
$$;

-- 읽기: 팀 대화는 팀 모두, 1:1 대화는 보낸 사람과 받는 사람만
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (
    team_id = public.my_team_id() and public.is_active_member()
    and (recipient_id is null or author_id = auth.uid() or recipient_id = auth.uid())
  );

-- 쓰기: 1:1 대화는 같은 팀의 다른 구성원에게만
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (
    author_id = auth.uid() and team_id = public.my_team_id() and public.is_active_member() and deleted_at is null
    and (recipient_id is null or (recipient_id <> auth.uid() and public.is_teammate(recipient_id)))
  );

-- 1:1 대화를 상대별로 어디까지 읽었는지
create table if not exists public.dm_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  peer_id uuid not null references public.profiles(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, peer_id)
);
alter table public.dm_reads enable row level security;
drop policy if exists dm_reads_all on public.dm_reads;
create policy dm_reads_all on public.dm_reads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 읽음 기록: 1:1 대화는 받는 사람만 기록할 수 있게
create or replace function public.mark_messages_read(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_active_member() then return; end if;
  insert into public.message_reads (message_id, user_id)
  select m.id, auth.uid() from public.messages m
  where m.id = any(p_ids) and m.team_id = public.my_team_id() and m.author_id <> auth.uid()
    and (m.recipient_id is null or m.recipient_id = auth.uid())
  on conflict do nothing;
end $$;
grant execute on function public.mark_messages_read(uuid[]) to authenticated;

-- 팀을 나가거나 삭제되면 1:1 읽은 위치도 정리
create or replace function private.on_member_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.dm_reads where user_id = old.user_id or peer_id = old.user_id;
  return old;
end $$;
drop trigger if exists members_gone_dm on public.members;
create trigger members_gone_dm after delete on public.members for each row execute function private.on_member_gone();

-- 휴대폰 알림: @호출 또는 1:1 메시지면 보낸다
create or replace function private.on_message_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.recipient_id is not null or new.mention_all or coalesce(array_length(new.mentions, 1), 0) > 0 then
    perform private.push_call(jsonb_build_object('kind', 'message', 'id', new.id));
  end if;
  return new;
end $$;
