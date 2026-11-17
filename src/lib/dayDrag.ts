/**
 * "끌어서 다른 날로 옮기기"의 진행 상태 (화면 어디서 끌든 같은 날짜 띠를 쓴다)
 * - 끌기 시작: startDayDrag → 날짜 띠가 나타난다
 * - 손가락/마우스 이동: moveDayDrag(x, y) → 아래에 있는 날짜를 찾는다
 * - 놓기: endDayDrag() → 날짜 위에서 놓았으면 onDrop(날짜)
 */
import { useSyncExternalStore } from 'react'
import { addDays } from './date'

export interface DayDragState {
  active: boolean
  /** 끌고 있는 것의 이름 (손가락 옆에 표시) */
  label: string
  x: number
  y: number
  /** 지금 손가락 아래의 날짜 (없으면 null) */
  over: string | null
  /** 브라우저 기본 끌기(PC 할 일)면 손가락 옆 표시를 생략 */
  native: boolean
  /** 날짜 띠를 놓을 기준 위치 (없으면 화면 위 가운데) */
  anchor: { left: number; top: number; width: number } | null
  onDrop: ((day: string) => void) | null
  /** 손가락을 따라다니는 반투명 복사본 (끌고 있는 줄의 모양 그대로) */
  ghost: { html: string; w: number; h: number; dx: number; dy: number } | null
  /** 폰 팀 주간 탭처럼 위에 주간 달력이 이미 있으면 true: 날짜 띠 대신 그 달력에 놓는다 */
  inline: boolean
  /** inline 일 때 달력이 보여 줄 주의 월요일 (null 이면 원래 보던 주) */
  week: string | null
}

const IDLE: DayDragState = { active: false, label: '', x: 0, y: 0, over: null, native: false, anchor: null, onDrop: null, ghost: null, inline: false, week: null }
let state = IDLE
const subs = new Set<() => void>()
const set = (patch: Partial<DayDragState>) => {
  state = { ...state, ...patch }
  subs.forEach((f) => f())
}

export const useDayDrag = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => {
        subs.delete(f)
      }
    },
    () => state,
  )

export function startDayDrag(o: { label: string; onDrop: (day: string) => void; x?: number; y?: number; native?: boolean; anchor?: Element | null; source?: Element | null }) {
  const r = o.anchor?.getBoundingClientRect()
  const x = o.x ?? 0, y = o.y ?? 0
  // 끌고 있는 줄을 복사해 손가락을 따라다니게 한다 (잡은 자리 그대로)
  const sr = o.source?.getBoundingClientRect()
  const ghost = o.source && sr ? { html: o.source.outerHTML, w: sr.width, h: sr.height, dx: x - sr.left, dy: y - sr.top } : null
  set({
    active: true, label: o.label, x, y, over: null, native: !!o.native, onDrop: o.onDrop, ghost,
    inline: !!document.querySelector('.m-week'), week: null,
    anchor: r ? { left: r.left, top: r.top, width: r.width } : null,
  })
}

/** 화면 좌표 아래의 날짜 칸 (data-drop-day) */
export function dayAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y)?.closest('[data-drop-day]')
  return el?.getAttribute('data-drop-day') ?? null
}

export function moveDayDrag(x: number, y: number) {
  if (!state.active) return
  set({ x, y, over: dayAt(x, y) })
}

/** inline 일 때 달력이 보여 주는 주를 n일(±7) 옮긴다. base = 원래 보던 주의 월요일 */
export function shiftDragWeek(n: number, base: string) {
  if (state.active) set({ week: addDays(state.week ?? base, n) })
}

export function setDayDragOver(day: string | null) {
  if (state.active && state.over !== day) set({ over: day })
}

/** 놓기. 날짜 위였으면 옮기고 true */
export function endDayDrag(drop = true): boolean {
  const { over, onDrop, active } = state
  state = IDLE
  subs.forEach((f) => f())
  if (drop && active && over && /^\d{4}-\d{2}-\d{2}$/.test(over) && onDrop) {
    onDrop(over)
    return true
  }
  return false
}

export const dayDragActive = () => state.active
