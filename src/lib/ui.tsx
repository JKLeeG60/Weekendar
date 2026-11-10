import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Occurrence } from './types'
import { initialDate } from './store'

export type ModalState =
  | { type: 'event'; date: string; start?: string; event?: Occurrence }
  | { type: 'detail'; occ: Occurrence }
  | { type: 'request'; mode: 'add' | 'edit' | 'delete'; date: string; occ?: Occurrence }
  | { type: 'day'; userId: string; date: string }
  | { type: 'admin' }
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
  toggleTheme: () => void
  panelOpen: boolean
  togglePanel: () => void
  /** 실제로 좁은 화면인지 */
  narrow: boolean
  /** 데스크탑에서 폰 화면 미리보기 중인지 */
  preview: boolean
  setPreview: (v: boolean) => void
  /** 모바일 레이아웃을 쓸지 (좁은 화면이거나 미리보기) */
  isMobile: boolean
}

const Ctx = createContext<UI | null>(null)
export const useUI = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('UIProvider 필요')
  return c
}

export function UIProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState(() => new URLSearchParams(location.search).get('date') ?? initialDate())
  const [modal, setModal] = useState<ModalState>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(true)
  const [narrow, setNarrow] = useState(() => matchMedia('(max-width: 820px)').matches)
  const [preview, setPreview] = useState(() => new URLSearchParams(location.search).get('preview') === 'phone')
  const isMobile = narrow || preview

  useEffect(() => {
    const mq = matchMedia('(max-width: 820px)')
    const h = () => setNarrow(mq.matches)
    mq.addEventListener('change', h)
    return () => mq.removeEventListener('change', h)
  }, [])

  useEffect(() => {
    document.documentElement.style.fontSize = isMobile ? '15px' : ''
  }, [isMobile])
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('weekendar-theme')
      if (saved === 'dark' || saved === 'light') return saved
    } catch {
      /* 저장소를 못 쓰는 환경 */
    }
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('weekendar-theme', theme)
    } catch {
      /* 무시 */
    }
  }, [theme])

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
        toggleTheme: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')),
        panelOpen,
        togglePanel: () => setPanelOpen((v) => !v),
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
