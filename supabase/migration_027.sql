-- migration_027: 대화 공지(대화방마다 1개) + 예약 보내기
-- Supabase SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전합니다.

-- ───────── 1) 대화 공지 ─────────
-- scope: 'team' (팀 대화) | 'dm:<작은 id>:<큰 id>' (1:1) | 'room:<방 id>' (그룹 대화)
create table if not exists public.chat_pins (
  team_id uuid not null references public.teams(id) on delete cascade,
  scope text not null,
  message_id uuid not null references public.messages(id) on delete cascade,
  body text not null default '' check (char_length(body) <= 1000),   -- 오래돼서 안 불러온 메시지도 띠에 보이게 내용을 함께 저장
  author_id uuid references public.profiles(id) on delete set null,   -- 원래 글쓴이
  pinned_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  pinned_at timestamptz not null default now(),
  primary key (team_id, scope)
);

-- 이 대화를 볼 수 있는 사람인지 (팀 대화: 팀원 / 1:1: 두 사람 / 그룹: 방 사람)
create or replace function public.can_see_chat_scope(p_scope text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_scope = 'team' then true
    when p_scope like 'dm:%' then auth.uid()::text in (split_part(p_scope, ':', 2), split_part(p_scope, ':', 3))
    when p_scope like 'room:%' then public.is_room_member(substr(p_scope, 6)::uuid)
    else false
  end
$$;

alter table public.chat_pins enable row level security;
drop policy if exists chat_pins_select on public.chat_pins;
create policy chat_pins_select on public.chat_pins for select to authenticated
  using (team_id = public.my_team_id() and public.is_active_member() and public.can_see_chat_scope(scope));
-- 등록·바꾸기·내리기: 그 대화를 볼 수 있는 사람 누구나
drop policy if exists chat_pins_insert on public.chat_pins;
create policy chat_pins_insert on public.chat_pins for insert to authenticated
  with check (team_id = public.my_team_id() and public.is_active_member() and public.can_see_chat_scope(scope) and pinned_by = auth.uid()
    and exists (select 1 from public.messages m where m.id = message_id and m.team_id = chat_pins.team_id and m.deleted_at is null));
drop policy if exists chat_pins_update on public.chat_pins;
create policy chat_pins_update on public.chat_pins for update to authenticated
  using (team_id = public.my_team_id() and public.is_active_member() and public.can_see_chat_scope(scope))
  with check (team_id = public.my_team_id() and public.can_see_chat_scope(scope) and pinned_by = auth.uid()
    and exists (select 1 from public.messages m where m.id = message_id and m.team_id = chat_pins.team_id and m.deleted_at is null));
drop policy if exists chat_pins_delete on public.chat_pins;
create policy chat_pins_delete on public.chat_pins for delete to authenticated
  using (team_id = public.my_team_id() and public.is_active_member() and public.can_see_chat_scope(scope));

-- 공지로 올린 메시지를 지우면 공지도 내린다
create or replace function private.on_message_unpin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.deleted_at is not null and old.deleted_at is null then
    delete from public.chat_pins where message_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists messages_unpin on public.messages;
create trigger messages_unpin after update of deleted_at on public.messages for each row execute function private.on_message_unpin();

-- 다른 사람 화면에도 바로 보이게
do $$ begin
  alter publication supabase_realtime add table public.chat_pins;
exception when duplicate_object then null; end $$;

-- ───────── 2) 예약 보내기 ─────────
-- 보낼 때까지는 쓴 사람만 볼 수 있고, 시간이 되면 서버가 실제 메시지로 옮긴다 (1분마다)
create table if not exists public.scheduled_messages (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  recipient_id uuid references public.profiles(id) on delete cascade,   -- 1:1 상대
  room_id uuid references public.chat_rooms(id) on delete cascade,      -- 그룹 대화방
  body text not null check (char_length(body) between 1 and 1000),
  mentions uuid[] not null default '{}',
  mention_all boolean not null default false,
  reply_to uuid references public.messages(id) on delete set null,
  send_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists scheduled_messages_due_idx on public.scheduled_messages(send_at);

alter table public.scheduled_messages enable row level security;
-- 본인 것만 보고, 고치고, 취소
drop policy if exists scheduled_own_select on public.scheduled_messages;
create policy scheduled_own_select on public.scheduled_messages for select to authenticated using (author_id = auth.uid());
drop policy if exists scheduled_own_delete on public.scheduled_messages;
create policy scheduled_own_delete on public.scheduled_messages for delete to authenticated using (author_id = auth.uid());
-- 만들기·시간 바꾸기: 보통 메시지를 보낼 수 있는 곳에만, 지금 이후 1년 안
drop policy if exists scheduled_own_insert on public.scheduled_messages;
create policy scheduled_own_insert on public.scheduled_messages for insert to authenticated
  with check (
    author_id = auth.uid() and team_id = public.my_team_id() and public.is_active_member()
    and send_at > now() and send_at < now() + interval '366 days'
    and (room_id is null or (recipient_id is null and public.is_room_member(room_id)))
    and (recipient_id is null or (recipient_id <> auth.uid() and public.is_teammate(recipient_id)))
  );
drop policy if exists scheduled_own_update on public.scheduled_messages;
create policy scheduled_own_update on public.scheduled_messages for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid() and send_at > now() - interval '1 minute' and send_at < now() + interval '366 days');

-- 시간이 된 예약을 실제 메시지로 (그사이 팀·방을 나갔거나 상대가 팀을 떠났으면 보내지 않고 지움)
create or replace function private.send_scheduled_messages() returns void
language plpgsql security definer set search_path = public as $$
begin
  with due as (
    delete from public.scheduled_messages where send_at <= now() returning *
  )
  insert into public.messages (team_id, author_id, recipient_id, room_id, body, mentions, mention_all, reply_to)
  select d.team_id, d.author_id, d.recipient_id, d.room_id, d.body, d.mentions, d.mention_all, d.reply_to
  from due d
  where exists (select 1 from public.members m where m.user_id = d.author_id and m.team_id = d.team_id and m.role <> 'pending')
    and (d.room_id is null or exists (select 1 from public.chat_room_members r where r.room_id = d.room_id and r.user_id = d.author_id))
    and (d.recipient_id is null or exists (select 1 from public.members m where m.user_id = d.recipient_id and m.team_id = d.team_id and m.role <> 'pending'));
end $$;

-- 1분마다 실행 (같은 이름이면 덮어씀)
select cron.schedule('weekendar-scheduled-send', '* * * * *', $job$select private.send_scheduled_messages()$job$);

-- 내 화면의 '예약된 메시지' 목록이 보내지는 순간 바로 줄어들게
do $$ begin
  alter publication supabase_realtime add table public.scheduled_messages;
exception when duplicate_object then null; end $$;
