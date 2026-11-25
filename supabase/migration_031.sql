-- ───────── 031. 대화 보관 기간 ─────────
-- 팀마다 대화를 얼마나 보관할지 (일 수). 비어 있으면 영구 보관(기본값).
-- 바꾸기: 팀 관리 권한(teams_update 정책: is_my_team_admin)이 있는 사람만.
alter table public.teams add column if not exists chat_retention_days int
  check (chat_retention_days is null or chat_retention_days in (90, 180, 365, 1095));

-- 우리 팀 대화가 차지하는 용량(바이트): 메시지 + 반응 + 읽음 기록
create or replace function public.team_chat_usage() returns bigint
language sql stable security definer set search_path = public as $$
  select case when not public.is_active_member() then 0::bigint else
    coalesce((select sum(pg_column_size(m.*)) from public.messages m where m.team_id = public.my_team_id()), 0)::bigint
    + coalesce((select sum(pg_column_size(r.*)) from public.message_reactions r join public.messages m on m.id = r.message_id where m.team_id = public.my_team_id()), 0)::bigint
    + coalesce((select sum(pg_column_size(x.*)) from public.message_reads x join public.messages m on m.id = x.message_id where m.team_id = public.my_team_id()), 0)::bigint
  end
$$;
grant execute on function public.team_chat_usage() to authenticated;

-- 매일 새벽: 보관 기간이 지난 대화 지우기 (공지로 등록한 메시지는 남긴다)
create or replace function private.purge_old_chats() returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.messages m
  using public.teams t
  where m.team_id = t.id
    and t.chat_retention_days is not null
    and m.created_at < now() - make_interval(days => t.chat_retention_days)
    and not exists (select 1 from public.chat_pins p where p.message_id = m.id);
end $$;

-- 매일 한국 시간 새벽 4시 (UTC 19시)
select cron.unschedule(jobid) from cron.job where jobname = 'weekendar-chat-retention';
select cron.schedule('weekendar-chat-retention', '0 19 * * *', $job$select private.purge_old_chats()$job$);
