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
