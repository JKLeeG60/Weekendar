-- Weekendar 마이그레이션 8: 구성원 삭제 시 그 사람의 데이터 정리 (SQL Editor에서 Run)
-- 관리자가 구성원을 삭제하면 소속, 일정, 할 일, 관련 대기 요청, 대화 읽음 정보를 한 번에 지운다.
-- 팀 대화에 남긴 메시지는 팀의 기록이므로 남겨 둔다.

create or replace function public.remove_member(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  select team_id into t from public.members where user_id = p_user;
  if t is null then raise exception '구성원을 찾을 수 없습니다'; end if;
  if not public.is_my_team_admin(t) then raise exception '관리자만 삭제할 수 있습니다'; end if;
  if p_user = auth.uid() then raise exception '자기 자신은 삭제할 수 없습니다'; end if;

  delete from public.requests where team_id = t and status = 'pending' and (requester_id = p_user or leader_id = p_user);
  delete from public.events where owner_id = p_user;
  delete from public.todos where owner_id = p_user;
  delete from public.chat_reads where user_id = p_user;
  delete from public.calendar_tokens where user_id = p_user;
  delete from public.members where user_id = p_user;
end $$;

grant execute on function public.remove_member(uuid) to authenticated;
