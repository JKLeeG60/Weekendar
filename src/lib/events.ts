import type { EventItem, Occurrence } from './types'
import { dow, parse } from './date'

function occursOn(e: EventItem, date: string): boolean {
  if (date < e.date) return false
  if (e.until && date > e.until) return false
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
    .map((e) => ({ ...e, date, baseId: e.id }))
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title))
}
