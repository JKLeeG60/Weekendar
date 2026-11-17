import { useState } from 'react'
import { dowHeads, holidayLabel, holidayName, monthGrid, monthTitle, parse, todayStr } from '../lib/date'
import { t } from '../lib/i18n'
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
      <div className="minical" role="dialog" aria-label={t('날짜 선택')}>
        <div className="minical-head">
          <strong>{monthTitle(ym.y, ym.m)}</strong>
          <span>
            <button className="icon-btn" onClick={() => move(-1)} aria-label={t('이전 달')}><Icon name="chevL" size={16} /></button>
            <button className="icon-btn" onClick={() => move(1)} aria-label={t('다음 달')}><Icon name="chevR" size={16} /></button>
          </span>
        </div>
        <div className="minical-grid dow">
          {dowHeads().map((d, i) => (
            <span key={i} className={i === 0 ? 'sun' : i === 6 ? 'sat' : ''}>{d}</span>
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
                title={holidayLabel(d)}
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
