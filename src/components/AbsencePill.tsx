import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isMultiDay, spanLabel } from '../lib/events'
import { fmtMonthDay } from '../lib/date'
import { CATEGORY_LABEL, type Occurrence } from '../lib/types'
import { t } from '../lib/i18n'

/**
 * 부재자 이름표: 누르면 작은 말풍선으로 일정 제목·시간·장소를 보여준다
 * - 아래 공간이 모자라면(PC 표 맨 아래 줄) 위로 띄운다
 * - 바깥을 누르거나 같은 이름표를 다시 누르면 닫힌다
 * - 마우스를 올리기만 해도 잠깐 보여 주고, 마우스가 떠나면 닫힌다 (누르면 고정)
 */
export function AbsencePill({ name, o }: { name: string; o: Occurrence }) {
  // 'hover': 마우스를 올려 잠깐 보는 중 / 'click': 눌러서 고정
  const [mode, setMode] = useState<'hover' | 'click' | null>(null)
  const open = mode !== null
  const btn = useRef<HTMLButtonElement>(null)
  const pop = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number; ax: number; up: boolean } | null>(null)

  // 이름표 위치에 맞춰 말풍선 자리를 잡는다 (화면 밖으로 나가지 않게)
  useLayoutEffect(() => {
    if (!open || !btn.current || !pop.current) return
    const r = btn.current.getBoundingClientRect()
    const w = pop.current.offsetWidth, h = pop.current.offsetHeight
    const left = Math.max(10, Math.min(r.left - 8, innerWidth - w - 10))
    const up = r.bottom + 10 + h > innerHeight - 10
    setPos({ left, top: up ? r.top - 10 - h : r.bottom + 10, ax: r.left + r.width / 2 - left - 6, up })
  }, [open])

  const when = isMultiDay(o) ? `${spanLabel(o)} · ${t('종일')}` : `${fmtMonthDay(o.date)} ${o.start}–${o.end}`

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={'pill abs-pill' + (open ? ' sel' : '')}
        data-cat={o.category}
        onClick={() => { if (mode === 'hover') setMode('click'); else { setPos(null); setMode((v) => (v ? null : 'click')) } }}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse' && !mode) { setPos(null); setMode('hover') } }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse' && mode === 'hover') setMode(null) }}
        aria-expanded={open}
      >
        {name}
        <em>{t(CATEGORY_LABEL[o.category])}</em>
      </button>
      {open && createPortal(
        <>
          {mode === 'click' && <div className="abs-scrim" onPointerDown={() => setMode(null)} />}
          <div
            ref={pop}
            role="dialog"
            aria-label={`${name} · ${t(CATEGORY_LABEL[o.category])}`}
            className={'abs-pop' + (pos?.up ? ' up' : '') + (mode === 'hover' ? ' peek' : '')}
            data-cat={o.category}
            style={pos ? { left: pos.left, top: pos.top, ['--ax' as string]: pos.ax + 'px' } : { visibility: 'hidden', left: 0, top: 0 }}
          >
            <div className="abs-h"><i />{name} · {t(CATEGORY_LABEL[o.category])}</div>
            <b>{o.title}</b>
            <small>{when}{o.place && <><br />{o.place}</>}</small>
          </div>
        </>,
        document.body,
      )}
    </>
  )
}
