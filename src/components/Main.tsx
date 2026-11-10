import { useEffect } from 'react'
import { useStore, initialDate } from '../lib/store'
import { useUI } from '../lib/ui'
import { addDays } from '../lib/date'
import { Header } from './Header'
import { TeamTable } from './TeamTable'
import { PersonalPanel } from './PersonalPanel'
import { Modals } from './Modals'
import { MobileMain } from './Mobile'

export function Main() {
  const { selected, setSelected, modal, openModal, toast, panelOpen, isMobile } = useUI()
  const { myMember } = useStore()

  // 키보드 단축키: ← → 주 이동, T 이번 주, N 새 일정
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (modal || /INPUT|TEXTAREA|SELECT/.test(t.tagName) || e.metaKey || e.ctrlKey) return
      if (e.key === 'ArrowLeft') setSelected(addDays(selected, -7))
      else if (e.key === 'ArrowRight') setSelected(addDays(selected, 7))
      else if (e.key.toLowerCase() === 't') setSelected(initialDate())
      else if (e.key.toLowerCase() === 'n') openModal({ type: 'event', date: selected })
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [selected, modal, setSelected, openModal])

  if (isMobile) return <MobileMain />

  return (
    <div className="app" style={{ gridTemplateColumns: panelOpen ? '2fr 1fr' : '1fr 0fr' }}>
      <main className="team">
        <Header />
        {myMember && <TeamTable />}
      </main>
      <div className="panel-col">
        <PersonalPanel />
      </div>
      <Modals />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  )
}
