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
