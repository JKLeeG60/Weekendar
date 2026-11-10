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

export function weekRangeLabel(monday: string): string {
  const a = parse(monday)
  const b = parse(addDays(monday, 4))
  return `${a.getFullYear()}년 ${a.getMonth() + 1}월 ${a.getDate()}일 – ${b.getMonth() + 1}월 ${b.getDate()}일`
}

/**
 * 공휴일 (임시 샘플 데이터 · 대체공휴일 포함).
 * 정식 출시 전에 공공데이터포털 특일 정보 API 또는 관리 테이블로 교체한다.
 */
const HOLIDAYS: Record<string, string> = {
  '2026-01-01': '신정',
  '2026-02-16': '설날 연휴',
  '2026-02-17': '설날',
  '2026-02-18': '설날 연휴',
  '2026-03-01': '삼일절',
  '2026-03-02': '대체공휴일',
  '2026-05-01': '노동절',
  '2026-05-05': '어린이날',
  '2026-05-24': '부처님오신날',
  '2026-05-25': '대체공휴일',
  '2026-06-03': '지방선거',
  '2026-06-06': '현충일',
  '2026-08-15': '광복절',
  '2026-08-17': '대체공휴일',
  '2026-09-24': '추석 연휴',
  '2026-09-25': '추석',
  '2026-09-26': '추석 연휴',
  '2026-10-03': '개천절',
  '2026-10-05': '대체공휴일',
  '2026-10-09': '한글날',
  '2026-12-25': '성탄절',
}

export const holidayName = (s: string): string | undefined => HOLIDAYS[s]

/** 팀 표에 표시할 날짜: 월~금 중 공휴일 제외 */
export function weekDays(selected: string): string[] {
  const mon = mondayOf(selected)
  return [0, 1, 2, 3, 4].map((i) => addDays(mon, i)).filter((d) => !holidayName(d))
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
