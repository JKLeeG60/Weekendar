import { supabase } from './supabase'

// 휴대폰 알림(웹 푸쉬) 켜기/끄기
const FLAG = 'weekendar-push-on'

export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
/** 이 기기에서 푸쉬를 켜 두었는지 (켜져 있으면 앱 화면의 창 알림은 생략해 중복을 막음) */
export const pushOnHere = () => { try { return localStorage.getItem(FLAG) === '1' } catch { return false } }

export function registerSW() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) })
}

const b64ToBytes = (b64: string) => {
  const s = (b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(s)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

async function currentSub() {
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}

/** 이 기기의 상태: on / off */
export async function pushState(): Promise<'on' | 'off'> {
  if (!pushSupported() || Notification.permission !== 'granted') return 'off'
  const sub = await currentSub()
  return sub && pushOnHere() ? 'on' : 'off'
}

export async function enablePush(): Promise<string | null> {
  if (!pushSupported()) return '이 브라우저는 휴대폰 알림을 지원하지 않아요.'
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return '알림 권한이 허용되지 않았어요. 기기 설정에서 Weekendar 알림을 허용해주세요.'
  const r = await fetch('/api/push').then((x) => x.json()).catch(() => null)
  if (!r || !r.publicKey) return '서버에 알림 설정이 아직 없어요. (Vercel 환경 변수 확인)'
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'))
  await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(r.publicKey) })
  const j = sub.toJSON()
  const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth })
  if (error) return '기기를 등록하지 못했어요. (migration_009 실행 여부 확인)'
  try { localStorage.setItem(FLAG, '1') } catch { /* 무시 */ }
  return null
}

export async function disablePush() {
  const sub = await currentSub()
  if (sub) {
    await supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint })
    await sub.unsubscribe().catch(() => {})
  }
  try { localStorage.removeItem(FLAG) } catch { /* 무시 */ }
}

export async function sendTestPush(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) return '로그인이 필요해요.'
  const r = await fetch('/api/push', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ kind: 'test' }) })
    .then((x) => x.json()).catch(() => null)
  if (!r) return '서버에 연결하지 못했어요.'
  if (r.error) return '서버 설정을 확인해주세요. (' + r.error + ')'
  if (!r.sent) return '등록된 기기가 없어요. 알림을 다시 켜주세요.'
  return null
}
