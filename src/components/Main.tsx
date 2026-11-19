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
import { t } from '../lib/i18n'
import { DayDropStrip, Toast } from './DayDrop'
import { useAutoTutorial } from './Tutorial'
import { useAutoWeekStart } from './WeekGoals'
import { comboOf, resolveShortcuts, type ShortcutId } from '../lib/shortcuts'
import { finishGcalConnect } from '../lib/gcal'

export function Main() {
  const { selected, setSelected, modal, openModal, toast, panelOpen, togglePanel, isMobile, showToast, chatOpen, setChatOpen } = useUI()
  const { myMember, team, me, mode } = useStore()
  // 구글 캘린더 연결 화면에서 돌아왔으면 마무리 (토글을 켠 일정을 구글로 보냄)
  useEffect(() => {
    if (mode !== 'cloud' || !me) return
    finishGcalConnect().then((r) => {
      if (!r) return
      showToast(r.msg)
      if (r.back) openModal(r.back) // 쓰던 일정 창을 토글이 켜진 채로 다시 연다
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, me?.id])
  useAutoTutorial() // 처음 가입한 사람에게만 사용 안내를 한 번 보여준다
  useAutoWeekStart() // 주 첫 접속에 "이번 주 시작" 카드를 한 번 보여준다

  // 이미 팀이 있는데 초대 링크로 들어온 경우: 안내하고 코드는 버린다
  useEffect(() => {
    const code = getInvite()
    if (!code || !team) return
    clearInvite()
    if (code !== team.inviteCode) showToast(t('이미 팀에 속해 있어서 초대 링크를 사용할 수 없어요. (1인 1팀)'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id])

  // 키보드 단축키 (PC 전용): 사람마다 바꿀 수 있고(설정 → 단축키), 키보드 자리로 알아들어 한글 상태에서도 작동
  const keys = resolveShortcuts(me?.shortcuts)
  useEffect(() => {
    if (isMobile) return
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      // 창이 떠 있거나 글을 쓰는 중이면 무시
      if (modal || e.isComposing || /INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable) return
      const combo = comboOf(e)
      if (!combo) return
      const id = (Object.keys(keys) as ShortcutId[]).find((k) => keys[k] === combo)
      if (!id) return
      e.preventDefault()
      const run: Record<ShortcutId, () => void> = {
        quickAdd: () => openModal({ type: 'quick' }),
        newEvent: () => openModal({ type: 'event', date: selected }),
        newTodo: () => {
          if (!panelOpen) togglePanel()
          window.setTimeout(() => document.querySelector<HTMLInputElement>('[data-todo-input]')?.focus(), 60)
        },
        prevWeek: () => setSelected(addDays(selected, -7)),
        nextWeek: () => setSelected(addDays(selected, 7)),
        today: () => setSelected(initialDate()),
        prevDay: () => setSelected(addDays(selected, -1)),
        nextDay: () => setSelected(addDays(selected, 1)),
        chat: () => setChatOpen(!chatOpen),
        month: () => me && openModal({ type: 'month', userId: me.id }),
        notices: () => window.dispatchEvent(new Event('wk:notices')),
        panel: () => togglePanel(),
        settings: () => openModal({ type: 'settings' }),
        help: () => openModal({ type: 'shortcuts' }),
      }
      run[id]()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [selected, modal, setSelected, openModal, isMobile, keys, panelOpen, togglePanel, chatOpen, setChatOpen, me])

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
      {toast && <Toast />}
      <DayDropStrip />
      <ChatWindow />
      <NoticeToasts />
      <Reminders />
    </div>
  )
}
