import { useCallback, useSyncExternalStore } from 'react'

/**
 * 데스크탑 화면 칸 크기 (끌어서 조절) — 이 브라우저에만 기억한다
 * - right: 오른쪽 개인 칸 폭 (화면 폭의 %, 20~45, 기본 33.3)
 * - top:   오른쪽 칸에서 일정이 차지하는 높이 (%, 25~75, 기본 50) — 나머지는 할 일
 */
const KEY = 'weekendar-layout'
export const RIGHT_DEFAULT = 100 / 3
export const TOP_DEFAULT = 50
export const clampRight = (v: number) => Math.min(45, Math.max(20, v))
export const clampTop = (v: number) => Math.min(75, Math.max(25, v))

interface Layout { right: number; top: number }

function read(): Layout {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Layout>
    return {
      right: typeof v.right === 'number' ? clampRight(v.right) : RIGHT_DEFAULT,
      top: typeof v.top === 'number' ? clampTop(v.top) : TOP_DEFAULT,
    }
  } catch {
    return { right: RIGHT_DEFAULT, top: TOP_DEFAULT }
  }
}

// 여러 컴포넌트가 같은 값을 쓰도록 한 곳에 둔다
let cur: Layout | null = null
const subs = new Set<() => void>()

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
const snapshot = () => (cur ??= read())

export function useLayout() {
  const v = useSyncExternalStore(subscribe, snapshot)
  // save=false: 끄는 동안에는 화면만 바꾸고, 손을 뗄 때 한 번 저장
  const set = useCallback((patch: Partial<Layout>, save = true) => {
    cur = { ...snapshot(), ...patch }
    if (save) { try { localStorage.setItem(KEY, JSON.stringify(cur)) } catch { /* 무시 */ } }
    subs.forEach((f) => f())
  }, [])
  return { ...v, set }
}
