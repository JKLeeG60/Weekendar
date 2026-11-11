// 휴대폰 푸쉬 알림 발송
//  GET  /api/push                         → 브라우저가 기기를 등록할 때 쓰는 공개 키
//  POST /api/push {kind:'test'}           → (로그인한 본인) 내 기기로 테스트 알림
//  POST /api/push {kind:'notice'|'message'|'remind'}  → Supabase 가 호출 (x-push-secret 필요)
// 비밀값은 모두 Vercel 환경 변수에만 있다: SUPABASE_SERVICE_ROLE_KEY, VAPID_PRIVATE_KEY, PUSH_SECRET
import webpush from 'web-push'

const SB = process.env.VITE_SUPABASE_URL || 'https://lgloslfmoetlojuaqage.supabase.co'
const ANON = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_O1eG2Jw3q3BKdAtpba8Khw_ayIyJCMj'
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || ''
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || ''
const SECRET = process.env.PUSH_SECRET || ''

type Payload = { title: string; body: string; tag?: string; url?: string }
type Sub = { id: string; endpoint: string; p256dh: string; auth: string }

// 서버 전용 키로 DB 읽기/쓰기 (RLS 를 건너뜀)
async function db(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { apikey: SR, 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) }
  if (SR.startsWith('eyJ')) headers.Authorization = `Bearer ${SR}` // 예전 형식(service_role JWT) 키
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers })
  if (!r.ok) throw new Error(`db ${r.status} ${await r.text()}`)
  const t = await r.text()
  return t ? JSON.parse(t) : null
}

async function sendTo(userIds: string[], p: Payload) {
  const ids = [...new Set(userIds)].filter((x) => /^[0-9a-f-]{36}$/.test(x))
  if (!ids.length) return 0
  const subs: Sub[] = await db(`push_subscriptions?select=id,endpoint,p256dh,auth&user_id=in.(${ids.join(',')})`)
  let sent = 0
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(p), { TTL: 3600 })
        sent++
      } catch (e: any) {
        // 알림을 끄거나 앱을 지운 기기는 목록에서 정리
        if (e && (e.statusCode === 404 || e.statusCode === 410)) await db(`push_subscriptions?id=eq.${s.id}`, { method: 'DELETE' }).catch(() => {})
      }
    }),
  )
  return sent
}

const nameOf = async (id: string) => {
  const r = await db(`profiles?id=eq.${id}&select=name`)
  return (r && r[0] && r[0].name) || '팀원'
}

async function onNotice(id: string) {
  const r = await db(`notices?id=eq.${id}&select=user_id,text`)
  if (!r || !r[0]) return 0
  return sendTo([r[0].user_id], { title: 'Weekendar', body: r[0].text, tag: 'notice-' + id, url: '/' })
}

async function onMessage(id: string) {
  const r = await db(`messages?id=eq.${id}&select=team_id,author_id,body,mentions,mention_all,deleted_at`)
  const m = r && r[0]
  if (!m || m.deleted_at) return 0
  let to: string[] = m.mentions || []
  if (m.mention_all) {
    const mem = await db(`members?team_id=eq.${m.team_id}&role=neq.pending&select=user_id`)
    to = (mem || []).map((x: any) => x.user_id)
  }
  to = to.filter((u) => u !== m.author_id)
  const who = await nameOf(m.author_id)
  const body = String(m.body || '').slice(0, 140) || '일정을 공유했어요'
  return sendTo(to, { title: `${who}님이 불렀어요`, body, tag: 'msg-' + id, url: '/' })
}

// 미리 알림: 앱 화면(Reminders.tsx)과 같은 규칙으로 오늘 발생하는 일정을 계산
const dowOf = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay()
const dayOf = (d: string) => Number(d.slice(8, 10))
// 공휴일: 앱(src/lib/date.ts)과 같은 규칙. 반복 일정은 공휴일에 미리 알림을 보내지 않는다.
// ※ 공휴일 규칙을 바꾸면 src/lib/date.ts 와 이 부분을 함께 고쳐야 함
const EXTRA_HOLIDAYS: Record<string, string> = { '2026-06-03': '지방선거' }
const pad2 = (n: number) => String(n).padStart(2, '0')
const addDaysStr = (d: string, n: number) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10) }
const isWeekendStr = (d: string) => { const w = dowOf(d); return w === 0 || w === 6 }
const lunarFmt = new Intl.DateTimeFormat('en-u-ca-chinese-nu-latn', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' })
function lunarToSolar(year: number, lm: number, ld: number) {
  for (let i = 0; i < 366; i++) {
    const d = new Date(Date.UTC(year, 0, 1 + i, 3))
    if (d.getUTCFullYear() !== year) break
    const parts = lunarFmt.formatToParts(d)
    if (parts.find((x) => x.type === 'month')?.value === String(lm) && Number(parts.find((x) => x.type === 'day')?.value) === ld)
      return `${year}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`
  }
  return ''
}
const holidayCache = new Map<number, Set<string>>()
function isHoliday(date: string) {
  const year = Number(date.slice(0, 4))
  let set = holidayCache.get(year)
  if (!set) {
    const f = (md: string) => `${year}-${md}`
    type Rule = { name: string; dates: string[]; sub: 'sunday' | 'weekend' | 'none' }
    const rules: Rule[] = [
      { name: '신정', dates: [f('01-01')], sub: 'none' }, { name: '삼일절', dates: [f('03-01')], sub: 'weekend' },
      { name: '어린이날', dates: [f('05-05')], sub: 'weekend' }, { name: '현충일', dates: [f('06-06')], sub: 'none' },
      { name: '광복절', dates: [f('08-15')], sub: 'weekend' }, { name: '개천절', dates: [f('10-03')], sub: 'weekend' },
      { name: '한글날', dates: [f('10-09')], sub: 'weekend' }, { name: '성탄절', dates: [f('12-25')], sub: 'weekend' },
    ]
    if (year >= 2026) rules.push({ name: '노동절', dates: [f('05-01')], sub: 'none' }, { name: '제헌절', dates: [f('07-17')], sub: 'weekend' })
    const seol = lunarToSolar(year, 1, 1), chuseok = lunarToSolar(year, 8, 15), buddha = lunarToSolar(year, 4, 8)
    if (seol) rules.push({ name: '설날', dates: [addDaysStr(seol, -1), seol, addDaysStr(seol, 1)], sub: 'sunday' })
    if (chuseok) rules.push({ name: '추석', dates: [addDaysStr(chuseok, -1), chuseok, addDaysStr(chuseok, 1)], sub: 'sunday' })
    if (buddha) rules.push({ name: '부처님오신날', dates: [buddha], sub: 'weekend' })
    const map: Record<string, string> = {}
    for (const r of rules) r.dates.forEach((d, i) => { map[d] = r.dates.length > 1 && i !== 1 ? `${r.name} 연휴` : r.name })
    for (const [d, n] of Object.entries(EXTRA_HOLIDAYS)) if (d.startsWith(String(year))) map[d] = n
    const origin = { ...map }
    for (const r of [...rules].sort((a, b) => a.dates[0].localeCompare(b.dates[0]))) {
      if (r.sub === 'none') continue
      const hit = r.dates.some((d) => {
        const w = dowOf(d)
        if (w === 0 || (r.sub === 'weekend' && w === 6)) return true
        return Object.keys(origin).some((o) => o === d && origin[o] !== (r.dates.length > 1 ? (d === r.dates[1] ? r.name : `${r.name} 연휴`) : r.name))
      })
      if (!hit) continue
      let d = addDaysStr(r.dates[r.dates.length - 1], 1)
      while (isWeekendStr(d) || map[d]) d = addDaysStr(d, 1)
      map[d] = '대체공휴일'
    }
    set = new Set(Object.keys(map))
    holidayCache.set(year, set)
  }
  return set.has(date)
}

function occursOn(e: any, date: string) {
  if (date < e.date) return false
  if (e.until && date > e.until) return false
  if (e.repeat_rule !== 'none' && date !== e.date && isHoliday(date)) return false
  switch (e.repeat_rule) {
    case 'daily': return true
    case 'weekly': return dowOf(date) === dowOf(e.date)
    case 'monthly': return dayOf(date) === dayOf(e.date)
    default: return date === e.date
  }
}
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/** 남은 시간 문구: 지금 시작해요 / 25분 뒤 시작 / 2시간 30분 뒤 시작 / 내일 09:00 시작 */
function whenLabel(left: number, remind: number, start: string, tomorrow: boolean) {
  if (remind === 0 || left <= 0) return '지금 시작해요'
  if (tomorrow) return `내일 ${start} 시작`
  if (left < 60) return `${left}분 뒤 시작`
  return `${Math.floor(left / 60)}시간${left % 60 ? ` ${left % 60}분` : ''} 뒤 시작`
}

async function onRemind() {
  const seoul = new Date(Date.now() + 9 * 3600 * 1000)
  const today = seoul.toISOString().slice(0, 10)
  const tomorrow = addDaysStr(today, 1)
  const nowMin = seoul.getUTCHours() * 60 + seoul.getUTCMinutes()
  // 하루 전 알림까지 있으므로 내일 일정도 함께 확인
  const evs: any[] = await db(
    `events?select=id,owner_id,title,date,until,start_time,end_time,place,repeat_rule,remind_min&remind_min=not.is.null&date=lte.${tomorrow}&or=(until.is.null,until.gte.${today})`,
  )
  type Due = { e: any; day: string; left: number; isTomorrow: boolean }
  const due: Due[] = []
  for (const [day, offset] of [[today, 0], [tomorrow, 1440]] as const) {
    for (const e of evs || []) {
      if (!occursOn(e, day)) continue
      const start = offset + toMin(e.start_time) // 오늘 0시 기준 분
      if (nowMin >= start - e.remind_min && nowMin <= start + 5) due.push({ e, day, left: start - nowMin, isTomorrow: offset > 0 })
    }
  }
  if (!due.length) return 0
  // 처음 보내는 것만 골라냄 (이미 기록된 것은 무시)
  const fresh: any[] = await db('reminder_log?on_conflict=event_id,occ_date,start_time,remind_min', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(due.map(({ e, day }) => ({ event_id: e.id, occ_date: day, start_time: e.start_time, remind_min: e.remind_min }))),
  })
  const freshKeys = new Set((fresh || []).map((x) => `${x.event_id}:${x.occ_date}`))
  let sent = 0
  for (const { e, day, left, isTomorrow } of due) {
    if (!freshKeys.has(`${e.id}:${day}`)) continue
    const body = `${e.start_time}–${e.end_time}${e.place ? ' · ' + e.place : ''} · ${whenLabel(left, e.remind_min, e.start_time, isTomorrow)}`
    sent += await sendTo([e.owner_id], { title: e.title, body, tag: `remind-${e.id}-${day}`, url: '/' })
  }
  return sent
}

// 테스트 알림: 로그인한 사람의 토큰을 Supabase 에 확인해서 본인 기기로만 보냄
async function onTest(authHeader: string) {
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: authHeader } })
  if (!r.ok) return -1
  const u = await r.json()
  return sendTo([u.id], { title: 'Weekendar', body: '알림이 잘 도착했어요! 🎉', tag: 'test', url: '/' })
}

export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store')
    res.status(200).json({ publicKey: VAPID_PUBLIC || null })
    return
  }
  if (req.method !== 'POST') { res.status(405).end(); return }
  if (!SR || !VAPID_PUBLIC || !VAPID_PRIVATE) { res.status(503).json({ error: 'push not configured' }); return }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:noreply@weekendar.app', VAPID_PUBLIC, VAPID_PRIVATE)

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
  try {
    if (body.kind === 'test') {
      const n = await onTest(String(req.headers.authorization || ''))
      if (n < 0) { res.status(401).json({ error: 'login required' }); return }
      res.status(200).json({ sent: n })
      return
    }
    if (!SECRET || req.headers['x-push-secret'] !== SECRET) { res.status(401).json({ error: 'unauthorized' }); return }
    const id = String(body.id || '')
    if (body.kind !== 'remind' && !/^[0-9a-f-]{36}$/.test(id)) { res.status(400).json({ error: 'bad id' }); return }
    const n = body.kind === 'notice' ? await onNotice(id) : body.kind === 'message' ? await onMessage(id) : body.kind === 'remind' ? await onRemind() : 0
    res.status(200).json({ sent: n })
  } catch (e: any) {
    res.status(500).json({ error: String((e && e.message) || e) })
  }
}
