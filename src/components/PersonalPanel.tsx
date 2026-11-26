import React, { useEffect, useRef, useState } from 'react'
import { useLayout, clampTop, TOP_DEFAULT } from '../lib/layout'
import { Resizer } from './Resizer'
import { popup } from '../lib/bus'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { isMultiDay, occurrencesOn, spanLabel } from '../lib/events'
import { addDays, fmtHead, todayStr } from '../lib/date'
import type { Occurrence, Todo } from '../lib/types'
import { Rich, t } from '../lib/i18n'
import { WeekGoalSection } from './WeekGoals'
import { MemoDock } from './Memo'
/** 할 일 목록 안에서는 변수 이름 t(할 일)와 겹치므로 tr 로 부른다 */
const tr = t
import { MiniCalendar } from './MiniCalendar'
import { Icon } from './ui'
import { GestureRow, useEventActions } from './DayDrop'
import { endDayDrag, moveDayDrag, startDayDrag } from '../lib/dayDrag'

export function DayAgenda() {
  const { db, me, updateEvent, addEvent } = useStore()
  const { selected, setSelected, openModal, showToast } = useUI()
  const act = useEventActions()
  const [cal, setCal] = useState(false)
  const all = occurrencesOn(db.events.filter((e) => e.ownerId === me?.id), selected)
  const allDay = all.filter((o) => isMultiDay(o))
  const mine = all.filter((o) => !isMultiDay(o))
  const isToday = selected === todayStr()

  return (
      <section className="panel-half">
        <div className="panel-head">
          <div className="datenav">
            <button className="icon-btn" onClick={() => setSelected(addDays(selected, -1))} aria-label={t('전날')}><Icon name="chevL" /></button>
            <div className="datebtn-wrap">
              <button className="datebtn" onClick={() => setCal((v) => !v)} aria-haspopup="dialog" aria-expanded={cal}>
                {fmtHead(selected)}
              </button>
              {cal && (
                <MiniCalendar
                  selected={selected}
                  onPick={(d) => { setSelected(d); setCal(false) }}
                  onClose={() => setCal(false)}
                />
              )}
            </div>
            <button className="icon-btn" onClick={() => setSelected(addDays(selected, 1))} aria-label={t('다음날')}><Icon name="chevR" /></button>
            {/* 오늘 표시는 화살표 바깥 오른쪽에 (날짜 글자 길이가 바뀌어도 화살표가 흔들리지 않게) */}
            {isToday && <span className="today-tag">{t('오늘')}</span>}
          </div>
          <button className="icon-btn accent" onClick={() => openModal({ type: 'event', date: selected })} aria-label={t('일정 추가')} title={t('일정 추가 (N)')}>
            <Icon name="plus" />
          </button>
        </div>
        {allDay.length > 0 && (
          <div className="allday">
            <span className="allday-label">{t('종일')}</span>
            <div className="allday-list">
              {allDay.map((o) => (
                <button key={o.id} className="allday-item" data-cat={o.category} data-base={o.baseId} onClick={() => openModal({ type: 'detail', occ: o })}>
                  <b>{o.title}</b><small>{spanLabel(o)}</small>
                </button>
              ))}
            </div>
          </div>
        )}
        <Timeline
          occs={mine}
          date={selected}
          onAdd={(t) => openModal({ type: 'event', date: selected, start: t })}
          onOpen={(o) => openModal({ type: 'detail', occ: o })}
          onMoveDay={(o, day) => act.moveEvent(o.baseId, selected, day)}
          onChange={(o, start, end) => {
            updateEvent(o.baseId, { start, end })
            showToast(t('{range}로 옮겼어요', { range: `${start}–${end}` }) + (o.repeat !== 'none' ? t(' (반복 일정 전체)') : ''))
          }}
          onDropTodo={(todoId, start, end) => {
            const t = db.todos.find((x) => x.id === todoId)
            if (!t) return
            // 할 일은 비공개라, 할 일에서 만든 일정도 기본은 '나만 보기'
            addEvent({ title: t.text, date: selected, start, end, place: '', category: 'work', repeat: 'none', shared: false })
            popup({ id: 'tb_' + Date.now(), title: tr('할 일을 일정으로 잡았어요'), text: `${start}–${end} ${t.text} · ${tr('나만 보기')}`, tag: tr('일정 추가'), icon: 'cal' })
          }}
        />
      </section>
  )
}

export function PersonalPanel() {
  // 일정과 할 일 사이를 끌어서 높이 비율을 바꾼다 (이 브라우저에 기억)
  const lay = useLayout()
  const ref = useRef<HTMLElement>(null)
  const toTop = (y: number) => {
    const halves = ref.current?.querySelectorAll<HTMLElement>(':scope > .panel-half')
    if (!halves || halves.length < 2) return lay.top
    const a = halves[0].getBoundingClientRect(), b = halves[1].getBoundingClientRect()
    return clampTop(((y - a.top) / (b.bottom - a.top)) * 100)
  }
  return (
    <aside ref={ref} className="panel memo-host" style={{ '--top': lay.top } as React.CSSProperties}>
      <DayAgenda />
      <Resizer
        dir="row"
        label={t('일정과 할 일 높이')}
        value={lay.top}
        min={25}
        max={75}
        onMove={(y, done) => lay.set({ top: toTop(y) }, done)}
        onStep={(d) => lay.set({ top: clampTop(lay.top + d) })}
        onReset={() => lay.set({ top: TOP_DEFAULT })}
      />
      <Todos />
      <MemoDock />
    </aside>
  )
}

/** 접어 둔 상위 할 일 (나에게만, 이 기기에) */
const FOLD_KEY = 'weekendar-todo-fold'
const readFold = (): string[] => { try { return JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]') } catch { return [] } }

export function Todos() {
  const { db, me, addTodo, toggleTodo, togglePriority, arrangeTodos, moveTodo } = useStore()
  const { selected, openModal, isMobile, showToast } = useUI()
  const act = useEventActions()
  const [text, setText] = useState('')
  const carry = me?.todoCarry !== false
  const [fold, setFold] = useState<string[]>(readFold)
  const toggleFold = (id: string) => {
    const next = fold.includes(id) ? fold.filter((x) => x !== id) : [...fold, id]
    setFold(next)
    try { localStorage.setItem(FOLD_KEY, JSON.stringify(next)) } catch { /* 저장 못 해도 화면에서는 접힘 */ }
  }

  // 순서: 직접 정한 순서(position)가 먼저, 아직 안 정한 것은 예전처럼 중요 → 만든 순
  const idx = new Map(db.todos.map((x, i) => [x.id, i]))
  const key = (x: Todo) => x.position ?? 100000 + (x.priority ? 0 : 50000) + (idx.get(x.id) ?? 0)
  const byOrder = (a: Todo, b: Todo) => Number(a.done) - Number(b.done) || key(a) - key(b)
  const list = db.todos
    // 넘기기 설정이 켜져 있으면 지난 날의 못 끝낸 할 일도 함께 보여준다
    .filter((t) => t.ownerId === me?.id && (t.date === selected || (carry && t.date < selected && !t.done)))
  const shown = new Set(list.map((x) => x.id))
  // 상위가 안 보이는 하위 할 일은 맨 위 단계에 보여 준다
  const top = list.filter((x) => !x.parentId || !shown.has(x.parentId)).sort(byOrder)
  const kidsOf = (id: string) => list.filter((x) => x.parentId === id && shown.has(id)).sort(byOrder)
  const left = list.filter((t) => !t.done).length
  // 지난 날에서 넘어온 할 일을 끝내면 끝낸 날로 옮긴다 (안 그러면 '안 끝난 것만 넘기기' 때문에 화면에서 사라짐)
  const check = (t: Todo) => {
    const old = t.date < selected || list.some((k) => k.parentId === t.id && k.date < selected)
    if (!t.done && old) moveTodo(t.id, selected)
    toggleTodo(t.id)
  }

  // ── 끌어 놓기: 할 일 위에 놓으면 그 하위로, 위·아래 가장자리에 놓으면 순서만 ──
  const [dragId, setDragId] = useState<string | null>(null)
  const [hint, setHint] = useState<{ id: string; zone: 'before' | 'after' | 'into' } | null>(null)
  const zoneOf = (el: HTMLElement, clientY: number, target: Todo): 'before' | 'after' | 'into' => {
    const r = el.getBoundingClientRect()
    const y = clientY - r.top
    // 위·아래 끝 8px 만 '사이에 놓기', 나머지는 '하위로 넣기' (가운데만 되면 너무 좁아 순서만 바뀌기 쉽다)
    const edge = Math.min(8, r.height * 0.25)
    const d = db.todos.find((x) => x.id === dragId)
    // 하위로 넣을 수 있는 경우: 대상이 맨 위 단계, 끄는 것은 하위가 없는 것 (한 단계까지)
    const canInto = !!d && !target.parentId && target.id !== d.id && !db.todos.some((x) => x.parentId === d.id)
    if (canInto && y > edge && y < r.height - edge) return 'into'
    return y < r.height / 2 ? 'before' : 'after'
  }
  /** 손가락 아래의 할 일과 놓을 자리 (휴대폰에서 꾹 눌러 끌 때) */
  const fingerOver = (x: number, y: number) => {
    const li = document.elementFromPoint(x, y)?.closest('.todos .todo-li') as HTMLElement | null
    const target = li && list.find((v) => v.id === li.dataset.tid)
    if (!li || !target || target.id === dragId) { if (hint) setHint(null); return }
    const zone = zoneOf(li, y, target)
    if (hint?.id !== target.id || hint.zone !== zone) setHint({ id: target.id, zone })
  }
  function drop(target: Todo, zone: 'before' | 'after' | 'into') {
    const d = db.todos.find((x) => x.id === dragId)
    if (!d || d.id === target.id) return
    const hasKids = db.todos.some((x) => x.parentId === d.id)
    let parent: string | null
    let sibs: Todo[]
    let at: number
    const targetKids = kidsOf(target.id).filter((x) => x.id !== d.id)
    if (zone === 'into') {
      parent = target.id
      sibs = targetKids
      at = sibs.length
    } else if (zone === 'after' && !target.parentId && targetKids.length && !fold.includes(target.id)) {
      // 펼친 상위 할 일 바로 아래에 놓으면 첫 번째 하위로
      parent = target.id
      sibs = targetKids
      at = 0
    } else {
      parent = target.parentId && shown.has(target.parentId) ? target.parentId : null
      sibs = (parent ? kidsOf(parent) : top).filter((x) => x.id !== d.id)
      at = sibs.findIndex((x) => x.id === target.id) + (zone === 'after' ? 1 : 0)
    }
    if (parent && hasKids) { showToast(t('하위 할 일이 있는 할 일은 다른 할 일의 하위로 넣을 수 없어요')); return }
    const order = [...sibs.slice(0, at), d, ...sibs.slice(at)]
    arrangeTodos(order.map((x, i) => ({ id: x.id, parentId: x.id === d.id ? parent : x.parentId ?? null, position: i })))
    if (parent && d.parentId !== parent) showToast(t('‘{name}’의 하위 할 일로 넣었어요', { name: target.parentId ? db.todos.find((x) => x.id === parent)?.text ?? '' : target.text }))
  }

  return (
    <section className="panel-half todo">
      <WeekGoalSection />
      <div className="panel-head">
        <h3 className="section-label big">{t('할 일')}</h3>
        <span className="count">{t('{n}개 남음', { n: left })}</span>
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
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('새로운 할 일')} aria-label={t('새로운 할 일')} data-todo-input />
        </form>
        {list.length === 0 && (
          <div className="empty-guide">
            <span className="eg-icon"><Icon name="check" size={18} /></span>
            <strong>{t('오늘 할 일이 없어요')}</strong>
            <small><Rich text={t('위 칸에 할 일을 적어 보세요. <mbr>적은 할 일을 타임라인으로 끌어다 놓으면 일정이 돼요.')} /></small>
          </div>
        )}
        <ul className={'todos' + (dragId ? ' sorting' : '')}>
          {top.map((p) => [p, ...(fold.includes(p.id) ? [] : kidsOf(p.id))]).flat().map((t, i, rows) => {
            const kids = kidsOf(t.id)
            const isChild = !!t.parentId && shown.has(t.parentId)
            // 마지막 하위 할 일이면 연결선을 아래로 잇지 않는다
            const isLast = isChild && rows[i + 1]?.parentId !== t.parentId
            const h = hint?.id === t.id ? hint.zone : null
            return (
            <li
              key={t.id}
              className={'todo-li' + (isChild ? ' child' + (isLast ? ' last' : '') : '') + (h ? ' drop-' + h : '') + (dragId === t.id ? ' drag-src' : '')}
              data-tid={t.id}
              onDragOver={(e) => {
                if (!dragId || !e.dataTransfer.types.includes('text/weekendar-todo')) return
                e.preventDefault()
                const z = zoneOf(e.currentTarget, e.clientY, t)
                if (hint?.id !== t.id || hint.zone !== z) setHint({ id: t.id, zone: z })
              }}
              onDragLeave={(e) => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setHint((x) => (x?.id === t.id ? null : x)) }}
              onDrop={(e) => {
                if (!dragId) return
                e.preventDefault()
                drop(t, zoneOf(e.currentTarget, e.clientY, t))
                setHint(null)
                setDragId(null)
                endDayDrag(false)
              }}
            >
            {isChild && <span className="todo-tree" aria-hidden />}
            <GestureRow
              className={'todo-item' + (t.done ? ' done' : '')}
              onDelete={() => act.removeTodo(t)}
              drag={!t.done ? {
                label: t.text,
                onDrop: (d) => act.moveTodo(t.id, d),
                // 휴대폰: 꾹 눌러 끌다가 다른 할 일 위에 놓으면 하위로, 사이에 놓으면 순서 바꾸기
                onStart: () => setDragId(t.id),
                onMove: fingerOver,
                onEnd: (dropped) => {
                  const target = hint && list.find((x) => x.id === hint.id)
                  if (dropped && target) drop(target, hint.zone)
                  setHint(null)
                  setDragId(null)
                },
              } : undefined}
              bodyProps={{
                draggable: !t.done && !isMobile,
                onDragStart: (e) => {
                  e.dataTransfer.setData('text/weekendar-todo', t.id)
                  e.dataTransfer.effectAllowed = 'copyMove'
                  setDragId(t.id)
                  // 위쪽에 날짜 띠: 날짜에 놓으면 그날로 옮기기, 타임라인에 놓으면 일정으로
                  startDayDrag({ label: t.text, native: true, anchor: document.querySelector('.timeline-scroll'), onDrop: (d) => act.moveTodo(t.id, d) })
                },
                onDragEnd: () => { setDragId(null); setHint(null); endDayDrag(false) },
                title: !t.done && !isMobile ? tr('다른 할 일 위에 놓으면 하위 할 일, 사이에 놓으면 순서 바꾸기 · 타임라인에 놓으면 일정, 위 날짜에 놓으면 그날로 옮겨져요') : undefined,
              }}
            >
              <button className="check" role="checkbox" aria-checked={t.done} onClick={() => check(t)} aria-label={t.text}>
                {t.done && <Icon name="check" size={13} />}
              </button>
              <span className="todo-text">
                {t.text}
                {kids.length > 0 && (
                  <button
                    className={'todo-fold' + (fold.includes(t.id) ? ' folded' : '')}
                    onClick={() => toggleFold(t.id)}
                    aria-expanded={!fold.includes(t.id)}
                    aria-label={fold.includes(t.id) ? tr('하위 할 일 펼치기') : tr('하위 할 일 접기')}
                  >
                    <span>{kids.filter((k) => k.done).length}/{kids.length}</span>
                    <Icon name="chevD" size={11} />
                  </button>
                )}
                {h === 'into' && <span className="todo-into">{tr('하위 할 일로')}</span>}
              </span>
              {!t.done && (
                <button
                  className="icon-btn tiny to-event"
                  onClick={() => openModal({ type: 'event', date: selected, title: t.text, shared: false })}
                  aria-label={tr('일정으로 잡기')}
                  title={tr('일정으로 잡기')}
                >
                  <Icon name="cal" size={14} />
                </button>
              )}
              <button className={'icon-btn tiny flag' + (t.priority ? ' on' : '')} onClick={() => togglePriority(t.id)} aria-label={tr('중요 표시')}>
                <Icon name="flag" size={14} />
              </button>
              <button className="icon-btn tiny del" onClick={() => act.removeTodo(t)} aria-label={tr('삭제')}>
                <Icon name="x" size={14} />
              </button>
            </GestureRow>
            </li>
            )
          })}
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

function Timeline({ occs, date, onAdd, onOpen, onChange, onDropTodo, onMoveDay }: {
  occs: Occurrence[]; date: string
  /** 끌어서 위 날짜 띠에 놓으면 그날로 옮기기 */
  onMoveDay: (o: Occurrence, day: string) => void
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
    el.scrollTop = Math.max(0, (topOf(target) - 0.9) * remPx()) // 0.9rem: 맨 위 시각 글자가 잘리지 않도록
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
        if (mode === 'move') startDayDrag({ label: o.title, x: e.clientX, y: e.clientY, anchor: ref.current, onDrop: (day) => onMoveDay(o, day) })
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
      // 처음 움직일 때 위쪽에 날짜 띠를 띄우고, 이후 손가락/마우스 위치를 알려 준다
      if (!d.active && e.pointerType !== 'touch') {
        const o = occs.find((x) => x.id === d.id)
        if (o) startDayDrag({ label: o.title, x: e.clientX, y: e.clientY, anchor: ref.current, onDrop: (day) => onMoveDay(o, day) })
      }
      moveDayDrag(e.clientX, e.clientY)
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
      // 날짜 띠 위에서 놓았으면 그날로 옮기고, 아니면 시간만 바꾼다
      if (endDayDrag()) return
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
            <span>{hhmm(dropAt)}–{hhmm(Math.min(dropAt + 60, 23 * 60 + 59))} {t('여기에 일정으로')}</span>
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
              data-base={o.baseId}
              style={{
                top: `${topOf(ss)}rem`,
                height: `${h}rem`,
                left: live ? '3.6rem' : `calc(3.6rem + (100% - 3.8rem) * ${col / cols})`,
                width: live ? 'calc(100% - 3.8rem)' : `calc((100% - 3.8rem) / ${cols} - 0.2rem)`,
              }}
              onPointerDown={(ev) => begin(ev, o, s, e, 'move')}
              onPointerMove={move}
              onPointerUp={() => end(o)}
              onPointerCancel={() => { cancelHold(); setDrag(null); endDayDrag(false) }}
              onClick={(ev) => { ev.stopPropagation(); if (!suppressClick.current) onOpen(o) }}
              title={`${o.start}–${o.end} ${o.title} · ${t('끌어서 시간 이동, 아래 끝을 끌어서 길이 조절')}`}
            >
              <span className="tl-title">
                {o.title}
                {o.shared && <Icon name="users" size={13} />}
                {o.remind !== undefined && o.remind !== null && <Icon name="bell" size={12} />}
              </span>
              <span className="tl-sub">
                {live ? `${hhmm(ss)}–${hhmm(Math.min(ee, 23 * 60 + 59))}` : `${o.start}–${o.end}`}{o.place ? ` · ${o.place}` : ''}{o.repeat !== 'none' ? ' · ' + t('반복') : ''}
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
