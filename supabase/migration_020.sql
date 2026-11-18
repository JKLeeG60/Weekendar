-- ───────── 그룹 대화 (migration_020) ─────────
-- 1:1 대화에 사람을 더하면 새 "대화방"이 생긴다 (원래 1:1 대화는 그대로).
-- 대화방 메시지는 그 방 사람만, 그것도 들어온 뒤의 메시지만 볼 수 있다. 팀장·관리자도 예외 없음.

create table if not exists public.chat_rooms (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.chat_room_members (
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create index if not exists chat_room_members_user_idx on public.chat_room_members(user_id);

-- 메시지: 대화방, 시스템 안내(초대·나가기) 표시
alter table public.messages add column if not exists room_id uuid references public.chat_rooms(id) on delete cascade;
alter table public.messages add column if not exists system boolean not null default false;
create index if not exists messages_room_idx on public.messages(room_id, created_at desc) where room_id is not null;

-- 내가 그 방 사람인지 (규칙 안에서 쓰려고 security definer)
create or replace function public.is_room_member(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_room_members where room_id = p_room and user_id = auth.uid())
$$;
-- 내가 그 방에 들어온 시각 (그 전 메시지는 안 보인다)
create or replace function public.room_joined_at(p_room uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select joined_at from public.chat_room_members where room_id = p_room and user_id = auth.uid()
$$;

alter table public.chat_rooms enable row level security;
alter table public.chat_room_members enable row level security;
drop policy if exists chat_rooms_select on public.chat_rooms;
create policy chat_rooms_select on public.chat_rooms for select to authenticated
  using (public.is_room_member(id));
drop policy if exists chat_room_members_select on public.chat_room_members;
create policy chat_room_members_select on public.chat_room_members for select to authenticated
  using (public.is_room_member(room_id));
-- 방 만들기·초대·나가기·읽음은 아래 함수로만

-- 읽기: 팀 대화는 팀 모두, 1:1은 두 사람, 대화방은 들어온 뒤의 그 방 사람
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (
    team_id = public.my_team_id() and public.is_active_member()
    and (
      case
        when room_id is not null then created_at >= public.room_joined_at(room_id)
        when recipient_id is not null then author_id = auth.uid() or recipient_id = auth.uid()
        else true
      end
    )
  );

-- 쓰기: 대화방은 그 방 사람만, 시스템 안내는 직접 쓸 수 없음
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (
    author_id = auth.uid() and team_id = public.my_team_id() and public.is_active_member() and deleted_at is null
    and not system
    and (room_id is null or (recipient_id is null and public.is_room_member(room_id)))
    and (recipient_id is null or (recipient_id <> auth.uid() and public.is_teammate(recipient_id)))
  );

-- 이름 목록 "박서준님, 최유리님"
create or replace function private.names_of(p_ids uuid[]) returns text
language sql stable security definer set search_path = public as $$
  select string_agg(coalesce(nullif(p.name, ''), p.email) || '님', ', ' order by array_position(p_ids, p.id))
  from public.profiles p where p.id = any(p_ids)
$$;

-- 방 만들기: 나 + 고른 사람(2명 이상). 방 id 를 돌려준다
create or replace function public.create_room(p_members uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_room uuid;
  v_ids uuid[];
begin
  if auth.uid() is null or not public.is_active_member() then raise exception '팀 구성원만 대화방을 만들 수 있습니다'; end if;
  select array_agg(distinct x) into v_ids from unnest(p_members) x where x <> auth.uid();
  if coalesce(array_length(v_ids, 1), 0) < 2 then raise exception '두 명 이상을 골라 주세요'; end if;
  if exists (select 1 from unnest(v_ids) x where not public.is_teammate(x)) then raise exception '같은 팀 구성원만 초대할 수 있습니다'; end if;
  insert into public.chat_rooms (team_id, created_by) values (public.my_team_id(), auth.uid()) returning id into v_room;
  insert into public.chat_room_members (room_id, user_id) select v_room, x from unnest(array_prepend(auth.uid(), v_ids)) x;
  insert into public.messages (team_id, author_id, room_id, system, body)
  values (public.my_team_id(), auth.uid(), v_room, true, private.names_of(array[auth.uid()]) || '이 ' || private.names_of(v_ids) || '을 초대했어요');
  return v_room;
end $$;
grant execute on function public.create_room(uuid[]) to authenticated;

-- 초대: 방 사람이 같은 팀 구성원을 더한다 (들어온 사람은 그 뒤의 대화만 봄)
create or replace function public.invite_to_room(p_room uuid, p_members uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  if not public.is_room_member(p_room) then raise exception '대화방 사람만 초대할 수 있습니다'; end if;
  select array_agg(distinct x) into v_ids from unnest(p_members) x
  where not exists (select 1 from public.chat_room_members where room_id = p_room and user_id = x);
  if coalesce(array_length(v_ids, 1), 0) = 0 then return; end if;
  if exists (select 1 from unnest(v_ids) x where not public.is_teammate(x)) then raise exception '같은 팀 구성원만 초대할 수 있습니다'; end if;
  insert into public.chat_room_members (room_id, user_id) select p_room, x from unnest(v_ids) x;
  insert into public.messages (team_id, author_id, room_id, system, body)
  values (public.my_team_id(), auth.uid(), p_room, true, private.names_of(array[auth.uid()]) || '이 ' || private.names_of(v_ids) || '을 초대했어요');
end $$;
grant execute on function public.invite_to_room(uuid, uuid[]) to authenticated;

-- 나가기: 방에 "○○님이 나갔어요"를 남기고, 마지막 사람이 나가면 방을 지운다
create or replace function public.leave_room(p_room uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_room_member(p_room) then return; end if;
  delete from public.chat_room_members where room_id = p_room and user_id = auth.uid();
  if not exists (select 1 from public.chat_room_members where room_id = p_room) then
    delete from public.chat_rooms where id = p_room;
  else
    insert into public.messages (team_id, author_id, room_id, system, body)
    select r.team_id, auth.uid(), p_room, true, private.names_of(array[auth.uid()]) || '이 나갔어요' from public.chat_rooms r where r.id = p_room;
  end if;
end $$;
grant execute on function public.leave_room(uuid) to authenticated;

-- 대화방을 어디까지 읽었는지
create or replace function public.mark_room_read(p_room uuid) returns void
language sql security definer set search_path = public as $$
  update public.chat_room_members set last_read_at = now() where room_id = p_room and user_id = auth.uid()
$$;
grant execute on function public.mark_room_read(uuid) to authenticated;

-- 읽음 기록: 대화방 메시지는 그 방 사람만
create or replace function public.mark_messages_read(p_ids uuid[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_active_member() then return; end if;
  insert into public.message_reads (message_id, user_id)
  select m.id, auth.uid() from public.messages m
  where m.id = any(p_ids) and m.team_id = public.my_team_id() and m.author_id <> auth.uid() and not m.system
    and (m.recipient_id is null or m.recipient_id = auth.uid())
    and (m.room_id is null or public.is_room_member(m.room_id))
  on conflict do nothing;
end $$;
grant execute on function public.mark_messages_read(uuid[]) to authenticated;

-- 팀을 나가거나 삭제되면: 1:1 읽은 위치, 대화방 자리도 정리 (빈 방은 지움)
create or replace function private.on_member_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.dm_reads where user_id = old.user_id or peer_id = old.user_id;
  delete from public.chat_room_members where user_id = old.user_id;
  delete from public.chat_rooms r where r.team_id = old.team_id and not exists (select 1 from public.chat_room_members m where m.room_id = r.id);
  return old;
end $$;

-- 휴대폰 알림: @호출, 1:1, 대화방 메시지 (초대·나가기 안내는 보내지 않음)
create or replace function private.on_message_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.system then return new; end if;
  if new.room_id is not null or new.recipient_id is not null or new.mention_all or coalesce(array_length(new.mentions, 1), 0) > 0 then
    perform private.push_call(jsonb_build_object('kind', 'message', 'id', new.id));
  end if;
  return new;
end $$;

-- 대화방 자리가 생기거나 없어지면 바로 알 수 있게 (이미 켜져 있으면 무시)
do $$ begin
  alter publication supabase_realtime add table public.chat_room_members;
exception when duplicate_object then null; end $$;
