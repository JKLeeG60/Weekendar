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

-- ───────── 팀 대화 (migration_005) ─────────

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

-- ───────── 메시지 읽음 확인 (migration_006) ─────────

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

-- ───────── 실시간·미리 알림·캘린더 구독 (migration_007) ─────────
-- 1) 실시간: 일정·요청·알림·구성원·팀·할 일 변경을 바로 전달
do $$
declare t text;
begin
  foreach t in array array['events','requests','notices','members','teams','todos'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- 2) 미리 알림: 시작 몇 분 전 (null = 알림 없음)
alter table public.events add column if not exists remind_min int check (remind_min is null or remind_min between 0 and 1440);

-- 3) 캘린더 구독 주소: 사람마다 비밀 토큰 하나
create table if not exists public.calendar_tokens (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now()
);
alter table public.calendar_tokens enable row level security;
drop policy if exists calendar_tokens_own on public.calendar_tokens;
create policy calendar_tokens_own on public.calendar_tokens for select to authenticated using (user_id = auth.uid());

create or replace function public.new_calendar_token() returns text
language sql volatile as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')
$$;

create or replace function public.get_calendar_token() returns text
language plpgsql security definer set search_path = public as $$
declare tk text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select token into tk from public.calendar_tokens where user_id = auth.uid();
  if tk is null then
    tk := public.new_calendar_token();
    insert into public.calendar_tokens (user_id, token) values (auth.uid(), tk);
  end if;
  return tk;
end $$;

create or replace function public.reset_calendar_token() returns text
language plpgsql security definer set search_path = public as $$
declare tk text := public.new_calendar_token();
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  insert into public.calendar_tokens (user_id, token) values (auth.uid(), tk)
  on conflict (user_id) do update set token = excluded.token, created_at = now();
  return tk;
end $$;

create or replace function public.ics_esc(t text) returns text
language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t, ''), '\', '\\'), ';', '\;'), ',', '\,'), E'\n', '\n')
$$;

-- 구독 주소가 부르는 함수: 토큰 주인의 일정을 .ics 텍스트로 (토큰이 틀리면 null)
create or replace function public.ics_feed(p_token text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid; nm text; e record; rr text;
  nl text := E'\r\n';
  o text;
begin
  select user_id into uid from public.calendar_tokens where token = p_token;
  if uid is null then return null; end if;
  select name into nm from public.profiles where id = uid;
  o := 'BEGIN:VCALENDAR' || nl || 'VERSION:2.0' || nl || 'PRODID:-//Weekendar//KO' || nl ||
       'CALSCALE:GREGORIAN' || nl || 'METHOD:PUBLISH' || nl ||
       'X-WR-CALNAME:' || public.ics_esc('Weekendar · ' || coalesce(nm, '')) || nl ||
       'X-WR-TIMEZONE:Asia/Seoul' || nl ||
       'BEGIN:VTIMEZONE' || nl || 'TZID:Asia/Seoul' || nl || 'BEGIN:STANDARD' || nl ||
       'DTSTART:19700101T000000' || nl || 'TZOFFSETFROM:+0900' || nl || 'TZOFFSETTO:+0900' || nl ||
       'TZNAME:KST' || nl || 'END:STANDARD' || nl || 'END:VTIMEZONE' || nl;
  for e in select * from public.events where owner_id = uid order by date, start_time loop
    rr := case e.repeat_rule when 'daily' then 'DAILY' when 'weekly' then 'WEEKLY' when 'monthly' then 'MONTHLY' end;
    o := o || 'BEGIN:VEVENT' || nl ||
      'UID:' || e.id || '@weekendar' || nl ||
      'DTSTAMP:' || to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"') || nl ||
      'DTSTART;TZID=Asia/Seoul:' || to_char(e.date, 'YYYYMMDD') || 'T' || replace(e.start_time, ':', '') || '00' || nl ||
      'DTEND;TZID=Asia/Seoul:' || to_char(e.date, 'YYYYMMDD') || 'T' || replace(e.end_time, ':', '') || '00' || nl ||
      'SUMMARY:' || public.ics_esc(e.title) || nl ||
      case when coalesce(e.place, '') <> '' then 'LOCATION:' || public.ics_esc(e.place) || nl else '' end ||
      case when rr is not null then 'RRULE:FREQ=' || rr ||
        case when e.until is not null then ';UNTIL=' || to_char(e.until, 'YYYYMMDD') || 'T145959Z' else '' end || nl else '' end ||
      case when e.remind_min is not null then 'BEGIN:VALARM' || nl || 'ACTION:DISPLAY' || nl ||
        'DESCRIPTION:' || public.ics_esc(e.title) || nl || 'TRIGGER:-PT' || e.remind_min || 'M' || nl || 'END:VALARM' || nl else '' end ||
      'END:VEVENT' || nl;
  end loop;
  return o || 'END:VCALENDAR' || nl;
end $$;

grant execute on function public.get_calendar_token(), public.reset_calendar_token() to authenticated;
-- 캘린더 앱은 로그인 없이 가져가므로 토큰만으로 호출 가능해야 한다
grant execute on function public.ics_feed(text) to anon, authenticated;
revoke execute on function public.new_calendar_token() from public;

-- ───────── 구성원 삭제 정리 (migration_008) ─────────

create or replace function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  select team_id into t from public.members where user_id = p_user;
  if t is null then raise exception '구성원을 찾을 수 없습니다'; end if;
  if not public.is_my_team_admin(t) then raise exception '관리자만 삭제할 수 있습니다'; end if;
  if p_user = auth.uid() then raise exception '자기 자신은 삭제할 수 없습니다'; end if;

  delete from public.requests where team_id = t and status = 'pending' and (requester_id = p_user or leader_id = p_user);
  delete from public.events where owner_id = p_user;
  delete from public.todos where owner_id = p_user;
  delete from public.chat_reads where user_id = p_user;
  delete from public.calendar_tokens where user_id = p_user;
  delete from public.members where user_id = p_user;
end $$;

grant execute on function public.remove_member(uuid) to authenticated;

-- ───────── 휴대폰 푸쉬 알림 (migration_009) ─────────

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ───────── 알림 받을 기기 ─────────
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());

-- 같은 기기에서 다른 계정으로 바꿔 켜도 되도록, 저장은 함수로만
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (auth.uid(), p_endpoint, p_p256dh, p_auth);
end $$;

create or replace function public.delete_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;

grant execute on function public.save_push_subscription(text, text, text), public.delete_push_subscription(text) to authenticated;

-- 같은 미리 알림을 두 번 보내지 않도록 기록 (서버만 사용)
create table if not exists public.reminder_log (
  event_id uuid not null,
  occ_date date not null,
  start_time text not null,
  remind_min int not null,
  sent_at timestamptz not null default now(),
  primary key (event_id, occ_date, start_time, remind_min)
);
alter table public.reminder_log enable row level security;

-- ───────── 서버 설정 (브라우저에서는 읽을 수 없음) ─────────
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.config (key text primary key, value text not null);
alter table private.config enable row level security;
insert into private.config values ('push_url', 'https://weekendar-eight.vercel.app') on conflict (key) do nothing;

-- /api/push 호출 (실패해도 원래 작업은 그대로 진행)
create or replace function private.push_call(p_body jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare u text; s text;
begin
  select value into u from private.config where key = 'push_url';
  select value into s from private.config where key = 'push_secret';
  if u is null or s is null then return; end if;
  perform net.http_post(
    url := u || '/api/push',
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', s)
  );
exception when others then
  raise warning 'push_call 실패: %', sqlerrm;
end $$;

-- 알림(동의 요청·결과, 참여 요청 등)이 생기면
create or replace function private.on_notice_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform private.push_call(jsonb_build_object('kind', 'notice', 'id', new.id));
  return new;
end $$;
drop trigger if exists notices_push on public.notices;
create trigger notices_push after insert on public.notices for each row execute function private.on_notice_push();

-- 팀 대화에서 누군가를 @로 부르면
create or replace function private.on_message_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mention_all or coalesce(array_length(new.mentions, 1), 0) > 0 then
    perform private.push_call(jsonb_build_object('kind', 'message', 'id', new.id));
  end if;
  return new;
end $$;
drop trigger if exists messages_push on public.messages;
create trigger messages_push after insert on public.messages for each row execute function private.on_message_push();

-- 미리 알림: 1분마다 확인
select cron.unschedule(jobid) from cron.job where jobname = 'weekendar-remind';
select cron.schedule('weekendar-remind', '* * * * *', $job$select private.push_call('{"kind":"remind"}'::jsonb)$job$);

-- ───────── 실행 후 한 번만: 비밀값 넣기 ─────────
-- 아래 줄의 '여기에_PUSH_SECRET' 을 Vercel 에 넣은 PUSH_SECRET 과 같은 값으로 바꿔 실행하세요.
-- insert into private.config values ('push_secret', '여기에_PUSH_SECRET') on conflict (key) do update set value = excluded.value;

-- ───────── 여러 날 일정 (migration_011) ─────────

alter table public.events add column if not exists end_date date;
alter table public.events drop constraint if exists events_end_date_check;
alter table public.events add constraint events_end_date_check check (end_date is null or end_date >= date);

-- 캘린더 구독 주소(.ics)에도 여러 날 일정을 종일 일정으로 내보냄
create or replace function public.ics_feed(p_token text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid; nm text; e record; rr text;
  nl text := E'\r\n';
  o text;
begin
  select user_id into uid from public.calendar_tokens where token = p_token;
  if uid is null then return null; end if;
  select name into nm from public.profiles where id = uid;
  o := 'BEGIN:VCALENDAR' || nl || 'VERSION:2.0' || nl || 'PRODID:-//Weekendar//KO' || nl ||
       'CALSCALE:GREGORIAN' || nl || 'METHOD:PUBLISH' || nl ||
       'X-WR-CALNAME:' || public.ics_esc('Weekendar · ' || coalesce(nm, '')) || nl ||
       'X-WR-TIMEZONE:Asia/Seoul' || nl ||
       'BEGIN:VTIMEZONE' || nl || 'TZID:Asia/Seoul' || nl || 'BEGIN:STANDARD' || nl ||
       'DTSTART:19700101T000000' || nl || 'TZOFFSETFROM:+0900' || nl || 'TZOFFSETTO:+0900' || nl ||
       'TZNAME:KST' || nl || 'END:STANDARD' || nl || 'END:VTIMEZONE' || nl;
  for e in select * from public.events where owner_id = uid order by date, start_time loop
    rr := case when e.end_date is not null and e.end_date > e.date then null else case e.repeat_rule when 'daily' then 'DAILY' when 'weekly' then 'WEEKLY' when 'monthly' then 'MONTHLY' end end;
    o := o || 'BEGIN:VEVENT' || nl ||
      'UID:' || e.id || '@weekendar' || nl ||
      'DTSTAMP:' || to_char(now() at time zone 'utc', 'YYYYMMDD"T"HH24MISS"Z"') || nl ||
      case when e.end_date is not null and e.end_date > e.date then
        -- 여러 날(종일) 일정: 끝 날짜는 다음 날(미포함)로 적는 것이 캘린더 규칙
        'DTSTART;VALUE=DATE:' || to_char(e.date, 'YYYYMMDD') || nl ||
        'DTEND;VALUE=DATE:' || to_char(e.end_date + 1, 'YYYYMMDD') || nl
      else
        'DTSTART;TZID=Asia/Seoul:' || to_char(e.date, 'YYYYMMDD') || 'T' || replace(e.start_time, ':', '') || '00' || nl ||
        'DTEND;TZID=Asia/Seoul:' || to_char(e.date, 'YYYYMMDD') || 'T' || replace(e.end_time, ':', '') || '00' || nl
      end ||
      'SUMMARY:' || public.ics_esc(e.title) || nl ||
      case when coalesce(e.place, '') <> '' then 'LOCATION:' || public.ics_esc(e.place) || nl else '' end ||
      case when rr is not null then 'RRULE:FREQ=' || rr ||
        case when e.until is not null then ';UNTIL=' || to_char(e.until, 'YYYYMMDD') || 'T145959Z' else '' end || nl else '' end ||
      case when e.remind_min is not null then 'BEGIN:VALARM' || nl || 'ACTION:DISPLAY' || nl ||
        'DESCRIPTION:' || public.ics_esc(e.title) || nl || 'TRIGGER:-PT' || e.remind_min || 'M' || nl || 'END:VALARM' || nl else '' end ||
      'END:VEVENT' || nl;
  end loop;
  return o || 'END:VCALENDAR' || nl;
end $$;

-- ───────── 팀장 일정 요청도 여러 날로 (migration_012) ─────────
create or replace function public.decide_request(p_id uuid, p_accept boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r public.requests; pl jsonb; nm text; verb text;
begin
  select * into r from public.requests where id = p_id for update;
  if r.id is null then raise exception '요청을 찾을 수 없습니다'; end if;
  if r.leader_id <> auth.uid() then raise exception '팀장만 처리할 수 있습니다'; end if;
  if r.status <> 'pending' then raise exception '이미 처리된 요청입니다'; end if;
  pl := r.payload;
  verb := case r.type when 'add' then '추가' when 'edit' then '수정' else '삭제' end;

  if p_accept then
    if r.type = 'add' then
      insert into public.events (owner_id, title, date, end_date, start_time, end_time, place, category, repeat_rule, shared)
      values (r.leader_id, pl->>'title', (pl->>'date')::date, nullif(pl->>'endDate', '')::date, pl->>'start', pl->>'end',
              coalesce(pl->>'place',''), 'meeting', 'none', true);
    elsif r.type = 'edit' and r.event_id is not null then
      update public.events set
        title = coalesce(pl->>'title', title),
        date = case when repeat_rule = 'none' then coalesce((pl->>'date')::date, date) else date end,
        -- 여러 날 ↔ 하루 변경도 반영 (요청에 endDate 항목이 있을 때만)
        end_date = case when repeat_rule = 'none' and pl ? 'endDate' then nullif(pl->>'endDate', '')::date else end_date end,
        start_time = coalesce(pl->>'start', start_time),
        end_time = coalesce(pl->>'end', end_time),
        place = coalesce(pl->>'place', place)
      where id = r.event_id and owner_id = r.leader_id;
    elsif r.type = 'delete' and r.event_id is not null then
      delete from public.events where id = r.event_id and owner_id = r.leader_id;
    end if;
  end if;

  update public.requests set status = case when p_accept then 'accepted' else 'rejected' end,
    reason = coalesce(p_reason, ''), decided_at = now() where id = p_id;

  update public.notices set read = true where request_id = p_id and user_id = r.leader_id;

  insert into public.notices (user_id, kind, text, request_id)
  values (r.requester_id, 'result',
    case when p_accept
      then '팀장이 일정 ' || verb || ' 요청에 동의했습니다. (' || coalesce(pl->>'title','') || ')'
      else '팀장이 일정 ' || verb || ' 요청을 거절했습니다. (' || coalesce(pl->>'title','') || ')'
           || case when coalesce(p_reason,'') <> '' then ' 사유: ' || p_reason else '' end
    end,
    p_id);
end $$;

-- ───────── 요청 카테고리 반영 (migration_013) ─────────
create or replace function public.decide_request(p_id uuid, p_accept boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r public.requests; pl jsonb; nm text; verb text;
begin
  select * into r from public.requests where id = p_id for update;
  if r.id is null then raise exception '요청을 찾을 수 없습니다'; end if;
  if r.leader_id <> auth.uid() then raise exception '팀장만 처리할 수 있습니다'; end if;
  if r.status <> 'pending' then raise exception '이미 처리된 요청입니다'; end if;
  pl := r.payload;
  verb := case r.type when 'add' then '추가' when 'edit' then '수정' else '삭제' end;

  if p_accept then
    if r.type = 'add' then
      insert into public.events (owner_id, title, date, end_date, start_time, end_time, place, category, repeat_rule, shared)
      values (r.leader_id, pl->>'title', (pl->>'date')::date, nullif(pl->>'endDate', '')::date, pl->>'start', pl->>'end',
              coalesce(pl->>'place',''), coalesce(nullif(pl->>'category', ''), 'meeting'), 'none', true);
    elsif r.type = 'edit' and r.event_id is not null then
      update public.events set
        title = coalesce(pl->>'title', title),
        date = case when repeat_rule = 'none' then coalesce((pl->>'date')::date, date) else date end,
        -- 여러 날 ↔ 하루 변경도 반영 (요청에 endDate 항목이 있을 때만)
        end_date = case when repeat_rule = 'none' and pl ? 'endDate' then nullif(pl->>'endDate', '')::date else end_date end,
        start_time = coalesce(pl->>'start', start_time),
        end_time = coalesce(pl->>'end', end_time),
        place = coalesce(pl->>'place', place),
        category = coalesce(nullif(pl->>'category', ''), category)
      where id = r.event_id and owner_id = r.leader_id;
    elsif r.type = 'delete' and r.event_id is not null then
      delete from public.events where id = r.event_id and owner_id = r.leader_id;
    end if;
  end if;

  update public.requests set status = case when p_accept then 'accepted' else 'rejected' end,
    reason = coalesce(p_reason, ''), decided_at = now() where id = p_id;

  update public.notices set read = true where request_id = p_id and user_id = r.leader_id;

  insert into public.notices (user_id, kind, text, request_id)
  values (r.requester_id, 'result',
    case when p_accept
      then '팀장이 일정 ' || verb || ' 요청에 동의했습니다. (' || coalesce(pl->>'title','') || ')'
      else '팀장이 일정 ' || verb || ' 요청을 거절했습니다. (' || coalesce(pl->>'title','') || ')'
           || case when coalesce(p_reason,'') <> '' then ' 사유: ' || p_reason else '' end
    end,
    p_id);
end $$;
