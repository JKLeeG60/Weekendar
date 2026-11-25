import { useEffect, useRef, useState, type DragEvent, type HTMLAttributes, type ReactNode } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { addDays, dowLabel, fmtHead, holidayName, mondayOf, parse, todayStr } from '../lib/date'
import { endDayDrag, moveDayDrag, setDayDragOver, shiftDragWeek, startDayDrag, useDayDrag } from '../lib/dayDrag'
import type { Todo } from '../lib/types'
import { t } from '../lib/i18n'
import { Icon } from './ui'

const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000)

/* ─────────── 옮기기·지우기 (되돌리기 포함) ─────────── */
export function useEventActions() {
  const { db, updateEvent, deleteEvent, addEvent, moveTodo, removeTodo, restoreTodo } = useStore()
  const { showToast } = useUI()

  /** 일정을 from 날짜에서 to 날짜로. 반복·여러 날 일정은 전체가 같은 만큼 움직인다 */
  const moveEvent = (baseId: string, from: string, to: string) => {
    const e = db.events.find((x) => x.id === baseId)
    const n = daysBetween(from, to)
    if (!e || n === 0) return
    updateEvent(baseId, {
      date: addDays(e.date, n),
      ...(e.endDate ? { endDate: addDays(e.endDate, n) } : {}),
      ...(e.until ? { until: addDays(e.until, n) } : {}),
    })
    showToast(t('{date}로 옮겼어요', { date: fmtHead(to) }) + (e.repeat !== 'none' ? t(' (반복 일정 전체)') : ''))
  }

  /** 일정 지우기. 반복 일정은 한 번 묻고, 지운 뒤 5초 동안 되돌리기 */
  const removeEvent = (baseId: string) => {
    const e = db.events.find((x) => x.id === baseId)
    if (!e) return
    if (e.repeat !== 'none' && !window.confirm(t('반복 일정 전체를 지울까요?'))) return
    deleteEvent(baseId)
    const { id: _id, ownerId: _owner, ...rest } = e
    showToast(t('일정을 삭제했어요.'), { label: t('되돌리기'), run: () => addEvent(rest) })
  }

  const moveTodoTo = (id: string, to: string) => {
    moveTodo(id, to)
    showToast(t('{date}로 옮겼어요', { date: fmtHead(to) }))
  }

  const removeTodoUndo = (todo: Todo) => {
    // 하위 할 일이 있으면 함께 지워진다고 먼저 묻는다. 되돌리기는 하위까지 함께
    const kids = db.todos.filter((x) => x.parentId === todo.id)
    if (kids.length && !window.confirm(t('하위 할 일 {n}개도 함께 지워져요. 지울까요?', { n: kids.length }))) return
    removeTodo(todo.id)
    const strip = ({ id: _id, ownerId: _owner, parentId: _p, ...rest }: Todo) => rest
    showToast(t('할 일을 삭제했어요.'), { label: t('되돌리기'), run: () => restoreTodo(strip(todo), kids.map(strip)) })
  }

  return { moveEvent, removeEvent, moveTodo: moveTodoTo, removeTodo: removeTodoUndo }
}

/* ─────────── 안내 (되돌리기 버튼 포함) ─────────── */
export function Toast() {
  const { toast, toastAction, showToast } = useUI()
  if (!toast) return null
  return (
    <div className={'toast' + (toastAction ? ' with-action' : '')} role="status">
      {toast}
      {toastAction && (
        <button className="toast-btn" onClick={() => { toastAction.run(); showToast(t('되돌렸어요')) }}>
          {toastAction.label}
        </button>
      )}
    </div>
  )
}

/* ─────────── 끄는 동안 나타나는 날짜 띠 (월~일) ─────────── */
export function DayDropStrip() {
  const d = useDayDrag()
  const { selected, isMobile } = useUI()
  const [week, setWeek] = useState(() => mondayOf(selected))
  const flip = useRef<number | null>(null)

  // 끌기를 시작할 때마다 지금 보고 있는 주로
  useEffect(() => {
    if (d.active) setWeek(mondayOf(selected))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.active])

  // 화살표 위에 잠깐 머물면 주를 넘긴다
  useEffect(() => {
    if (flip.current) window.clearTimeout(flip.current)
    flip.current = null
    if (d.over === 'prev' || d.over === 'next') {
      const n = d.over === 'prev' ? -7 : 7
      // 위에 주간 달력이 있으면 그 달력의 주를, 아니면 날짜 띠의 주를 넘긴다
      flip.current = window.setTimeout(() => (d.inline ? shiftDragWeek(n, mondayOf(selected)) : setWeek((w) => addDays(w, n))), 550)
    }
    return () => { if (flip.current) window.clearTimeout(flip.current) }
  }, [d.over, week, d.inline, d.week, selected])

  if (!d.active) return null
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i))
  const today = todayStr()
  // PC: 끄는 곳(타임라인) 위쪽에. 화면 밖으로 나가지 않게 (띠 너비 약 540px)
  const style = !isMobile && d.anchor
    ? { left: Math.max(280, Math.min(d.anchor.left + d.anchor.width / 2, innerWidth - 280)), top: d.anchor.top + 6 }
    : undefined
  // 브라우저 기본 끌기(PC 할 일)는 놓을 칸이 직접 받아야 한다
  const native = (day: string) => ({
    onDragOver: (e: DragEvent) => { e.preventDefault(); setDayDragOver(day) },
    onDragLeave: () => setDayDragOver(null),
    onDrop: (e: DragEvent) => { e.preventDefault(); setDayDragOver(day); endDayDrag() },
  })
  return (
    <>
      {/* 폰 팀 주간 탭은 위의 주간 달력이 날짜 띠 역할을 하므로 띠를 숨긴다 */}
      {!d.inline && <div className="dd-strip" style={style} role="listbox" aria-label={t('옮길 날짜')}>
        <span className={'dd-arrow' + (d.over === 'prev' ? ' on' : '')} data-drop-day="prev" {...native('prev')}><Icon name="chevL" size={16} /></span>
        {days.map((day) => (
          <span
            key={day}
            data-drop-day={day}
            className={'dd-day' + (day === d.over ? ' on' : '') + (day === selected ? ' cur' : '') + (day === today ? ' today' : '') + (parse(day).getDay() === 0 || holidayName(day) ? ' red' : '')}
            {...native(day)}
          >
            <small>{dowLabel(day)}</small>
            <b>{parse(day).getDate()}</b>
          </span>
        ))}
        <span className={'dd-arrow' + (d.over === 'next' ? ' on' : '')} data-drop-day="next" {...native('next')}><Icon name="chevR" size={16} /></span>
      </div>}
      {/* 손가락을 따라다니는 반투명 복사본 */}
      {d.ghost && (
        <div className={'dd-clone' + (d.over ? ' over' : '')} style={{ left: d.x - d.ghost.dx, top: d.y - d.ghost.dy, width: d.ghost.w }} dangerouslySetInnerHTML={{ __html: d.ghost.html }} />
      )}
      {!d.native && (!d.ghost || (d.over && /^\d{4}/.test(d.over))) && (
        <div className={'dd-ghost' + (d.ghost ? ' below' : '')} style={d.ghost ? { left: d.x, top: d.y - d.ghost.dy + d.ghost.h + 10 } : { left: d.x, top: d.y }}>
          {d.over && /^\d{4}/.test(d.over) ? t('{date}로 옮기기', { date: fmtHead(d.over) }) : d.label}
        </div>
      )}
    </>
  )
}

/* ─────────── 목록 한 줄: 왼쪽으로 밀면 휴지통, 길게 눌러 끌면 다른 날로 ─────────── */
const TRASH_W = 72

export function GestureRow({
  children, className, onDelete, drag, bodyProps,
}: {
  children: ReactNode
  className?: string
  /** 안쪽 줄에 붙일 속성 (PC 할 일의 브라우저 기본 끌기 등) */
  bodyProps?: HTMLAttributes<HTMLDivElement> & { draggable?: boolean }
  onDelete?: () => void
  /** 길게 눌러 끌기 (손가락): label = 표시 이름, onDrop = 놓은 날짜 */
  drag?: { label: string; onDrop: (day: string) => void }
}) {
  const [x, setX] = useState(0)
  const [lifted, setLifted] = useState(false)
  const g = useRef<{ x0: number; y0: number; base: number; mode: 'idle' | 'swipe' | 'drag' | 'scroll'; timer: number | null; moved: boolean } | null>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const suppress = useRef(false)
  const open = x <= -TRASH_W / 2

  // 끄는 중에는 화면이 스크롤되지 않게
  useEffect(() => {
    const el = rowRef.current
    if (!el) return
    const h = (e: TouchEvent) => { if (g.current?.mode === 'drag' || g.current?.mode === 'swipe') e.preventDefault() }
    el.addEventListener('touchmove', h, { passive: false })
    return () => el.removeEventListener('touchmove', h)
  }, [])

  const stopTimer = () => { if (g.current?.timer) window.clearTimeout(g.current.timer); if (g.current) g.current.timer = null }

  return (
    <div
      ref={rowRef}
      className={'swipe-row' + (open ? ' open' : '') + (x < 0 ? ' sliding' : '') + (lifted ? ' lifted' : '')}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        g.current = { x0: e.clientX, y0: e.clientY, base: x, mode: 'idle', timer: null, moved: false }
        if (drag && e.pointerType === 'touch') {
          const { clientX, clientY } = e
          g.current.timer = window.setTimeout(() => {
            if (!g.current || g.current.mode !== 'idle') return
            g.current.mode = 'drag'
            setLifted(true)
            setX(0)
            navigator.vibrate?.(10)
            startDayDrag({ label: drag.label, onDrop: drag.onDrop, x: clientX, y: clientY, source: rowRef.current?.querySelector('.swipe-body') })
          }, 420)
        }
      }}
      onPointerMove={(e) => {
        const s = g.current
        if (!s) return
        const dx = e.clientX - s.x0, dy = e.clientY - s.y0
        if (s.mode === 'drag') { moveDayDrag(e.clientX, e.clientY); return }
        if (s.mode === 'idle') {
          if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) && onDelete) {
            s.mode = 'swipe'
            stopTimer()
            ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
          } else if (Math.abs(dy) > 8) {
            s.mode = 'scroll'
            stopTimer()
          }
        }
        if (s.mode === 'swipe') {
          s.moved = true
          setX(Math.max(-TRASH_W * 1.4, Math.min(0, s.base + dx)))
        }
      }}
      onPointerUp={() => {
        const s = g.current
        stopTimer()
        g.current = null
        if (!s) return
        if (s.mode === 'drag') {
          setLifted(false)
          endDayDrag()
          suppress.current = true
        } else if (s.mode === 'swipe') {
          setX((v) => (v <= -TRASH_W / 2 ? -TRASH_W : 0))
          suppress.current = true
        }
        if (suppress.current) setTimeout(() => (suppress.current = false), 0)
      }}
      onPointerCancel={() => {
        stopTimer()
        if (g.current?.mode === 'drag') { setLifted(false); endDayDrag(false) }
        g.current = null
        setX((v) => (v <= -TRASH_W / 2 ? -TRASH_W : 0))
      }}
      onContextMenu={(e) => { if (drag) e.preventDefault() }}
      onClickCapture={(e) => {
        // 밀거나 끈 직후의 누름, 또는 휴지통이 열린 상태에서 다른 곳을 누르면 닫기만
        if (suppress.current || (open && !(e.target as HTMLElement).closest('.swipe-del'))) {
          e.preventDefault()
          e.stopPropagation()
          if (!suppress.current) setX(0)
        }
      }}
    >
      {onDelete && (
        <button className="swipe-del" aria-label={t('삭제')} onClick={() => { setX(0); onDelete() }} tabIndex={open ? 0 : -1}>
          <Icon name="trash" size={20} />
        </button>
      )}
      <div {...bodyProps} className={'swipe-body' + (className ? ' ' + className : '')} style={{ transform: x ? `translateX(${x}px)` : undefined }}>
        {children}
      </div>
    </div>
  )
}
