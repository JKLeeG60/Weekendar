-- migration_013: 팀장 일정 요청에서 고른 카테고리(회의·교육·출장 등)를 동의 시 그대로 반영
-- (migration_012 이후 실행)

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
