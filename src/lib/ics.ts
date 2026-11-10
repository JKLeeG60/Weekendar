import type { EventItem } from './types'

const esc = (t: string) => t.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const d8 = (date: string) => date.replace(/-/g, '')
const t6 = (hm: string) => hm.replace(':', '') + '00'
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')

/** 내 일정을 캘린더 앱용 .ics 형식으로 (서버의 구독 주소와 같은 형식) */
export function buildICS(events: EventItem[], calName: string): string {
  const L: string[] = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Weekendar//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'X-WR-CALNAME:' + esc(calName), 'X-WR-TIMEZONE:Asia/Seoul',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Seoul', 'BEGIN:STANDARD', 'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:KST', 'END:STANDARD', 'END:VTIMEZONE',
  ]
  const now = stamp()
  for (const e of events) {
    L.push('BEGIN:VEVENT', `UID:${e.id}@weekendar`, `DTSTAMP:${now}`,
      `DTSTART;TZID=Asia/Seoul:${d8(e.date)}T${t6(e.start)}`,
      `DTEND;TZID=Asia/Seoul:${d8(e.date)}T${t6(e.end)}`,
      'SUMMARY:' + esc(e.title))
    if (e.place) L.push('LOCATION:' + esc(e.place))
    if (e.repeat !== 'none') {
      const f = { daily: 'DAILY', weekly: 'WEEKLY', monthly: 'MONTHLY' }[e.repeat]
      // UNTIL 은 UTC 로: 그날 한국 시간 23:59:59 = 14:59:59Z
      L.push(`RRULE:FREQ=${f}` + (e.until ? `;UNTIL=${d8(e.until)}T145959Z` : ''))
    }
    if (e.remind !== undefined && e.remind !== null) {
      L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(e.title), `TRIGGER:-PT${e.remind}M`, 'END:VALARM')
    }
    L.push('END:VEVENT')
  }
  L.push('END:VCALENDAR')
  return L.join('\r\n') + '\r\n'
}

export function downloadICS(text: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
