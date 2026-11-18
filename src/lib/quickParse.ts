import type { Category } from './types'

/**
 * 빠른 입력 문장 읽기 (규칙 기반, 외부 서비스 없음)
 * 예) "오늘 09:00~10:00 주간예정사항 수정 장소는 사무실" → 일정
 *     "내일까지 예산안 검토 중요" → 할 일
 * 판단: 시간이 있거나, 부재 단어(출장·휴가…)·기간이 있으면 일정 / 그 밖에는 할 일
 */
export interface QuickResult {
  kind: 'event' | 'todo'
  /** 왜 이렇게 판단했는지 (화면에 보여줄 짧은 설명) */
  reason: 'time' | 'range' | 'absence' | 'notime'
  title: string
  date: string
  endDate?: string
  start?: string
  end?: string
  place?: string
  category: Category
  shared: boolean
  priority: boolean
  /** 알아들은 부분 (입력창에서 강조): [시작, 끝) 글자 위치 */
  marks: [number, number][]
}

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addD = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
const hm = (h: number, m: number) => `${pad(Math.min(23, h))}:${pad(Math.min(59, m))}`

const DOW: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 }
const DOW_EN: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }

// 종류: 단어 → 카테고리 (앞에 있는 것 우선)
const CAT_WORDS: [RegExp, Category][] = [
  [/반차|half[- ]?day/i, 'halfday'],
  [/연차|휴가|월차|vacation|day off|leave/i, 'leave'],
  [/출장|business trip|trip/i, 'trip'],
  [/외근|현장|field work/i, 'outside'],
  [/교육|연수|세미나|training|workshop/i, 'training'],
  [/회의|미팅|면담|meeting|call|1:1/i, 'meeting'],
  [/병원|치과|약속|생일|개인|dentist|doctor|personal/i, 'personal'],
]
const ABSENCE_CATS: Category[] = ['leave', 'halfday', 'outside', 'trip', 'training']

/** 오전·오후가 없는 시: 업무 시간 기준 (1~6시 → 오후, 7~12시 → 그대로) */
function guessHour(h: number, ampm?: string) {
  if (ampm && /오후|저녁|밤|pm/i.test(ampm)) return h < 12 ? h + 12 : h
  if (ampm && /오전|아침|새벽|am/i.test(ampm)) return h === 12 ? 0 : h
  return h >= 1 && h <= 6 ? h + 12 : h
}

export function parseQuick(input: string, today = new Date()): QuickResult {
  let s = input
  const marks: [number, number][] = []
  // 찾은 부분은 같은 길이의 빈칸으로 지워서, 남은 글자가 제목이 되게 한다 (위치 유지)
  const take = (re: RegExp): RegExpExecArray | null => {
    const m = re.exec(s)
    if (!m) return null
    marks.push([m.index, m.index + m[0].length])
    s = s.slice(0, m.index) + ' '.repeat(m[0].length) + s.slice(m.index + m[0].length)
    return m
  }

  // ── 날짜 ──
  let date: Date | null = null
  let endDate: Date | null = null
  const year = today.getFullYear()
  const mkDate = (mo: number, d: number) => {
    const x = new Date(year, mo - 1, d)
    // 이미 많이 지난 날짜면 내년으로 (예: 12월에 "1/5")
    if (x.getTime() < addD(today, -60).getTime()) x.setFullYear(year + 1)
    return x
  }
  // 기간: 11/20~22, 11월 20일~22일, 11/20~11/22
  let m = take(/(\d{1,2})\s*[/.월]\s*(\d{1,2})\s*일?\s*[~\-–]\s*(?:(\d{1,2})\s*[/.월]\s*)?(\d{1,2})\s*일?/)
  if (m) {
    date = mkDate(+m[1], +m[2])
    endDate = mkDate(m[3] ? +m[3] : +m[1], +m[4])
  }
  if (!date && (m = take(/(\d{1,2})\s*[/.]\s*(\d{1,2})(?![\d:])|(\d{1,2})\s*월\s*(\d{1,2})\s*일/))) {
    date = m[1] ? mkDate(+m[1], +m[2]) : mkDate(+m[3], +m[4])
  }
  if (!date && (m = take(/(오늘|today)(까지)?/i))) date = today
  if (!date && (m = take(/(내일|tomorrow)(까지)?/i))) date = addD(today, 1)
  if (!date && (m = take(/(모레)(까지)?/))) date = addD(today, 2)
  if (!date && (m = take(/(다음\s*주|담주|next\s+week|이번\s*주|this\s+week)?\s*([일월화수목금토])요일(까지)?|(next\s+)?\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i))) {
    const next = /다음|담주|next/i.test(m[1] ?? m[4] ?? '')
    const target = m[2] ? DOW[m[2]] : DOW_EN[(m[5] ?? '').toLowerCase()]
    // 이번 주(월요일 시작)의 그 요일, 다음 주면 +7, 이번 주인데 지났으면 다음 주
    const mon = addD(today, -((today.getDay() + 6) % 7))
    let d = addD(mon, (target + 6) % 7)
    if (next) d = addD(d, 7)
    else if (!/이번|this/i.test(m[1] ?? '') && ymd(d) < ymd(today)) d = addD(d, 7)
    date = d
  }
  if (!date && (m = take(/(?:^|\s)([일월화수목금토])(?=\s+\d)/))) {
    const mon = addD(today, -((today.getDay() + 6) % 7))
    let d = addD(mon, (DOW[m[1]] + 6) % 7)
    if (ymd(d) < ymd(today)) d = addD(d, 7)
    date = d
  }
  if (!date && (m = take(/(\d{1,2})\s*일(까지)?(?!\s*[~\-–])/))) date = mkDate(today.getMonth() + 1, +m[1])

  // ── 시간 ──
  let start: string | undefined
  let end: string | undefined
  // 09:00~10:00, 9시-10시, 오후 2시 30분~4시, 2시부터 3시까지
  m = take(/(오전|오후|아침|저녁|밤|am|pm)?\s*(\d{1,2})(?::(\d{2})|\s*시\s*(?:(\d{1,2})\s*분|(반))?)\s*(?:부터)?\s*(?:[~\-–]|부터)\s*(오전|오후|저녁|밤|am|pm)?\s*(\d{1,2})(?::(\d{2})|\s*시(?!간)\s*(?:(\d{1,2})\s*분|(반))?)\s*(?:까지)?/i)
  if (m) {
    const sh = guessHour(+m[2], m[1])
    const sm = m[3] ? +m[3] : m[4] ? +m[4] : m[5] ? 30 : 0
    let eh = guessHour(+m[7], m[6] ?? (m[1] && /오후|pm|저녁|밤/i.test(m[1]) ? '오후' : undefined))
    const em = m[8] ? +m[8] : m[9] ? +m[9] : m[10] ? 30 : 0
    if (eh * 60 + em <= sh * 60 + sm && eh < 12) eh += 12
    start = hm(sh, sm)
    end = hm(eh, em)
  } else if ((m = take(/(오전|오후|아침|저녁|밤|am|pm)?\s*(\d{1,2})(?::(\d{2})|\s*시\s*(?:(\d{1,2})\s*분|(반))?)(?:\s*(?:부터|에))?(?:\s*(\d{1,2})\s*시간(?:\s*(반))?|\s*(\d{1,3})\s*분\s*(?:동안|간)?)?/i))) {
    const sh = guessHour(+m[2], m[1])
    const sm = m[3] ? +m[3] : m[4] ? +m[4] : m[5] ? 30 : 0
    const dur = m[6] ? +m[6] * 60 + (m[7] ? 30 : 0) : m[8] ? +m[8] : 60 // 끝 시간이 없으면 1시간
    const t = sh * 60 + sm + dur
    start = hm(sh, sm)
    end = hm(Math.floor(t / 60), t % 60)
  }

  // ── 장소: "장소는 X", "장소 X", "@X", "X에서" ──
  let place: string | undefined
  if ((m = take(/장소\s*(?:는|은|:)?\s*(\S+(?:\s+\S+)?)\s*$/)) || (m = take(/장소\s*(?:는|은|:)\s*(\S+)/))) place = m[1]
  else if ((m = take(/@(\S+)/))) place = m[1]
  else if ((m = take(/(\S+)에서(?=\s|$)/))) place = m[1]

  // ── 그 밖의 표시 ──
  const priority = !!take(/(?:^|\s)(중요|급함|긴급|!{1,3})(?=\s|$)/)
  const shared = !take(/(?:^|\s)(나만|비공개|private)(?=\s|$)/i)

  // ── 종류 ──
  let category: Category = 'work'
  for (const [re, c] of CAT_WORDS) if (re.test(input)) { category = c; break }
  const absence = ABSENCE_CATS.includes(category)

  // ── 제목: 남은 글자 정리 ──
  const title = s.replace(/\s+/g, ' ').replace(/^[\s,.·:-]+|[\s,.·:-]+$/g, '').replace(/^(까지|에|은|는)\s+/, '').trim()

  const base = date ?? today
  const isRange = !!endDate && ymd(endDate) > ymd(base)
  // 판단: 시간 → 일정 / 기간 → 여러 날 일정 / 부재 단어 → 일정(업무 시간) / 그 밖 → 할 일
  if (start) {
    return { kind: 'event', reason: 'time', title, date: ymd(base), start, end, place, category, shared, priority, marks }
  }
  if (isRange) {
    return { kind: 'event', reason: 'range', title, date: ymd(base), endDate: ymd(endDate!), place, category, shared, priority, marks }
  }
  if (absence) {
    // 반차는 오전 반나절, 나머지 부재는 업무 시간 전체
    const [s1, e1] = category === 'halfday' ? ['09:00', '13:00'] : ['09:00', '18:00']
    return { kind: 'event', reason: 'absence', title, date: ymd(base), start: s1, end: e1, place, category, shared, priority, marks }
  }
  return { kind: 'todo', reason: 'notime', title, date: ymd(base), place, category, shared, priority, marks }
}
