-- migration_037: 휴가·출장 신청과 승인 (내 목록 → 부재 관리)
-- · 팀원이 휴가(연차·반차·병가·경조사)나 출장을 신청 → 팀장·관리자가 승인하면 일정이 자동으로 생긴다
-- · 팀장·관리자는 "자동 승인"을 켤 수 있다 (휴가·출장 / 출장만 / 휴가만)
-- · 팀원마다 올해 총 연차(기본 15일)를 정할 수 있다

alter table public.members add column if not exists leave_total numeric not null default 15;
alter table public.teams add column if not exists auto_approve text not null default 'none';
alter table public.teams drop constraint if exists teams_auto_approve_check;
alter table public.teams add constraint teams_auto_approve_check check (auto_approve in ('none', 'all', 'trip', 'leave'));

create table if not exists public.absence_requests (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- annual 연차 · am 오전 반차 · pm 오후 반차 · sick 병가 · family 경조사 · trip 출장
  kind text not null check (kind in ('annual', 'am', 'pm', 'sick', 'family', 'trip')),
  date date not null,
  end_date date,
  place text not null default '',
  reason text not null default '',
  -- 평일 기준 일수 (반차 0.5). 연차에서 빠지는 건 annual·am·pm 만
  days numeric not null default 0,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'canceled')),
  reject_reason text not null default '',
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  auto boolean not null default false,
  event_id uuid references public.events(id) on delete set null,
  created_at timestamptz not null default now(),
  check (end_date is null or end_date >= date)
);
create index if not exists absence_team_date_idx on public.absence_requests(team_id, date);
create index if not exists absence_user_idx on public.absence_requests(user_id);
alter table public.absence_requests enable row level security;
-- 같은 팀 사람은 볼 수 있다 (팀 표의 "대기" 표시용). 쓰기는 아래 함수로만
drop policy if exists absence_select on public.absence_requests;
create policy absence_select on public.absence_requests for select to authenticated
  using (exists (select 1 from public.members m where m.user_id = auth.uid() and m.team_id = absence_requests.team_id and m.role <> 'pending'));

alter table public.notices add column if not exists absence_id uuid references public.absence_requests(id) on delete set null;

-- 실시간
do $$ begin
  alter publication supabase_realtime add table public.absence_requests;
exception when others then null; end $$;

-- "연차 2일" · "오전 반차" · "대구" 같은 짧은 이름
create or replace function private.absence_label(k text, d numeric, p text) returns text
language sql immutable as $$
  select case k when 'annual' then '연차 ' || trim_scale(d) || '일' when 'am' then '오전 반차' when 'pm' then '오후 반차'
    when 'sick' then '병가' when 'family' then '경조사' else p end
$$;
-- "12. 3.(목)~12. 4.(금)" 또는 "12. 3.(목)"
create or replace function private.absence_when(d date, ed date) returns text
language sql immutable as $$
  select case when coalesce(ed, d) > d then private.md_ko(d) || '~' || private.md_ko(ed) else private.md_ko(d) end
$$;

-- 승인할 수 있는 사람: 그 팀의 팀장·관리자 (신청한 본인 제외)
create or replace function private.absence_approvers(p_team uuid, p_user uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.user_id from public.members m
  where m.team_id = p_team and m.user_id <> p_user and m.role <> 'pending' and (m.role = 'leader' or m.is_admin)
$$;

-- 승인 처리: 일정을 만들고 신청을 "승인"으로
create or replace function private.absence_apply(p_id uuid, p_by uuid, p_auto boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r public.absence_requests; v_ev uuid; v_end date; v_s text; v_e text;
begin
  select * into r from public.absence_requests where id = p_id;
  v_end := case when r.end_date > r.date then r.end_date end;
  if v_end is not null then v_s := '00:00'; v_e := '23:59';
  elsif r.kind = 'am' then v_s := '09:00'; v_e := '14:00';
  elsif r.kind = 'pm' then v_s := '14:00'; v_e := '18:00';
  else v_s := '09:00'; v_e := '18:00'; end if;
  insert into public.events (owner_id, title, date, end_date, start_time, end_time, place, category, shared, repeat_rule)
  values (r.user_id,
    case r.kind when 'annual' then '연차' when 'am' then '오전 반차' when 'pm' then '오후 반차' when 'sick' then '병가' when 'family' then '경조사' else '출장' end,
    r.date, v_end, v_s, v_e, case when r.kind = 'trip' then r.place else '' end,
    case r.kind when 'trip' then 'trip' when 'am' then 'halfday' when 'pm' then 'halfday' else 'leave' end,
    true, 'none')
  returning id into v_ev;
  update public.absence_requests set status = 'approved', decided_by = p_by, decided_at = now(), auto = p_auto, event_id = v_ev where id = p_id;
end $$;

-- 신청 (팀원·팀장·관리자 누구나). 신청 id 를 돌려준다
create or replace function public.request_absence(p_kind text, p_date date, p_end date, p_place text, p_reason text, p_days numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  t uuid := public.my_team_id(); v_me public.members; v_id uuid; v_max numeric; v_days numeric;
  v_auto text; v_now boolean; v_name text; v_total numeric; v_used numeric; v_txt text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select * into v_me from public.members where user_id = auth.uid() and team_id = t;
  if v_me.user_id is null or v_me.role = 'pending' then raise exception '팀에 참여한 뒤에 신청할 수 있어요'; end if;
  if p_kind not in ('annual', 'am', 'pm', 'sick', 'family', 'trip') then raise exception '종류를 골라 주세요'; end if;
  if p_date is null then raise exception '날짜를 골라 주세요'; end if;
  if p_kind in ('am', 'pm') or p_end <= p_date then p_end := null; end if;
  if p_end is not null and p_end < p_date then raise exception '기간을 확인해 주세요'; end if;
  if p_kind = 'trip' and coalesce(trim(p_place), '') = '' then raise exception '출장지를 적어 주세요'; end if;
  -- 이미 신청한 기간과 겹치면 안 된다 (같은 날 오전·오후 반차는 괜찮다)
  if exists (select 1 from public.absence_requests a
    where a.user_id = auth.uid() and a.team_id = t and a.status in ('pending', 'approved')
      and a.date <= coalesce(p_end, p_date) and coalesce(a.end_date, a.date) >= p_date
      and not (a.kind in ('am', 'pm') and p_kind in ('am', 'pm') and a.kind <> p_kind)) then
    raise exception '이미 신청한 기간과 겹쳐요';
  end if;
  -- 일수: 화면이 공휴일을 빼고 센 값을 쓰되, 평일 수를 넘지 않게
  v_max := (select count(*) from generate_series(p_date, coalesce(p_end, p_date), interval '1 day') g where extract(isodow from g) < 6);
  v_days := case when p_kind in ('am', 'pm') then 0.5 else least(greatest(coalesce(p_days, v_max), 0), v_max) end;
  -- 남은 연차 확인 (올해, 승인 + 대기)
  if p_kind in ('annual', 'am', 'pm') then
    v_total := v_me.leave_total;
    select coalesce(sum(days), 0) into v_used from public.absence_requests
      where user_id = auth.uid() and team_id = t and kind in ('annual', 'am', 'pm') and status in ('pending', 'approved')
        and extract(year from date) = extract(year from p_date);
    if v_used + v_days > v_total then raise exception '남은 연차가 부족해요'; end if;
  end if;
  insert into public.absence_requests (team_id, user_id, kind, date, end_date, place, reason, days)
  values (t, auth.uid(), p_kind, p_date, p_end, coalesce(trim(p_place), ''), coalesce(trim(p_reason), ''), v_days)
  returning id into v_id;

  select name into v_name from public.profiles where id = auth.uid();
  v_txt := private.absence_label(p_kind, v_days, trim(p_place)) || ' (' || private.absence_when(p_date, p_end) || ')';
  select auto_approve into v_auto from public.teams where id = t;
  -- 관리자 본인 · 자동 승인 · 승인할 사람이 없으면 바로 승인
  v_now := v_me.is_admin
    or v_auto = 'all' or (v_auto = 'trip' and p_kind = 'trip') or (v_auto = 'leave' and p_kind <> 'trip')
    or not exists (select 1 from private.absence_approvers(t, auth.uid()));
  if v_now then
    perform private.absence_apply(v_id, case when v_me.is_admin then auth.uid() end, not v_me.is_admin);
    insert into public.notices (user_id, kind, text, absence_id)
    select a, 'absence', coalesce(v_name, '') || '님의 ' || (case when p_kind = 'trip' then '출장이' else '휴가가' end) || (case when v_me.is_admin then ' 등록됐어요: ' else ' 자동 승인됐어요: ' end) || v_txt, v_id
    from private.absence_approvers(t, auth.uid()) a;
  else
    insert into public.notices (user_id, kind, text, absence_id)
    select a, 'absence', coalesce(v_name, '') || '님이 ' || (case when p_kind = 'trip' then '출장을' else '휴가를' end) || ' 신청했어요: ' || v_txt, v_id
    from private.absence_approvers(t, auth.uid()) a;
  end if;
  return v_id;
end $$;
revoke all on function public.request_absence(text, date, date, text, text, numeric) from public;
grant execute on function public.request_absence(text, date, date, text, text, numeric) to authenticated;

-- 승인·반려 (팀장·관리자)
create or replace function public.decide_absence(p_id uuid, p_ok boolean, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
declare r public.absence_requests; v_noun text; v_txt text;
begin
  select * into r from public.absence_requests where id = p_id for update;
  if r.id is null or r.status <> 'pending' then raise exception '이미 처리된 신청이에요'; end if;
  if auth.uid() not in (select private.absence_approvers(r.team_id, r.user_id)) then raise exception '승인 권한이 없어요'; end if;
  v_noun := case when r.kind = 'trip' then '출장' else '휴가' end;
  v_txt := private.absence_label(r.kind, r.days, r.place) || ' (' || private.absence_when(r.date, r.end_date) || ')';
  if p_ok then
    perform private.absence_apply(p_id, auth.uid(), false);
    insert into public.notices (user_id, kind, text, absence_id) values (r.user_id, 'absence', v_noun || ' 신청이 승인됐어요: ' || v_txt, p_id);
  else
    update public.absence_requests set status = 'rejected', reject_reason = coalesce(trim(p_reason), ''), decided_by = auth.uid(), decided_at = now() where id = p_id;
    insert into public.notices (user_id, kind, text, absence_id)
    values (r.user_id, 'absence', v_noun || ' 신청이 반려됐어요: ' || v_txt || case when coalesce(trim(p_reason), '') <> '' then ' 사유: ' || trim(p_reason) else '' end, p_id);
  end if;
  -- 다른 승인자에게 간 신청 알림은 읽음으로
  update public.notices set read = true where absence_id = p_id and user_id <> r.user_id;
end $$;
revoke all on function public.decide_absence(uuid, boolean, text) from public;
grant execute on function public.decide_absence(uuid, boolean, text) to authenticated;

-- 취소 (신청한 본인). 승인된 건은 일정도 지운다 (지난 기간은 취소 불가)
create or replace function public.cancel_absence(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.absence_requests; v_name text;
begin
  select * into r from public.absence_requests where id = p_id for update;
  if r.id is null or r.user_id <> auth.uid() then raise exception '신청을 찾을 수 없어요'; end if;
  if r.status not in ('pending', 'approved') then raise exception '이미 처리된 신청이에요'; end if;
  if r.status = 'approved' and coalesce(r.end_date, r.date) < (now() at time zone 'Asia/Seoul')::date then raise exception '지난 기간은 취소할 수 없어요'; end if;
  if r.status = 'approved' and r.event_id is not null then
    delete from public.events where id = r.event_id; -- 아래 트리거가 "취소"로 바꾸고 알린다
    return;
  end if;
  update public.absence_requests set status = 'canceled' where id = p_id;
  update public.notices set read = true where absence_id = p_id;
  select name into v_name from public.profiles where id = r.user_id;
  insert into public.notices (user_id, kind, text, absence_id)
  select a, 'absence', coalesce(v_name, '') || '님이 ' || (case when r.kind = 'trip' then '출장' else '휴가' end) || ' 신청을 취소했어요: '
    || private.absence_label(r.kind, r.days, r.place) || ' (' || private.absence_when(r.date, r.end_date) || ')', p_id
  from private.absence_approvers(r.team_id, r.user_id) a;
end $$;
revoke all on function public.cancel_absence(uuid) from public;
grant execute on function public.cancel_absence(uuid) to authenticated;

-- 승인으로 생긴 일정을 지우면 신청도 "취소"로 (연차가 돌아온다)
create or replace function private.on_absence_event_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
declare r public.absence_requests; v_name text;
begin
  update public.absence_requests set status = 'canceled' where event_id = old.id and status = 'approved' returning * into r;
  if r.id is null then return old; end if;
  select name into v_name from public.profiles where id = r.user_id;
  insert into public.notices (user_id, kind, text, absence_id)
  select a, 'absence', coalesce(v_name, '') || '님이 ' || (case when r.kind = 'trip' then '출장' else '휴가' end) || ' 신청을 취소했어요: '
    || private.absence_label(r.kind, r.days, r.place) || ' (' || private.absence_when(r.date, r.end_date) || ')', r.id
  from private.absence_approvers(r.team_id, r.user_id) a;
  return old;
end $$;
drop trigger if exists events_absence_deleted on public.events;
create trigger events_absence_deleted before delete on public.events for each row execute function private.on_absence_event_deleted();

-- 자동 승인 설정 (팀장·관리자)
create or replace function public.set_auto_approve(p_mode text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_mode not in ('none', 'all', 'trip', 'leave') then raise exception '설정 값을 확인해 주세요'; end if;
  if not exists (select 1 from public.members where user_id = auth.uid() and team_id = public.my_team_id() and (role = 'leader' or is_admin)) then
    raise exception '팀장이나 관리자만 바꿀 수 있어요';
  end if;
  update public.teams set auto_approve = p_mode where id = public.my_team_id();
end $$;
revoke all on function public.set_auto_approve(text) from public;
grant execute on function public.set_auto_approve(text) to authenticated;

-- 팀원 총 연차 (팀장·관리자)
create or replace function public.set_leave_total(p_user uuid, p_total numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_total is null or p_total < 0 or p_total > 100 then raise exception '연차 일수를 확인해 주세요'; end if;
  if not exists (select 1 from public.members where user_id = auth.uid() and team_id = public.my_team_id() and (role = 'leader' or is_admin)) then
    raise exception '팀장이나 관리자만 바꿀 수 있어요';
  end if;
  update public.members set leave_total = p_total where user_id = p_user and team_id = public.my_team_id();
end $$;
revoke all on function public.set_leave_total(uuid, numeric) from public;
grant execute on function public.set_leave_total(uuid, numeric) to authenticated;
