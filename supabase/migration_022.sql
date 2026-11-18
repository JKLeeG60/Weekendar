-- ───────── 구글 캘린더에 추가 (migration_022) ─────────
-- 일정마다 "구글 캘린더에 추가" 토글(기본 꺼짐). 켠 일정만 구글의 "Weekendar" 캘린더로 보낸다 (Weekendar → 구글, 한 방향).
-- 고치면 구글도 고치고, 지우거나 토글을 끄면 구글에서도 지운다.
-- (예전에 비워 둔 migration_010 의 "모든 일정 보내기"를 일정별 토글 방식으로 바꾼 것. 010 은 실행하지 않는다)

alter table public.events add column if not exists gcal boolean not null default false;

-- 사람마다 구글 연결 정보 (연결 열쇠는 서버만 읽음: select 정책 없음)
create table if not exists public.google_links (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  refresh_token text not null,
  calendar_id text,
  status text not null default 'ok' check (status in ('ok', 'error')),
  connected_at timestamptz not null default now()
);
alter table public.google_links enable row level security;

create or replace function public.save_google_link(p_refresh text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  if coalesce(p_refresh, '') = '' then raise exception '구글 연결 정보가 없습니다'; end if;
  insert into public.google_links (user_id, refresh_token) values (auth.uid(), p_refresh)
  on conflict (user_id) do update set refresh_token = excluded.refresh_token, status = 'ok', connected_at = now();
end $$;

create or replace function public.delete_google_link() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.google_links where user_id = auth.uid();
end $$;

-- 화면 표시용: 연결 여부와 상태만 (열쇠는 돌려주지 않음)
create or replace function public.google_link_status() returns table (connected boolean, status text, connected_at timestamptz)
language sql security definer set search_path = public as $$
  select true, g.status, g.connected_at from public.google_links g where g.user_id = auth.uid();
$$;

grant execute on function public.save_google_link(text), public.delete_google_link(), public.google_link_status() to authenticated;

-- /api/gcal 호출 (실패해도 일정 저장은 그대로 진행)
create or replace function private.gcal_call(p_body jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare u text; s text;
begin
  select value into u from private.config where key = 'push_url';
  select value into s from private.config where key = 'push_secret';
  if u is null or s is null then return; end if;
  perform net.http_post(
    url := u || '/api/gcal',
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', s)
  );
exception when others then
  raise warning 'gcal_call 실패: %', sqlerrm;
end $$;

-- 일정이 바뀔 때: 구글에 연결한 사람의, 토글을 켠(또는 방금 끈) 일정만
create or replace function private.on_event_gcal() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_kind text;
begin
  if tg_op = 'DELETE' then
    if not old.gcal then return null; end if;
    r := old; v_kind := 'delete';
  elsif tg_op = 'INSERT' then
    if not new.gcal then return null; end if;
    r := new; v_kind := 'upsert';
  else
    if not new.gcal and not old.gcal then return null; end if;
    r := new; v_kind := case when new.gcal then 'upsert' else 'delete' end; -- 토글을 끄면 구글에서 지움
  end if;
  if exists (select 1 from public.google_links where user_id = r.owner_id and status = 'ok') then
    perform private.gcal_call(jsonb_build_object('kind', v_kind, 'event_id', r.id, 'user_id', r.owner_id));
  end if;
  return null;
end $$;
drop trigger if exists events_gcal on public.events;
create trigger events_gcal after insert or update or delete on public.events for each row execute function private.on_event_gcal();
