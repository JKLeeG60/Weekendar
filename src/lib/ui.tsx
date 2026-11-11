import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Occurrence } from './types'
import { initialDate } from './store'

export type ModalState =
  | { type: 'event'; date: string; start?: string; event?: Occurrence; title?: string; shared?: boolean }
  | { type: 'detail'; occ: Occurrence }
  | { type: 'request'; mode: 'add' | 'edit' | 'delete'; date: string; occ?: Occurrence }
  | { type: 'day'; userId: string; date: string }
  | { type: 'admin' }
  | { type: 'calendar' }
  | { type: 'push' }
  | null

interface UI {
  selected: string
  setSelected: (d: string) => void
  modal: ModalState
  openModal: (m: ModalState) => void
  closeModal: () => void
  toast: string | null
  showToast: (t: string) => void
  theme: 'light' | 'dark'
  themePref: ThemePref
  setThemePref: (v: ThemePref) => void
  toggleTheme: () => void
  panelOpen: boolean
  togglePanel: () => void
  /** 팀 대화창이 열려 있는지 (모바일은 대화 탭) */
  chatOpen: boolean
  setChatOpen: (v: boolean) => void
  /** 실제로 좁은 화면인지 */
  narrow: boolean
  /** 데스크탑에서 폰 화면 미리보기 중인지 */
  preview: boolean
  setPreview: (v: boolean) => void
  /** 모바일 레이아웃을 쓸지 (좁은 화면이거나 미리보기) */
  isMobile: boolean
}

export type ThemePref = 'system' | 'light' | 'dark'

const Ctx = createContext<UI | null>(null)
export const useUI = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('UIProvider 필요')
  return c
}

/** 폰에서 브라우저의 '데스크톱 사이트 요청'을 켠 경우 (터치 기기인데 모바일 UA가 아님) */
function desktopSiteRequested(): boolean {
  const ua = navigator.userAgent
  const mobileUA = /iPhone|iPod|Android.*Mobile|Mobile.*Safari/.test(ua) && !/Macintosh|X11|Windows NT/.test(ua)
  return !mobileUA && navigator.maxTouchPoints > 0
}

/** 모바일 레이아웃을 쓸지: ?view=mobile|desktop 으로 강제 가능 */
function isNarrow(): boolean {
  const v = new URLSearchParams(location.search).get('view')
  if (v === 'mobile') return true
  if (v === 'desktop') return false
  if (desktopSiteRequested()) return false
  return matchMedia('(max-width: 820px)').matches
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState(() => new URLSearchParams(location.search).get('date') ?? initialDate())
  const [modal, setModal] = useState<ModalState>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const [chatOpen, setChatOpen] = useState(false)
  const [narrow, setNarrow] = useState(() => isNarrow())
  const [preview, setPreview] = useState(() => new URLSearchParams(location.search).get('preview') === 'phone')
  const isMobile = narrow || preview

  useEffect(() => {
    const mq = matchMedia('(max-width: 820px)')
    const h = () => setNarrow(isNarrow())
    mq.addEventListener('change', h)
    // 폰의 "데스크톱 사이트" 모드: 화면 폭을 넓게 잡아 데스크탑 화면 전체가 보이게 한다.
    const meta = document.querySelector('meta[name=viewport]')
    if (meta) meta.setAttribute('content', desktopSiteRequested() && !isNarrow() ? 'width=1280' : 'width=device-width, initial-scale=1.0')
    return () => mq.removeEventListener('change', h)
  }, [])

  useEffect(() => {
    document.documentElement.style.fontSize = isMobile ? '15px' : ''
  }, [isMobile])
  // 화면 모드: 기본은 기기(시스템) 설정을 따르고, 프로필 메뉴에서 라이트·다크로 고정할 수 있음
  const [themePref, setThemePref] = useState<ThemePref>(() => {
    try {
      const saved = localStorage.getItem('weekendar-theme')
      if (saved === 'dark' || saved === 'light' || saved === 'system') return saved
    } catch {
      /* 저장소를 못 쓰는 환경 */
    }
    return 'system'
  })
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const theme: 'light' | 'dark' = themePref === 'system' ? (systemDark ? 'dark' : 'light') : themePref

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  useEffect(() => {
    try {
      localStorage.setItem('weekendar-theme', themePref)
    } catch {
      /* 무시 */
    }
  }, [themePref])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  return (
    <Ctx.Provider
      value={{
        selected,
        setSelected,
        modal,
        openModal: setModal,
        closeModal: () => setModal(null),
        toast,
        showToast: setToast,
        theme,
        toggleTheme: () => setThemePref(theme === 'light' ? 'dark' : 'light'),
        themePref,
        setThemePref,
        panelOpen,
        togglePanel: () => setPanelOpen((v) => !v),
        chatOpen,
        setChatOpen,
        narrow,
        preview,
        setPreview,
        isMobile,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}
