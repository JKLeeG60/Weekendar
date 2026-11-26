-- ───────── 032. 여러 팀 소속 (최대 2개) ─────────
-- 한 사람이 팀마다 한 줄씩, 최대 2개 팀에 속할 수 있다. 팀마다 관리자는 1명.
-- "지금 보고 있는 팀"(profiles.current_team_id)을 my_team_id() 가 돌려주므로
-- 기존 권한 규칙(my_team_id 기준)은 그대로 "지금 보고 있는 팀" 기준으로 동작한다.
-- 기존 데이터는 그대로 유지된다. (지금 각자 속한 팀 = 지금 보고 있는 팀)

-- 1) 구성원: 1명 = 팀마다 1줄
alter table public.members drop constraint if exists members_pkey;
alter table public.members add primary key (user_id, team_id);
create index if not exists members_user_idx on public.members(user_id);

-- 2) 팀마다 관리자 1명
create unique index if not exists one_admin_per_team on public.members(team_id) where is_admin;

-- 3) 한 사람은 최대 2개 팀 (참여 대기 포함)
create or replace function private.check_member_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from public.members where user_id = new.user_id) >= 2 then
    raise exception '팀은 최대 2개까지 참여할 수 있어요';
  end if;
  return new;
end $$;
drop trigger if exists members_limit on public.members;
create trigger members_limit before insert on public.members for each row execute function private.check_member_limit();

-- 4) 지금 보고 있는 팀
alter table public.profiles add column if not exists current_team_id uuid references public.teams(id) on delete set null;

create or replace function public.my_team_id() returns uuid
language sql stable security definer set search_path = public as $$
  select m.team_id from public.members m
  left join public.profiles p on p.id = m.user_id
  where m.user_id = auth.uid()
  order by (m.team_id = p.current_team_id) desc nulls last, (m.role <> 'pending') desc, m.joined_at
  limit 1
$$;

-- 지금 보고 있는 팀에서 승인된 구성원인지
create or replace function public.is_active_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and team_id = public.my_team_id() and role <> 'pending')
$$;

-- 내가 속한 팀 목록 (전환 버튼용)
create or replace function public.my_teams()
returns table(team_id uuid, name text, role text, is_admin boolean, is_current boolean)
language sql stable security definer set search_path = public as $$
  select m.team_id, t.name, m.role, m.is_admin, m.team_id = public.my_team_id()
  from public.members m join public.teams t on t.id = m.team_id
  where m.user_id = auth.uid()
  order by m.joined_at
$$;

-- 보고 있는 팀 바꾸기 (승인된 팀만)
create or replace function public.switch_team(p_team uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.members where user_id = auth.uid() and team_id = p_team and role <> 'pending') then
    raise exception '이 팀으로 바꿀 수 없어요';
  end if;
  update public.profiles set current_team_id = p_team where id = auth.uid();
end $$;
grant execute on function public.my_teams(), public.switch_team(uuid) to authenticated;

-- 5) 팀 만들기: 2개까지, 만든 팀으로 바로 전환
create or replace function public.create_team(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid; code text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if (select count(*) from public.members where user_id = auth.uid()) >= 2 then
    raise exception '팀은 최대 2개까지 참여할 수 있어요';
  end if;
  loop
    code := 'WKND-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.teams where invite_code = code);
  end loop;
  insert into public.teams (name, invite_code, created_by) values (trim(p_name), code, auth.uid()) returning id into t;
  insert into public.members (user_id, team_id, role, is_admin, sort) values (auth.uid(), t, 'member', true, 0);
  update public.profiles set current_team_id = t where id = auth.uid();
  return t;
end $$;

-- 6) 초대 코드로 참여: 이미 팀이 있어도 2개까지 (승인 대기로 등록)
create or replace function public.join_team(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid; nm text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select id into t from public.teams where invite_code = upper(trim(p_code));
  if t is null then raise exception '초대 코드를 찾을 수 없습니다'; end if;
  if exists (select 1 from public.members where user_id = auth.uid() and team_id = t) then
    raise exception '이미 이 팀에 참여했거나 승인을 기다리고 있어요';
  end if;
  if (select count(*) from public.members where user_id = auth.uid()) >= 2 then
    raise exception '팀은 최대 2개까지 참여할 수 있어요';
  end if;
  insert into public.members (user_id, team_id, role, sort)
    values (auth.uid(), t, 'pending', coalesce((select max(sort) + 1 from public.members where team_id = t), 0));
  select name into nm from public.profiles where id = auth.uid();
  insert into public.notices (user_id, kind, text)
    select m.user_id, 'join', nm || '님이 팀 참여를 요청했어요'
    from public.members m where m.team_id = t and m.is_admin;
  return t;
end $$;

-- 7) 팀장 지정: 지금 보고 있는 팀 안에서만
create or replace function public.set_leader(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id();
begin
  if t is null or not public.is_my_team_admin(t) then raise exception '권한이 없습니다'; end if;
  if not exists (select 1 from public.members where user_id = p_user and team_id = t) then raise exception '구성원을 찾을 수 없습니다'; end if;
  update public.members set role = 'member' where team_id = t and role = 'leader';
  update public.members set role = 'leader', title = '' where user_id = p_user and team_id = t;
end $$;

-- 8) 구성원 삭제: 이 팀에서만 빼고, 다른 팀에도 없을 때만 일정·할 일까지 정리
create or replace function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id();
begin
  if not exists (select 1 from public.members where user_id = p_user and team_id = t) then raise exception '구성원을 찾을 수 없습니다'; end if;
  if not public.is_my_team_admin(t) then raise exception '관리자만 삭제할 수 있습니다'; end if;
  if p_user = auth.uid() then raise exception '자기 자신은 삭제할 수 없습니다'; end if;

  delete from public.requests where team_id = t and status = 'pending' and (requester_id = p_user or leader_id = p_user);
  delete from public.chat_reads where user_id = p_user and team_id = t;
  delete from public.members where user_id = p_user and team_id = t;
  update public.profiles set current_team_id = null where id = p_user and current_team_id = t;
  if not exists (select 1 from public.members where user_id = p_user) then
    delete from public.events where owner_id = p_user;
    delete from public.todos where owner_id = p_user;
    delete from public.calendar_tokens where user_id = p_user;
  end if;
end $$;

-- 9) 관리자 넘기기: 지금 보고 있는 팀의 관리자만
create or replace function public.transfer_admin(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id(); tn text;
begin
  if t is null or not public.is_my_team_admin(t) then raise exception '관리자만 넘길 수 있습니다'; end if;
  if p_user = auth.uid() then raise exception '자기 자신에게는 넘길 수 없습니다'; end if;
  if not exists (select 1 from public.members where user_id = p_user and team_id = t and role <> 'pending') then
    raise exception '같은 팀의 승인된 구성원에게만 넘길 수 있습니다';
  end if;
  -- 관리자는 팀마다 1명: 먼저 내 표시를 내리고 넘긴다
  update public.members set is_admin = false, role = case when role = 'none' then 'member' else role end where user_id = auth.uid() and team_id = t;
  update public.members set is_admin = true where user_id = p_user and team_id = t;
  select name into tn from public.teams where id = t;
  insert into public.notices (user_id, kind, text) values (p_user, 'result', coalesce(tn, '') || ' 관리자 권한을 넘겨받았어요. 이제 팀 관리 메뉴를 쓸 수 있어요.');
end $$;

-- 10) 팀 나가기: 지금 보고 있는 팀에서만 나가고, 다른 팀이 남아 있으면 일정·할 일은 그대로
create or replace function public.leave_team(p_new_admin uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid := public.my_team_id(); adm boolean; others int;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select is_admin into adm from public.members where user_id = auth.uid() and team_id = t;
  if t is null or adm is null then raise exception '소속된 팀이 없습니다'; end if;
  select count(*) into others from public.members where team_id = t and user_id <> auth.uid();
  if adm and others > 0 then
    if p_new_admin is null then raise exception '관리자는 관리자를 넘긴 뒤 나갈 수 있습니다'; end if;
    perform public.transfer_admin(p_new_admin);
  end if;

  delete from public.requests where team_id = t and status = 'pending' and (requester_id = auth.uid() or leader_id = auth.uid());
  delete from public.chat_reads where user_id = auth.uid() and team_id = t;
  delete from public.members where user_id = auth.uid() and team_id = t;
  update public.profiles set current_team_id = null where id = auth.uid() and current_team_id = t;
  if not exists (select 1 from public.members where user_id = auth.uid()) then
    delete from public.events where owner_id = auth.uid();
    delete from public.todos where owner_id = auth.uid();
    delete from public.calendar_tokens where user_id = auth.uid();
  end if;
  -- 마지막 구성원이었다면 팀도 삭제 (팀 대화·요청 등은 함께 정리됨)
  if others = 0 then delete from public.teams where id = t; end if;
end $$;

-- 11) 팀을 나가면: 그 팀의 대화방 자리만 정리 (다른 팀이 남아 있으면 1:1 읽은 위치는 유지)
create or replace function private.on_member_gone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.members where user_id = old.user_id) then
    delete from public.dm_reads where user_id = old.user_id or peer_id = old.user_id;
  end if;
  delete from public.chat_room_members crm using public.chat_rooms r
    where crm.room_id = r.id and r.team_id = old.team_id and crm.user_id = old.user_id;
  delete from public.chat_rooms r where r.team_id = old.team_id and not exists (select 1 from public.chat_room_members m where m.room_id = r.id);
  return old;
end $$;

-- 12) 팀장 일정 변경 알림: 그 사람이 팀장인 모든 팀의 팀원에게
create or replace function private.on_event_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_name text;
  v_old text; v_new text; v_text text; v_today date;
begin
  if not (old.shared and new.shared) then return new; end if;
  if row(new.title, new.date, new.end_date, new.start_time, new.end_time, new.place)
     is not distinct from row(old.title, old.date, old.end_date, old.start_time, old.end_time, old.place) then
    return new;
  end if;
  if not exists (select 1 from public.members where user_id = new.owner_id and role = 'leader') then return new; end if;
  v_today := (now() at time zone 'Asia/Seoul')::date;
  if new.repeat_rule = 'none' and coalesce(new.end_date, new.date) < v_today and coalesce(old.end_date, old.date) < v_today then
    return new;
  end if;

  v_old := private.ev_when(old.date, old.end_date, old.start_time, old.end_time);
  v_new := private.ev_when(new.date, new.end_date, new.start_time, new.end_time);
  if old.date = new.date and coalesce(old.end_date, old.date) = old.date and coalesce(new.end_date, new.date) = new.date then
    v_old := old.start_time || '–' || old.end_time;
    v_new := new.start_time || '–' || new.end_time;
  end if;

  new.changed_at := now();
  new.change_text := case when v_old <> v_new then v_old || ' → ' || v_new else '' end;
  delete from public.event_confirms where event_id = new.id;

  select name into v_name from public.profiles where id = new.owner_id;
  v_text := coalesce(v_name, '') || ' 팀장이 일정을 변경했어요: ' || new.title
    || case when v_old <> v_new then ' (' || v_old || ' → ' || v_new || ')' else '' end;

  update public.notices set read = true where event_id = new.id and kind = 'confirm' and not read;
  insert into public.notices (user_id, kind, text, event_id)
  select distinct m.user_id, 'confirm', v_text, new.id
  from public.members m
  where m.role = 'member' and m.user_id <> new.owner_id
    and m.team_id in (select team_id from public.members where user_id = new.owner_id and role = 'leader');
  return new;
end $$;

-- 13) 팀 대화 읽은 위치: 팀마다 따로
alter table public.chat_reads add column if not exists team_id uuid references public.teams(id) on delete cascade;
update public.chat_reads c set team_id = m.team_id from public.members m where m.user_id = c.user_id and c.team_id is null;
delete from public.chat_reads where team_id is null;
alter table public.chat_reads alter column team_id set default public.my_team_id();
alter table public.chat_reads alter column team_id set not null;
alter table public.chat_reads drop constraint if exists chat_reads_pkey;
alter table public.chat_reads add primary key (user_id, team_id);
drop policy if exists chat_reads_all on public.chat_reads;
create policy chat_reads_all on public.chat_reads for all to authenticated
  using (user_id = auth.uid() and team_id = public.my_team_id())
  with check (user_id = auth.uid() and team_id = public.my_team_id());
