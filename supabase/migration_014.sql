-- migration_014: 팀 나가기 + 관리자 넘기기
-- 팀 나가기: 소속, 내 일정·할 일, 내가 보냈거나 받은 대기 요청, 대화 읽음 정보, 캘린더 구독 주소를 지운다.
--            팀 대화에 남긴 메시지는 팀의 기록이므로 남겨 둔다.
-- 관리자는 다른 구성원이 있으면 관리자를 넘겨야 나갈 수 있다. 혼자 남은 관리자가 나가면 팀도 함께 삭제한다.

-- 관리자 넘기기: 지정한 구성원이 관리자가 되고, 나는 일반 구성원이 된다
create or replace function public.transfer_admin(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  select team_id into t from public.members where user_id = auth.uid() and is_admin;
  if t is null then raise exception '관리자만 넘길 수 있습니다'; end if;
  if p_user = auth.uid() then raise exception '자기 자신에게는 넘길 수 없습니다'; end if;
  if not exists (select 1 from public.members where user_id = p_user and team_id = t and role <> 'pending') then
    raise exception '같은 팀의 승인된 구성원에게만 넘길 수 있습니다';
  end if;
  update public.members set is_admin = true where user_id = p_user;
  -- '관리자 전용(표 미표시)'이던 사람은 일반 팀원으로
  update public.members set is_admin = false, role = case when role = 'none' then 'member' else role end where user_id = auth.uid();
  insert into public.notices (user_id, kind, text) values (p_user, 'result', '관리자 권한을 넘겨받았어요. 이제 팀 관리 메뉴를 쓸 수 있어요.');
end $$;

drop function if exists public.leave_team();
create or replace function public.leave_team(p_new_admin uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare t uuid; adm boolean; others int;
begin
  if auth.uid() is null then raise exception '로그인이 필요합니다'; end if;
  select team_id, is_admin into t, adm from public.members where user_id = auth.uid();
  if t is null then raise exception '소속된 팀이 없습니다'; end if;
  select count(*) into others from public.members where team_id = t and user_id <> auth.uid();
  if adm and others > 0 then
    if p_new_admin is null then raise exception '관리자는 관리자를 넘긴 뒤 나갈 수 있습니다'; end if;
    perform public.transfer_admin(p_new_admin);
  end if;

  delete from public.requests where team_id = t and status = 'pending' and (requester_id = auth.uid() or leader_id = auth.uid());
  delete from public.events where owner_id = auth.uid();
  delete from public.todos where owner_id = auth.uid();
  delete from public.chat_reads where user_id = auth.uid();
  delete from public.calendar_tokens where user_id = auth.uid();
  delete from public.members where user_id = auth.uid();
  -- 마지막 구성원이었다면 팀도 삭제 (팀 대화·요청 등은 함께 정리됨)
  if others = 0 then delete from public.teams where id = t; end if;
end $$;

grant execute on function public.transfer_admin(uuid), public.leave_team(uuid) to authenticated;
