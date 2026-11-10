import { useEffect, useState } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { occurrencesOn } from '../lib/events'
import { addDays, dowLabel, holidayName, isoWeek, mondayOf, parse, todayStr, weekDays } from '../lib/date'
import { CATEGORY_LABEL, isAbsence, type ChangeRequest, type Member, type Occurrence } from '../lib/types'
import { Header } from './Header'
import { DayAgenda, Todos } from './PersonalPanel'
import { Modals } from './Modals'
import { NoticeToasts } from './NoticeToasts'
import { ChatPanel } from './Chat'
import { Avatar, Icon } from './ui'

type Tab = 'team' | 'me' | 'todo' | 'chat'

/** 좁은 화면용 레이아웃: 하단 탭 + 요일 탭 중심의 팀 일정 */
export function MobileMain() {
  const [tab, setTab] = useState<Tab>('team')
  const { toast, setChatOpen } = useUI()
  const { db, me, chatUnread, chatMentions } = useStore()
  // 대화 탭을 보고 있으면 '대화창 열림'으로 본다 (호출 팝업을 띄우지 않음)
  useEffect(() => {
    setChatOpen(tab === 'chat')
  }, [tab, setChatOpen])
  const { selected } = useUI()
  const left = db.todos.filter((t) => t.ownerId === me?.id && !t.done && t.date <= selected).length

  return (
    <div className="m-app">
      <Header />
      <div className="m-body">
        {tab === 'team' && <MobileTeam />}
        {tab === 'me' && <DayAgenda />}
        {tab === 'todo' && <Todos />}
        {tab === 'chat' && <ChatPanel />}
      </div>
      <nav className="m-tabs" aria-label="화면 전환">
        {([
          ['team', '팀 주간표', 'cal'],
          ['me', '내 일정', 'person'],
          ['todo', '할 일', 'list'],
          ['chat', '대화', 'chat'],
        ] as const).map(([k, label, icon]) => (
          <button key={k} className={'m-tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)} aria-current={tab === k}>
            <span className="m-tab-ico">
              <Icon name={icon} size={22} />
              {k === 'todo' && left > 0 && <b>{left}</b>}
              {k === 'chat' && chatUnread > 0 && <b className={chatMentions > 0 ? 'at' : ''}>{chatMentions > 0 ? '@' : ''}{chatUnread > 99 ? '99+' : chatUnread}</b>}
            </span>
            {label}
          </button>
        ))}
      </nav>
      <Modals />
      {toast && <div className="toast" role="status">{toast}</div>}
      <NoticeToasts />
    </div>
  )
}

function MobileTeam() {
  const { db, me, myMember, tableMembers, userOf } = useStore()
  const { selected, setSelected, openModal } = useUI()
  const days = weekDays(selected)
  const today = todayStr()
  const day = days.includes(selected) ? selected : days[0]
  const mon = mondayOf(selected)
  const a = parse(mon)
  const b = parse(addDays(mon, 4))
  const label = `${a.getMonth() + 1}월 ${a.getDate()}일 – ${a.getMonth() === b.getMonth() ? '' : b.getMonth() + 1 + '월 '}${b.getDate()}일`

  const shared = db.events.filter((e) => e.shared)
  const myPending: ChangeRequest[] = db.requests.filter(
    (r) => r.status === 'pending' && (r.requesterId === me?.id || r.leaderId === me?.id),
  )
  const eventsOf = (userId: string, d: string): Occurrence[] =>
    occurrencesOn(shared.filter((e) => e.ownerId === userId), d)

  const clickable = (m: Member) =>
    m.userId === me?.id || (m.role === 'leader' && myMember?.role === 'member')
  const onAdd = (m: Member) => {
    if (m.userId === me?.id) openModal({ type: 'event', date: day })
    else openModal({ type: 'request', mode: 'add', date: day })
  }

  const absent = day
    ? tableMembers.flatMap((m) => {
        const o = eventsOf(m.userId, day).find((x) => isAbsence(x.category))
        return o ? [{ m, o }] : []
      })
    : []

  return (
    <div className="m-team">
      <section className="m-week">
        <div className="m-week-head">
          <strong>{label}</strong>
          <span className="week-pill">{isoWeek(mon)}주차</span>
          <span className="grow" />
          <button className="m-today" onClick={() => setSelected(todayStr())}>오늘</button>
        </div>
        {days.length === 0 ? (
          <div className="empty">이번 주는 표시할 평일이 없어요.</div>
        ) : (
          <div className="m-week-row">
            <button className="m-wk-arrow" onClick={() => setSelected(addDays(selected, -7))} aria-label="이전 주"><Icon name="chevL" size={18} /></button>
            <div className="m-days" role="tablist" aria-label="요일">
              {days.map((d) => (
                <button
                  key={d}
                  role="tab"
                  aria-selected={d === day}
                  className={'m-day' + (d === day ? ' on' : '') + (d === today ? ' today' : '') + (holidayName(d) ? ' holiday' : '')}
                  onClick={() => setSelected(d)}
                >
                  <small>{dowLabel(d)}</small>
                  <strong>{parse(d).getDate()}</strong>
                </button>
              ))}
            </div>
            <button className="m-wk-arrow" onClick={() => setSelected(addDays(selected, 7))} aria-label="다음 주"><Icon name="chevR" size={18} /></button>
          </div>
        )}
      </section>

      {days.length > 0 && (
        <>
          <div className="m-scroll">
            {holidayName(day) && <div className="m-holiday">{holidayName(day)} · 휴일</div>}
            <section className="m-absent">
              <h3>부재자</h3>
              <div className="m-pills">
                {absent.length === 0 && <span className="none">없음</span>}
                {absent.map(({ m, o }) => (
                  <span key={m.userId} className="pill" data-cat={o.category}>
                    {userOf(m.userId).name}
                    <em>{CATEGORY_LABEL[o.category]}</em>
                  </span>
                ))}
              </div>
            </section>

            {tableMembers.map((m) => {
              const u = userOf(m.userId)
              const mine = m.userId === me?.id
              const evs = eventsOf(m.userId, day)
              const reqs = myPending.filter((r) => r.type === 'add' && r.leaderId === m.userId && r.payload.date === day)
              type Entry = { start: string; ev?: Occurrence; req?: ChangeRequest }
              const entries: Entry[] = [
                ...evs.map((ev) => ({ start: ev.start, ev })),
                ...reqs.map((req) => ({ start: req.payload.start, req })),
              ].sort((x, y) => x.start.localeCompare(y.start))
              return (
                <section key={m.userId} className={'m-card' + (mine ? ' mine' : '')}>
                  <header>
                    <Avatar name={u.name} size={34} />
                    <div className="m-who">
                      <strong>
                        {u.name}
                        {m.role === 'leader' && <span className="badge">팀장</span>}
                        {mine && <span className="me-badge">나</span>}
                      </strong>
                      {m.role !== 'leader' && <small>{m.title || '직급 미지정'}</small>}
                    </div>
                    {clickable(m) && (
                      <button className="m-add" onClick={() => onAdd(m)} aria-label={mine ? '일정 추가' : '팀장에게 일정 요청'}>
                        <Icon name="plus" size={14} /> {mine ? '추가' : '요청'}
                      </button>
                    )}
                  </header>
                  {entries.length === 0 ? (
                    <p className="m-none">일정 없음</p>
                  ) : (
                    <ul>
                      {entries.map((en) =>
                        en.req ? (
                          <li key={en.req.id} className="m-item ghost" data-cat="meeting">
                            <span className="m-time">{en.req.payload.start}<small>{en.req.payload.end}</small></span>
                            <span className="m-main">
                              <b>{en.req.payload.title}</b>
                              {en.req.payload.place && <small>{en.req.payload.place}</small>}
                            </span>
                            <span className="wait-tag">대기</span>
                          </li>
                        ) : (
                          <li key={en.ev!.id + en.ev!.date}>
                            <button className="m-item" data-cat={en.ev!.category} onClick={() => openModal({ type: 'detail', occ: en.ev! })}>
                              <span className="m-time">{en.ev!.start}<small>{en.ev!.end}</small></span>
                              <span className="m-main">
                                <b>{en.ev!.title}</b>
                                {en.ev!.place && <small>{en.ev!.place}</small>}
                              </span>
                              <span className="cat-tag" data-cat={en.ev!.category}>{CATEGORY_LABEL[en.ev!.category]}</span>
                            </button>
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                </section>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
