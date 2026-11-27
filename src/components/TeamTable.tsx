import React, { useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { isMultiDay, occurrencesOn, spanLabel } from '../lib/events'
import { fmtHead, holidayLabel, holidayName, todayStr, weekDays } from '../lib/date'
import { t } from '../lib/i18n'
import { useEventActions } from './DayDrop'
import { CATEGORY_LABEL, isAbsence, type ChangeRequest, type EventItem, type Member, type Occurrence } from '../lib/types'
import { Avatar, Icon } from './ui'
import { inRowOf, inviteOf } from '../lib/attend'
import { AbsencePill } from './AbsencePill'
import { changedActive, confirmStatus, needsMyConfirm } from '../lib/confirm'

const MAX_CHIPS = 5

/** 여러 날 일정 막대: 이번 주 표에서 어느 칸부터 몇 칸을 차지하는지, 몇 번째 줄(lane)인지 */
type Span = { e: EventItem; from: number; to: number; lane: number; cutL: boolean; cutR: boolean }
function spansOf(events: EventItem[], days: string[]): { spans: Span[]; lanes: number } {
  const first = days[0], last = days[days.length - 1]
  const raw = events
    .filter((e) => isMultiDay(e) && e.date <= last && e.endDate! >= first)
    .map((e) => {
      const from = days.findIndex((d) => d >= e.date)
      let to = -1
      days.forEach((d, i) => { if (d <= e.endDate!) to = i })
      return { e, from, to, cutL: e.date < days[from], cutR: e.endDate! > days[to] }
    })
    .filter((s) => s.from >= 0 && s.to >= s.from)
    .sort((a, b) => a.from - b.from || b.to - a.to)
  const laneEnd: number[] = [] // 줄마다 마지막으로 차지한 칸
  const spans = raw.map((s) => {
    let lane = laneEnd.findIndex((end) => end < s.from)
    if (lane < 0) { lane = laneEnd.length; laneEnd.push(s.to) } else laneEnd[lane] = s.to
    return { ...s, lane }
  })
  return { spans, lanes: laneEnd.length }
}

export function TeamTable() {
  const { db, me, myMember, tableMembers, userOf, solo, online } = useStore()
  const { selected, openModal } = useUI()
  const days = weekDays(selected)
  const act = useEventActions()
  // 내 일정 끌어서 다른 요일로: 끌고 있는 일정과 놓을 칸
  const dragging = useRef<{ baseId: string; from: string } | null>(null)
  const [overDay, setOverDay] = useState<string | null>(null)
  const dragProps = (o: Occurrence, from: string | ((e: React.DragEvent) => string)) =>
    o.ownerId === me?.id
      ? {
          draggable: true,
          onDragStart: (e: React.DragEvent) => {
            dragging.current = { baseId: o.baseId, from: typeof from === 'function' ? from(e) : from }
            e.dataTransfer.setData('text/weekendar-event', o.baseId)
            e.dataTransfer.effectAllowed = 'move'
          },
          onDragEnd: () => { dragging.current = null; setOverDay(null) },
        }
      : {}
  const dropProps = (m: Member, d: string) =>
    m.userId === me?.id
      ? {
          onDragOver: (e: React.DragEvent) => {
            if (!dragging.current) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            if (overDay !== d) setOverDay(d)
          },
          onDragLeave: (e: React.DragEvent) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOverDay(null) },
          onDrop: (e: React.DragEvent) => {
            const g = dragging.current
            if (!g) return
            e.preventDefault()
            dragging.current = null
            setOverDay(null)
            act.moveEvent(g.baseId, g.from, d)
          },
        }
      : {}
  const today = todayStr()
  // 혼자 쓸 때는 내 일정을 모두 보여 준다 (팀에 공유할 사람이 없음)
  // 회의에 초대됐거나 내가 만든 회의는 "나만 보기"여도 참석자 줄에 보인다
  const shared = solo ? db.events : db.events.filter((e) => e.shared || (!!e.attendees?.length && inRowOf(e, me?.id)))
  // 참석자 명단 (마우스를 올리면 보이는 설명)
  const attTip = (o: Occurrence) => [
    `${userOf(o.ownerId).name} · ${t('주최')}`,
    ...(o.attendees ?? []).map((a) => `${userOf(a.userId).name} · ${a.status === 'accepted' ? t('참석') : a.status === 'declined' ? t('불참') : t('응답 대기')}`),
  ].join('\n')
  // 참석자 줄에서의 응답 표시
  const invClass = (o: Occurrence, rowUser: string) => {
    if (o.ownerId === rowUser) return ''
    const a = inviteOf(o, rowUser)
    return a?.status === 'pending' ? ' inv-wait' : a?.status === 'declined' ? ' inv-no' : ''
  }

  // 요청 대기 표시: 요청자 본인과 팀장에게만 보인다
  const myPending: ChangeRequest[] = db.requests.filter(
    (r) => r.status === 'pending' && (r.requesterId === me?.id || r.leaderId === me?.id),
  )
  const markOf = (o: Occurrence): ChangeRequest | undefined =>
    myPending.find((r) => r.type !== 'add' && r.eventId === o.baseId)

  // 팀장이 바꾼 일정 표시: 팀원에게는 "확인 필요/변경", 팀장 본인에게는 "✅ 확인한 수/전체"
  const changeInfo = (baseId: string, day: string) => {
    const e = db.events.find((x) => x.id === baseId)
    if (!e || !changedActive(e, day, today)) return null
    const need = needsMyConfirm(db, e, me?.id, day, today)
    const st = e.ownerId === me?.id ? confirmStatus(db, e) : null
    return { need, st }
  }
  const changeTag = (ci: ReturnType<typeof changeInfo>) =>
    !ci ? null : ci.need ? <span className="wait-tag">{t('확인 필요')}</span>
      : ci.st && ci.st.all.length > 0 ? <span className={'chg-tag' + (ci.st.waiting.length === 0 ? ' all' : '')} title={t('확인 {a} / {b}명', { a: ci.st.done.length, b: ci.st.all.length })}>✅ {ci.st.done.length}/{ci.st.all.length}</span>
      : <span className="chg-tag">{t('변경')}</span>

  const eventsOf = (userId: string, day: string): Occurrence[] =>
    occurrencesOn(shared.filter((e) => inRowOf(e, userId)), day)
  // 칸 안에 넣을 일정 (여러 날 일정은 막대로 따로 그림)
  const dayEventsOf = (userId: string, day: string): Occurrence[] => eventsOf(userId, day).filter((o) => !isMultiDay(o))

  function onCell(m: Member, day: string) {
    if (m.userId === me?.id) openModal({ type: 'event', date: day })
    else if (m.role === 'leader' && myMember?.role === 'member') openModal({ type: 'request', mode: 'add', date: day })
  }
  const clickable = (m: Member) =>
    m.userId === me?.id || (m.role === 'leader' && myMember?.role === 'member')

  if (days.length === 0) {
    return <div className="empty-week">{t('이번 주는 표시할 평일이 없어요. (공휴일 제외)')}</div>
  }

  return (
    <div className="table-wrap">
      <table className="team-table">
        <colgroup>
          <col style={{ width: '11rem' }} />
          {days.map((d) => <col key={d} />)}
        </colgroup>
        <thead>
          <tr>
            <th className="corner">{solo ? '' : t('구성원')}</th>
            {days.map((d) => (
              <th key={d} className={'day' + (d === today ? ' today' : '') + (holidayName(d) ? ' holiday' : '')}>
                <span>{fmtHead(d)}</span>
                {holidayName(d) && <small className="hol-name">{holidayLabel(d)}</small>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableMembers.map((m) => {
            const u = userOf(m.userId)
            const mine = m.userId === me?.id
            const { spans, lanes } = spansOf(shared.filter((e) => e.ownerId === m.userId), days)
            return (
              <tr key={m.userId} className={mine && !solo ? 'mine' : ''} style={{ height: `${100 / tableMembers.length}%`, ['--lanes' as string]: lanes }}>
                <th className="who" scope="row">
                  {/* 이름을 누르면 팀원 메뉴 (월간 일정·1:1 대화·메일) */}
                  <button
                    className={'who-wrap' + (mine ? '' : ' who-btn')}
                    onClick={(e) => { if (!mine) openModal({ type: 'member', userId: m.userId, x: e.clientX, y: e.clientY }) }}
                    title={mine ? undefined : t('{name}님 메뉴', { name: u.name })}
                    style={mine ? { cursor: 'default' } : undefined}
                  >
                    <Avatar name={u.name} size={32} online={!solo && online.includes(m.userId)} />
                    <div>
                      <div className="who-name">
                        {u.name}
                        {m.role === 'leader' && <span className="badge">{t('팀장')}</span>}
                      </div>
                      <div className="who-title">{solo ? t('나') : m.role === 'leader' ? '' : m.title || t('직급 미지정')}</div>
                    </div>
                  </button>
                </th>
                {days.map((d, di) => {
                  const evs = dayEventsOf(m.userId, d)
                  const reqs = myPending.filter((r) => r.type === 'add' && r.leaderId === m.userId && (r.payload.endDate && r.payload.endDate > r.payload.date ? r.payload.date <= d && d <= r.payload.endDate : r.payload.date === d))
                  type Entry = { start: string; ev?: Occurrence; req?: ChangeRequest }
                  const entries: Entry[] = [
                    ...evs.map((ev) => ({ start: ev.start, ev })),
                    ...reqs.map((req) => ({ start: req.payload.start, req })),
                  ].sort((a, b) => a.start.localeCompare(b.start))
                  const shown = entries.slice(0, MAX_CHIPS)
                  const rest = entries.length - shown.length
                  const roomy = entries.length <= 2
                  return (
                    <td
                      key={d}
                      {...dropProps(m, d)}
                      data-drop-label={mine && overDay === d ? t('{date}로 옮기기', { date: fmtHead(d) }) : undefined}
                      className={'cell' + (clickable(m) ? ' clickable' : '') + (d === today ? ' today' : '') + (holidayName(d) ? ' holiday' : '') + (mine && overDay === d ? ' drop-on' : '')}
                      onClick={() => {
                        onCell(m, d)
                      }}
                      title={clickable(m) ? (mine ? t('클릭해서 내 일정 추가') : t('클릭해서 팀장에게 일정 요청')) : undefined}
                    >
                      {spans.filter((s) => s.from === di).map((s) => {
                        const n = s.to - s.from + 1
                        const o: Occurrence = { ...s.e, baseId: s.e.id }
                        const ci = changeInfo(s.e.id, days[s.from])
                        return (
                          <button
                            key={s.e.id}
                            {...dragProps(o, (e) => {
                              // 막대의 어느 날을 잡았는지
                              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                              return days[di + Math.min(n - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * n)))]
                            })}
                            className={'span-bar' + (s.cutL ? ' cut-l' : '') + (s.cutR ? ' cut-r' : '') + (ci?.need ? ' need-confirm' : '')}
                            data-cat={s.e.category}
                            style={{ top: `calc(0.35rem + ${s.lane} * var(--bar-step))`, width: `calc(${n} * 100% + ${n - 1}px - ${0.7 - (s.cutL ? 0.35 : 0) - (s.cutR ? 0.35 : 0)}rem)` }}
                            title={`${spanLabel(s.e)} ${s.e.title}${s.e.place ? ' · ' + s.e.place : ''}`}
                            onClick={(ev) => { ev.stopPropagation(); openModal({ type: 'detail', occ: o }) }}
                          >
                            <span className="span-tag">{t(CATEGORY_LABEL[s.e.category])}</span>
                            <span className="span-title">{s.e.title}</span>
                            <span className="span-range">{spanLabel(s.e)}</span>
                            {changeTag(ci)}
                          </button>
                        )
                      })}
                      <div className="cell-inner">
                        {shown.map((en) => {
                          if (en.req) {
                            const r = en.req
                            return (
                              <div
                                key={r.id}
                                className={'chip ghost' + (roomy ? ' roomy' : '')}
                                data-cat={r.payload.category ?? 'meeting'}
                                title={`${t('팀장 동의 대기 중')} · ${r.payload.start}–${r.payload.end} ${r.payload.title}`}
                                onClick={(ev) => ev.stopPropagation()}
                              >
                                <span className="chip-time">{r.payload.endDate && r.payload.endDate > r.payload.date ? t('종일') : r.payload.start}</span>
                                <span className="chip-title">{r.payload.title}</span>
                                <span className="wait-tag">{t('대기')}</span>
                                {roomy && r.payload.place && <span className="chip-place">{r.payload.place}</span>}
                              </div>
                            )
                          }
                          const o = en.ev!
                          const mk = markOf(o)
                          const ci = changeInfo(o.baseId, d)
                          return (
                            <button
                              key={o.id + o.date}
                              {...(o.ownerId === m.userId ? dragProps(o, d) : {})}
                              className={'chip' + (roomy ? ' roomy' : '') + (mk ? ' marked' : '') + (ci?.need ? ' need-confirm' : '') + invClass(o, m.userId)}
                              data-cat={o.category}
                              data-base={o.baseId}
                              data-date={d}
                              title={`${o.start}–${o.end} ${o.title}${o.place ? ' · ' + o.place : ''}`}
                              onClick={(ev) => {
                                ev.stopPropagation()
                                openModal({ type: 'detail', occ: o })
                              }}
                            >
                              <span className="chip-time">{o.start}</span>
                              <span className="chip-title">{o.title}</span>
                              {mk && <span className="wait-tag">{mk.type === 'edit' ? t('수정 요청') : t('삭제 요청')}</span>}
                              {changeTag(ci)}
                              {invClass(o, m.userId) === ' inv-wait' && <span className="wait-tag inv">{t('응답 대기')}</span>}
                              {roomy && (o.place || !!o.attendees?.length) && (
                                <span className="chip-place">
                                  {o.place}
                                  {!!o.attendees?.length && <span className="chip-att" data-tip={attTip(o)}><Icon name="users" size={11} />{t('{n}명', { n: o.attendees.filter((a) => a.status !== 'declined').length + 1 })}</span>}
                                </span>
                              )}
                            </button>
                          )
                        })}
                        {rest > 0 && (
                          <button
                            className="more"
                            onClick={(ev) => {
                              ev.stopPropagation()
                              openModal({ type: 'day', userId: m.userId, date: d })
                            }}
                          >
                            {t('+{n}개 더보기', { n: rest })}
                          </button>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
        {!solo && <tfoot>
          <tr>
            <th className="who absent-label" scope="row">{t('부재자')}</th>
            {days.map((d) => {
              const absent = tableMembers.flatMap((m) => {
                const o = eventsOf(m.userId, d).find((x) => isAbsence(x.category))
                return o ? [{ m, o }] : []
              })
              return (
                <td key={d} className={'cell absent' + (d === today ? ' today' : '') + (holidayName(d) ? ' holiday' : '')}>
                  <div className="cell-inner row">
                    {absent.length === 0 && <span className="none">–</span>}
                    {absent.map(({ m, o }) => (
                      <AbsencePill key={m.userId} name={userOf(m.userId).name} o={o} />
                    ))}
                  </div>
                </td>
              )
            })}
          </tr>
        </tfoot>}
      </table>
    </div>
  )
}
