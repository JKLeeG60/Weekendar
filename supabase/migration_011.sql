-- migration_011: 여러 날 일정 (예: 월~수 출장)
-- events.end_date 가 있으면 date ~ end_date 기간의 종일 일정이다.

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
