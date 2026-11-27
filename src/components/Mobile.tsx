import { useEffect, useState } from 'react'
import { useStore } from '../lib/store'
import { inRowOf, inviteOf } from '../lib/attend'
import { useUI } from '../lib/ui'
import { isMultiDay, occurrencesOn, spanLabel } from '../lib/events'
import { addDays, dowLabel, holidayLabel, holidayName, isoWeek, mondayOf, parse, todayStr, weekDays, weekPill } from '../lib/date'
import { getLang, t } from '../lib/i18n'
import { CATEGORY_LABEL, isAbsence, type ChangeRequest, type Member, type Occurrence } from '../lib/types'
import { Header } from './Header'
import { DayAgenda, Todos } from './PersonalPanel'
import { MemoTab } from './Memo'
import { Modals } from './Modals'
import { NoticeToasts } from './NoticeToasts'
import { TipLayer } from './Meeting'
import { ChatPanel } from './Chat'
import { Reminders } from './Reminders'
import { Avatar, Icon } from './ui'
import { AbsencePill } from './AbsencePill'
import { dayOff, KIND_LABEL, leaveName, OFF_CATS, offHides, waitingOn } from '../lib/absence'
import { SearchSheet } from './Search'
import { DayDropStrip, GestureRow, Toast, useEventActions } from './DayDrop'
import { useDayDrag } from '../lib/dayDrag'

type Tab = 'team' | 'me' | 'todo' | 'memo' | 'chat'

/** 좁은 화면용 레이아웃: 하단 탭 + 요일 탭 중심의 팀 일정 */
const TAB_TITLE: Record<Exclude<Tab, 'team'>, string> = { me: '내 일정', todo: '할 일', memo: '메모', chat: '대화' }

export function MobileMain() {
  const [tab, setTab] = useState<Tab>('team')
  const { toast, setChatOpen, chatOpen } = useUI()
  const { db, me, chatUnread: teamUnread, chatMentions, dmUnread, solo } = useStore()
  // 팀 대화 + 1:1 대화 안 읽은 수
  const chatUnread = teamUnread + dmUnread
  // 대화 탭을 보고 있으면 '대화창 열림'으로 본다 (호출 팝업을 띄우지 않음)
  useEffect(() => {
    setChatOpen(tab === 'chat')
  }, [tab, setChatOpen])
  // 팀원 메뉴에서 "1:1 대화"를 누르면 대화 탭으로
  useEffect(() => {
    if (chatOpen) setTab('chat')
  }, [chatOpen])
  // 검색 결과를 누르면 그 탭으로
  useEffect(() => {
    const h = (e: Event) => setTab((e as CustomEvent<Tab>).detail)
    window.addEventListener('wk:mtab', h)
    return () => window.removeEventListener('wk:mtab', h)
  }, [])
  const { selected, searchOpen } = useUI()
  const carry = me?.todoCarry !== false
  const left = db.todos.filter((t) => t.ownerId === me?.id && !t.done && (carry ? t.date <= selected : t.date === selected)).length

  return (
    <div className="m-app">
      {/* 팀 탭은 기존 제목(○○팀 주간예정사항), 나머지 탭은 탭 이름 */}
      <Header mobileTitle={tab === 'team' ? (solo ? t('내 주간예정사항') : t('주간예정사항')) : t(TAB_TITLE[tab])} teamMenu={tab === 'team'} />
      <div className="m-body">
        {tab === 'team' && <MobileTeam />}
        {tab === 'me' && <DayAgenda />}
        {tab === 'todo' && <Todos />}
        {tab === 'memo' && <MemoTab />}
        {tab === 'chat' && <ChatPanel />}
      </div>
      {/* 혼자 쓸 때는 대화 탭이 없다 (주간표·내 일정·할 일·메모 4탭) */}
      <nav className={'m-tabs' + (solo ? '' : ' five')} aria-label={t('화면 전환')}>
        {([
          ['team', solo ? '주간표' : '팀 주간표', 'cal'],
          ['me', '내 일정', 'person'],
          ['todo', '할 일', 'list'],
          ['memo', '메모', 'note'],
          ['chat', '대화', 'chat'],
        ] as const).filter(([k]) => !(solo && k === 'chat')).map(([k, label, icon]) => (
          <button key={k} className={'m-tab' + (tab === k ? ' on' : '')} onClick={() => setTab(k)} aria-current={tab === k}>
            <span className="m-tab-ico">
              <Icon name={icon} size={22} />
              {k === 'todo' && left > 0 && <b>{left}</b>}
              {k === 'chat' && chatUnread > 0 && <b className={chatMentions > 0 ? 'at' : ''}>{chatMentions > 0 ? '@' : ''}{chatUnread > 99 ? '99+' : chatUnread}</b>}
            </span>
            {t(label)}
          </button>
        ))}
      </nav>
      {searchOpen && <SearchSheet />}
      <Modals />
      {toast && <Toast />}
      <DayDropStrip />
      <NoticeToasts />
      <TipLayer />
      <Reminders />
    </div>
  )
}

function MobileTeam() {
  const { db, me, myMember, tableMembers, userOf, solo, myTeams, online, absences } = useStore()
  const { selected, setSelected, openModal } = useUI()
  const act = useEventActions()
  const days = weekDays(selected)
  const today = todayStr()
  const day = days.includes(selected) ? selected : days[0]
  // 일정을 끌어 다른 주로 넘기는 중이면 위의 주간 달력이 그 주를 보여 준다 (아래 목록은 그대로)
  const dd = useDayDrag()
  const preview = dd.active && !!dd.week
  const mon = preview ? dd.week! : mondayOf(selected)
  const cardDays = preview ? weekDays(dd.week!) : days
  const a = parse(mon)
  const b = parse(addDays(mon, 4))
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const label = getLang() === 'en'
    ? `${MON[a.getMonth()]} ${a.getDate()} – ${a.getMonth() === b.getMonth() ? '' : MON[b.getMonth()] + ' '}${b.getDate()}`
    : `${a.getMonth() + 1}. ${a.getDate()}.(월) – ${b.getMonth() + 1}. ${b.getDate()}.(금)`

  // 혼자 쓸 때는 내 일정을 모두 보여 준다
  // 회의에 초대됐거나 내가 만든 회의는 "나만 보기"여도 참석자 카드에 보인다
  const shared = solo ? db.events : db.events.filter((e) => e.shared || (!!e.attendees?.length && inRowOf(e, me?.id)))
  const waiting = myTeams.find((x) => x.role === 'pending')
  const myPending: ChangeRequest[] = db.requests.filter(
    (r) => r.status === 'pending' && (r.requesterId === me?.id || r.leaderId === me?.id),
  )
  const eventsOf = (userId: string, d: string): Occurrence[] =>
    occurrencesOn(shared.filter((e) => inRowOf(e, userId)), d)
  // 참석자 카드에서의 응답 표시
  const invClass = (o: Occurrence, rowUser: string) => {
    if (o.ownerId === rowUser) return ''
    const a = inviteOf(o, rowUser)
    return a?.status === 'pending' ? ' inv-wait' : a?.status === 'declined' ? ' inv-no' : ''
  }

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
  // 승인 대기 중인 휴가·출장 (점선)
  const waits = day && !solo ? tableMembers.flatMap((m) => absent.some((x) => x.m.userId === m.userId) ? [] : waitingOn(absences, m.userId, day)) : []

  return (
    <div className="m-team">
      <section className="m-week">
        <div className="m-week-head">
          <strong>{label}</strong>
          <span className="week-pill">{weekPill(isoWeek(mon))}</span>
          <span className="grow" />
          <button className="m-today" onClick={() => setSelected(todayStr())}>{t('오늘')}</button>
        </div>
        {cardDays.length === 0 ? (
          <div className="empty">{t('이번 주는 표시할 평일이 없어요.')}</div>
        ) : (
          <div className="m-week-row">
            <button className={'m-wk-arrow' + (dd.active && dd.over === 'prev' ? ' dd-over' : '')} data-drop-day="prev" onClick={() => setSelected(addDays(selected, -7))} aria-label={t('이전 주')}><Icon name="chevL" size={18} /></button>
            <div className="m-days" role="tablist" aria-label={t('요일')}>
              {cardDays.map((d) => (
                <button
                  key={d}
                  role="tab"
                  aria-selected={d === day}
                  data-drop-day={d}
                  className={'m-day' + (d === day ? ' on' : '') + (d === today ? ' today' : '') + (holidayName(d) ? ' holiday' : '') + (dd.active && dd.over === d ? ' dd-over' : '')}
                  onClick={() => setSelected(d)}
                >
                  <small>{dowLabel(d)}</small>
                  <strong>{parse(d).getDate()}</strong>
                </button>
              ))}
            </div>
            <button className={'m-wk-arrow' + (dd.active && dd.over === 'next' ? ' dd-over' : '')} data-drop-day="next" onClick={() => setSelected(addDays(selected, 7))} aria-label={t('다음 주')}><Icon name="chevR" size={18} /></button>
          </div>
        )}
      </section>

      {days.length > 0 && (
        <>
          <div className="m-scroll">
            {holidayName(day) && <div className="m-holiday">{holidayLabel(day)} · {t('휴일')}</div>}
            {!solo && <section className="m-absent">
              <h3>{t('부재자')}</h3>
              <div className="m-pills">
                {absent.length === 0 && waits.length === 0 && <span className="none">{t('없음')}</span>}
                {absent.map(({ m, o }) => (
                  <AbsencePill key={m.userId} name={userOf(m.userId).name} o={o} />
                ))}
                {waits.map((a) => (
                  <span key={a.id} className="pill abs-pill wait" data-cat={a.kind === 'trip' ? 'trip' : a.kind === 'am' || a.kind === 'pm' ? 'halfday' : 'leave'}>
                    {userOf(a.userId).name}<em>{a.kind === 'trip' ? t('출장') : t(KIND_LABEL[a.kind])} · {t('대기')}</em>
                  </span>
                ))}
              </div>
            </section>}

            {tableMembers.map((m) => {
              const u = userOf(m.userId)
              const mine = m.userId === me?.id
              const evs = eventsOf(m.userId, day)
              // 휴가·반차·출장: 이름 옆 표시 + 쉬는 동안 일정은 흐리게
              const off = solo ? null : dayOff(shared, m.userId, day)
              const wait = solo ? [] : waitingOn(absences, m.userId, day)
              const dim = (o: Occurrence) => !OFF_CATS.includes(o.category) && offHides(off, o)
              const reqs = myPending.filter((r) => r.type === 'add' && r.leaderId === m.userId && (r.payload.endDate && r.payload.endDate > r.payload.date ? r.payload.date <= day && day <= r.payload.endDate : r.payload.date === day))
              type Entry = { start: string; ev?: Occurrence; req?: ChangeRequest }
              const entries: Entry[] = [
                ...evs.map((ev) => ({ start: ev.start, ev })),
                ...reqs.map((req) => ({ start: req.payload.start, req })),
              ].sort((x, y) => x.start.localeCompare(y.start))
              return (
                <section key={m.userId} className={'m-card' + (mine ? ' mine' : '') + (off?.leave ? ' off-leave' : off?.half ? ' off-half' : '') + (off?.trip ? ' off-trip' : '')}>
                  <header>
                    {/* 이름을 누르면 팀원 메뉴 (월간 일정·1:1 대화·메일) */}
                    <button className={'m-who-btn' + (mine ? '' : ' who-btn')} onClick={(e) => {
                      if (mine) return
                      // 이름 오른쪽에 말풍선 메뉴 (꼬리가 이름 가운데를 가리킨다)
                      const r = e.currentTarget.getBoundingClientRect()
                      // 이름·직급 글자가 끝나는 자리 (칸 너비가 아니라 실제 글자 끝)
                      const who = e.currentTarget.querySelector('.m-who')
                      const rg = document.createRange()
                      if (who) rg.selectNodeContents(who)
                      const end = who ? rg.getBoundingClientRect().right : r.right
                      openModal({ type: 'member', userId: m.userId, x: end + 6, y: r.top + r.height / 2 - 30 })
                    }}>
                      <Avatar name={u.name} size={34} online={!solo && online.includes(m.userId)} />
                      <div className="m-who">
                        <strong>
                          {u.name}
                          {m.role === 'leader' && <span className="badge">{t('팀장')}</span>}
                          {mine && !solo && <span className="me-badge">{t('나')}</span>}
                        </strong>
                        {m.role !== 'leader' && !solo && <small>{m.title || t('직급 미지정')}</small>}
                      </div>
                    </button>
                    {(off || wait.length > 0) && (
                      <span className="off-tags m-off">
                        {off?.leave && <span className="off-tag leave">🌴 {leaveName(off.leave)}</span>}
                        {off?.half && <span className="off-tag half">{t(off.half.title)}</span>}
                        {off?.trip && <span className="off-tag trip">✈︎ {t('출장')}{off.trip.place ? ` · ${off.trip.place}` : ''}</span>}
                        {wait.map((a) => <span key={a.id} className="off-tag wait" data-kind={a.kind === 'trip' ? 'trip' : a.kind === 'am' || a.kind === 'pm' ? 'half' : 'leave'}>{a.kind === 'trip' ? t('출장') : t(KIND_LABEL[a.kind])} · {t('대기')}</span>)}
                      </span>
                    )}
                    {clickable(m) && (
                      <button className="m-add" onClick={() => onAdd(m)} aria-label={mine ? t('일정 추가') : t('팀장에게 일정 요청')}>
                        <Icon name="plus" size={14} /> {mine ? t('추가') : t('요청')}
                      </button>
                    )}
                  </header>
                  {entries.length === 0 ? (
                    <p className="m-none">{t('일정 없음')}</p>
                  ) : (
                    <ul>
                      {entries.map((en) =>
                        en.req ? (
                          <li key={en.req.id} className="m-item ghost" data-cat={en.req.payload.category ?? 'meeting'}>
                            {en.req.payload.endDate && en.req.payload.endDate > en.req.payload.date
                              ? <span className="m-time allday-time">{t('종일')}</span>
                              : <span className="m-time">{en.req.payload.start}<small>{en.req.payload.end}</small></span>}
                            <span className="m-main">
                              <b>{en.req.payload.title}</b>
                              {en.req.payload.place && <small>{en.req.payload.place}</small>}
                            </span>
                            <span className="wait-tag">{t('대기')}</span>
                          </li>
                        ) : (
                          <li key={en.ev!.id + en.ev!.date}>
                            {/* 내 일정: 왼쪽으로 밀면 삭제, 길게 눌러 끌면 다른 날로 */}
                            <GestureRow
                              onDelete={mine && en.ev!.ownerId === m.userId ? () => act.removeEvent(en.ev!.baseId) : undefined}
                              drag={mine && en.ev!.ownerId === m.userId ? { label: en.ev!.title, onDrop: (to) => act.moveEvent(en.ev!.baseId, day, to) } : undefined}
                            >
                            <button className={'m-item' + invClass(en.ev!, m.userId) + (dim(en.ev!) ? ' off-dim' : '')} data-cat={en.ev!.category} data-base={en.ev!.baseId} onClick={() => openModal({ type: 'detail', occ: en.ev! })}>
                              {isMultiDay(en.ev!)
                                ? <span className="m-time allday-time">{t('종일')}</span>
                                : <span className="m-time">{en.ev!.start}<small>{en.ev!.end}</small></span>}
                              <span className="m-main">
                                <b>{en.ev!.title}</b>
                                {isMultiDay(en.ev!)
                                  ? <small>{spanLabel(en.ev!)}{en.ev!.place ? ` · ${en.ev!.place}` : ''}</small>
                                  : en.ev!.place && <small>{en.ev!.place}</small>}
                              </span>
                              {invClass(en.ev!, m.userId) === ' inv-wait'
                                ? <span className="wait-tag inv">{t('응답 대기')}</span>
                                : <span className="cat-tag" data-cat={en.ev!.category}>{t(CATEGORY_LABEL[en.ev!.category])}</span>}
                            </button>
                            </GestureRow>
                          </li>
                        ),
                      )}
                    </ul>
                  )}
                </section>
              )
            })}
            {/* 혼자 쓰는 중: 팀과 함께 쓰기 (승인 대기 중이면 그 팀 이름) */}
            {solo && (
              <button className="m-teamup" onClick={() => openModal({ type: 'teamup' })}>
                <span className="ico"><Icon name={waiting ? 'clock' : 'userPlus'} size={20} /></span>
                <span>
                  <b>{waiting ? t('{team} 승인 대기 중', { team: waiting.name }) : t('팀과 함께 쓰기')}</b>
                  <small>{waiting ? t('승인되면 팀 화면으로 바뀌어요') : t('팀을 만들거나 초대 코드로 참여해요')}</small>
                </span>
                <Icon name="chevR" size={16} />
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
