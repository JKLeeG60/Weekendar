import { supabase } from './supabase'
import { t } from './i18n'

// 구글 캘린더에 추가 (Weekendar → 구글, 한 방향): 일정마다 토글을 켠 것만 보낸다
// 구글의 "Weekendar" 캘린더를 만들고 그 안의 일정만 다루는 가장 좁은 권한
const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'
const PENDING = 'weekendar-gcal-pending'

export type GcalStatus = { connected: boolean; broken: boolean }

export async function gcalStatus(): Promise<GcalStatus> {
  const { data, error } = await supabase.rpc('google_link_status')
  if (error || !data || !data[0]) return { connected: false, broken: false }
  return { connected: true, broken: data[0].status === 'error' }
}

/** 구글 권한 화면으로 이동 (돌아오면 finishGcalConnect 가 마무리) */
export async function connectGcal() {
  try { localStorage.setItem(PENDING, '1') } catch { /* 무시 */ }
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      scopes: SCOPE,
      queryParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' },
    },
  })
}

async function fullSync(): Promise<{ sent: number; failed: number } | null> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return null
  return fetch('/api/gcal', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ kind: 'full' }) })
    .then((r) => r.json()).then((j) => (j && typeof j.sent === 'number' ? j : null)).catch(() => null)
}

/** 구글 화면에서 돌아온 직후: 연결 열쇠를 저장하고 토글을 켠 일정을 한 번에 보냄. 안내 문구를 돌려준다. */
export async function finishGcalConnect(): Promise<string | null> {
  let pending = false
  try { pending = localStorage.getItem(PENDING) === '1'; localStorage.removeItem(PENDING) } catch { /* 무시 */ }
  if (!pending) return null
  const { data } = await supabase.auth.getSession()
  const refresh = data.session?.provider_refresh_token
  if (!refresh) return t('구글 캘린더 권한을 받지 못했어요. 권한 화면에서 캘린더 항목을 체크했는지 확인 후 다시 연결해주세요.')
  const { error } = await supabase.rpc('save_google_link', { p_refresh: refresh })
  if (error) return t('구글 캘린더 연결을 저장하지 못했어요. (migration_022 실행 여부 확인)')
  const r = await fullSync()
  if (!r) return t('연결은 됐지만 기존 일정을 보내지 못했어요. "다시 보내기"를 눌러주세요.')
  return r.failed ? t('구글 캘린더에 일정 {n}개를 보냈어요. ({f}개 실패)', { n: r.sent, f: r.failed }) : t('구글 캘린더에 연결했어요. 일정 {n}개를 보냈어요', { n: r.sent })
}

export async function resyncGcal(): Promise<string> {
  const r = await fullSync()
  return r ? t('구글 캘린더에 일정 {n}개를 다시 보냈어요', { n: r.sent }) : t('보내지 못했어요. 잠시 후 다시 시도해주세요')
}

export async function disconnectGcal() {
  await supabase.rpc('delete_google_link')
}
