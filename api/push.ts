// 휴대폰 푸쉬 알림 발송
//  GET  /api/push                         → 브라우저가 기기를 등록할 때 쓰는 공개 키
//  POST /api/push {kind:'test'}           → (로그인한 본인) 내 기기로 테스트 알림
//  POST /api/push {kind:'brief-test'}     → (로그인한 본인) 아침 브리핑을 지금 받아 보기
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

// ───────── 받는 사람 언어 (화면에서 고른 언어, profiles.lang) ─────────
type Lang = 'ko' | 'en'
/** 사람별 언어. migration_016 전이라 칸이 없으면 모두 한국어 */
async function langsOf(ids: string[]): Promise<Record<string, Lang>> {
  try {
    const r = await db(`profiles?id=in.(${ids.join(',')})&select=id,lang`)
    return Object.fromEntries((r || []).map((x: any) => [x.id, x.lang === 'en' ? 'en' : 'ko']))
  } catch {
    return {}
  }
}
/** 한국어/영어 중 고르기 */
const L = (lang: Lang, ko: string, en: string) => (lang === 'en' ? en : ko)

/** 서버(DB 함수)가 한국어로 만든 알림 문장을 영어로 (앱의 src/lib/i18n.tsx localize 와 같은 규칙) */
const VERB: Record<string, string> = { 추가: 'add', 수정: 'change', 삭제: 'delete' }
function noticeText(text: string, lang: Lang): string {
  if (lang === 'ko') return text
  // 알림 속 날짜 "11. 28.(금)" → "Fri 11/28"
  text = text.replace(/(\d{1,2})\. (\d{1,2})\.\(([일월화수목금토])\)/g, (_, mo, d, w) => `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']['일월화수목금토'.indexOf(w)]} ${mo}/${d}`)
  let m: RegExpMatchArray | null
  if ((m = text.match(/^(.+)님이 팀 참여를 요청했(?:어요|습니다)\.?$/))) return `${m[1]} asked to join the team.`
  if ((m = text.match(/^(.+)님이 일정 (추가|수정|삭제)을(?:\(를\))? 요청했(?:어요|습니다)\.?$/))) return `${m[1]} sent a request to ${VERB[m[2]]} an event.`
  if ((m = text.match(/^(.+) 팀장이 요청을 (수락|거절)했어요$/))) return `${m[1]} (team lead) ${m[2] === '수락' ? 'approved' : 'declined'} your request.`
  if ((m = text.match(/^(.+) 팀장이 일정을 변경했어요: ([\s\S]+?)(?: \(([^()]+ → [^()]+)\))?$/)))
    return `${m[1]} (team lead) changed an event: ${m[2]}` + (m[3] ? ` (${m[3]})` : '')
  if ((m = text.match(/^팀장이 일정 (추가|수정|삭제) 요청에 동의했습니다\. \(([\s\S]*)\)$/))) return `Your team lead approved your request to ${VERB[m[1]]} an event. (${m[2]})`
  if ((m = text.match(/^팀장이 일정 (추가|수정|삭제) 요청을 거절했습니다\. \(([\s\S]*?)\)(?: 사유: ([\s\S]*))?$/)))
    return `Your team lead declined your request to ${VERB[m[1]]} an event. (${m[2]})` + (m[3] ? ` Reason: ${m[3]}` : '')
  // 업무 배정·수정·취소·완료 (migration_035)
  if ((m = text.match(/^(.+)님이 업무를 배정했어요: ([\s\S]+)$/))) return `${m[1]} assigned you a task: ${m[2].replace(/ \(([^()]+?)( \d{1,2}:\d{2})? 마감\)$/, ' (due $1$2)')}`
  if ((m = text.match(/^(.+)님이 배정한 업무를 바꿨어요: ([\s\S]+)$/))) return `${m[1]} updated a task: ${m[2].replace(/ \(([^()]+?)( \d{1,2}:\d{2})? 마감\)$/, ' (due $1$2)')}`
  if ((m = text.match(/^(.+)님이 배정한 업무를 취소했어요: ([\s\S]+)$/))) return `${m[1]} canceled a task: ${m[2]}`
  if ((m = text.match(/^(.+)님이 배정한 업무를 끝냈어요: ([\s\S]+)$/))) return `${m[1]} finished a task you assigned: ${m[2]}`
  // 휴가·출장 신청 (migration_037)
  const what = (x: string) => x.replace(/^연차 ([\d.]+)일/, '$1d leave').replace(/^오전 반차/, 'Morning off').replace(/^오후 반차/, 'Afternoon off')
    .replace(/^병가/, 'Sick leave').replace(/^경조사/, 'Family event').replace(/ 사유: /, ' · Reason: ')
  const noun = (k: string) => (k === '휴가' ? 'time off' : 'a trip')
  if ((m = text.match(/^(.+)님이 (휴가|출장)[을를] 신청했어요: ([\s\S]+)$/))) return `${m[1]} requested ${noun(m[2])}: ${what(m[3])}`
  if ((m = text.match(/^(.+)님의 (휴가|출장)[이가] (자동 승인됐어요|등록됐어요): ([\s\S]+)$/))) return `${m[1]}'s ${m[2] === '휴가' ? 'time off' : 'trip'} was ${m[3] === '등록됐어요' ? 'added' : 'auto-approved'}: ${what(m[4])}`
  if ((m = text.match(/^(휴가|출장) 신청이 (승인됐어요|반려됐어요): ([\s\S]+)$/))) return `Your ${m[1] === '휴가' ? 'time off' : 'trip'} was ${m[2] === '승인됐어요' ? 'approved' : 'declined'}: ${what(m[3])}`
  if ((m = text.match(/^(.+)님이 (휴가|출장) 신청을 취소했어요: ([\s\S]+)$/))) return `${m[1]} canceled ${noun(m[2])}: ${what(m[3])}`
  // 회의 초대·시간 변경·취소·불참 (migration_034)
  if ((m = text.match(/^(.+)님이 회의에 초대했어요: ([\s\S]+) \(([^()]+)\)$/))) return `${m[1]} invited you to a meeting: ${m[2]} (${m[3]})`
  if ((m = text.match(/^(.+)님이 회의 시간을 바꿨어요: ([\s\S]+) \(([^()]+)\)$/))) return `${m[1]} moved a meeting: ${m[2]} (${m[3]})`
  if ((m = text.match(/^(.+)님이 회의를 취소했어요: ([\s\S]+) \(([^()]+)\)$/))) return `${m[1]} canceled a meeting: ${m[2]} (${m[3]})`
  if ((m = text.match(/^(.+)님이 회의에 불참해요: ([\s\S]+) \(([^()]+)\)$/))) return `${m[1]} can't attend: ${m[2]} (${m[3]})`
  if (text.startsWith('관리자 권한을 넘겨받았어요')) return "You're now the admin. You can use Manage team."
  return text
}

/** 보내기. p 를 함수로 주면 받는 사람 언어마다 따로 만든다 */
async function sendTo(userIds: string[], p: Payload | ((lang: Lang) => Payload)) {
  const ids = [...new Set(userIds)].filter((x) => /^[0-9a-f-]{36}$/.test(x))
  if (!ids.length) return 0
  const subs: (Sub & { user_id: string })[] = await db(`push_subscriptions?select=id,user_id,endpoint,p256dh,auth&user_id=in.(${ids.join(',')})`)
  const langs = typeof p === 'function' ? await langsOf(ids) : {}
  let sent = 0
  await Promise.all(
    subs.map(async (s) => {
      try {
        const payload = typeof p === 'function' ? p(langs[s.user_id] ?? 'ko') : p
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(payload), { TTL: 3600 })
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
  return sendTo([r[0].user_id], (lang) => ({ title: 'Weekendar', body: noticeText(r[0].text, lang), tag: 'notice-' + id, url: '/' }))
}

async function onMessage(id: string) {
  const r = await db(`messages?id=eq.${id}&select=*`)
  const m = r && r[0]
  if (!m || m.deleted_at || m.system) return 0
  // 그룹 대화방: 그 방 사람(보낸 사람 빼고)에게 (migration_020)
  if (m.room_id) {
    const mem = await db(`chat_room_members?room_id=eq.${m.room_id}&select=user_id`)
    const to = (mem || []).map((x: any) => x.user_id).filter((u: string) => u !== m.author_id)
    const who = await nameOf(m.author_id)
    const text = m.sticker ? '' : String(m.body || '').slice(0, 140)
    return sendTo(to, (lang) => ({
      title: L(lang, `${who}님의 그룹 메시지`, `Group message from ${who}`),
      body: text || (m.sticker ? L(lang, '(이모티콘)', '(Sticker)') : L(lang, '일정을 공유했어요', 'Shared an event')),
      tag: 'room-' + m.room_id,
      url: '/',
    }))
  }
  // 1:1 대화: 받는 사람에게만
  if (m.recipient_id) {
    const who = await nameOf(m.author_id)
    const text = m.sticker ? '' : String(m.body || '').slice(0, 140)
    return sendTo([m.recipient_id], (lang) => ({
      title: L(lang, `${who}님의 1:1 메시지`, `Message from ${who}`),
      body: text || (m.sticker ? L(lang, '(이모티콘)', '(Sticker)') : L(lang, '일정을 공유했어요', 'Shared an event')),
      tag: 'dm-' + m.author_id,
      url: '/',
    }))
  }
  let to: string[] = m.mentions || []
  if (m.mention_all) {
    const mem = await db(`members?team_id=eq.${m.team_id}&role=neq.pending&select=user_id`)
    to = (mem || []).map((x: any) => x.user_id)
  }
  to = to.filter((u) => u !== m.author_id)
  const who = await nameOf(m.author_id)
  const text = m.sticker ? '' : String(m.body || '').slice(0, 140)
  return sendTo(to, (lang) => ({
    title: L(lang, `${who}님이 불렀어요`, `${who} mentioned you`),
    body: text || (m.sticker ? L(lang, '(이모티콘)', '(Sticker)') : L(lang, '일정을 공유했어요', 'Shared an event')),
    tag: 'msg-' + id,
    url: '/',
  }))
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
function whenLabel(left: number, remind: number, start: string, tomorrow: boolean, lang: Lang = 'ko') {
  const h = Math.floor(left / 60), mm = left % 60
  if (lang === 'en') {
    if (remind === 0 || left <= 0) return 'Starting now'
    if (tomorrow) return `Starts tomorrow at ${start}`
    if (left < 60) return `Starts in ${left} min`
    return `Starts in ${h} h${mm ? ` ${mm} min` : ''}`
  }
  if (remind === 0 || left <= 0) return '지금 시작해요'
  if (tomorrow) return `내일 ${start} 시작`
  if (left < 60) return `${left}분 뒤 시작`
  return `${h}시간${mm ? ` ${mm}분` : ''} 뒤 시작`
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
    sent += await sendTo([e.owner_id], (lang) => ({
      title: e.title,
      body: `${e.start_time}–${e.end_time}${e.place ? ' · ' + e.place : ''} · ${whenLabel(left, e.remind_min, e.start_time, isTomorrow, lang)}`,
      tag: `remind-${e.id}-${day}`,
      url: '/',
    }))
  }
  return sent
}

// ───────── 아침 브리핑 (migration_038) ─────────
const KIND_KO: Record<string, string> = { annual: '휴가', am: '오전 반차', pm: '오후 반차', sick: '병가', family: '경조사', trip: '출장' }
const KIND_EN: Record<string, string> = { annual: 'off', am: 'morning off', pm: 'afternoon off', sick: 'sick', family: 'family event', trip: 'trip' }
const DOW_KO = '일월화수목금토', DOW_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** 한 사람의 오늘 브리핑. 휴가인 날이면 null (보내지 않음) */
async function briefOf(u: { id: string; todo_carry?: boolean; current_team_id?: string | null }, today: string): Promise<((lang: Lang) => Payload) | null> {
  const evFilter = `date=lte.${today}&and=(or(until.is.null,until.gte.${today}),or(date.eq.${today},end_date.gte.${today},repeat_rule.neq.none))&select=id,title,date,end_date,until,start_time,end_time,category,repeat_rule`
  const own: any[] = (await db(`events?owner_id=eq.${u.id}&${evFilter}`)) || []
  // 수락한 회의 초대
  const att: any[] = (await db(`event_attendees?user_id=eq.${u.id}&status=eq.accepted&select=event_id`).catch(() => [])) || []
  const inv: any[] = att.length ? (await db(`events?id=in.(${att.map((a) => a.event_id).join(',')})&${evFilter}`)) || [] : []
  const occurs = (e: any) => (e.end_date && e.end_date > e.date ? e.date <= today && today <= e.end_date : occursOn(e, today))
  const evs = [...own, ...inv].filter(occurs).sort((a, b) => String(a.start_time).localeCompare(String(b.start_time)))
  // 하루 종일 휴가인 날은 보내지 않는다
  if (evs.some((e) => e.category === 'leave')) return null
  const todos: any[] = (await db(`todos?owner_id=eq.${u.id}&done=eq.false&parent_id=is.null&date=${u.todo_carry === false ? 'eq' : 'lte'}.${today}&select=title,assigned_by,due_date,due_time`)) || []
  const due = todos.filter((x) => x.assigned_by && x.due_date === today)
  const plain = todos.filter((x) => !x.assigned_by).length + todos.filter((x) => x.assigned_by && x.due_date !== today).length
  // 오늘 팀 부재 (승인된 휴가·출장, 나 빼고)
  let away: { name: string; kind: string }[] = []
  if (u.current_team_id) {
    const ab: any[] = (await db(`absence_requests?team_id=eq.${u.current_team_id}&status=eq.approved&user_id=neq.${u.id}&date=lte.${today}&or=(end_date.gte.${today},date.eq.${today})&select=user_id,kind`).catch(() => [])) || []
    if (ab.length) {
      const ps: any[] = (await db(`profiles?id=in.(${[...new Set(ab.map((a) => a.user_id))].join(',')})&select=id,name`)) || []
      away = ab.map((a) => ({ name: ps.find((p) => p.id === a.user_id)?.name || '', kind: a.kind }))
    }
  }
  const [y, mo, d] = today.split('-').map(Number)
  const w = dowOf(today)
  const allDay = (e: any) => e.end_date && e.end_date > e.date
  return (lang) => {
    const en = lang === 'en'
    const lines: string[] = []
    const head = en
      ? [`${evs.length} event${evs.length === 1 ? '' : 's'}`, `${plain} to-do${plain === 1 ? '' : 's'}`, ...(due.length ? [`${due.length} due today`] : [])]
      : [`일정 ${evs.length}개`, `할 일 ${plain}개`, ...(due.length ? [`오늘 마감 ${due.length}건`] : [])]
    if (!evs.length && !plain && !due.length) lines.push(en ? 'Nothing scheduled today. Have a relaxed day!' : '오늘은 일정도 할 일도 없어요. 여유로운 하루 보내세요!')
    else lines.push(head.join(' · '))
    if (evs.length) {
      const top = evs.slice(0, 3).map((e) => (allDay(e) ? e.title : `${e.start_time} ${e.title}`)).join(' · ')
      lines.push(top + (evs.length > 3 ? (en ? ` +${evs.length - 3} more` : ` 외 ${evs.length - 3}개`) : ''))
    }
    for (const x of due.slice(0, 2)) lines.push(en ? `⚑ ${x.title} due ${x.due_time || 'today'}` : `⚑ ${x.title}${x.due_time ? ' ' + x.due_time : ''} 마감`)
    if (away.length) lines.push((en ? 'Away today: ' : '오늘 부재: ') + away.map((a) => `${a.name} ${en ? KIND_EN[a.kind] : KIND_KO[a.kind]}`).join(', '))
    return {
      title: en ? `Good morning · ${DOW_EN[w]} ${mo}/${d}` : `좋은 아침이에요 · ${mo}. ${d}.(${DOW_KO[w]})`,
      body: lines.join('\n'),
      tag: `brief-${y}${mo}${d}`,
      url: '/',
    }
  }
}

/** 정한 시간(기본 평일 08:30)이 된 사람에게 하루 한 번 브리핑 */
async function onBrief() {
  const seoul = new Date(Date.now() + 9 * 3600 * 1000)
  const today = seoul.toISOString().slice(0, 10)
  const now = seoul.getUTCHours() * 60 + seoul.getUTCMinutes()
  const hm = (n: number) => `${pad2(Math.floor(n / 60))}:${pad2(n % 60)}`
  // 휴대폰 알림을 켠 사람만
  const subs: any[] = (await db('push_subscriptions?select=user_id')) || []
  const ids = [...new Set(subs.map((x) => x.user_id))]
  if (!ids.length) return 0
  // 정한 시간부터 1시간 안 (서버가 잠깐 멈춰도 놓치지 않게)
  const people: any[] = (await db(`profiles?id=in.(${ids.join(',')})&brief_on=eq.true&brief_time=lte.${hm(now)}&brief_time=gte.${hm(Math.max(0, now - 60))}&select=id,brief_days,todo_carry,current_team_id`)) || []
  const offDay = isWeekendStr(today) || isHoliday(today)
  const due = people.filter((p) => p.brief_days === 'daily' || !offDay)
  if (!due.length) return 0
  // 처음 보내는 사람만 (이미 기록된 사람은 무시)
  const fresh: any[] = (await db('brief_log?on_conflict=user_id,day', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify(due.map((p) => ({ user_id: p.id, day: today }))),
  })) || []
  let sent = 0
  for (const f of fresh) {
    const p = due.find((x) => x.id === f.user_id)
    const make = p && (await briefOf(p, today))
    if (make) sent += await sendTo([p.id], make)
  }
  return sent
}

/** 설정의 "휴대폰으로 받아 보기": 로그인한 본인에게 지금 브리핑 (휴가인 날도 보냄) */
async function onBriefTest(authHeader: string) {
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: authHeader } })
  if (!r.ok) return -1
  const u = await r.json()
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
  const p: any[] = (await db(`profiles?id=eq.${u.id}&select=id,todo_carry,current_team_id`)) || []
  const make = await briefOf(p[0] ?? { id: u.id }, today)
  return sendTo([u.id], make ?? ((lang) => ({ title: L(lang, '오늘은 휴가예요', "You're off today"), body: L(lang, '휴가인 날에는 아침 브리핑을 보내지 않아요.', 'Morning briefings skip your days off.'), tag: 'brief-test', url: '/' })))
}

// 테스트 알림: 로그인한 사람의 토큰을 Supabase 에 확인해서 본인 기기로만 보냄
async function onTest(authHeader: string) {
  const r = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: ANON, Authorization: authHeader } })
  if (!r.ok) return -1
  const u = await r.json()
  return sendTo([u.id], (lang) => ({ title: 'Weekendar', body: L(lang, '알림이 잘 도착했어요! 🎉', 'Notifications are working! 🎉'), tag: 'test', url: '/' }))
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
    if (body.kind === 'brief-test') {
      const n = await onBriefTest(String(req.headers.authorization || ''))
      if (n < 0) { res.status(401).json({ error: 'login required' }); return }
      res.status(200).json({ sent: n })
      return
    }
    if (!SECRET || req.headers['x-push-secret'] !== SECRET) { res.status(401).json({ error: 'unauthorized' }); return }
    const id = String(body.id || '')
    if (body.kind !== 'remind' && !/^[0-9a-f-]{36}$/.test(id)) { res.status(400).json({ error: 'bad id' }); return }
    const n = body.kind === 'notice' ? await onNotice(id) : body.kind === 'message' ? await onMessage(id) : body.kind === 'remind' ? (await onRemind()) + (await onBrief().catch(() => 0)) : 0
    res.status(200).json({ sent: n })
  } catch (e: any) {
    res.status(500).json({ error: String((e && e.message) || e) })
  }
}
