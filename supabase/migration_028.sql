-- migration_028: 할 일 하위 단계(한 단계까지) + 직접 정한 순서
-- Supabase SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전합니다.

-- 상위 할 일 (지우면 하위도 함께 지워짐) / 목록 안 순서 (작을수록 위, 비어 있으면 예전처럼)
alter table public.todos add column if not exists parent_id uuid references public.todos(id) on delete cascade;
alter table public.todos add column if not exists position double precision;
create index if not exists todos_parent_idx on public.todos(parent_id);

-- 상위 할 일은 같은 사람의 것이어야 하고, 하위의 하위는 만들 수 없게 (한 단계까지)
create or replace function private.check_todo_parent() returns trigger
language plpgsql security definer set search_path = public as $$
declare p public.todos;
begin
  if new.parent_id is null then return new; end if;
  if new.parent_id = new.id then raise exception '자기 자신의 하위로 넣을 수 없어요'; end if;
  select * into p from public.todos where id = new.parent_id;
  if not found or p.owner_id <> new.owner_id then raise exception '상위 할 일을 찾을 수 없어요'; end if;
  if p.parent_id is not null then raise exception '하위 할 일은 한 단계까지만 만들 수 있어요'; end if;
  if exists (select 1 from public.todos c where c.parent_id = new.id) then raise exception '하위 할 일이 있는 할 일은 다른 할 일의 하위로 넣을 수 없어요'; end if;
  return new;
end $$;
drop trigger if exists todos_parent_check on public.todos;
create trigger todos_parent_check before insert or update of parent_id on public.todos
  for each row execute function private.check_todo_parent();
