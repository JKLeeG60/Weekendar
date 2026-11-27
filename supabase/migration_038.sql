-- migration_038: 아침 브리핑 (평일 아침에 오늘 일정·할 일·마감·팀 부재를 휴대폰 알림 하나로)
-- · 본인 행 수정 권한(profiles_update)은 이미 있다.
-- · 보내는 일은 1분마다 도는 'weekendar-remind' 작업(api/push.ts)이 함께 한다.

alter table public.profiles add column if not exists brief_on boolean not null default true;
alter table public.profiles add column if not exists brief_time text not null default '08:30';
alter table public.profiles add column if not exists brief_days text not null default 'weekdays';
alter table public.profiles drop constraint if exists profiles_brief_time_check;
alter table public.profiles add constraint profiles_brief_time_check check (brief_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
alter table public.profiles drop constraint if exists profiles_brief_days_check;
alter table public.profiles add constraint profiles_brief_days_check check (brief_days in ('weekdays', 'daily'));

-- 하루에 한 번만 보내도록 기록 (서버만 씀)
create table if not exists public.brief_log (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.brief_log enable row level security;

-- 30일 지난 기록은 정리
create or replace function private.purge_brief_log() returns void
language sql security definer set search_path = public as $$
  delete from public.brief_log where day < (now() at time zone 'Asia/Seoul')::date - 30
$$;
select cron.unschedule(jobid) from cron.job where jobname = 'weekendar-brief-purge';
select cron.schedule('weekendar-brief-purge', '10 19 * * *', $job$select private.purge_brief_log()$job$);
