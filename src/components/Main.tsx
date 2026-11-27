import { useEffect, useRef } from 'react'
import { useStore, initialDate } from '../lib/store'
import { useUI } from '../lib/ui'
import { addDays, parse } from '../lib/date'
import { Header } from './Header'
import { TeamTable } from './TeamTable'
import { MonthView } from './People'
import { SearchSheet } from './Search'
import { PersonalPanel } from './PersonalPanel'
import { Modals } from './Modals'
import { MobileMain } from './Mobile'
import { NoticeToasts } from './NoticeToasts'
import { TipLayer } from './Meeting'
import { ChatWindow } from './Chat'
import { Reminders } from './Reminders'
import { clearInvite, getInvite } from '../lib/invite'
import { MAX_TEAMS } from '../lib/types'
import { t } from '../lib/i18n'
import { DayDropStrip, Toast } from './DayDrop'
import { useAutoTutorial } from './Tutorial'
import { useAutoWeekStart } from './WeekGoals'
import { comboOf, resolveShortcuts, type ShortcutId } from '../lib/shortcuts'
import { finishGcalConnect } from '../lib/gcal'
import { useLayout, clampRight, RIGHT_DEFAULT } from '../lib/layout'
import { Resizer } from './Resizer'

export function Main() {
  const { selected, setSelected, modal, openModal, toast, panelOpen, togglePanel, isMobile, showToast, chatOpen, setChatOpen, monthView, setMonthView, searchOpen, setSearchOpen } = useUI()
  // 끌어서 바꾸는 오른쪽 칸 폭 (이 브라우저에 기억)
  const lay = useLayout()
  const appRef = useRef<HTMLDivElement>(null)
  const { myMember, team, me, mode, myTeams, joinTeam, solo } = useStore()
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

  // 이미 팀이 있는데 초대 링크로 들어온 경우: 팀이 하나뿐이면 다른 팀에도 참여 요청 (최대 2개 팀)
  useEffect(() => {
    const code = getInvite()
    if (!code || !team) return
    clearInvite()
    if (code === team.inviteCode) return
    if (myTeams.length >= MAX_TEAMS) { showToast(t('팀은 최대 2개까지 참여할 수 있어요.')); return }
    // 혼자 쓰는 중이면: 승인되면 그 팀 화면으로 바뀐다 (내 일정은 그대로)
    if (solo) {
      if (!window.confirm(t('초대 코드 {code} 팀에 참여할까요? 관리자가 승인하면 팀 화면으로 바뀌고, 내 일정은 그대로 따라가요.', { code }))) return
      void Promise.resolve(joinTeam(code)).then((err) => showToast(err ?? t('참여를 요청했어요. 승인될 때까지 지금처럼 혼자 쓸 수 있어요.')))
      return
    }
    if (!window.confirm(t('초대 코드 {code} 팀에도 참여할까요? 관리자가 승인하면 팀을 오가며 볼 수 있어요.', { code }))) return
    void Promise.resolve(joinTeam(code)).then((err) => showToast(err ?? t('참여를 요청했어요. 관리자가 승인하면 팀 목록에 나타나요.')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id])

  // 키보드 단축키 (PC 전용): 사람마다 바꿀 수 있고(설정 → 단축키), 키보드 자리로 알아들어 한글 상태에서도 작동
  const keys = resolveShortcuts(me?.shortcuts)
  useEffect(() => {
    if (isMobile) return
    const h = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      // 창이 떠 있거나 글을 쓰는 중이면 무시
      if (modal || searchOpen || e.isComposing || /INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable) return
      // 월간 보기에서 Esc: 주간 팀 표로 (메모 창이 열려 있으면 메모 창이 먼저 닫힌다)
      if (e.key === 'Escape' && monthView && !document.querySelector('.memo-sheet.open')) { setMonthView(null); return }
      const combo = comboOf(e)
      if (!combo) return
      const id = (Object.keys(keys) as ShortcutId[]).find((k) => keys[k] === combo)
      if (!id) return
      e.preventDefault()
      const moveMonth = (n: number) => {
        if (!monthView) return
        const d = parse(monthView.date ?? selected)
        const { y, m } = monthView.ym ?? { y: d.getFullYear(), m: d.getMonth() }
        setMonthView({ ...monthView, ym: { y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 } })
      }
      const run: Record<ShortcutId, () => void> = {
        quickAdd: () => openModal({ type: 'quick' }),
        newEvent: () => openModal({ type: 'event', date: selected }),
        newTodo: () => {
          if (!panelOpen) togglePanel()
          window.setTimeout(() => document.querySelector<HTMLInputElement>('[data-todo-input]')?.focus(), 60)
        },
        // 월간 보기에서는 ← → 가 달을, T 가 이번 달을 바꾼다
        prevWeek: () => (monthView ? moveMonth(-1) : setSelected(addDays(selected, -7))),
        nextWeek: () => (monthView ? moveMonth(1) : setSelected(addDays(selected, 7))),
        today: () => { if (monthView) { const n = new Date(); setMonthView({ ...monthView, ym: { y: n.getFullYear(), m: n.getMonth() } }) } else setSelected(initialDate()) },
        prevDay: () => setSelected(addDays(selected, -1)),
        nextDay: () => setSelected(addDays(selected, 1)),
        chat: () => setChatOpen(!chatOpen),
        // M: 주간 ↔ 월간 보기 전환
        month: () => { if (monthView) setMonthView(null); else if (me) openModal({ type: 'month', userId: me.id }) },
        notices: () => window.dispatchEvent(new Event('wk:notices')),
        panel: () => togglePanel(),
        settings: () => openModal({ type: 'settings' }),
        help: () => openModal({ type: 'shortcuts' }),
        search: () => setSearchOpen(true),
      }
      run[id]()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [selected, modal, setSelected, openModal, isMobile, keys, panelOpen, togglePanel, chatOpen, setChatOpen, me, monthView, setMonthView, searchOpen, setSearchOpen])

  // ⌘F (윈도우는 Ctrl+F): 브라우저 찾기 대신 Weekendar 검색 (이미 열려 있으면 입력칸 선택)
  useEffect(() => {
    if (isMobile) return
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === 'KeyF') {
        e.preventDefault()
        if (searchOpen) document.querySelector<HTMLInputElement>('.sr-in input')?.select()
        else setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [isMobile, searchOpen, setSearchOpen])

  if (isMobile) return <MobileMain />

  return (
    <div ref={appRef} className={'app' + (panelOpen ? '' : ' panel-closed')} style={{ gridTemplateColumns: panelOpen ? `${100 - lay.right}fr ${lay.right}fr` : '1fr 0fr' }}>
      <main className="team">
        <Header />
        {myMember && (monthView ? <MonthView key={monthView.userId + (monthView.date ?? '')} userId={monthView.userId} date={monthView.date} /> : <TeamTable />)}
      </main>
      <div className="panel-col">
        {panelOpen && (
          <Resizer
            dir="col"
            label={t('오른쪽 칸 폭')}
            value={lay.right}
            min={20}
            max={45}
            onMove={(x, done) => {
              const r = appRef.current?.getBoundingClientRect()
              if (r) lay.set({ right: clampRight(((r.right - x) / r.width) * 100) }, done)
            }}
            onStep={(d) => lay.set({ right: clampRight(lay.right - d) })}
            onReset={() => lay.set({ right: RIGHT_DEFAULT })}
          />
        )}
        <PersonalPanel />
      </div>
      {searchOpen && <SearchSheet />}
      <Modals />
      {toast && <Toast />}
      <DayDropStrip />
      <ChatWindow />
      <NoticeToasts />
      <TipLayer />
      <Reminders />
    </div>
  )
}
