/** 휴가·출장 신청 도우미 (체험 모드·실서비스·화면이 같이 쓴다) */
import type { Absence, AbsenceKind, AutoApprove, Category, EventItem, Member, Occurrence } from './types'
import { addDays, fmtHead, holidayName, isWeekend, noticeDate, todayStr } from './date'
import { occurrencesOn } from './events'
import { t } from './i18n'

export const KIND_LABEL: Record<AbsenceKind, string> = {
  annual: '연차', am: '오전 반차', pm: '오후 반차', sick: '병가', family: '경조사', trip: '출장',
}
/** 휴가 신청 창의 종류 */
export const LEAVE_KINDS: AbsenceKind[] = ['annual', 'am', 'pm', 'sick', 'family']
/** 연차에서 빠지는 종류 */
export const deducts = (k: AbsenceKind) => k === 'annual' || k === 'am' || k === 'pm'
export const isHalf = (k: AbsenceKind) => k === 'am' || k === 'pm'
export const DEFAULT_LEAVE = 15

/** 기간의 일수: 주말·공휴일 빼고 (반차 0.5) */
export function countDays(kind: AbsenceKind, date: string, endDate?: string): number {
  if (isHalf(kind)) return 0.5
  let n = 0
  for (let d = date; d <= (endDate && endDate > date ? endDate : date); d = addDays(d, 1)) if (!isWeekend(d) && !holidayName(d)) n++
  return n
}

/** "연차 2일" · "오전 반차" · "병가 1일" · "대구" (화면 언어로) */
export function absenceLabel(a: Pick<Absence, 'kind' | 'days' | 'place'>): string {
  if (a.kind === 'trip') return a.place
  if (isHalf(a.kind)) return t(KIND_LABEL[a.kind])
  return t('{kind} {n}일', { kind: t(KIND_LABEL[a.kind]), n: a.days })
}

/** 알림 문장용 (서버 migration_037 과 같은 한국어 원문): "연차 2일 (12. 3.(목)~12. 4.(금))" */
export function absenceNoticeText(a: Pick<Absence, 'kind' | 'days' | 'place' | 'date' | 'endDate'>): string {
  const label = a.kind === 'trip' ? a.place : a.kind === 'annual' ? `연차 ${a.days}일` : KIND_LABEL[a.kind]
  const when = a.endDate && a.endDate > a.date ? `${noticeDate(a.date)}~${noticeDate(a.endDate)}` : noticeDate(a.date)
  return `${label} (${when})`
}

/** "12. 3.(목) – 12. 4.(금)" */
export const absenceWhen = (a: Pick<Absence, 'date' | 'endDate'>) =>
  a.endDate && a.endDate > a.date ? `${fmtHead(a.date)} – ${fmtHead(a.endDate)}` : fmtHead(a.date)

/** 그 신청을 승인할 수 있는 사람: 같은 팀의 팀장·관리자 (본인 제외) */
export const approversOf = (members: Member[], teamId: string, userId: string) =>
  members.filter((m) => m.teamId === teamId && m.userId !== userId && m.role !== 'pending' && (m.role === 'leader' || m.isAdmin)).map((m) => m.userId)

export const canApprove = (members: Member[], me: string | null | undefined, a: Absence) =>
  !!me && a.status === 'pending' && approversOf(members, a.teamId, a.userId).includes(me)

/** 자동 승인 대상인지 */
export const autoCovers = (mode: AutoApprove | undefined, kind: AbsenceKind) =>
  mode === 'all' || (mode === 'trip' && kind === 'trip') || (mode === 'leave' && kind !== 'trip')

/** 올해 연차 현황 */
export function leaveSummary(list: Absence[], userId: string, teamId: string | undefined, total = DEFAULT_LEAVE, year = todayStr().slice(0, 4)) {
  const mine = list.filter((a) => a.userId === userId && a.teamId === teamId && deducts(a.kind) && a.date.startsWith(year))
  const used = mine.filter((a) => a.status === 'approved').reduce((s, a) => s + a.days, 0)
  const pending = mine.filter((a) => a.status === 'pending').reduce((s, a) => s + a.days, 0)
  return { total, used, pending, left: total - used - pending }
}

/** 기간이 겹치는지 (같은 날 오전·오후 반차는 괜찮다) */
export function overlaps(list: Absence[], userId: string, teamId: string | undefined, kind: AbsenceKind, date: string, endDate?: string) {
  const end = endDate && endDate > date ? endDate : date
  return list.some((a) => a.userId === userId && a.teamId === teamId && (a.status === 'pending' || a.status === 'approved')
    && a.date <= end && (a.endDate ?? a.date) >= date && !(isHalf(a.kind) && isHalf(kind) && a.kind !== kind))
}

/** 승인되면 만들어질 일정 */
export function absenceEvent(a: Absence): Omit<EventItem, 'id' | 'ownerId'> {
  const multi = !!a.endDate && a.endDate > a.date
  const [start, end] = multi ? ['00:00', '23:59'] : a.kind === 'am' ? ['09:00', '14:00'] : a.kind === 'pm' ? ['14:00', '18:00'] : ['09:00', '18:00']
  return {
    title: KIND_LABEL[a.kind], date: a.date, endDate: multi ? a.endDate : undefined, start, end,
    place: a.kind === 'trip' ? a.place : '', category: a.kind === 'trip' ? 'trip' : isHalf(a.kind) ? 'halfday' : 'leave',
    shared: true, repeat: 'none',
  }
}

/** 휴가·반차·출장 분류 (팀 표에서 칸 표시로 보여 준다) */
export const OFF_CATS: Category[] = ['leave', 'halfday', 'trip']

/** 그날 그 사람이 휴가·반차·출장인지 (팀 표 칸 표시용) */
export interface DayOff {
  /** 하루 종일 휴가 */
  leave?: Occurrence
  /** 반차 (side: 쉬는 반나절) */
  half?: Occurrence
  side?: 'am' | 'pm'
  /** 출장 */
  trip?: Occurrence
}
export function dayOff(events: EventItem[], userId: string, date: string): DayOff | null {
  const occ = occurrencesOn(events.filter((e) => e.ownerId === userId && OFF_CATS.includes(e.category)), date)
  if (!occ.length) return null
  const r: DayOff = {}
  for (const o of occ) {
    if (o.category === 'leave') r.leave = o
    else if (o.category === 'halfday') { r.half = o; r.side = o.start < '12:00' ? 'am' : 'pm' }
    else r.trip = o
  }
  return r
}

/** 휴가 칸 이름: 병가·경조사는 그대로, 나머지는 "휴가" */
export const leaveName = (o: Pick<EventItem, 'title'>) => (o.title === '병가' || o.title === '경조사' ? t(o.title) : t('휴가'))

/** 쉬는 동안 겹치는 일정인지 (흐리게 보여 줄 일정) */
export const offHides = (off: DayOff | null, o: Pick<EventItem, 'start' | 'end'>) =>
  !!off && (!!off.leave || (!!off.half && o.start < off.half.end && o.end > off.half.start))

/** 그날 승인 대기 중인 신청 */
export const waitingOn = (list: Absence[], userId: string, date: string) =>
  list.filter((a) => a.userId === userId && a.status === 'pending' && a.date <= date && (a.endDate ?? a.date) >= date)
