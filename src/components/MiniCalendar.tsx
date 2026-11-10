import { useState } from 'react'
import { holidayName, monthGrid, parse, todayStr } from '../lib/date'
import { Icon } from './ui'

export function MiniCalendar({ selected, onPick, onClose }: { selected: string; onPick: (d: string) => void; onClose: () => void }) {
  const base = parse(selected)
  const [ym, setYm] = useState({ y: base.getFullYear(), m: base.getMonth() })
  const grid = monthGrid(ym.y, ym.m)
  const today = todayStr()
  const move = (n: number) => {
    const d = new Date(ym.y, ym.m + n, 1)
    setYm({ y: d.getFullYear(), m: d.getMonth() })
  }
  return (
    <>
      <div className="popover-scrim" onMouseDown={onClose} />
      <div className="minical" role="dialog" aria-label="날짜 선택">
        <div className="minical-head">
          <strong>{ym.y}년 {ym.m + 1}월</strong>
          <span>
            <button className="icon-btn" onClick={() => move(-1)} aria-label="이전 달"><Icon name="chevL" size={16} /></button>
            <button className="icon-btn" onClick={() => move(1)} aria-label="다음 달"><Icon name="chevR" size={16} /></button>
          </span>
        </div>
        <div className="minical-grid dow">
          {['일', '월', '화', '수', '목', '금', '토'].map((d, i) => (
            <span key={d} className={i === 0 ? 'sun' : i === 6 ? 'sat' : ''}>{d}</span>
          ))}
        </div>
        <div className="minical-grid">
          {grid.map((d) => {
            const dt = parse(d)
            const out = dt.getMonth() !== ym.m
            const wd = dt.getDay()
            const hol = holidayName(d)
            return (
              <button
                key={d}
                title={hol}
                className={
                  'mc-day' + (out ? ' out' : '') + (d === selected ? ' sel' : '') + (d === today ? ' today' : '') +
                  (wd === 0 || hol ? ' red' : wd === 6 ? ' blue' : '')
                }
                onClick={() => onPick(d)}
              >
                {dt.getDate()}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
