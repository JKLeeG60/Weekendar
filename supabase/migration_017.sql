-- ───────── 대화 답장 · 전달 · 이모지 반응 (migration_017) ─────────
-- 답장: 어떤 메시지에 답했는지 기억한다 (원본이 지워지면 비움)
-- 전달: 다른 대화에서 옮겨 온 메시지 표시
-- 반응: 한 사람이 한 메시지에 이모지 1개만

alter table public.messages add column if not exists reply_to uuid references public.messages(id) on delete set null;
alter table public.messages add column if not exists forwarded boolean not null default false;

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.message_reactions enable row level security;

-- 읽기: 그 메시지를 볼 수 있는 사람 (메시지 읽기 규칙을 그대로 따른다)
drop policy if exists message_reactions_select on public.message_reactions;
create policy message_reactions_select on public.message_reactions for select to authenticated
  using (exists (select 1 from public.messages m where m.id = message_id));

-- 쓰기·바꾸기·지우기: 내 반응만, 볼 수 있고 지워지지 않은 메시지에만
drop policy if exists message_reactions_insert on public.message_reactions;
create policy message_reactions_insert on public.message_reactions for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.messages m where m.id = message_id and m.deleted_at is null));

drop policy if exists message_reactions_update on public.message_reactions;
create policy message_reactions_update on public.message_reactions for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and exists (select 1 from public.messages m where m.id = message_id and m.deleted_at is null));

drop policy if exists message_reactions_delete on public.message_reactions;
create policy message_reactions_delete on public.message_reactions for delete to authenticated
  using (user_id = auth.uid());

-- 메시지를 지우면 달린 반응도 함께 지운다
create or replace function public.delete_message(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.messages set body = '', ref = null, mentions = '{}', mention_all = false, deleted_at = now()
  where id = p_id and author_id = auth.uid();
  if not found then raise exception '내 메시지만 삭제할 수 있습니다'; end if;
  delete from public.message_reactions where message_id = p_id;
end $$;
grant execute on function public.delete_message(uuid) to authenticated;

-- 반응도 실시간으로 (이미 켜져 있으면 무시)
do $$ begin
  alter publication supabase_realtime add table public.message_reactions;
exception when duplicate_object then null; end $$;
