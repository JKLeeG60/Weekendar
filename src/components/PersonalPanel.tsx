import { useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { occurrencesOn } from '../lib/events'
import { addDays, fmtHead, todayStr } from '../lib/date'
import type { Occurrence } from '../lib/types'
import { MiniCalendar } from './MiniCalendar'
import { Icon } from './ui'

export function DayAgenda() {
  const { db, me } = useStore()
  const { selected, setSelected, openModal } = useUI()
  const [cal, setCal] = useState(false)
  const mine = occurrencesOn(db.events.filter((e) => e.ownerId === me?.id), selected)
  const isToday = selected === todayStr()

  return (
      <section className="panel-half">
        <div className="panel-head">
          <div className="datenav">
            <button className="icon-btn" onClick={() => setSelected(addDays(selected, -1))} aria-label="전날"><Icon name="chevL" /></button>
            <div className="datebtn-wrap">
              <button className="datebtn" onClick={() => setCal((v) => !v)} aria-haspopup="dialog" aria-expanded={cal}>
                {fmtHead(selected)}
                {isToday && <span className="today-tag">오늘</span>}
              </button>
              {cal && (
                <MiniCalendar
                  selected={selected}
                  onPick={(d) => { setSelected(d); setCal(false) }}
                  onClose={() => setCal(false)}
                />
              )}
            </div>
            <button className="icon-btn" onClick={() => setSelected(addDays(selected, 1))} aria-label="다음날"><Icon name="chevR" /></button>
          </div>
          <button className="icon-btn accent" onClick={() => openModal({ type: 'event', date: selected })} aria-label="일정 추가" title="일정 추가 (N)">
            <Icon name="plus" />
          </button>
        </div>
        <Timeline
          occs={mine}
          date={selected}
          onAdd={(t) => openModal({ type: 'event', date: selected, start: t })}
          onOpen={(o) => openModal({ type: 'detail', occ: o })}
        />
      </section>
  )
}

export function PersonalPanel() {
  return (
    <aside className="panel">
      <DayAgenda />
      <Todos />
    </aside>
  )
}

export function Todos() {
  const { db, me, addTodo, toggleTodo, togglePriority, removeTodo } = useStore()
  const { selected } = useUI()
  const [text, setText] = useState('')

  const list = db.todos
    .filter((t) => t.ownerId === me?.id && (t.date === selected || (t.date < selected && !t.done)))
    .sort((a, b) => Number(a.done) - Number(b.done) || Number(b.priority) - Number(a.priority))
  const left = list.filter((t) => !t.done).length

  return (
    <section className="panel-half todo">
      <div className="panel-head">
        <h3 className="section-label big">할 일</h3>
        <span className="count">{left}개 남음</span>
      </div>
      <div className="panel-scroll">
        <form
          className="todo-add"
          onSubmit={(e) => {
            e.preventDefault()
            if (!text.trim()) return
            addTodo(text.trim(), selected)
            setText('')
          }}
        >
          <Icon name="plus" size={16} />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="새로운 할 일" aria-label="새로운 할 일" />
        </form>
        {list.length === 0 && <div className="empty">할 일이 없어요. 여유로운 하루네요.</div>}
        <ul className="todos">
          {list.map((t) => (
            <li key={t.id} className={'todo-item' + (t.done ? ' done' : '')}>
              <button className="check" role="checkbox" aria-checked={t.done} onClick={() => toggleTodo(t.id)} aria-label={t.text}>
                {t.done && <Icon name="check" size={13} />}
              </button>
              <span className="todo-text">{t.text}</span>
              {t.date < selected && !t.done && <span className="carry">이월</span>}
              <button className={'icon-btn tiny flag' + (t.priority ? ' on' : '')} onClick={() => togglePriority(t.id)} aria-label="중요 표시">
                <Icon name="flag" size={14} />
              </button>
              <button className="icon-btn tiny del" onClick={() => removeTodo(t.id)} aria-label="삭제">
                <Icon name="x" size={14} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ───────── 애플 캘린더식 하루 타임라인 ───────── */
const HOUR_H = 3.6 // rem
const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** 겹치는 일정을 나란히 배치하기 위한 열 계산 */
function layout(occs: Occurrence[]) {
  const items = occs.map((o) => ({ o, s: mins(o.start), e: Math.max(mins(o.end), mins(o.start) + 20), col: 0, cols: 1 }))
  let group: typeof items = []
  let groupEnd = -1
  const flush = () => {
    const n = Math.max(1, ...group.map((g) => g.col + 1))
    group.forEach((g) => (g.cols = n))
    group = []
  }
  for (const it of items) {
    if (group.length && it.s >= groupEnd) { flush(); groupEnd = -1 }
    const used = new Set(group.filter((g) => g.e > it.s).map((g) => g.col))
    let c = 0
    while (used.has(c)) c++
    it.col = c
    group.push(it)
    groupEnd = Math.max(groupEnd, it.e)
  }
  flush()
  return items
}

function Timeline({ occs, date, onAdd, onOpen }: { occs: Occurrence[]; date: string; onAdd: (t: string) => void; onOpen: (o: Occurrence) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const items = layout(occs)
  const first = Math.min(8, ...items.map((i) => Math.floor(i.s / 60)))
  const last = Math.max(19, ...items.map((i) => Math.ceil(i.e / 60)))
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i)
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const showNow = date === todayStr() && nowMin >= first * 60 && nowMin <= last * 60
  const topOf = (m: number) => ((m - first * 60) / 60) * HOUR_H

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const target = items.length ? Math.min(...items.map((i) => i.s)) - 40 : 8 * 60
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
    el.scrollTop = Math.max(0, topOf(target) * rem)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, occs.length])

  return (
    <div className="panel-scroll timeline-scroll" ref={ref}>
      <div
        className="timeline"
        style={{ height: `${(last - first + 1) * HOUR_H}rem` }}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const y = e.clientY - r.top
          const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
          const m = (y / rem / HOUR_H) * 60 + first * 60
          onAdd(hhmm(Math.min(23 * 60, Math.max(0, Math.floor(m / 30) * 30))))
        }}
      >
        {hours.map((h) => (
          <div key={h} className="hour" style={{ top: `${(h - first) * HOUR_H}rem`, height: `${HOUR_H}rem` }}>
            <span className="hour-label">{String(h).padStart(2, '0')}:00</span>
          </div>
        ))}
        {showNow && (
          <div className="now-line" style={{ top: `${topOf(nowMin)}rem` }}>
            <span>{hhmm(nowMin)}</span>
          </div>
        )}
        {items.map(({ o, s, e, col, cols }) => {
          const h = Math.max(((e - s) / 60) * HOUR_H, 1.5)
          const compact = h < 2.6
          return (
            <button
              key={o.id}
              className={'tl-event' + (o.shared ? ' shared' : '') + (compact ? ' compact' : '')}
              data-cat={o.category}
              style={{
                top: `${topOf(s)}rem`,
                height: `${h}rem`,
                left: `calc(3.6rem + (100% - 3.8rem) * ${col / cols})`,
                width: `calc((100% - 3.8rem) / ${cols} - 0.2rem)`,
              }}
              onClick={(ev) => { ev.stopPropagation(); onOpen(o) }}
              title={`${o.start}–${o.end} ${o.title}`}
            >
              <span className="tl-title">
                {o.title}
                {o.shared && <Icon name="users" size={13} />}
              </span>
              <span className="tl-sub">
                {o.start}–{o.end}{o.place ? ` · ${o.place}` : ''}{o.repeat !== 'none' ? ' · 반복' : ''}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
