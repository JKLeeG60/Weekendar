import type { EventItem, Occurrence } from './types'
import { dow, holidayName, parse } from './date'

/** 여러 날(종일) 일정인가 */
export const isMultiDay = (e: Pick<EventItem, 'date' | 'endDate'>) => !!e.endDate && e.endDate > e.date

function occursOn(e: EventItem, date: string): boolean {
  if (date < e.date) return false
  if (isMultiDay(e)) return date <= e.endDate!
  if (e.until && date > e.until) return false
  // 반복 일정은 공휴일(대체공휴일 포함)에는 쉰다. 첫날로 지정한 날짜는 그대로 표시
  if (e.repeat !== 'none' && date !== e.date && holidayName(date)) return false
  switch (e.repeat) {
    case 'none':
      return date === e.date
    case 'daily':
      return true
    case 'weekly':
      return dow(date) === dow(e.date)
    case 'monthly':
      return parse(date).getDate() === parse(e.date).getDate()
  }
}

/** 특정 날짜에 발생하는 일정(반복 포함)을 시간순으로 반환 */
export function occurrencesOn(events: EventItem[], date: string): Occurrence[] {
  return events
    .filter((e) => occursOn(e, date))
    // 여러 날 일정은 기간 정보를 지키도록 시작 날짜를 그대로 둔다
    .map((e) => ({ ...e, date: isMultiDay(e) ? e.date : date, baseId: e.id }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
}

/** 여러 날 일정 기간 표시: 11/9(월)–11/11(수) */
export function spanLabel(e: Pick<EventItem, 'date' | 'endDate'>) {
  const f = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${'일월화수목금토'[dow(d)]})`
  return isMultiDay(e) ? `${f(e.date)}–${f(e.endDate!)}` : f(e.date)
}
