/**
 * "끌어서 다른 날로 옮기기"의 진행 상태 (화면 어디서 끌든 같은 날짜 띠를 쓴다)
 * - 끌기 시작: startDayDrag → 날짜 띠가 나타난다
 * - 손가락/마우스 이동: moveDayDrag(x, y) → 아래에 있는 날짜를 찾는다
 * - 놓기: endDayDrag() → 날짜 위에서 놓았으면 onDrop(날짜)
 */
import { useSyncExternalStore } from 'react'

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
}

const IDLE: DayDragState = { active: false, label: '', x: 0, y: 0, over: null, native: false, anchor: null, onDrop: null }
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

export function startDayDrag(o: { label: string; onDrop: (day: string) => void; x?: number; y?: number; native?: boolean; anchor?: Element | null }) {
  const r = o.anchor?.getBoundingClientRect()
  set({
    active: true, label: o.label, x: o.x ?? 0, y: o.y ?? 0, over: null, native: !!o.native, onDrop: o.onDrop,
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
