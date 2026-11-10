-- migration_009: 휴대폰 푸쉬 알림
-- 1) push_subscriptions : 사람마다 "알림 받을 기기" 목록
-- 2) 알림이 생기거나(@호출, 동의 요청 등) 1분마다(미리 알림) Vercel 의 /api/push 를 호출
-- 실행 후, 맨 아래 안내대로 비밀값(push_secret)을 한 번 넣어 주세요.

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ───────── 알림 받을 기기 ─────────
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists push_subscriptions_select on public.push_subscriptions;
create policy push_subscriptions_select on public.push_subscriptions for select to authenticated using (user_id = auth.uid());

-- 같은 기기에서 다른 계정으로 바꿔 켜도 되도록, 저장은 함수로만
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (auth.uid(), p_endpoint, p_p256dh, p_auth);
end $$;

create or replace function public.delete_push_subscription(p_endpoint text) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
end $$;

grant execute on function public.save_push_subscription(text, text, text), public.delete_push_subscription(text) to authenticated;

-- 같은 미리 알림을 두 번 보내지 않도록 기록 (서버만 사용)
create table if not exists public.reminder_log (
  event_id uuid not null,
  occ_date date not null,
  start_time text not null,
  remind_min int not null,
  sent_at timestamptz not null default now(),
  primary key (event_id, occ_date, start_time, remind_min)
);
alter table public.reminder_log enable row level security;

-- ───────── 서버 설정 (브라우저에서는 읽을 수 없음) ─────────
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.config (key text primary key, value text not null);
alter table private.config enable row level security;
insert into private.config values ('push_url', 'https://weekendar-eight.vercel.app') on conflict (key) do nothing;

-- /api/push 호출 (실패해도 원래 작업은 그대로 진행)
create or replace function private.push_call(p_body jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare u text; s text;
begin
  select value into u from private.config where key = 'push_url';
  select value into s from private.config where key = 'push_secret';
  if u is null or s is null then return; end if;
  perform net.http_post(
    url := u || '/api/push',
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', s)
  );
exception when others then
  raise warning 'push_call 실패: %', sqlerrm;
end $$;

-- 알림(동의 요청·결과, 참여 요청 등)이 생기면
create or replace function private.on_notice_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform private.push_call(jsonb_build_object('kind', 'notice', 'id', new.id));
  return new;
end $$;
drop trigger if exists notices_push on public.notices;
create trigger notices_push after insert on public.notices for each row execute function private.on_notice_push();

-- 팀 대화에서 누군가를 @로 부르면
create or replace function private.on_message_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.mention_all or coalesce(array_length(new.mentions, 1), 0) > 0 then
    perform private.push_call(jsonb_build_object('kind', 'message', 'id', new.id));
  end if;
  return new;
end $$;
drop trigger if exists messages_push on public.messages;
create trigger messages_push after insert on public.messages for each row execute function private.on_message_push();

-- 미리 알림: 1분마다 확인
select cron.unschedule(jobid) from cron.job where jobname = 'weekendar-remind';
select cron.schedule('weekendar-remind', '* * * * *', $job$select private.push_call('{"kind":"remind"}'::jsonb)$job$);

-- ───────── 실행 후 한 번만: 비밀값 넣기 ─────────
-- 아래 줄의 '여기에_PUSH_SECRET' 을 Vercel 에 넣은 PUSH_SECRET 과 같은 값으로 바꿔 실행하세요.
-- insert into private.config values ('push_secret', '여기에_PUSH_SECRET') on conflict (key) do update set value = excluded.value;
