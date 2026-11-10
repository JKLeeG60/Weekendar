const DOW = ['일', '월', '화', '수', '목', '금', '토']

export const pad = (n: number) => String(n).padStart(2, '0')

export function toStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parse(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const todayStr = () => toStr(new Date())

export function addDays(s: string, n: number): string {
  const d = parse(s)
  d.setDate(d.getDate() + n)
  return toStr(d)
}

export const dow = (s: string) => parse(s).getDay()
export const dowLabel = (s: string) => DOW[dow(s)]
export const isWeekend = (s: string) => dow(s) === 0 || dow(s) === 6

/** 월요일 기준 주 시작일 */
export function mondayOf(s: string): string {
  const d = dow(s)
  return addDays(s, d === 0 ? -6 : 1 - d)
}

/** "10. 10.(월)" 형식 */
export function fmtHead(s: string): string {
  const d = parse(s)
  return `${d.getMonth() + 1}. ${d.getDate()}.(${DOW[d.getDay()]})`
}

export function fmtLong(s: string): string {
  const d = parse(s)
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`
}

/** ISO 8601 주차 (월요일 시작, 그 주의 목요일이 속한 연도 기준) */
export function isoWeek(s: string): number {
  const d = parse(s)
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day) // 그 주의 목요일
  const jan1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - jan1.getTime()) / 86400000 + 1) / 7)
}

export function weekRangeLabel(monday: string): string {
  const a = parse(monday)
  const b = parse(addDays(monday, 4))
  return `${a.getFullYear()}년 ${a.getMonth() + 1}월 ${a.getDate()}일 – ${b.getMonth() + 1}월 ${b.getDate()}일`
}

/**
 * 공휴일: 연도별로 규칙에 따라 계산한다 (대체공휴일 포함).
 * - 양력 공휴일은 고정 날짜, 설날·추석·부처님오신날은 브라우저의 음력 변환으로 계산
 * - 계산할 수 없는 임시공휴일·선거일은 아래 EXTRA_HOLIDAYS 에 직접 추가한다.
 * 기준: 2026년 현재 규정 (노동절·제헌절 공휴일 포함). 법이 바뀌면 이 부분만 수정한다.
 */
export const EXTRA_HOLIDAYS: Record<string, string> = {
  '2026-06-03': '지방선거',
}

const lunarFmt = new Intl.DateTimeFormat('en-u-ca-chinese-nu-latn', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
})

/** 해당 양력 연도 안에서 음력 월/일(윤달 제외)에 해당하는 날짜 */
function lunarToSolar(year: number, lunarMonth: number, lunarDay: number): string {
  for (let i = 0; i < 366; i++) {
    const d = new Date(Date.UTC(year, 0, 1 + i, 3)) // 한국 시간 낮 12시
    if (d.getUTCFullYear() !== year) break
    const parts = lunarFmt.formatToParts(d)
    const m = parts.find((x) => x.type === 'month')?.value
    const day = Number(parts.find((x) => x.type === 'day')?.value)
    if (m === String(lunarMonth) && day === lunarDay) {
      return `${year}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    }
  }
  return ''
}

interface Rule {
  name: string
  dates: string[] // 연휴면 여러 날
  /** 대체공휴일 적용 방식: sunday = 일요일/타 공휴일과 겹칠 때, weekend = 토·일/타 공휴일과 겹칠 때, none = 없음 */
  sub: 'sunday' | 'weekend' | 'none'
}

function computeHolidays(year: number): Record<string, string> {
  const y = String(year)
  const fixed = (md: string) => `${y}-${md}`
  const seol = lunarToSolar(year, 1, 1)
  const chuseok = lunarToSolar(year, 8, 15)
  const buddha = lunarToSolar(year, 4, 8)

  const rules: Rule[] = [
    { name: '신정', dates: [fixed('01-01')], sub: 'none' },
    { name: '삼일절', dates: [fixed('03-01')], sub: 'weekend' },
    { name: '어린이날', dates: [fixed('05-05')], sub: 'weekend' },
    { name: '현충일', dates: [fixed('06-06')], sub: 'none' },
    { name: '광복절', dates: [fixed('08-15')], sub: 'weekend' },
    { name: '개천절', dates: [fixed('10-03')], sub: 'weekend' },
    { name: '한글날', dates: [fixed('10-09')], sub: 'weekend' },
    { name: '성탄절', dates: [fixed('12-25')], sub: 'weekend' },
  ]
  if (year >= 2026) {
    rules.push({ name: '노동절', dates: [fixed('05-01')], sub: 'none' })
    rules.push({ name: '제헌절', dates: [fixed('07-17')], sub: 'weekend' })
  }
  if (seol) rules.push({ name: '설날', dates: [addDays(seol, -1), seol, addDays(seol, 1)], sub: 'sunday' })
  if (chuseok) rules.push({ name: '추석', dates: [addDays(chuseok, -1), chuseok, addDays(chuseok, 1)], sub: 'sunday' })
  if (buddha) rules.push({ name: '부처님오신날', dates: [buddha], sub: 'weekend' })

  const map: Record<string, string> = {}
  for (const r of rules) {
    r.dates.forEach((d, i) => {
      map[d] = r.dates.length > 1 && i !== 1 ? `${r.name} 연휴` : r.name
    })
  }
  for (const [d, n] of Object.entries(EXTRA_HOLIDAYS)) if (d.startsWith(y)) map[d] = n

  // 대체공휴일: 날짜 순으로 처리하고, 쉬는 날이 아닌 첫 평일로 넘긴다
  const origin = { ...map }
  const ordered = [...rules].sort((a, b) => a.dates[0].localeCompare(b.dates[0]))
  for (const r of ordered) {
    if (r.sub === 'none') continue
    const hit = r.dates.some((d) => {
      const w = dow(d)
      if (w === 0) return true
      if (r.sub === 'weekend' && w === 6) return true
      // 다른 공휴일과 겹치는 경우
      return Object.keys(origin).some((o) => o === d && origin[o] !== (r.dates.length > 1 ? (d === r.dates[1] ? r.name : `${r.name} 연휴`) : r.name))
    })
    if (!hit) continue
    let d = addDays(r.dates[r.dates.length - 1], 1)
    while (isWeekend(d) || map[d]) d = addDays(d, 1)
    map[d] = '대체공휴일'
  }
  return map
}

const holidayCache = new Map<number, Record<string, string>>()
export function holidayName(s: string): string | undefined {
  const year = Number(s.slice(0, 4))
  let m = holidayCache.get(year)
  if (!m) {
    m = computeHolidays(year)
    holidayCache.set(year, m)
  }
  return m[s]
}

/** 팀 표에 표시할 날짜: 월~금 (공휴일도 칸은 유지하고 화면에서 휴일로 표시) */
export function weekDays(selected: string): string[] {
  const mon = mondayOf(selected)
  return [0, 1, 2, 3, 4].map((i) => addDays(mon, i))
}

/** 달력 격자 (일요일 시작, 6주) */
export function monthGrid(year: number, month: number): string[] {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return toStr(d)
  })
}
