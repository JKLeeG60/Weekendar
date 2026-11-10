-- Weekendar DB 스키마 (Supabase SQL Editor에 통째로 붙여넣고 Run)
-- 여러 번 실행해도 안전하도록 작성했습니다.

create extension if not exists pgcrypto;

-- ───────── 테이블 ─────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

-- 1명 = 1팀 (user_id가 PK)
create table if not exists public.members (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  role text not null default 'pending' check (role in ('leader','member','pending')),
  is_admin boolean not null default false,
  title text not null default '',
  sort int not null default 0,
  joined_at timestamptz not null default now()
);
create unique index if not exists one_leader_per_team on public.members(team_id) where role = 'leader';
create index if not exists members_team_idx on public.members(team_id);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  date date not null,
  start_time text not null,
  end_time text not null,
  place text not null default '',
  memo text not null default '',
  category text not null default 'meeting'
    check (category in ('meeting','work','personal','leave','halfday','outside','trip','training')),
  repeat_rule text not null default 'none' check (repeat_rule in ('none','daily','weekly','monthly')),
  shared boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists events_owner_date_idx on public.events(owner_id, date);

create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  leader_id uuid not null references public.profiles(id) on delete cascade,
  type text not null check (type in ('add','edit','delete')),
  event_id uuid references public.events(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  reason text not null default '',
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists requests_leader_idx on public.requests(leader_id, status);
create index if not exists requests_requester_idx on public.requests(requester_id, status);

create table if not exists public.notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  text text not null,
  request_id uuid references public.requests(id) on delete set null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notices_user_idx on public.notices(user_id, created_at desc);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  date date not null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists todos_owner_idx on public.todos(owner_id, date);

-- ───────── 헬퍼 함수 (RLS 재귀 방지를 위해 security definer) ─────────
create or replace function public.my_team_id() returns uuid
language sql stable security definer set search_path = public as $$
  select team_id from public.members where user_id = auth.uid()
$$;

create or replace function public.is_my_team_admin(t uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and team_id = t and is_admin)
$$;

create or replace function public.same_team(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members a join public.members b on a.team_id = b.team_id
    where a.user_id = auth.uid() and b.user_id = u
  )
$$;

-- 승인된 팀원(대기 아님)인지
create or replace function public.is_active_in_same_team(u uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members a join public.members b on a.team_id = b.team_id
    where a.user_id = auth.uid() and a.role <> 'pending' and b.user_id = u and b.role <> 'pending'
  )
$$;

-- ───────── 가입 시 프로필 자동 생성 ─────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────── RLS ─────────
alter table public.profiles enable row level security;
alter table public.teams    enable row level security;
alter table public.members  enable row level security;
alter table public.events   enable row level security;
alter table public.requests enable row level security;
alter table public.notices  enable row level security;
alter table public.todos    enable row level security;

-- profiles: 본인 + 같은 팀원 조회, 본인 이름 수정
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.same_team(id));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- teams: 내 팀만 조회, 이름 변경은 관리자 (생성은 create_team RPC)
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select to authenticated
  using (id = public.my_team_id());
drop policy if exists teams_update on public.teams;
create policy teams_update on public.teams for update to authenticated
  using (public.is_my_team_admin(id)) with check (public.is_my_team_admin(id));

-- members: 같은 팀 조회, 관리자만 수정/삭제 (본인 탈퇴는 허용), 가입은 join_team RPC
drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
  using (team_id = public.my_team_id());
drop policy if exists members_update on public.members;
create policy members_update on public.members for update to authenticated
  using (public.is_my_team_admin(team_id)) with check (public.is_my_team_admin(team_id));
drop policy if exists members_delete on public.members;
create policy members_delete on public.members for delete to authenticated
  using (public.is_my_team_admin(team_id) or user_id = auth.uid());

-- events: 내 일정 전체 + 같은 팀원이 '공유'한 일정만. 쓰기는 본인만.
drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated
  using (owner_id = auth.uid() or (shared and public.is_active_in_same_team(owner_id)));
drop policy if exists events_insert on public.events;
create policy events_insert on public.events for insert to authenticated
  with check (owner_id = auth.uid());
drop policy if exists events_update on public.events;
create policy events_update on public.events for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists events_delete on public.events;
create policy events_delete on public.events for delete to authenticated
  using (owner_id = auth.uid());

-- requests: 요청자/팀장만 조회. 요청은 팀원이 직접 생성(팀장은 같은 팀의 팀장이어야 함). 승인/거절은 decide_request RPC.
drop policy if exists requests_select on public.requests;
create policy requests_select on public.requests for select to authenticated
  using (requester_id = auth.uid() or leader_id = auth.uid());
drop policy if exists requests_insert on public.requests;
create policy requests_insert on public.requests for insert to authenticated
  with check (
    requester_id = auth.uid()
    and status = 'pending'
    and team_id = public.my_team_id()
    and exists (select 1 from public.members m where m.user_id = leader_id and m.team_id = team_id and m.role = 'leader')
  );
drop policy if exists requests_delete on public.requests;  -- 요청자가 대기 중 요청 취소
create policy requests_delete on public.requests for delete to authenticated
  using (requester_id = auth.uid() and status = 'pending');

-- notices: 본인 것만 조회/읽음 처리 (생성은 서버 함수/트리거)
drop policy if exists notices_select on public.notices;
create policy notices_select on public.notices for select to authenticated using (user_id = auth.uid());
drop policy if exists notices_update on public.notices;
create policy notices_update on public.notices for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- todos: 본인만 (팀원에게 절대 노출되지 않음)
drop policy if exists todos_all on public.todos;
create policy todos_all on public.todos for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ───────── RPC ─────────
-- 팀 생성: 만든 사람이 관리자
create or replace function public.create_team(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid; code text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception '이미 팀에 속해 있습니다';
  end if;
  loop
    code := 'WKND-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.teams where invite_code = code);
  end loop;
  insert into public.teams (name, invite_code, created_by) values (trim(p_name), code, auth.uid()) returning id into t;
  insert into public.members (user_id, team_id, role, is_admin, sort) values (auth.uid(), t, 'member', true, 0);
  return t;
end $$;

-- 초대 코드로 팀 참여 (승인 대기 상태로 등록, 관리자에게 알림)
create or replace function public.join_team(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare t uuid; nm text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception '이미 팀에 속해 있습니다';
  end if;
  select id into t from public.teams where invite_code = upper(trim(p_code));
  if t is null then raise exception '초대 코드를 찾을 수 없습니다'; end if;
  insert into public.members (user_id, team_id, role, sort)
    values (auth.uid(), t, 'pending', coalesce((select max(sort) + 1 from public.members where team_id = t), 0));
  select name into nm from public.profiles where id = auth.uid();
  insert into public.notices (user_id, kind, text)
    select m.user_id, 'join', nm || '님이 팀 참여를 요청했어요'
    from public.members m where m.team_id = t and m.is_admin;
  return t;
end $$;

-- 팀원이 변경 요청을 만들면 팀장에게 알림
create or replace function public.notify_new_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  select name into nm from public.profiles where id = new.requester_id;
  insert into public.notices (user_id, kind, text, request_id)
  values (new.leader_id, 'request',
    nm || '님이 일정 ' || case new.type when 'add' then '추가' when 'edit' then '수정' else '삭제' end || '을 요청했어요',
    new.id);
  return new;
end $$;
drop trigger if exists on_request_created on public.requests;
create trigger on_request_created after insert on public.requests
  for each row execute function public.notify_new_request();

-- 팀장이 요청 수락/거절 (수락 시 일정 반영)
create or replace function public.decide_request(p_id uuid, p_accept boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r public.requests; pl jsonb; nm text;
begin
  select * into r from public.requests where id = p_id for update;
  if r.id is null then raise exception '요청을 찾을 수 없습니다'; end if;
  if r.leader_id <> auth.uid() then raise exception '팀장만 처리할 수 있습니다'; end if;
  if r.status <> 'pending' then raise exception '이미 처리된 요청입니다'; end if;
  pl := r.payload;

  if p_accept then
    if r.type = 'add' then
      insert into public.events (owner_id, title, date, start_time, end_time, place, memo, category, repeat_rule, shared)
      values (r.leader_id, pl->>'title', (pl->>'date')::date, pl->>'start', pl->>'end',
              coalesce(pl->>'place',''), coalesce(pl->>'memo',''), coalesce(pl->>'category','meeting'),
              coalesce(pl->>'repeat','none'), true);
    elsif r.type = 'edit' and r.event_id is not null then
      update public.events set
        title = coalesce(pl->>'title', title),
        date = coalesce((pl->>'date')::date, date),
        start_time = coalesce(pl->>'start', start_time),
        end_time = coalesce(pl->>'end', end_time),
        place = coalesce(pl->>'place', place),
        memo = coalesce(pl->>'memo', memo),
        category = coalesce(pl->>'category', category)
      where id = r.event_id and owner_id = r.leader_id;
    elsif r.type = 'delete' and r.event_id is not null then
      delete from public.events where id = r.event_id and owner_id = r.leader_id;
    end if;
  end if;

  update public.requests set status = case when p_accept then 'accepted' else 'rejected' end,
    reason = coalesce(p_reason, ''), decided_at = now() where id = p_id;

  select name into nm from public.profiles where id = r.leader_id;
  insert into public.notices (user_id, kind, text, request_id)
  values (r.requester_id, case when p_accept then 'accepted' else 'rejected' end,
    nm || ' 팀장이 요청을 ' || case when p_accept then '수락' else '거절' end || '했어요'
      || case when not p_accept and coalesce(p_reason,'') <> '' then ' (' || p_reason || ')' else '' end,
    p_id);
end $$;

-- 팀장 지정: 기존 팀장은 팀원으로 내리고 새 팀장 지정 (관리자만)
create or replace function public.set_leader(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  select team_id into t from public.members where user_id = p_user;
  if t is null or not public.is_my_team_admin(t) then raise exception '권한이 없습니다'; end if;
  update public.members set role = 'member' where team_id = t and role = 'leader';
  update public.members set role = 'leader', title = '' where user_id = p_user;
end $$;

grant execute on function public.create_team(text), public.join_team(text),
  public.decide_request(uuid, boolean, text), public.set_leader(uuid) to authenticated;
