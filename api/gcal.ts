// 구글 캘린더에 추가 (Weekendar → 구글, 한 방향) — 일정마다 "구글 캘린더에 추가" 토글을 켠 것만 (migration_022)
//  POST {kind:'upsert'|'delete', event_id, user_id}  ← Supabase 가 일정 변경 때 호출 (x-push-secret 필요)
//  POST {kind:'full'}  ← 연결 직후 앱이 호출 (로그인 토큰): 토글을 켠 내 일정을 한 번에 보냄
// 비밀값: SUPABASE_SERVICE_ROLE_KEY, PUSH_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (Vercel 환경 변수)
const SB = process.env.VITE_SUPABASE_URL || 'https://lgloslfmoetlojuaqage.supabase.co'
const ANON = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_O1eG2Jw3q3BKdAtpba8Khw_ayIyJCMj'
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const SECRET = process.env.PUSH_SECRET || ''
const GID = process.env.GOOGLE_CLIENT_ID || ''
const GSECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const GCAL = 'https://www.googleapis.com/calendar/v3'
const UUID = /^[0-9a-f-]{36}$/

type Link = { user_id: string; refresh_token: string; calendar_id: string | null; status: string }

async function db(path: string, init: RequestInit = {}) {
  const headers: Record<string, string> = { apikey: SR, 'Content-Type': 'application/json', ...(init.headers as Record<string, string>) }
  if (SR.startsWith('eyJ')) headers.Authorization = `Bearer ${SR}`
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers })
  if (!r.ok) throw new Error(`db ${r.status} ${await r.text()}`)
  const t = await r.text()
  return t ? JSON.parse(t) : null
}

class GoogleError extends Error {
  status: number
  constructor(status: number, msg: string) { super(msg); this.status = status }
}

async function accessToken(link: Link) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: GID, client_secret: GSECRET, refresh_token: link.refresh_token, grant_type: 'refresh_token' }),
  })
  const j: any = await r.json().catch(() => ({}))
  if (!r.ok || !j.access_token) {
    // 사용자가 구글에서 권한을 끊었거나 열쇠가 만료됨 → 앱에 "다시 연결" 표시
    if (j.error === 'invalid_grant') await db(`google_links?user_id=eq.${link.user_id}`, { method: 'PATCH', body: JSON.stringify({ status: 'error' }) })
    throw new GoogleError(401, 'token ' + (j.error || r.status))
  }
  return j.access_token as string
}

async function g(token: string, method: string, path: string, body?: unknown) {
  const r = await fetch(GCAL + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (r.status === 204) return null
  const j: any = await r.json().catch(() => null)
  if (!r.ok) throw new GoogleError(r.status, `google ${r.status} ${j && j.error ? j.error.message : ''}`)
  return j
}

async function getLink(userId: string): Promise<Link | null> {
  const r = await db(`google_links?user_id=eq.${userId}&select=user_id,refresh_token,calendar_id,status`)
  return r && r[0] ? r[0] : null
}

/** 구글에 "Weekendar" 캘린더가 없으면 새로 만든다 */
async function ensureCalendar(token: string, link: Link, force = false) {
  if (link.calendar_id && !force) return link.calendar_id
  const cal = await g(token, 'POST', '/calendars', { summary: 'Weekendar', description: 'Weekendar에서 만든 내 일정이 자동으로 들어오는 캘린더예요.', timeZone: 'Asia/Seoul' })
  link.calendar_id = cal.id
  await db(`google_links?user_id=eq.${link.user_id}`, { method: 'PATCH', body: JSON.stringify({ calendar_id: cal.id }) })
  return cal.id as string
}

const CATEGORY: Record<string, string> = { meeting: '회의', work: '업무', personal: '개인', leave: '휴가', halfday: '반차', outside: '외근', trip: '출장', training: '교육' }
const FREQ: Record<string, string> = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' }

function nextDay(d: string) {
  const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 1)
  return t.toISOString().slice(0, 10)
}

/** Weekendar 일정 → 구글 일정 */
function toGoogle(e: any) {
  const endPastMidnight = e.end_time >= '24:00' || e.end_time <= e.start_time
  const endDate = endPastMidnight ? nextDay(e.date) : e.date
  const endTime = e.end_time >= '24:00' ? '00:00' : e.end_time
  const lines = [CATEGORY[e.category] ? `[${CATEGORY[e.category]}]` : '', e.memo || ''].filter(Boolean)
  const body: any = {
    summary: e.title,
    location: e.place || '',
    description: lines.join('\n'),
    start: { dateTime: `${e.date}T${e.start_time}:00`, timeZone: 'Asia/Seoul' },
    end: { dateTime: `${endDate}T${endTime}:00`, timeZone: 'Asia/Seoul' },
    recurrence: FREQ[e.repeat_rule] ? [`RRULE:FREQ=${FREQ[e.repeat_rule]}${e.until ? `;UNTIL=${e.until.replace(/-/g, '')}T145959Z` : ''}`] : [],
    reminders: { useDefault: false, overrides: e.remind_min == null ? [] : [{ method: 'popup', minutes: e.remind_min }] },
    extendedProperties: { private: { weekendarId: e.id } },
  }
  // 여러 날(종일) 일정: 구글 종일 일정으로 (끝 날짜는 다음 날, 미포함)
  if (e.end_date && e.end_date > e.date) {
    body.start = { date: e.date }
    body.end = { date: nextDay(e.end_date) }
    body.recurrence = []
    body.reminders = { useDefault: false, overrides: [] }
  }
  return body
}

// 구글 일정 ID를 Weekendar 일정 ID로 고정 (짝 정보 저장 불필요, 중복 생성 방지)
const gidOf = (eventId: string) => eventId.replace(/-/g, '')
const ignore = (err: unknown, ...codes: number[]) => { if (!(err instanceof GoogleError) || !codes.includes(err.status)) throw err }

async function upsertOne(token: string, link: Link, e: any, retried = false): Promise<void> {
  const cal = encodeURIComponent(await ensureCalendar(token, link))
  const gid = gidOf(e.id)
  const body = { ...toGoogle(e), id: gid, status: 'confirmed' }
  try {
    try { await g(token, 'PUT', `/calendars/${cal}/events/${gid}`, body); return }
    catch (err) { ignore(err, 404, 410) } // 아직 구글에 없음 → 새로 만듦
    try { await g(token, 'POST', `/calendars/${cal}/events`, body); return }
    catch (err) { ignore(err, 409) } // 동시에 다른 요청이 먼저 만듦 → 수정으로
    await g(token, 'PUT', `/calendars/${cal}/events/${gid}`, body)
  } catch (err) {
    // 사용자가 구글에서 Weekendar 캘린더를 지웠으면 다시 만들고 한 번 더 시도
    if (!retried && err instanceof GoogleError && err.status === 404) {
      await ensureCalendar(token, link, true)
      return upsertOne(token, link, e, true)
    }
    throw err
  }
}

async function deleteOne(token: string, link: Link, eventId: string) {
  if (!link.calendar_id) return
  try { await g(token, 'DELETE', `/calendars/${encodeURIComponent(link.calendar_id)}/events/${gidOf(eventId)}`) }
  catch (err) { ignore(err, 404, 410) }
}

const EVENT_COLS = 'id,owner_id,title,date,end_date,start_time,end_time,place,memo,category,repeat_rule,until,remind_min,gcal'

async function onChange(kind: string, eventId: string, userId: string) {
  const link = await getLink(userId)
  if (!link || link.status !== 'ok') return 'not linked'
  const token = await accessToken(link)
  if (kind === 'delete') { await deleteOne(token, link, eventId); return 'deleted' }
  const r = await db(`events?id=eq.${eventId}&select=${EVENT_COLS}`)
  if (!r || !r[0]) { await deleteOne(token, link, eventId); return 'gone' }
  if (r[0].owner_id !== userId) return 'skip'
  if (!r[0].gcal) { await deleteOne(token, link, eventId); return 'off' } // 토글을 끈 일정은 구글에서 지움
  await upsertOne(token, link, r[0])
  return 'saved'
}

async function fullSync(authHeader: string) {
  const u = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: authHeader } })
  if (!u.ok) return { status: 401, body: { error: 'login required' } }
  const userId = (await u.json()).id as string
  const link = await getLink(userId)
  if (!link) return { status: 404, body: { error: 'not linked' } }
  const token = await accessToken(link)
  await ensureCalendar(token, link)
  const events: any[] = (await db(`events?owner_id=eq.${userId}&gcal=eq.true&select=${EVENT_COLS}&order=date.asc`)) || []
  let ok = 0, fail = 0
  // 구글 요청 한도를 넘지 않도록 4개씩 나눠 보냄
  for (let i = 0; i < events.length; i += 4) {
    const res = await Promise.allSettled(events.slice(i, i + 4).map((e) => upsertOne(token, link, e)))
    res.forEach((x) => (x.status === 'fulfilled' ? ok++ : fail++))
  }
  return { status: 200, body: { sent: ok, failed: fail } }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') { res.status(405).end(); return }
  if (!SR || !GID || !GSECRET) { res.status(503).json({ error: 'google not configured' }); return }
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {}
  try {
    if (body.kind === 'full') {
      const r = await fullSync(String(req.headers.authorization || ''))
      res.status(r.status).json(r.body)
      return
    }
    if (!SECRET || req.headers['x-push-secret'] !== SECRET) { res.status(401).json({ error: 'unauthorized' }); return }
    const eventId = String(body.event_id || ''), userId = String(body.user_id || '')
    if (!UUID.test(eventId) || !UUID.test(userId) || (body.kind !== 'upsert' && body.kind !== 'delete')) { res.status(400).json({ error: 'bad request' }); return }
    res.status(200).json({ result: await onChange(body.kind, eventId, userId) })
  } catch (e: any) {
    res.status(e instanceof GoogleError ? 502 : 500).json({ error: String((e && e.message) || e) })
  }
}
