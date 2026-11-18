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
