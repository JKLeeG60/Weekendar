import { Fragment } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { isMultiDay, occurrencesOn, spanLabel } from '../lib/events'
import { fmtHead, holidayName, todayStr, weekDays } from '../lib/date'
import { CATEGORY_LABEL, isAbsence, type ChangeRequest, type EventItem, type Member, type Occurrence } from '../lib/types'
import { Avatar } from './ui'

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
  const { db, me, myMember, tableMembers, userOf } = useStore()
  const { selected, openModal } = useUI()
  const days = weekDays(selected)
  const today = todayStr()
  const shared = db.events.filter((e) => e.shared)

  // 요청 대기 표시: 요청자 본인과 팀장에게만 보인다
  const myPending: ChangeRequest[] = db.requests.filter(
    (r) => r.status === 'pending' && (r.requesterId === me?.id || r.leaderId === me?.id),
  )
  const markOf = (o: Occurrence): ChangeRequest | undefined =>
    myPending.find((r) => r.type !== 'add' && r.eventId === o.baseId)

  const eventsOf = (userId: string, day: string): Occurrence[] =>
    occurrencesOn(shared.filter((e) => e.ownerId === userId), day)
  // 칸 안에 넣을 일정 (여러 날 일정은 막대로 따로 그림)
  const dayEventsOf = (userId: string, day: string): Occurrence[] => eventsOf(userId, day).filter((o) => !isMultiDay(o))

  function onCell(m: Member, day: string) {
    if (m.userId === me?.id) openModal({ type: 'event', date: day })
    else if (m.role === 'leader' && myMember?.role === 'member') openModal({ type: 'request', mode: 'add', date: day })
  }
  const clickable = (m: Member) =>
    m.userId === me?.id || (m.role === 'leader' && myMember?.role === 'member')

  if (days.length === 0) {
    return <div className="empty-week">이번 주는 표시할 평일이 없어요. (공휴일 제외)</div>
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
            <th className="corner">구성원</th>
            {days.map((d) => (
              <th key={d} className={'day' + (d === today ? ' today' : '') + (holidayName(d) ? ' holiday' : '')}>
                <span>{fmtHead(d)}</span>
                {holidayName(d) && <small className="hol-name">{holidayName(d)}</small>}
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
              <tr key={m.userId} className={mine ? 'mine' : ''} style={{ height: `${100 / tableMembers.length}%`, ['--lanes' as string]: lanes }}>
                <th className="who" scope="row">
                  <div className="who-wrap">
                    <Avatar name={u.name} size={32} />
                    <div>
                      <div className="who-name">
                        {u.name}
                        {m.role === 'leader' && <span className="badge">팀장</span>}
                      </div>
                      <div className="who-title">{m.role === 'leader' ? '' : m.title || '직급 미지정'}</div>
                    </div>
                  </div>
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
                      className={'cell' + (clickable(m) ? ' clickable' : '') + (d === today ? ' today' : '') + (holidayName(d) ? ' holiday' : '')}
                      onClick={() => {
                        onCell(m, d)
                      }}
                      title={clickable(m) ? (mine ? '클릭해서 내 일정 추가' : '클릭해서 팀장에게 일정 요청') : undefined}
                    >
                      {spans.filter((s) => s.from === di).map((s) => {
                        const n = s.to - s.from + 1
                        const o: Occurrence = { ...s.e, baseId: s.e.id }
                        return (
                          <button
                            key={s.e.id}
                            className={'span-bar' + (s.cutL ? ' cut-l' : '') + (s.cutR ? ' cut-r' : '')}
                            data-cat={s.e.category}
                            style={{ top: `calc(0.35rem + ${s.lane} * var(--bar-step))`, width: `calc(${n} * 100% + ${n - 1}px - ${0.7 - (s.cutL ? 0.35 : 0) - (s.cutR ? 0.35 : 0)}rem)` }}
                            title={`${spanLabel(s.e)} ${s.e.title}${s.e.place ? ' · ' + s.e.place : ''}`}
                            onClick={(ev) => { ev.stopPropagation(); openModal({ type: 'detail', occ: o }) }}
                          >
                            <span className="span-tag">{CATEGORY_LABEL[s.e.category]}</span>
                            <span className="span-title">{s.e.title}</span>
                            <span className="span-range">{spanLabel(s.e)}</span>
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
                                data-cat="meeting"
                                title={`팀장 동의 대기 중 · ${r.payload.start}–${r.payload.end} ${r.payload.title}`}
                                onClick={(ev) => ev.stopPropagation()}
                              >
                                <span className="chip-time">{r.payload.endDate && r.payload.endDate > r.payload.date ? '종일' : r.payload.start}</span>
                                <span className="chip-title">{r.payload.title}</span>
                                <span className="wait-tag">대기</span>
                                {roomy && r.payload.place && <span className="chip-place">{r.payload.place}</span>}
                              </div>
                            )
                          }
                          const o = en.ev!
                          const mk = markOf(o)
                          return (
                            <button
                              key={o.id + o.date}
                              className={'chip' + (roomy ? ' roomy' : '') + (mk ? ' marked' : '')}
                              data-cat={o.category}
                              title={`${o.start}–${o.end} ${o.title}${o.place ? ' · ' + o.place : ''}`}
                              onClick={(ev) => {
                                ev.stopPropagation()
                                openModal({ type: 'detail', occ: o })
                              }}
                            >
                              <span className="chip-time">{o.start}</span>
                              <span className="chip-title">{o.title}</span>
                              {mk && <span className="wait-tag">{mk.type === 'edit' ? '수정 요청' : '삭제 요청'}</span>}
                              {roomy && o.place && <span className="chip-place">{o.place}</span>}
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
                            +{rest}개 더보기
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
        <tfoot>
          <tr>
            <th className="who absent-label" scope="row">부재자</th>
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
                      <Fragment key={m.userId}>
                        <span className="pill" data-cat={o.category}>
                          {userOf(m.userId).name}
                          <em>{CATEGORY_LABEL[o.category]}</em>
                        </span>
                      </Fragment>
                    ))}
                  </div>
                </td>
              )
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
