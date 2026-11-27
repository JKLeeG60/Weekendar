/** 아침 브리핑 미리 보기 (서버 api/push.ts 의 briefOf 와 같은 내용을 화면에서 만든다) */
import type { Absence, DB } from './types'
import { occurrencesOn, isMultiDay } from './events'
import { fmtHead } from './date'
import { t } from './i18n'

const AWAY: Record<string, string> = { annual: '휴가', am: '오전 반차', pm: '오후 반차', sick: '병가', family: '경조사', trip: '출장' }

export interface Brief {
  title: string
  lines: string[]
  /** 하루 종일 휴가라 보내지 않는 날 */
  off: boolean
}

export function makeBrief(db: DB, me: string, teamId: string | undefined, absences: Absence[], today: string, carry = true): Brief {
  // 내 일정 + 수락한 회의 (불참·응답 전은 빼고)
  const mine = db.events.filter((e) => e.ownerId === me || e.attendees?.some((a) => a.userId === me && a.status === 'accepted'))
  const evs = occurrencesOn(mine, today).sort((a, b) => (isMultiDay(a) ? '' : a.start).localeCompare(isMultiDay(b) ? '' : b.start))
  const off = evs.some((o) => o.category === 'leave' && o.ownerId === me)
  const todos = db.todos.filter((x) => x.ownerId === me && !x.done && !x.parentId && (carry ? x.date <= today : x.date === today))
  const due = todos.filter((x) => x.assignedBy && x.dueDate === today)
  const plain = todos.length - due.length
  const away = absences.filter((a) => a.teamId === teamId && a.userId !== me && a.status === 'approved' && a.date <= today && (a.endDate ?? a.date) >= today)
  const name = (id: string) => db.users.find((u) => u.id === id)?.name ?? ''

  const lines: string[] = []
  if (!evs.length && !plain && !due.length) lines.push(t('오늘은 일정도 할 일도 없어요. 여유로운 하루 보내세요!'))
  else lines.push([t('일정 {n}개', { n: evs.length }), t('할 일 {n}개', { n: plain }), ...(due.length ? [t('오늘 마감 {n}건', { n: due.length })] : [])].join(' · '))
  if (evs.length) {
    const top = evs.slice(0, 3).map((o) => (isMultiDay(o) ? o.title : `${o.start} ${o.title}`)).join(' · ')
    lines.push(top + (evs.length > 3 ? t(' 외 {n}개', { n: evs.length - 3 }) : ''))
  }
  for (const x of due.slice(0, 2)) lines.push(t('⚑ {title} {time} 마감', { title: x.text, time: x.dueTime ?? '' }).replace('  ', ' '))
  if (away.length) lines.push(t('오늘 부재: {list}', { list: away.map((a) => `${name(a.userId)} ${t(AWAY[a.kind])}`).join(', ') }))
  return { title: t('좋은 아침이에요 · {date}', { date: fmtHead(today) }), lines, off }
}
