-- Weekendar 마이그레이션 2: 앱 코드와 DB를 맞추는 보완 (SQL Editor에서 Run)

alter table public.events add column if not exists until date;
alter table public.todos  add column if not exists priority boolean not null default false;

-- 요청 처리 결과 알림 종류를 앱과 맞춤('result'), 팀장의 요청 알림은 읽음 처리,
-- 반복 일정 수정 시 날짜는 유지
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
      insert into public.events (owner_id, title, date, start_time, end_time, place, category, repeat_rule, shared)
      values (r.leader_id, pl->>'title', (pl->>'date')::date, pl->>'start', pl->>'end',
              coalesce(pl->>'place',''), 'meeting', 'none', true);
    elsif r.type = 'edit' and r.event_id is not null then
      update public.events set
        title = coalesce(pl->>'title', title),
        date = case when repeat_rule = 'none' then coalesce((pl->>'date')::date, date) else date end,
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

-- 요청 알림 문구를 앱과 동일하게
create or replace function public.notify_new_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  select name into nm from public.profiles where id = new.requester_id;
  insert into public.notices (user_id, kind, text, request_id)
  values (new.leader_id, 'request',
    nm || '님이 일정 ' || case new.type when 'add' then '추가' when 'edit' then '수정' else '삭제' end || '을(를) 요청했습니다.',
    new.id);
  return new;
end $$;
