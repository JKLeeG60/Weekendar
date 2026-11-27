// 회의 참석자 · 모두 비는 시간 계산 (체험 모드와 실서비스가 함께 씀)
import type { AttendStatus, BusyEvent, DB, EventItem, Notice } from './types'
import { isMultiDay, occurrencesOn } from './events'
import { noticeDate, pad } from './date'

/** 이 사람 줄에 보이는 일정인가 (만든 사람, 또는 초대받은 사람 — 불참도 흐리게 보인다) */
export const inRowOf = (e: EventItem, userId?: string | null) =>
  !!userId && (e.ownerId === userId || !!e.attendees?.some((a) => a.userId === userId))

/** 이 사람이 실제로 가는 일정인가 (불참은 빼고) */
export const goesTo = (e: EventItem, userId?: string | null) =>
  !!userId && (e.ownerId === userId || !!e.attendees?.some((a) => a.userId === userId && a.status !== 'declined'))

/** 이 일정에서 이 사람의 응답 (초대받지 않았으면 없음) */
export const inviteOf = (e: Pick<EventItem, 'attendees'>, userId?: string | null) =>
  e.attendees?.find((a) => a.userId === userId)

// ───────── 모두 비는 시간 ─────────
/** 찾는 시간: 9시 ~ 18시, 점심 12~13시는 뺀다 */
export const DAY_FROM = 9 * 60
export const DAY_TO = 18 * 60
export const LUNCH: [number, number] = [12 * 60, 13 * 60]

export const toMin = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
export const fmtMin = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
const ceil30 = (m: number) => Math.ceil(m / 30) * 30

/** 한 날의 바쁜 구간들 [시작분, 끝분]. 여러 날 일정(휴가·출장 등)은 하루 전체가 바쁨 */
export function busyOn(busy: BusyEvent[], date: string, skipId?: string): [number, number][] {
  const evs = busy
    .filter((b) => b.id !== skipId)
    .map((b): EventItem => ({
      id: b.id + ':' + b.userId, ownerId: b.userId, title: '', date: b.date, endDate: b.endDate,
      start: b.start, end: b.end, repeat: b.repeat, until: b.until, place: '', category: b.category, shared: true,
    }))
  return occurrencesOn(evs, date).map((o): [number, number] => (isMultiDay(o) ? [0, 24 * 60] : [toMin(o.start), toMin(o.end)]))
}

/** 모두 비어 있는 구간 (점심 빼고, dur 분 이상인 것만). 시작은 30분 단위로 맞춘다 */
export function freeRanges(blocks: [number, number][], dur: number, notBefore = 0): [number, number][] {
  let segs: [number, number][] = [[Math.max(DAY_FROM, notBefore), DAY_TO]]
  for (const [a, b] of [...blocks, LUNCH]) {
    segs = segs.flatMap(([x, y]): [number, number][] =>
      b <= x || a >= y ? [[x, y]] : [...(a > x ? [[x, a] as [number, number]] : []), ...(b < y ? [[b, y] as [number, number]] : [])])
  }
  return segs.map(([x, y]): [number, number] => [ceil30(x), y]).filter(([x, y]) => y - x >= dur)
}

// ───────── 체험 모드: 서버(migration_034)가 하는 알림을 흉내 낸다 ─────────
const when = (e: Pick<EventItem, 'date' | 'start' | 'end'>) => `${noticeDate(e.date)} ${e.start}–${e.end}`
const note = (userId: string, kind: Notice['kind'], text: string, eventId?: string): Notice =>
  ({ id: 'n_' + Math.random().toString(36).slice(2, 10), userId, kind, text, eventId, read: false, createdAt: Date.now() })

/**
 * 일정이 생기거나·바뀌거나·지워진 뒤 참석자 알림을 만든다.
 * - 새로 들어온 참석자: 초대 알림
 * - 시간이 바뀜: 모두 응답 대기로 돌리고 알림
 * - 지워짐: 불참하지 않은 참석자에게 취소 알림
 */
export function syncMeeting(p: DB, before: EventItem | undefined, after: EventItem | undefined): DB {
  const ownerId = (after ?? before)?.ownerId
  const name = p.users.find((u) => u.id === ownerId)?.name ?? ''
  const fresh: Notice[] = []
  let events = p.events
  if (after) {
    const old = new Set((before?.attendees ?? []).map((a) => a.userId))
    for (const a of after.attendees ?? []) {
      if (!old.has(a.userId)) fresh.push(note(a.userId, 'invite', `${name}님이 회의에 초대했어요: ${after.title} (${when(after)})`, after.id))
    }
    const moved = before && (before.date !== after.date || before.start !== after.start || before.end !== after.end || (before.endDate ?? '') !== (after.endDate ?? ''))
    if (moved && after.attendees?.length) {
      events = events.map((e) => (e.id === after.id ? { ...e, attendees: e.attendees?.map((a) => ({ ...a, status: 'pending' as AttendStatus })) } : e))
      for (const a of (before!.attendees ?? []).filter((x) => after.attendees!.some((y) => y.userId === x.userId))) {
        fresh.push(note(a.userId, 'invite', `${name}님이 회의 시간을 바꿨어요: ${after.title} (${when(before!)} → ${when(after)})`, after.id))
      }
    }
  } else if (before) {
    for (const a of (before.attendees ?? []).filter((x) => x.status !== 'declined')) {
      fresh.push(note(a.userId, 'invite', `${name}님이 회의를 취소했어요: ${before.title} (${when(before)})`))
    }
  }
  if (fresh.length === 0 && events === p.events) return p
  return { ...p, events, notices: [...fresh, ...p.notices].slice(0, 200) }
}

/** 체험 모드: 참석 / 불참 응답. 불참이면 만든 사람에게 알림 */
export function respondDemo(p: DB, eventId: string, status: 'accepted' | 'declined'): DB {
  const me = p.currentUserId
  const e = p.events.find((x) => x.id === eventId)
  const mine = e && inviteOf(e, me)
  if (!e || !me || !mine) return p
  const name = p.users.find((u) => u.id === me)?.name ?? ''
  const notices = p.notices.map((n) => (n.userId === me && n.eventId === eventId && n.kind === 'invite' ? { ...n, read: true } : n))
  return {
    ...p,
    events: p.events.map((x) => (x.id === eventId ? { ...x, attendees: x.attendees!.map((a) => (a.userId === me ? { ...a, status } : a)) } : x)),
    notices: status === 'declined' && mine.status !== 'declined'
      ? [note(e.ownerId, 'decline', `${name}님이 회의에 불참해요: ${e.title} (${when(e)})`, e.id), ...notices]
      : notices,
  }
}

// ───────── 업무 배정 ─────────
/** 두 날짜 사이 날 수 (b - a) */
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00') - Date.parse(a + 'T00:00:00')) / 86400000)

/** 마감까지 상태: 끝남 · 지남(n일) · 오늘 · D-n · 마감 없음 */
export function dueState(t: { done: boolean; dueDate?: string }, today: string): { kind: 'done' | 'late' | 'today' | 'soon' | 'none'; days: number } {
  if (t.done) return { kind: 'done', days: 0 }
  if (!t.dueDate) return { kind: 'none', days: 0 }
  const d = daysBetween(today, t.dueDate)
  return { kind: d < 0 ? 'late' : d === 0 ? 'today' : 'soon', days: Math.abs(d) }
}
