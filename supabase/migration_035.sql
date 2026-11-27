-- ───────── 035. 업무 배정 ─────────
-- 팀장·관리자가 팀원에게 할 일을 맡긴다 (담당자마다 할 일 하나씩)
--  - 담당자: 할 일 맨 위 "배정받은 업무"에 보임. 체크(완료)만 할 수 있고, 내용 수정·삭제는 못 함
--  - 배정한 사람: "내가 배정한 업무"에서 진행 상황을 보고, 수정·취소할 수 있음
--  - 알림: 배정·수정·취소 → 담당자, 완료 → 배정한 사람 (푸쉬 + 화면 오른쪽 아래 팝업)
-- Supabase SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전합니다.

alter table public.todos add column if not exists assigned_by uuid references public.profiles(id) on delete set null;
alter table public.todos add column if not exists due_date date;
alter table public.todos add column if not exists due_time text;
alter table public.todos add column if not exists note text;
create index if not exists todos_assigned_idx on public.todos(assigned_by) where assigned_by is not null;

-- 할 일 보기·고치기: 내 할 일 + 내가 배정한 할 일
drop policy if exists todos_all on public.todos;
drop policy if exists todos_select on public.todos;
drop policy if exists todos_insert on public.todos;
drop policy if exists todos_update on public.todos;
drop policy if exists todos_delete on public.todos;
create policy todos_select on public.todos for select to authenticated
  using (owner_id = auth.uid() or assigned_by = auth.uid());
-- 직접 넣는 건 내 할 일만 (배정은 assign_task 함수로)
create policy todos_insert on public.todos for insert to authenticated
  with check (owner_id = auth.uid() and (assigned_by is null or assigned_by = auth.uid()));
create policy todos_update on public.todos for update to authenticated
  using (owner_id = auth.uid() or assigned_by = auth.uid())
  with check (owner_id = auth.uid() or assigned_by = auth.uid());
create policy todos_delete on public.todos for delete to authenticated
  using (owner_id = auth.uid() or assigned_by = auth.uid());

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
  v_when := case when p_due_date is null then '' else ' (' || extract(month from p_due_date)::int || '/' || extract(day from p_due_date)::int
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

-- 담당자는 내용을 못 바꾸고 지울 수 없다 (체크·순서·날짜만). 함수 안(서버)에서 하는 정리는 막지 않는다
-- (security invoker: 사용자가 직접 할 때만 current_user 가 authenticated 이고, 서버 함수 안에서는 막지 않는다)
create or replace function private.guard_assigned_todo() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if current_user <> 'authenticated' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    if old.assigned_by is not null and old.assigned_by <> auth.uid() and old.owner_id = auth.uid() then
      raise exception '배정받은 업무는 지울 수 없어요';
    end if;
    return old;
  end if;
  if old.assigned_by is distinct from new.assigned_by and not (old.assigned_by = auth.uid() and new.assigned_by is null) then
    raise exception '배정한 사람은 바꿀 수 없어요';
  end if;
  if old.assigned_by is not null and old.assigned_by <> auth.uid()
     and row(new.title, new.due_date, new.due_time, new.note) is distinct from row(old.title, old.due_date, old.due_time, old.note) then
    raise exception '배정받은 업무 내용은 배정한 사람만 바꿀 수 있어요';
  end if;
  -- 배정한 사람은 내용만 바꾸고, 담당자의 체크·순서는 건드리지 않는다
  if old.assigned_by = auth.uid() and old.owner_id <> auth.uid()
     and row(new.owner_id, new.done, new.parent_id) is distinct from row(old.owner_id, old.done, old.parent_id) then
    raise exception '담당자의 진행 상황은 바꿀 수 없어요';
  end if;
  return new;
end $$;
drop trigger if exists todos_assigned_guard on public.todos;
create trigger todos_assigned_guard before update or delete on public.todos
  for each row execute function private.guard_assigned_todo();

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
      || case when new.due_date is null then '' else ' (' || extract(month from new.due_date)::int || '/' || extract(day from new.due_date)::int
         || coalesce(' ' || new.due_time, '') || ' 마감)' end);
  end if;
  return new;
end $$;
drop trigger if exists todos_assigned_changed on public.todos;
create trigger todos_assigned_changed after update on public.todos
  for each row execute function private.on_assigned_todo_changed();

-- 알림: 배정한 사람이 지움(취소) → 담당자
create or replace function private.on_assigned_todo_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_name text;
begin
  if old.assigned_by is null or old.assigned_by <> auth.uid() or old.owner_id = auth.uid() or old.done then return old; end if;
  select name into v_name from public.profiles where id = old.assigned_by;
  insert into public.notices (user_id, kind, text)
  values (old.owner_id, 'assign', coalesce(v_name, '') || '님이 배정한 업무를 취소했어요: ' || old.title);
  return old;
end $$;
drop trigger if exists todos_assigned_deleted on public.todos;
create trigger todos_assigned_deleted after delete on public.todos
  for each row execute function private.on_assigned_todo_deleted();
