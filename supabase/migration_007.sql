-- Weekendar 마이그레이션 7: 실시간 팀 표, 미리 알림, 캘린더 구독 주소 (SQL Editor에서 Run)

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
