import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Occurrence } from './types'
import { initialDate } from './store'

export type ModalState =
  /** back: 닫거나 저장하면 이 창으로 돌아간다 (예: 월간 일정에서 연 경우) */
  | { type: 'event'; date: string; start?: string; event?: Occurrence; title?: string; shared?: boolean; back?: ModalState }
  | { type: 'detail'; occ: Occurrence }
  | { type: 'request'; mode: 'add' | 'edit' | 'delete'; date: string; occ?: Occurrence; back?: ModalState }
  | { type: 'day'; userId: string; date: string }
  | { type: 'admin' }
  | { type: 'calendar' }
  | { type: 'push' }
  | { type: 'leave' }
  /** 팀원 메뉴 (x, y: 데스크탑에서 메뉴를 띄울 위치) */
  | { type: 'member'; userId: string; x?: number; y?: number }
  /** date: 처음 보여줄 날짜 (없으면 지금 고른 날) */
  | { type: 'month'; userId: string; date?: string }
  | { type: 'mail'; userId: string }
  | { type: 'install' }
  | { type: 'tutorial' }
  | { type: 'settings' }
  | null

interface UI {
  selected: string
  setSelected: (d: string) => void
  modal: ModalState
  openModal: (m: ModalState) => void
  closeModal: () => void
  /** 지금 열린 창 위에 겹쳐 여는 창 (예: 월간 일정을 닫지 않고 일정 상세·수정을 보기). 이 층의 창은 closeModal 로 닫으면 아래 창이 그대로 남는다 */
  layer: ModalState
  openLayer: (m: ModalState) => void
  toast: string | null
  /** 안내에 붙은 버튼 (예: 되돌리기) */
  toastAction: { label: string; run: () => void } | null
  /** action 을 주면 버튼이 붙고 5초 동안 보인다 */
  showToast: (t: string, action?: { label: string; run: () => void }) => void
  theme: 'light' | 'dark'
  themePref: ThemePref
  setThemePref: (v: ThemePref) => void
  toggleTheme: () => void
  panelOpen: boolean
  togglePanel: () => void
  /** 팀 대화창이 열려 있는지 (모바일은 대화 탭) */
  chatOpen: boolean
  setChatOpen: (v: boolean) => void
  /** 대화창 탭: 팀 대화 / 1:1 대화 */
  chatTab: 'team' | 'dm'
  setChatTab: (v: 'team' | 'dm') => void
  /** 1:1 대화 중인 상대 (null 이면 1:1 목록) */
  dmPeer: string | null
  setDmPeer: (id: string | null) => void
  /** 이 사람과의 1:1 대화창 열기 */
  openDM: (userId: string) => void
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
  const [layer, setLayer] = useState<ModalState>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [toastAction, setToastAction] = useState<{ label: string; run: () => void } | null>(null)
  const showToast = (t: string, action?: { label: string; run: () => void }) => {
    setToastAction(action ?? null)
    setToast(t)
  }
  const [panelOpen, setPanelOpen] = useState(true)
  const [chatOpen, setChatOpen] = useState(false)
  const [chatTab, setChatTab] = useState<'team' | 'dm'>('team')
  const [dmPeer, setDmPeer] = useState<string | null>(null)
  const openDM = (userId: string) => {
    setModal(null)
    setChatTab('dm')
    setDmPeer(userId)
    setChatOpen(true)
  }
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
    // 휴대폰 상단바(시계 줄) 색도 화면 배경색(--bg)과 맞춘다
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', theme === 'dark' ? '#000000' : '#f5f5f7')
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
    const t = setTimeout(() => { setToast(null); setToastAction(null) }, toastAction ? 5000 : 2600)
    return () => clearTimeout(t)
  }, [toast, toastAction])

  return (
    <Ctx.Provider
      value={{
        selected,
        setSelected,
        modal,
        // 겹친 창이 있으면 그 창 안에서 여는 것은 겹친 창을 바꾼다
        openModal: (m) => (layer ? setLayer(m) : setModal(m)),
        layer,
        openLayer: setLayer,
        chatTab,
        setChatTab,
        dmPeer,
        setDmPeer,
        openDM,
        // 돌아갈 창이 있으면 그 창으로, 없으면 닫기
        closeModal: () => (layer ? setLayer(null) : setModal((m) => (m && 'back' in m && m.back ? m.back : null))),
        toast,
        toastAction,
        showToast,
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
