-- migration_036: 알림 문장 속 날짜 표기 통일 "11/28" → "11. 28.(금)"
-- (화면의 모든 날짜를 "1. 1.(월)" 형식으로 맞춤. 영어 화면은 앱·푸쉬가 "Fri 11/28" 로 바꿔 보여 줌)

-- 날짜 → "11. 28.(금)"
create or replace function private.md_ko(d date) returns text
language sql immutable as $$
  select extract(month from d)::int || '. ' || extract(day from d)::int || '.('
    || substr('일월화수목금토', extract(dow from d)::int + 1, 1) || ')'
$$;

-- 일정의 "언제"를 짧은 글로 (예: 11. 18.(수) 14:00–15:00, 11. 18.(수)~11. 20.(금))
create or replace function private.ev_when(d date, ed date, s text, e text) returns text
language sql immutable as $$
  select case when coalesce(ed, d) > d
    then private.md_ko(d) || '~' || private.md_ko(ed)
    else private.md_ko(d) || ' ' || s || '–' || e end
$$;

-- 업무 배정 (팀장·관리자만). 담당자마다 할 일 하나씩 만들고 알림
create or replace function public.assign_task(p_title text, p_users uuid[], p_due_date date, p_due_time text default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_name text; v_when text;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if not exists (select 1 from public.members where user_id = auth.uid() and team_id = public.my_team_id() and (role = 'leader' or is_admin)) then
    raise exception '팀장이나 관리자만 업무를 배정할 수 있어요';
  end if;
  if coalesce(trim(p_title), '') = '' then raise exception '업무 내용을 적어 주세요'; end if;
  select name into v_name from public.profiles where id = auth.uid();
  v_when := case when p_due_date is null then '' else ' (' || private.md_ko(p_due_date)
    || coalesce(' ' || nullif(p_due_time, ''), '') || ' 마감)' end;
  with made as (
    insert into public.todos (owner_id, title, date, assigned_by, due_date, due_time, note)
    select u, trim(p_title), (now() at time zone 'Asia/Seoul')::date, auth.uid(), p_due_date, nullif(p_due_time, ''), nullif(trim(coalesce(p_note, '')), '')
    from unnest(coalesce(p_users, '{}')) as u
    where u <> auth.uid() and exists (select 1 from public.members m where m.user_id = u and m.team_id = public.my_team_id() and m.role <> 'pending')
    returning owner_id
  )
  insert into public.notices (user_id, kind, text)
  select owner_id, 'assign', coalesce(v_name, '') || '님이 업무를 배정했어요: ' || trim(p_title) || v_when from made;
end $$;
revoke all on function public.assign_task(text, uuid[], date, text, text) from public;
grant execute on function public.assign_task(text, uuid[], date, text, text) to authenticated;

-- 알림: 완료 → 배정한 사람 / 내용 수정 → 담당자
create or replace function private.on_assigned_todo_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if new.assigned_by is null or new.assigned_by = new.owner_id then return new; end if;
  if new.done and not old.done then
    select name into v_name from public.profiles where id = new.owner_id;
    insert into public.notices (user_id, kind, text)
    values (new.assigned_by, 'done', coalesce(v_name, '') || '님이 배정한 업무를 끝냈어요: ' || new.title);
  elsif row(new.title, new.due_date, new.due_time, new.note) is distinct from row(old.title, old.due_date, old.due_time, old.note) then
    select name into v_name from public.profiles where id = new.assigned_by;
    insert into public.notices (user_id, kind, text)
    values (new.owner_id, 'assign', coalesce(v_name, '') || '님이 배정한 업무를 바꿨어요: ' || new.title
      || case when new.due_date is null then '' else ' (' || private.md_ko(new.due_date)
         || coalesce(' ' || new.due_time, '') || ' 마감)' end);
  end if;
  return new;
end $$;
