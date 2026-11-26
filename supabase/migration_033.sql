-- ───────── 033. 혼자 쓰기 (팀 없이 개인용) ─────────
-- 속으로는 "나 혼자만 있는 팀"(teams.personal = true)을 하나 만들어 둔다.
-- 그러면 일정·할 일·알림·캘린더 구독 등 기존 기능이 그대로 동작한다.
-- - 팀 만들기를 하면 혼자 공간이 그대로 팀으로 바뀐다 (일정·할 일 유지)
-- - 다른 팀에 참여해 승인되면 혼자 공간은 자동으로 정리된다 (일정은 사람에게 붙어 있어 그대로 따라감)
-- - 혼자 공간은 "최대 2개 팀" 개수에 넣지 않는다
-- Supabase SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전합니다.

alter table public.teams add column if not exists personal boolean not null default false;

-- 1) 팀 개수 제한: 혼자 공간은 세지 않는다
create or replace function private.check_member_limit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select personal from public.teams where id = new.team_id) then return new; end if;
  if (select count(*) from public.members m join public.teams t on t.id = m.team_id
      where m.user_id = new.user_id and not t.personal) >= 2 then
    raise exception '팀은 최대 2개까지 참여할 수 있어요';
  end if;
  return new;
end $$;

-- 2) 혼자 쓰기 시작
create or replace function public.start_personal() returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid; code text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  -- 이미 혼자 공간이 있으면 그걸 돌려준다
  select m.team_id into t from public.members m join public.teams x on x.id = m.team_id
    where m.user_id = auth.uid() and x.personal limit 1;
  if t is not null then
    update public.profiles set current_team_id = t where id = auth.uid();
    return t;
  end if;
  if exists (select 1 from public.members where user_id = auth.uid() and role <> 'pending') then
    raise exception '이미 팀에 속해 있어요';
  end if;
  loop
    code := 'WKND-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.teams where invite_code = code);
  end loop;
  insert into public.teams (name, invite_code, created_by, personal) values ('개인', code, auth.uid(), true) returning id into t;
  insert into public.members (user_id, team_id, role, is_admin, sort) values (auth.uid(), t, 'member', true, 0);
  update public.profiles set current_team_id = t where id = auth.uid();
  return t;
end $$;
grant execute on function public.start_personal() to authenticated;

-- 3) 팀 만들기: 혼자 공간이 있으면 그 공간을 팀으로 바꾼다 (일정·할 일 그대로)
create or replace function public.create_team(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid; code text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select m.team_id into t from public.members m join public.teams x on x.id = m.team_id
    where m.user_id = auth.uid() and x.personal limit 1;
  if t is not null then
    update public.teams set name = trim(p_name), personal = false where id = t;
    update public.profiles set current_team_id = t where id = auth.uid();
    return t;
  end if;
  if (select count(*) from public.members m join public.teams x on x.id = m.team_id
      where m.user_id = auth.uid() and not x.personal) >= 2 then
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

-- 4) 초대 코드로 참여: 혼자 공간 코드로는 참여할 수 없고, 혼자 공간은 개수에 넣지 않는다
create or replace function public.join_team(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid; nm text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select id into t from public.teams where invite_code = upper(trim(p_code)) and not personal;
  if t is null then raise exception '초대 코드를 찾을 수 없습니다'; end if;
  if exists (select 1 from public.members where user_id = auth.uid() and team_id = t) then
    raise exception '이미 이 팀에 참여했거나 승인을 기다리고 있어요';
  end if;
  if (select count(*) from public.members m join public.teams x on x.id = m.team_id
      where m.user_id = auth.uid() and not x.personal) >= 2 then
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

-- 5) 다른 팀에 승인되면: 그 팀으로 바꾸고, 혼자 공간은 정리한다
create or replace function private.on_member_approved() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'pending' and new.role <> 'pending' then
    update public.profiles p set current_team_id = new.team_id where p.id = new.user_id
      and (p.current_team_id is null or exists (select 1 from public.teams x where x.id = p.current_team_id and x.personal));
    delete from public.teams x where x.personal and x.id <> new.team_id
      and exists (select 1 from public.members m where m.team_id = x.id and m.user_id = new.user_id);
  end if;
  return new;
end $$;
drop trigger if exists members_approved on public.members;
create trigger members_approved after update of role on public.members for each row execute function private.on_member_approved();

-- 6) 내 팀 목록: 혼자 공간인지 함께 돌려준다 (돌려주는 칸이 바뀌어 지우고 다시 만든다)
drop function if exists public.my_teams();
create function public.my_teams()
returns table(team_id uuid, name text, role text, is_admin boolean, is_current boolean, personal boolean)
language sql stable security definer set search_path = public as $$
  select m.team_id, t.name, m.role, m.is_admin, m.team_id = public.my_team_id(), t.personal
  from public.members m join public.teams t on t.id = m.team_id
  where m.user_id = auth.uid()
  order by m.joined_at
$$;
grant execute on function public.my_teams() to authenticated;

-- 7) 탈퇴: 혼자 공간만 있으면 정리하고 탈퇴할 수 있다
create or replace function public.delete_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception '로그인이 필요해요'; end if;
  if exists (select 1 from public.members m join public.teams t on t.id = m.team_id where m.user_id = me and not t.personal) then
    raise exception '팀에서 먼저 나간 뒤 탈퇴할 수 있어요';
  end if;
  delete from public.teams t where t.personal and exists (select 1 from public.members m where m.team_id = t.id and m.user_id = me);
  update public.teams set created_by = null where created_by = me;
  delete from auth.users where id = me;
end $$;
grant execute on function public.delete_account() to authenticated;
