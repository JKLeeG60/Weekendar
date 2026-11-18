import { supabase } from './supabase'
import { t } from './i18n'
import type { ModalState } from './ui'

// 구글 캘린더에 추가 (Weekendar → 구글, 한 방향): 일정마다 토글을 켠 것만 보낸다
// 구글의 "Weekendar" 캘린더를 만들고 그 안의 일정만 다루는 가장 좁은 권한
const SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'
const PENDING = 'weekendar-gcal-pending'
const DRAFT = 'weekendar-gcal-draft' // [연결]을 누를 때 쓰던 일정 창

export type GcalStatus = { connected: boolean; broken: boolean }

export async function gcalStatus(): Promise<GcalStatus> {
  const { data, error } = await supabase.rpc('google_link_status')
  if (error || !data || !data[0]) return { connected: false, broken: false }
  return { connected: true, broken: data[0].status === 'error' }
}

/** 구글 권한 화면으로 이동 (돌아오면 finishGcalConnect 가 마무리)
 *  back: 돌아온 뒤 다시 열 창 · email: 지금 로그인한 계정 (계정 고르는 화면을 건너뜀) */
export async function connectGcal(back?: ModalState, email?: string) {
  try {
    localStorage.setItem(PENDING, '1')
    if (back) localStorage.setItem(DRAFT, JSON.stringify(back))
  } catch { /* 무시 */ }
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      scopes: SCOPE,
      queryParams: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', ...(email ? { login_hint: email } : {}) },
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

/** 구글 화면에서 돌아온 직후: 연결 열쇠를 저장하고 토글을 켠 일정을 한 번에 보냄.
 *  안내 문구와, 다시 열 일정 창(있으면)을 돌려준다. */
export async function finishGcalConnect(): Promise<{ msg: string; back?: ModalState } | null> {
  let pending = false
  let back: ModalState | undefined
  try {
    pending = localStorage.getItem(PENDING) === '1'
    const raw = localStorage.getItem(DRAFT)
    if (raw) back = JSON.parse(raw)
    localStorage.removeItem(PENDING); localStorage.removeItem(DRAFT)
  } catch { /* 무시 */ }
  if (!pending) return null
  const { data } = await supabase.auth.getSession()
  const refresh = data.session?.provider_refresh_token
  if (!refresh) return { msg: t('구글 캘린더 권한을 받지 못했어요. 권한 화면에서 캘린더 항목을 체크했는지 확인 후 다시 연결해주세요.') }
  const { error } = await supabase.rpc('save_google_link', { p_refresh: refresh })
  if (error) return { msg: t('구글 캘린더 연결을 저장하지 못했어요. (migration_022 실행 여부 확인)') }
  await fullSync() // 예전에 토글을 켜 둔 일정이 있으면 함께 보냄
  return { msg: t('구글 캘린더에 연결했어요'), back }
}

export async function disconnectGcal() {
  await supabase.rpc('delete_google_link')
}
