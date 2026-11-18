-- migration_024: 약관 동의 기록 + Weekendar 탈퇴(계정 삭제)
-- Supabase SQL Editor 에 붙여넣고 Run. 여러 번 실행해도 안전합니다.

-- ① 약관 동의 기록: 동의한 약관 버전과 시각 (0 = 아직 동의 안 함)
alter table public.profiles add column if not exists terms_version int not null default 0;
alter table public.profiles add column if not exists terms_agreed_at timestamptz;

-- 약관 동의 (본인만, 버전은 올리기만 가능)
create or replace function public.agree_terms(p_version int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception '로그인이 필요해요'; end if;
  update public.profiles
     set terms_version = greatest(terms_version, p_version), terms_agreed_at = now()
   where id = auth.uid();
end $$;
grant execute on function public.agree_terms(int) to authenticated;

-- ② 탈퇴: 팀에 속하지 않은 본인 계정을 지운다
--    auth.users 를 지우면 profiles 와 내 일정·할 일·대화·알림·구글 연결이 함께 지워진다 (on delete cascade)
create or replace function public.delete_account()
returns void language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception '로그인이 필요해요'; end if;
  if exists (select 1 from public.members where user_id = me) then
    raise exception '팀에서 먼저 나간 뒤 탈퇴할 수 있어요';
  end if;
  -- 내가 만든 팀 기록은 남기고 만든 사람만 비운다 (이 칸은 연쇄 삭제가 아님)
  update public.teams set created_by = null where created_by = me;
  delete from auth.users where id = me;
end $$;
grant execute on function public.delete_account() to authenticated;
