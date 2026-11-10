import React, { useEffect, useRef, useState } from 'react'
import { popup } from '../lib/bus'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { occurrencesOn } from '../lib/events'
import { addDays, fmtHead, todayStr } from '../lib/date'
import type { Occurrence } from '../lib/types'
import { MiniCalendar } from './MiniCalendar'
import { Icon } from './ui'

export function DayAgenda() {
  const { db, me, updateEvent, addEvent } = useStore()
  const { selected, setSelected, openModal, showToast } = useUI()
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
          onChange={(o, start, end) => {
            updateEvent(o.baseId, { start, end })
            showToast(`${start}–${end}로 옮겼어요${o.repeat !== 'none' ? ' (반복 일정 전체)' : ''}`)
          }}
          onDropTodo={(todoId, start, end) => {
            const t = db.todos.find((x) => x.id === todoId)
            if (!t) return
            // 할 일은 비공개라, 할 일에서 만든 일정도 기본은 '나만 보기'
            addEvent({ title: t.text, date: selected, start, end, place: '', category: 'work', repeat: 'none', shared: false })
            popup({ id: 'tb_' + Date.now(), title: '할 일을 일정으로 잡았어요', text: `${start}–${end} ${t.text} · 나만 보기`, tag: '일정 추가', icon: 'cal' })
          }}
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
  const { selected, openModal, isMobile } = useUI()
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
            <li
              key={t.id}
              className={'todo-item' + (t.done ? ' done' : '')}
              draggable={!t.done && !isMobile}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/weekendar-todo', t.id)
                e.dataTransfer.effectAllowed = 'copy'
              }}
              title={!t.done && !isMobile ? '위 타임라인으로 끌어다 놓으면 일정이 돼요' : undefined}
            >
              <button className="check" role="checkbox" aria-checked={t.done} onClick={() => toggleTodo(t.id)} aria-label={t.text}>
                {t.done && <Icon name="check" size={13} />}
              </button>
              <span className="todo-text">{t.text}</span>
              {t.date < selected && !t.done && <span className="carry">이월</span>}
              {!t.done && (
                <button
                  className="icon-btn tiny to-event"
                  onClick={() => openModal({ type: 'event', date: selected, title: t.text, shared: false })}
                  aria-label="일정으로 잡기"
                  title="일정으로 잡기"
                >
                  <Icon name="cal" size={14} />
                </button>
              )}
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

type Drag = { id: string; mode: 'move' | 'resize'; y0: number; s0: number; e0: number; s: number; e: number; active: boolean }
const SNAP = 15

function Timeline({ occs, date, onAdd, onOpen, onChange, onDropTodo }: {
  occs: Occurrence[]; date: string
  onAdd: (t: string) => void
  onOpen: (o: Occurrence) => void
  onChange: (o: Occurrence, start: string, end: string) => void
  onDropTodo: (todoId: string, start: string, end: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const tlRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  dragRef.current = drag
  const suppressClick = useRef(false)
  const holdTimer = useRef<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)

  const items = layout(occs)
  const first = Math.min(8, ...items.map((i) => Math.floor(i.s / 60)))
  const last = Math.max(19, ...items.map((i) => Math.ceil(i.e / 60)))
  const hours = Array.from({ length: last - first + 1 }, (_, i) => first + i)
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const showNow = date === todayStr() && nowMin >= first * 60 && nowMin <= last * 60
  const topOf = (m: number) => ((m - first * 60) / 60) * HOUR_H
  const remPx = () => parseFloat(getComputedStyle(document.documentElement).fontSize)
  const pxToMin = (px: number) => (px / remPx() / HOUR_H) * 60
  const minAt = (clientY: number) => {
    const r = tlRef.current!.getBoundingClientRect()
    return pxToMin(clientY - r.top) + first * 60
  }
  const snap = (m: number) => Math.round(m / SNAP) * SNAP

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const target = items.length ? Math.min(...items.map((i) => i.s)) - 40 : 8 * 60
    el.scrollTop = Math.max(0, topOf(target) * remPx())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, occs.length])

  // 터치로 끄는 중에는 화면 스크롤을 막는다
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const h = (e: TouchEvent) => { if (dragRef.current?.active) e.preventDefault() }
    el.addEventListener('touchmove', h, { passive: false })
    return () => el.removeEventListener('touchmove', h)
  }, [])

  function begin(e: React.PointerEvent, o: Occurrence, s: number, eMin: number, mode: Drag['mode']) {
    if (e.button !== 0) return
    e.stopPropagation()
    const d: Drag = { id: o.id, mode, y0: e.clientY, s0: s, e0: eMin, s, e: eMin, active: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    if (e.pointerType === 'touch') {
      // 터치는 길게 눌러야 끌기 시작 (그냥 쓸면 스크롤)
      holdTimer.current = window.setTimeout(() => {
        setDrag({ ...d, active: true })
        navigator.vibrate?.(10)
      }, 350)
      setDrag(d)
    } else {
      setDrag(d)
    }
  }
  function move(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    const dy = e.clientY - d.y0
    if (!d.active) {
      if (e.pointerType === 'touch') {
        if (Math.abs(dy) > 8) { cancelHold(); setDrag(null) } // 스크롤하려는 것
        return
      }
      if (Math.abs(dy) < 4) return
    }
    const dm = snap(pxToMin(dy))
    if (d.mode === 'move') {
      const len = d.e0 - d.s0
      const s = Math.min(Math.max(0, d.s0 + dm), 24 * 60 - len)
      setDrag({ ...d, active: true, s, e: s + len })
    } else {
      const e2 = Math.min(Math.max(d.s0 + SNAP, d.e0 + dm), 24 * 60)
      setDrag({ ...d, active: true, e: e2 })
    }
  }
  function cancelHold() {
    if (holdTimer.current) window.clearTimeout(holdTimer.current)
    holdTimer.current = null
  }
  function end(o: Occurrence) {
    cancelHold()
    const d = dragRef.current
    setDrag(null)
    if (!d) return
    if (d.active) {
      suppressClick.current = true
      setTimeout(() => (suppressClick.current = false), 0)
      if (d.s !== d.s0 || d.e !== d.e0) onChange(o, hhmm(d.s), hhmm(Math.min(d.e, 23 * 60 + 59)))
    }
  }

  return (
    <div className="panel-scroll timeline-scroll" ref={ref}>
      <div
        ref={tlRef}
        className={'timeline' + (drag?.active ? ' dragging' : '') + (dropAt !== null ? ' dropping' : '')}
        style={{ height: `${(last - first + 1) * HOUR_H}rem` }}
        onClick={(e) => {
          if (suppressClick.current) return
          const m = minAt(e.clientY)
          onAdd(hhmm(Math.min(23 * 60, Math.max(0, Math.floor(m / 30) * 30))))
        }}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes('text/weekendar-todo')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setDropAt(Math.min(23 * 60, Math.max(0, snap(minAt(e.clientY) - 15))))
        }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDropAt(null) }}
        onDrop={(e) => {
          const id = e.dataTransfer.getData('text/weekendar-todo')
          if (!id) return
          e.preventDefault()
          const s = dropAt ?? snap(minAt(e.clientY))
          setDropAt(null)
          onDropTodo(id, hhmm(s), hhmm(Math.min(s + 60, 23 * 60 + 59)))
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
        {dropAt !== null && (
          <div className="drop-ghost" style={{ top: `${topOf(dropAt)}rem`, height: `${HOUR_H}rem` }}>
            <span>{hhmm(dropAt)}–{hhmm(Math.min(dropAt + 60, 23 * 60 + 59))} 여기에 일정으로</span>
          </div>
        )}
        {items.map(({ o, s, e, col, cols }) => {
          const live = drag?.id === o.id && drag.active ? drag : null
          const ss = live ? live.s : s
          const ee = live ? live.e : e
          const h = Math.max(((ee - ss) / 60) * HOUR_H, 1.5)
          const compact = h < 2.6
          return (
            <button
              key={o.id}
              className={'tl-event' + (o.shared ? ' shared' : '') + (compact ? ' compact' : '') + (live ? ' lifted' : '') + (drag?.id === o.id && !drag.active ? ' holding' : '')}
              data-cat={o.category}
              style={{
                top: `${topOf(ss)}rem`,
                height: `${h}rem`,
                left: live ? '3.6rem' : `calc(3.6rem + (100% - 3.8rem) * ${col / cols})`,
                width: live ? 'calc(100% - 3.8rem)' : `calc((100% - 3.8rem) / ${cols} - 0.2rem)`,
              }}
              onPointerDown={(ev) => begin(ev, o, s, e, 'move')}
              onPointerMove={move}
              onPointerUp={() => end(o)}
              onPointerCancel={() => { cancelHold(); setDrag(null) }}
              onClick={(ev) => { ev.stopPropagation(); if (!suppressClick.current) onOpen(o) }}
              title={`${o.start}–${o.end} ${o.title} · 끌어서 시간 이동, 아래 끝을 끌어서 길이 조절`}
            >
              <span className="tl-title">
                {o.title}
                {o.shared && <Icon name="users" size={13} />}
                {o.remind !== undefined && o.remind !== null && <Icon name="bell" size={12} />}
              </span>
              <span className="tl-sub">
                {live ? `${hhmm(ss)}–${hhmm(Math.min(ee, 23 * 60 + 59))}` : `${o.start}–${o.end}`}{o.place ? ` · ${o.place}` : ''}{o.repeat !== 'none' ? ' · 반복' : ''}
              </span>
              <span
                className="tl-resize"
                aria-hidden="true"
                onPointerDown={(ev) => begin(ev, o, s, e, 'resize')}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
