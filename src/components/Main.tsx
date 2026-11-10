import { useEffect } from 'react'
import { useStore, initialDate } from '../lib/store'
import { useUI } from '../lib/ui'
import { addDays } from '../lib/date'
import { Header } from './Header'
import { TeamTable } from './TeamTable'
import { PersonalPanel } from './PersonalPanel'
import { Modals } from './Modals'
import { MobileMain } from './Mobile'
import { NoticeToasts } from './NoticeToasts'
import { ChatWindow } from './Chat'
import { Reminders } from './Reminders'
import { clearInvite, getInvite } from '../lib/invite'

export function Main() {
  const { selected, setSelected, modal, openModal, toast, panelOpen, isMobile, showToast } = useUI()
  const { myMember, team } = useStore()

  // 이미 팀이 있는데 초대 링크로 들어온 경우: 안내하고 코드는 버린다
  useEffect(() => {
    const code = getInvite()
    if (!code || !team) return
    clearInvite()
    if (code !== team.inviteCode) showToast('이미 팀에 속해 있어서 초대 링크를 사용할 수 없어요. (1인 1팀)')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id])

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
    <div className={'app' + (panelOpen ? '' : ' panel-closed')} style={{ gridTemplateColumns: panelOpen ? '2fr 1fr' : '1fr 0fr' }}>
      <main className="team">
        <Header />
        {myMember && <TeamTable />}
      </main>
      <div className="panel-col">
        <PersonalPanel />
      </div>
      <Modals />
      {toast && <div className="toast" role="status">{toast}</div>}
      <ChatWindow />
      <NoticeToasts />
      <Reminders />
    </div>
  )
}
