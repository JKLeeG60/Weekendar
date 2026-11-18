/** 팀장 일정 변경 확인(✅) 계산 도우미. 체험 모드·실서비스·화면이 같이 쓴다. */
import type { DB, EventItem } from './types'

/** 반복 일정은 변경 표시를 이 기간(일)만 보여준다 (날짜가 지나도 계속 돌아오기 때문) */
const REPEAT_SHOW_DAYS = 14

/** 이 일정의 day(발생일)에 "변경" 표시를 보여줄지: 날짜가 지나면 사라진다 */
export function changedActive(e: EventItem, day: string, today: string): boolean {
  if (!e.changedAt) return false
  if (day < today) return false
  if (e.repeat !== 'none' && Date.now() - e.changedAt > REPEAT_SHOW_DAYS * 86400000) return false
  return true
}

/** 팀원(userId)이 이 일정의 가장 최근 변경을 확인했는지 */
export const confirmedBy = (db: DB, e: EventItem, userId: string): boolean =>
  (db.confirms ?? []).some((c) => c.eventId === e.id && c.userId === userId && c.changedAt === e.changedAt)

/** 확인해야 하는 사람(팀장 팀의 role=member)과 확인한 사람 */
export function confirmStatus(db: DB, e: EventItem): { all: string[]; done: string[]; waiting: string[] } {
  const owner = db.members.find((m) => m.userId === e.ownerId)
  const all = db.members.filter((m) => m.teamId === owner?.teamId && m.role === 'member').map((m) => m.userId)
  const done = all.filter((id) => confirmedBy(db, e, id))
  return { all, done, waiting: all.filter((id) => !done.includes(id)) }
}

/** 내가 아직 확인해야 하는 변경인가 (팀원이고, 팀장 일정이고, 아직 안 눌렀을 때) */
export function needsMyConfirm(db: DB, e: EventItem, me: string | undefined, day: string, today: string): boolean {
  if (!me || e.ownerId === me || !changedActive(e, day, today)) return false
  const mine = db.members.find((m) => m.userId === me)
  const owner = db.members.find((m) => m.userId === e.ownerId)
  return mine?.role === 'member' && owner?.role === 'leader' && mine.teamId === owner.teamId && !confirmedBy(db, e, me)
}

/* ───── 체험 모드: 서버(migration_023)가 하는 일을 똑같이 계산 ───── */
const md = (d: string) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`
const when = (e: EventItem) =>
  e.endDate && e.endDate > e.date ? `${md(e.date)}~${md(e.endDate)}` : `${md(e.date)} ${e.start}–${e.end}`

/** 팀장이 공유 일정을 고쳤을 때 "변경"으로 볼 내용. 바뀐 게 없으면 null */
export function changeOf(old: EventItem, next: EventItem): { changeText: string; noticeText: (leaderName: string) => string } | null {
  if (!(old.shared && next.shared)) return null
  const same = old.title === next.title && old.date === next.date && (old.endDate ?? null) === (next.endDate ?? null)
    && old.start === next.start && old.end === next.end && old.place === next.place
  if (same) return null
  let from = when(old), to = when(next)
  const oneDay = (e: EventItem) => !e.endDate || e.endDate <= e.date
  if (old.date === next.date && oneDay(old) && oneDay(next)) {
    from = `${old.start}–${old.end}`
    to = `${next.start}–${next.end}`
  }
  const changeText = from !== to ? `${from} → ${to}` : ''
  return { changeText, noticeText: (name) => `${name} 팀장이 일정을 변경했어요: ${next.title}${changeText ? ` (${changeText})` : ''}` }
}
