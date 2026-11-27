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

-- ───────── 팀 나가기 + 관리자 넘기기 (migration_014) ─────────

-- 관리자 넘기기: 지정한 구성원이 관리자가 되고, 나는 일반 구성원이 된다
create or replace function public.transfer_admin(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  select team_id into t from public.members where user_id = auth.uid() and is_admin;
  if t is null then raise exception '관리자만 넘길 수 있습니다'; end if;
  if p_user = auth.uid() then raise exception '자기 자신에게는 넘길 수 없습니다'; end if;
  if not exists (select 1 from public.members where user_id = p_user and team_id = t and role <> 'pending') then
    raise exception '같은 팀의 승인된 구성원에게만 넘길 수 있습니다';
  end if;
  update public.members set is_admin = true where user_id = p_user;
  -- '관리자 전용(표 미표시)'이던 사람은 일반 팀원으로
  update public.members set is_admin = false, role = case when role = 'none' then 'member' else role end where user_id = auth.uid();
  insert into public.notices (user_id, kind, text) values (p_user, 'result', '관리자 권한을 넘겨받았어요. 이제 팀 관리 메뉴를 쓸 수 있어요.');
end $$;

drop function if exists public.leave_team();
create or replace function public.leave_team(p_new_admin uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid; adm boolean; others int;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select team_id, is_admin into t, adm from public.members where user_id = auth.uid();
  if t is null then raise exception '소속된 팀이 없습니다'; end if;
  select count(*) into others from public.members where team_id = t and user_id <> auth.uid();
  if adm and others > 0 then
    if p_new_admin is null then raise exception '관리자는 관리자를 넘긴 뒤 나갈 수 있습니다'; end if;
    perform public.transfer_admin(p_new_admin);
  end if;

  delete from public.requests where team_id = t and status = 'pending' and (requester_id = auth.uid() or leader_id = auth.uid());
  delete from public.events where owner_id = auth.uid();
  delete from public.todos where owner_id = auth.uid();
  delete from public.chat_reads where user_id = auth.uid();
  delete from public.calendar_tokens where user_id = auth.uid();
  delete from public.members where user_id = auth.uid();
  -- 마지막 구성원이었다면 팀도 삭제 (팀 대화·요청 등은 함께 정리됨)
  if others = 0 then delete from public.teams where id = t; end if;
end $$;

grant execute on function public.transfer_admin(uuid), public.leave_team(uuid) to authenticated;

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

-- ───────── 사람별 화면 언어 (migration_016) ─────────
-- 앱에서 고른 언어(ko / en)를 저장해 두고, 휴대폰 푸쉬를 그 언어로 보낸다.
-- 비어 있으면 한국어로 보낸다. 본인 행 수정 권한(profiles_update)은 이미 있다.
alter table public.profiles add column if not exists lang text check (lang in ('ko', 'en'));

-- ───────── 대화 답장 · 전달 · 이모지 반응 (migration_017) ─────────
-- 답장: 어떤 메시지에 답했는지 기억한다 (원본이 지워지면 비움)
-- 전달: 다른 대화에서 옮겨 온 메시지 표시
-- 반응: 한 사람이 한 메시지에 이모지 1개만

alter table public.messages add column if not exists reply_to uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists forwarded boolean not null default false;

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.message_reactions enable row level security;

-- 읽기: 그 메시지를 볼 수 있는 사람 (메시지 읽기 규칙을 그대로 따른다)
drop policy if exists message_reactions_select on public.message_reactions;
create policy message_reactions_select on public.message_reactions for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));

-- 쓰기·바꾸기·지우기: 내 반응만, 볼 수 있고 지워지지 않은 메시지에만
drop policy if exists message_reactions_insert on public.message_reactions;
create policy message_reactions_insert on public.message_reactions for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.messages m where m.id = message_id and m.deleted_at is null));

drop policy if exists message_reactions_update on public.message_reactions;
create policy message_reactions_update on public.message_reactions for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.messages m where m.id = message_id and m.deleted_at is null));

drop policy if exists message_reactions_delete on public.message_reactions;
create policy message_reactions_delete on public.message_reactions for delete to authenticated
  using (user_id = auth.uid());

-- 메시지를 지우면 달린 반응도 함께 지운다
create or replace function public.delete_message(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.messages set body = '', ref = null, mentions = '{}', mention_all = false, deleted_at = now()
  where id = p_id and author_id = auth.uid();
  if not found then raise exception '내 메시지만 삭제할 수 있습니다'; end if;
  delete from public.message_reactions where message_id = p_id;
end $$;
grant execute on function public.delete_message(uuid) to authenticated;

-- 반응도 실시간으로 (이미 켜져 있으면 무시)
do $$ begin
  alter publication supabase_realtime add table public.message_reactions;
exception when duplicate_object then null; end $$;

-- ───────── 처음 사용 안내 (migration_018) ─────────
-- 처음 가입한 사람에게만 사용 안내 카드를 한 번 보여주기 위한 표시.
-- 이미 가입한 사람은 모두 "봤음"으로 두고, 앞으로 가입하는 사람만 false 로 시작한다.
-- 본인 행 수정 권한(profiles_update)은 이미 있다.
alter table public.profiles add column if not exists tutorial_seen boolean not null default false;
update public.profiles set tutorial_seen = true where created_at < now();

-- ───────── 설정: 못 끝낸 할 일을 다음 날로 넘기기 (migration_019) ─────────
-- 계정마다 저장한다 (PC와 휴대폰이 같은 설정). 기본은 켜짐 = 지금까지와 같은 동작.
-- 본인 행 수정 권한(profiles_update)은 이미 있다.
alter table public.profiles add column if not exists todo_carry boolean not null default true;

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

-- ───────── 설정: 내 단축키 (migration_021) ─────────
-- 바꾼 단축키만 저장 (예: {"chat":"KeyK"}). 비어 있으면 기본 단축키. 본인 행 수정 권한은 이미 있다.
alter table public.profiles add column if not exists shortcuts jsonb not null default '{}'::jsonb;

-- ===== migration_022: 구글 캘린더 일정별 연동 =====
-- ───────── 구글 캘린더에 추가 (migration_022) ─────────
-- 일정마다 "구글 캘린더에 추가" 토글(기본 꺼짐). 켠 일정만 구글의 "Weekendar" 캘린더로 보낸다 (Weekendar → 구글, 한 방향).
-- 고치면 구글도 고치고, 지우거나 토글을 끄면 구글에서도 지운다.
-- (예전에 비워 둔 migration_010 의 "모든 일정 보내기"를 일정별 토글 방식으로 바꾼 것. 010 은 실행하지 않는다)

alter table public.events add column if not exists gcal boolean not null default false;

-- 사람마다 구글 연결 정보 (연결 열쇠는 서버만 읽음: select 정책 없음)
create table if not exists public.google_links (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  refresh_token text not null,
  calendar_id text,
  status text not null default 'ok' check (status in ('ok', 'error')),
  connected_at timestamptz not null default now()
);
alter table public.google_links enable row level security;

create or replace function public.save_google_link(p_refresh text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if coalesce(p_refresh, '') = '' then raise exception '구글 연결 정보가 없습니다'; end if;
  insert into public.google_links (user_id, refresh_token) values (auth.uid(), p_refresh)
  on conflict (user_id) do update set refresh_token = excluded.refresh_token, status = 'ok', connected_at = now();
end $$;

create or replace function public.delete_google_link() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.google_links where user_id = auth.uid();
end $$;

-- 화면 표시용: 연결 여부와 상태만 (열쇠는 돌려주지 않음)
create or replace function public.google_link_status() returns table (connected boolean, status text, connected_at timestamptz)
language sql security definer set search_path = public as $$
  select true, g.status, g.connected_at from public.google_links g where g.user_id = auth.uid();
$$;

grant execute on function public.save_google_link(text), public.delete_google_link(), public.google_link_status() to authenticated;

-- /api/gcal 호출 (실패해도 일정 저장은 그대로 진행)
create or replace function private.gcal_call(p_body jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare u text; s text;
begin
  select value into u from private.config where key = 'push_url';
  select value into s from private.config where key = 'push_secret';
  if u is null or s is null then return; end if;
  perform net.http_post(
    url := u || '/api/gcal',
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', s)
  );
exception when others then
  raise warning 'gcal_call 실패: %', sqlerrm;
end $$;

-- 일정이 바뀔 때: 구글에 연결한 사람의, 토글을 켠(또는 방금 끈) 일정만
create or replace function private.on_event_gcal() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_kind text;
begin
  if tg_op = 'DELETE' then
    if not old.gcal then return null; end if;
    r := old; v_kind := 'delete';
  elsif tg_op = 'INSERT' then
    if not new.gcal then return null; end if;
    r := new; v_kind := 'upsert';
  else
    if not new.gcal and not old.gcal then return null; end if;
    r := new; v_kind := case when new.gcal then 'upsert' else 'delete' end; -- 토글을 끄면 구글에서 지움
  end if;
  if exists (select 1 from public.google_links where user_id = r.owner_id and status = 'ok') then
    perform private.gcal_call(jsonb_build_object('kind', v_kind, 'event_id', r.id, 'user_id', r.owner_id));
  end if;
  return null;
end $$;
drop trigger if exists events_gcal on public.events;
create trigger events_gcal after insert or update or delete on public.events for each row execute function private.on_event_gcal();

-- ───────── 팀장 일정 변경 확인 (migration_023) ─────────
-- 팀장이 "팀에 공유한 일정"의 시간·날짜·제목·장소를 바꾸면
--  1) 그 일정에 "변경됨" 표시를 남기고 (changed_at, change_text)
--  2) 팀원(role = member)에게 알림을 만든다 → 데스크톱은 오른쪽 아래 팝업, 모바일은 푸쉬 (기존 notices 푸쉬 장치를 그대로 씀)
--  3) 팀원은 "확인했어요"를 눌러 확인 기록(event_confirms)을 남기고, 팀장은 몇 명이 확인했는지 본다.
-- 일정이 또 바뀌면 이전 확인은 지워지고 처음부터 다시 확인받는다.

alter table public.events add column if not exists changed_at timestamptz;
alter table public.events add column if not exists change_text text not null default '';

-- 알림이 어느 일정에 대한 것인지
alter table public.notices add column if not exists event_id uuid references public.events(id) on delete cascade;

-- 확인 기록: 누가, 어느 변경(changed_at)을 확인했는지
create table if not exists public.event_confirms (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  changed_at timestamptz not null,
  confirmed_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table public.event_confirms enable row level security;
-- 내가 볼 수 있는 일정(내 일정 + 팀이 공유한 일정)의 확인 기록만 볼 수 있다. 쓰기는 confirm_event 함수로만.
drop policy if exists event_confirms_select on public.event_confirms;
create policy event_confirms_select on public.event_confirms for select to authenticated
  using (exists (select 1 from public.events e where e.id = event_confirms.event_id));

-- 일정의 "언제"를 짧은 글로 (예: 11/18 14:00–15:00, 11/18~11/20)
create or replace function private.ev_when(d date, ed date, s text, e text) returns text
language sql immutable as $$
  select case when coalesce(ed, d) > d
    then to_char(d, 'FMMM/FMDD') || '~' || to_char(ed, 'FMMM/FMDD')
    else to_char(d, 'FMMM/FMDD') || ' ' || s || '–' || e end
$$;

-- 팀장이 공유 일정을 고치면 (저장되기 전에 실행)
create or replace function private.on_event_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_team uuid; v_role text; v_name text;
  v_old text; v_new text; v_text text; v_today date;
begin
  -- 팀에 공유 중인 일정만 (공유를 켜거나 끄는 건 "변경"이 아님)
  if not (old.shared and new.shared) then return new; end if;
  -- 시간·날짜·제목·장소가 바뀐 경우만 (메모·알림·구글 토글 등은 제외)
  if row(new.title, new.date, new.end_date, new.start_time, new.end_time, new.place)
     is not distinct from row(old.title, old.date, old.end_date, old.start_time, old.end_time, old.place) then
    return new;
  end if;
  select team_id, role into v_team, v_role from public.members where user_id = new.owner_id;
  if v_role is distinct from 'leader' then return new; end if;
  -- 이미 지난 일정(반복 아님)을 고치는 것은 알리지 않는다
  v_today := (now() at time zone 'Asia/Seoul')::date;
  if new.repeat_rule = 'none' and coalesce(new.end_date, new.date) < v_today and coalesce(old.end_date, old.date) < v_today then
    return new;
  end if;

  v_old := private.ev_when(old.date, old.end_date, old.start_time, old.end_time);
  v_new := private.ev_when(new.date, new.end_date, new.start_time, new.end_time);
  -- 같은 날 하루 일정이면 날짜는 빼고 시간만 보여준다
  if old.date = new.date and coalesce(old.end_date, old.date) = old.date and coalesce(new.end_date, new.date) = new.date then
    v_old := old.start_time || '–' || old.end_time;
    v_new := new.start_time || '–' || new.end_time;
  end if;

  new.changed_at := now();
  new.change_text := case when v_old <> v_new then v_old || ' → ' || v_new else '' end;
  delete from public.event_confirms where event_id = new.id; -- 다시 확인받기

  select name into v_name from public.profiles where id = new.owner_id;
  v_text := coalesce(v_name, '') || ' 팀장이 일정을 변경했어요: ' || new.title
    || case when v_old <> v_new then ' (' || v_old || ' → ' || v_new || ')' else '' end;

  -- 같은 일정의 이전 변경 알림은 읽음 처리하고 새 알림을 팀원에게 (푸쉬는 notices 트리거가 보낸다)
  update public.notices set read = true where event_id = new.id and kind = 'confirm' and not read;
  insert into public.notices (user_id, kind, text, event_id)
  select m.user_id, 'confirm', v_text, new.id
  from public.members m where m.team_id = v_team and m.role = 'member';
  return new;
end $$;
drop trigger if exists events_changed on public.events;
create trigger events_changed before update on public.events
  for each row execute function private.on_event_changed();

-- 팀원이 "확인했어요"
create or replace function public.confirm_event(p_event uuid) returns void
language plpgsql security definer set search_path = public as $$
declare e public.events;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or e.changed_at is null then raise exception '확인할 변경이 없어요'; end if;
  if e.owner_id = auth.uid() then raise exception '내 일정은 확인할 필요가 없어요'; end if;
  if not (e.shared and public.is_active_in_same_team(e.owner_id)) then raise exception '볼 수 없는 일정이에요'; end if;
  insert into public.event_confirms (event_id, user_id, changed_at) values (p_event, auth.uid(), e.changed_at)
  on conflict (event_id, user_id) do update set changed_at = excluded.changed_at, confirmed_at = now();
  update public.notices set read = true where user_id = auth.uid() and event_id = p_event and kind = 'confirm';
end $$;
revoke all on function public.confirm_event(uuid) from public;
grant execute on function public.confirm_event(uuid) to authenticated;

-- 확인 기록이 바뀌면 팀장 화면에도 바로 반영되게 (이미 켜져 있으면 무시)
do $$ begin
  alter publication supabase_realtime add table public.event_confirms;
exception when duplicate_object then null; end $$;

-- ===== migration_024: 약관 동의 기록 + 탈퇴 =====
-- migration_024: 약관 동의 기록 + Weekendar 탈퇴(계정 삭제)
-- Supabase SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전합니다.

-- ① 약관 동의 기록: 동의한 약관 버전과 시각 (0 = 아직 동의 안 함)
alter table public.profiles add column if not exists terms_version int not null default 0;
alter table public.profiles add column if not exists terms_agreed_at timestamptz;

-- 약관 동의 (본인만, 버전은 올리기만 가능)
create or replace function public.agree_terms(p_version int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  update public.profiles
     set terms_version = greatest(terms_version, p_version), terms_agreed_at = now()
   where id = auth.uid();
end $$;
grant execute on function public.agree_terms(int) to authenticated;

-- ② 탈퇴: 팀에 속하지 않은 본인 계정을 지운다
--    auth.users 를 지우면 profiles 와 내 일정·할 일·대화·알림·구글 연결이 함께 지워진다 (on delete cascade)
create or replace function public.delete_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception '로그인이 필요해요'; end if;
  if exists (select 1 from public.members where user_id = me) then
    raise exception '팀에서 먼저 나간 뒤 탈퇴할 수 있어요';
  end if;
  -- 내가 만든 팀 기록은 남기고 만든 사람만 비운다 (이 칸은 연쇄 삭제가 아님)
  update public.teams set created_by = null where created_by = me;
  delete from auth.users where id = me;
end $$;
grant execute on function public.delete_account() to authenticated;

-- ===== migration_025: 이번 주 목표 + 월요일 카드 =====
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

-- ===== migration_026: 날짜별 메모 =====
-- migration_026: 날짜별 메모 (마크다운, 본인만 보기)
-- Supabase SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전합니다.

create table if not exists public.memos (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  date date not null,
  body text not null default '' check (char_length(body) <= 20000),
  updated_at timestamptz not null default now(),
  primary key (owner_id, date)
);

-- 본인만 읽고 쓰기 (팀원에게 노출되지 않음)
alter table public.memos enable row level security;
drop policy if exists memos_own on public.memos;
create policy memos_own on public.memos for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

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

-- migration_028: 할 일 하위 단계(한 단계까지) + 직접 정한 순서
-- Supabase SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전합니다.

-- 상위 할 일 (지우면 하위도 함께 지워짐) / 목록 안 순서 (작을수록 위, 비어 있으면 예전처럼)
alter table public.todos add column if not exists parent_id uuid references public.todos(id) on delete cascade;
alter table public.todos add column if not exists position double precision;
create index if not exists todos_parent_idx on public.todos(parent_id);

-- 상위 할 일은 같은 사람의 것이어야 하고, 하위의 하위는 만들 수 없게 (한 단계까지)
create or replace function private.check_todo_parent() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.todos;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then raise exception '자기 자신의 하위로 넣을 수 없어요'; end if;
  select * into p from public.todos where id = new.parent_id;
  if not found or p.owner_id <> new.owner_id then raise exception '상위 할 일을 찾을 수 없어요'; end if;
  if p.parent_id is not null then raise exception '하위 할 일은 한 단계까지만 만들 수 있어요'; end if;
  if exists (select 1 from public.todos c where c.parent_id = new.id) then raise exception '하위 할 일이 있는 할 일은 다른 할 일의 하위로 넣을 수 없어요'; end if;
  return new;
end $$;
drop trigger if exists todos_parent_check on public.todos;
create trigger todos_parent_check before insert or update of parent_id on public.todos
  for each row execute function private.check_todo_parent();

-- ───────── 029. 대화 이모티콘 ─────────
-- 메시지에 이모티콘(그림)을 담는 칸. 값은 '묶음/이름' (예: 'weeki/good'), 그림은 앱의 /stickers/ 폴더에 있다.
alter table public.messages add column if not exists sticker text
  check (sticker is null or sticker ~ '^[a-z0-9-]+/[a-z0-9-]+$');

-- ───────── 030. 대화 달력: 날짜별 대화 개수 ─────────
-- 대화(팀 / 1:1 / 그룹방)에서 기간 안의 날짜별 메시지 수.
-- security invoker(기본값)라서 메시지 읽기 권한(RLS)이 그대로 적용된다 → 내가 볼 수 있는 메시지만 센다.
create or replace function public.chat_day_counts(p_scope text, p_from date, p_to date, p_tz text default 'Asia/Seoul')
returns table(day date, n int)
language sql stable set search_path = public as $$
  select (m.created_at at time zone p_tz)::date as day, count(*)::int as n
  from public.messages m
  where m.team_id = public.my_team_id()
    and m.deleted_at is null and not m.system
    and m.created_at >= (p_from::timestamp at time zone p_tz)
    and m.created_at < ((p_to + 1)::timestamp at time zone p_tz)
    and case
      when p_scope = 'team' then m.room_id is null and m.recipient_id is null
      when p_scope like 'dm:%' then m.room_id is null and m.recipient_id is not null and (
        (m.author_id::text = split_part(p_scope, ':', 2) and m.recipient_id::text = split_part(p_scope, ':', 3))
        or (m.author_id::text = split_part(p_scope, ':', 3) and m.recipient_id::text = split_part(p_scope, ':', 2)))
      when p_scope like 'room:%' then m.room_id::text = substr(p_scope, 6)
      else false
    end
  group by 1
  order by 1
$$;
grant execute on function public.chat_day_counts(text, date, date, text) to authenticated;

-- ───────── 031. 대화 보관 기간 ─────────
-- 팀마다 대화를 얼마나 보관할지 (일 수). 비어 있으면 영구 보관(기본값).
-- 바꾸기: 팀 관리 권한(teams_update 정책: is_my_team_admin)이 있는 사람만.
alter table public.teams add column if not exists chat_retention_days int
  check (chat_retention_days is null or chat_retention_days in (90, 180, 365, 1095));

-- 우리 팀 대화가 차지하는 용량(바이트): 메시지 + 반응 + 읽음 기록
create or replace function public.team_chat_usage() returns bigint
language sql stable security definer set search_path = public as $$
  select case when not public.is_active_member() then 0::bigint else
    coalesce((select sum(pg_column_size(m.*)) from public.messages m where m.team_id = public.my_team_id()), 0)::bigint
    + coalesce((select sum(pg_column_size(r.*)) from public.message_reactions r join public.messages m on m.id = r.message_id where m.team_id = public.my_team_id()), 0)::bigint
    + coalesce((select sum(pg_column_size(x.*)) from public.message_reads x join public.messages m on m.id = x.message_id where m.team_id = public.my_team_id()), 0)::bigint
  end
$$;
grant execute on function public.team_chat_usage() to authenticated;

-- 매일 새벽: 보관 기간이 지난 대화 지우기 (공지로 등록한 메시지는 남긴다)
create or replace function private.purge_old_chats() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.messages m
  using public.teams t
  where m.team_id = t.id
    and t.chat_retention_days is not null
    and m.created_at < now() - make_interval(days => t.chat_retention_days)
    and not exists (select 1 from public.chat_pins p where p.message_id = m.id);
end $$;

-- 매일 한국 시간 새벽 4시 (UTC 19시)
select cron.unschedule(jobid) from cron.job where jobname = 'weekendar-chat-retention';
select cron.schedule('weekendar-chat-retention', '0 19 * * *', $job$select private.purge_old_chats()$job$);

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

-- ===== migration_033: 혼자 쓰기 =====
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

-- ===== migration_034: 회의 참석자 · 모두 비는 시간 =====
-- ───────── 034. 회의 참석자 · 모두 비는 시간 ─────────
-- 일정(회의)에 같은 팀 사람을 참석자로 넣으면
--  - 참석자의 팀 표 줄에도 그 회의가 보이고 (응답 대기 → 참석 / 불참)
--  - 초대받은 사람에게 알림(푸쉬 + 화면 오른쪽 아래 팝업)
--  - 참석자가 "불참"을 누르면 회의를 만든 사람에게 알림
--  - 회의 시간이 바뀌면 참석자에게 다시 묻고, 회의를 지우면 취소 알림
-- "모두 비는 시간 찾기"는 busy_events 로 팀원의 바쁜 시간만 받는다 (제목·장소·메모는 주지 않음)
-- Supabase SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전합니다.

-- 반복 일정의 끝 날짜 (migration_002 에서 만든 칸. schema.sql 에 빠져 있어 여기서도 확인만)
alter table public.events add column if not exists until date;

create table if not exists public.event_attendees (
  event_id uuid not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  responded_at timestamptz,
  primary key (event_id, user_id)
);
create index if not exists event_attendees_user_idx on public.event_attendees(user_id);
alter table public.event_attendees enable row level security;

-- 내가 초대받은 일정인지 / 내 일정인지 (규칙 안에서 서로를 부르다 꼬이지 않도록 따로 확인)
create or replace function public.is_invited(e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.event_attendees where event_id = e and user_id = auth.uid())
$$;
create or replace function public.is_event_owner(e uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.events where id = e and owner_id = auth.uid())
$$;
grant execute on function public.is_invited(uuid) to authenticated;
grant execute on function public.is_event_owner(uuid) to authenticated;

-- 참석자 목록: 나, 회의를 만든 사람, 같은 팀 사람이 볼 수 있다. 쓰기는 아래 함수로만.
drop policy if exists event_attendees_select on public.event_attendees;
create policy event_attendees_select on public.event_attendees for select to authenticated
  using (user_id = auth.uid() or public.is_event_owner(event_id) or public.is_active_in_same_team(user_id));

-- 초대받은 회의는 "나만 보기"여도 볼 수 있다
drop policy if exists events_select on public.events;
create policy events_select on public.events for select to authenticated
  using (owner_id = auth.uid() or (shared and public.is_active_in_same_team(owner_id)) or public.is_invited(id));

-- 참석자 정하기 (회의를 만든 사람만). 새로 들어온 사람에게 초대 알림
create or replace function public.set_attendees(p_event uuid, p_users uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare e public.events; v_name text;
begin
  select * into e from public.events where id = p_event;
  if e.id is null or e.owner_id <> auth.uid() then raise exception '내 일정만 참석자를 정할 수 있어요'; end if;
  if coalesce(e.end_date, e.date) > e.date and coalesce(array_length(p_users, 1), 0) > 0 then
    raise exception '여러 날 일정에는 참석자를 넣을 수 없어요';
  end if;
  -- 빠진 사람은 지운다
  delete from public.event_attendees a where a.event_id = p_event and not (a.user_id = any(coalesce(p_users, '{}')));
  select name into v_name from public.profiles where id = auth.uid();
  -- 같은 팀의 활동 중인 사람만, 나는 빼고
  with added as (
    insert into public.event_attendees (event_id, user_id)
    select p_event, u from unnest(coalesce(p_users, '{}')) as u
    where u <> auth.uid() and public.is_active_in_same_team(u)
    on conflict (event_id, user_id) do nothing
    returning user_id
  )
  insert into public.notices (user_id, kind, text, event_id)
  select user_id, 'invite',
    coalesce(v_name, '') || '님이 회의에 초대했어요: ' || e.title || ' (' || private.ev_when(e.date, e.end_date, e.start_time, e.end_time) || ')',
    p_event
  from added;
end $$;
revoke all on function public.set_attendees(uuid, uuid[]) from public;
grant execute on function public.set_attendees(uuid, uuid[]) to authenticated;

-- 참석 / 불참 (초대받은 사람). 불참이면 회의를 만든 사람에게 알림
create or replace function public.respond_invite(p_event uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
declare e public.events; v_old text; v_name text;
begin
  if p_status not in ('accepted', 'declined') then raise exception '참석 또는 불참만 고를 수 있어요'; end if;
  select status into v_old from public.event_attendees where event_id = p_event and user_id = auth.uid();
  if v_old is null then raise exception '초대받은 회의가 아니에요'; end if;
  update public.event_attendees set status = p_status, responded_at = now()
    where event_id = p_event and user_id = auth.uid();
  -- 이 회의의 초대 알림은 읽음으로
  update public.notices set read = true where user_id = auth.uid() and event_id = p_event and kind = 'invite' and not read;
  if p_status = 'declined' and v_old <> 'declined' then
    select * into e from public.events where id = p_event;
    select name into v_name from public.profiles where id = auth.uid();
    insert into public.notices (user_id, kind, text, event_id)
    values (e.owner_id, 'decline',
      coalesce(v_name, '') || '님이 회의에 불참해요: ' || e.title || ' (' || private.ev_when(e.date, e.end_date, e.start_time, e.end_time) || ')',
      p_event);
  end if;
end $$;
revoke all on function public.respond_invite(uuid, text) from public;
grant execute on function public.respond_invite(uuid, text) to authenticated;

-- 회의 시간이 바뀌면: 참석자에게 다시 묻는다 (응답을 대기로 돌리고 알림)
create or replace function private.on_meeting_moved() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text; v_old text; v_new text;
begin
  if row(new.date, new.end_date, new.start_time, new.end_time) is not distinct from row(old.date, old.end_date, old.start_time, old.end_time) then
    return new;
  end if;
  if not exists (select 1 from public.event_attendees where event_id = new.id) then return new; end if;
  select name into v_name from public.profiles where id = new.owner_id;
  v_old := private.ev_when(old.date, old.end_date, old.start_time, old.end_time);
  v_new := private.ev_when(new.date, new.end_date, new.start_time, new.end_time);
  update public.event_attendees set status = 'pending', responded_at = null where event_id = new.id;
  update public.notices set read = true where event_id = new.id and kind = 'invite' and not read;
  insert into public.notices (user_id, kind, text, event_id)
  select a.user_id, 'invite', coalesce(v_name, '') || '님이 회의 시간을 바꿨어요: ' || new.title || ' (' || v_old || ' → ' || v_new || ')', new.id
  from public.event_attendees a where a.event_id = new.id;
  return new;
end $$;
drop trigger if exists events_meeting_moved on public.events;
create trigger events_meeting_moved after update on public.events
  for each row execute function private.on_meeting_moved();

-- 회의를 지우면: 참석자에게 취소 알림 (일정이 없어지므로 알림은 일정과 잇지 않는다)
create or replace function private.on_meeting_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  select name into v_name from public.profiles where id = old.owner_id;
  insert into public.notices (user_id, kind, text)
  select a.user_id, 'invite', coalesce(v_name, '') || '님이 회의를 취소했어요: ' || old.title || ' (' || private.ev_when(old.date, old.end_date, old.start_time, old.end_time) || ')'
  from public.event_attendees a where a.event_id = old.id and a.status <> 'declined';
  return old;
end $$;
drop trigger if exists events_meeting_deleted on public.events;
create trigger events_meeting_deleted before delete on public.events
  for each row execute function private.on_meeting_deleted();

-- 모두 비는 시간 찾기: 고른 사람들의 "바쁜 시간"만 (제목·장소·메모 없이)
-- 내 일정 + 참석하기로 한(또는 응답 전) 회의. 같은 팀 사람만 볼 수 있다.
create or replace function public.busy_events(p_users uuid[], p_from date, p_to date)
returns table(id uuid, user_id uuid, date date, end_date date, start_time text, end_time text, repeat_rule text, until date, category text)
language sql stable security definer set search_path = public as $$
  with who as (
    select u from unnest(p_users) as u where u = auth.uid() or public.is_active_in_same_team(u)
  )
  select e.id, w.u, e.date, e.end_date, e.start_time, e.end_time, e.repeat_rule, e.until, e.category
  from who w join public.events e on e.owner_id = w.u
  where e.date <= p_to and (e.repeat_rule <> 'none' or coalesce(e.end_date, e.date) >= p_from) and (e.until is null or e.until >= p_from)
  union all
  select e.id, w.u, e.date, e.end_date, e.start_time, e.end_time, e.repeat_rule, e.until, e.category
  from who w join public.event_attendees a on a.user_id = w.u and a.status <> 'declined'
  join public.events e on e.id = a.event_id
  where e.date <= p_to and (e.repeat_rule <> 'none' or coalesce(e.end_date, e.date) >= p_from) and (e.until is null or e.until >= p_from)
$$;
revoke all on function public.busy_events(uuid[], date, date) from public;
grant execute on function public.busy_events(uuid[], date, date) to authenticated;

-- 참석 응답이 바뀌면 화면에 바로 반영되게
do $$ begin
  alter publication supabase_realtime add table public.event_attendees;
exception when duplicate_object then null; end $$;
