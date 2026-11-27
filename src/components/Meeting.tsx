// 회의 참석자 고르기 · 모두 비는 시간 찾기 (일정 추가 창 안에서 씀)
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { getLang, t } from '../lib/i18n'
import { addDays, dowLabel, fmtHead, holidayName, todayStr } from '../lib/date'
import { busyOn, DAY_FROM, DAY_TO, fmtMin, freeRanges, LUNCH } from '../lib/attend'
import type { BusyEvent } from '../lib/types'
import { Avatar, Icon } from './ui'

/** 참석자 칸: 고른 사람 칩 + [+ 추가] 목록 + "모두 비는 시간 찾기" (업무 배정의 담당자 칸으로도 씀) */
export function AttendeeField({ value, onChange, onFind, label, note, locked }: {
  value: string[]; onChange: (v: string[]) => void; onFind?: () => void
  /** 칸 이름 (기본 "참석자") · 오른쪽 작은 설명 · 고칠 수 없음 */
  label?: string; note?: string; locked?: boolean
}) {
  const { me, tableMembers, userOf } = useStore()
  const [open, setOpen] = useState(false)
  const others = tableMembers.filter((m) => m.userId !== me?.id && m.role !== 'pending')
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  return (
    <div className="group">
      <div className="gr col att-field">
        <div className="att-head">
          <span>{label ?? t('참석자')}</span>
          {note !== undefined ? note && <small>{note}</small> : value.length > 0 && <small>{t('나 포함 {n}명', { n: value.length + 1 })}</small>}
        </div>
        <div className="att-chips">
          {value.map((id) => (
            <span key={id} className="att-chip">
              <Avatar name={userOf(id).name} size={22} />
              {userOf(id).name}
              {!locked && <button type="button" className="att-x" onClick={() => toggle(id)} aria-label={t('{name} 빼기', { name: userOf(id).name })}>×</button>}
            </span>
          ))}
          {!locked && <button type="button" className="att-chip add" onClick={() => setOpen((v) => !v)} aria-expanded={open}>+ {t('추가')}</button>}
        </div>
        {open && (
          <div className="att-pick" role="listbox" aria-multiselectable="true">
            {others.length === 0 && <p className="hint">{t('초대할 팀원이 없어요.')}</p>}
            {others.map((m) => {
              const on = value.includes(m.userId)
              return (
                <button key={m.userId} type="button" role="option" aria-selected={on} className={'att-opt' + (on ? ' on' : '')} onClick={() => toggle(m.userId)}>
                  <Avatar name={userOf(m.userId).name} size={26} />
                  <span className="att-name">{userOf(m.userId).name}</span>
                  <span className="att-check">{on && <Icon name="check" size={16} />}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
      {onFind && value.length > 0 && (
        <button type="button" className="gr att-find" onClick={onFind}>
          <span className="att-find-l"><Icon name="cal" size={18} />{t('모두 비는 시간 찾기')}</span>
          <Icon name="chevR" size={16} />
        </button>
      )}
    </div>
  )
}

const H = 30 // 한 시간 칸 높이(px)
const SPAN = 5 // 한 번에 보는 평일 수
const md = (d: string) => getLang() === 'en' ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : `${Number(d.slice(5, 7))}. ${Number(d.slice(8, 10))}.`
/** from 부터 평일(주말·공휴일 제외)만 n일 */
function workdays(from: string, n: number): string[] {
  const out: string[] = []
  for (let d = from; out.length < n; d = addDays(d, 1)) {
    const w = new Date(d + 'T00:00:00').getDay()
    if (w !== 0 && w !== 6 && !holidayName(d)) out.push(d)
  }
  return out
}
const top = (m: number) => ((Math.max(DAY_FROM, Math.min(DAY_TO, m)) - DAY_FROM) / 60) * H

/**
 * 모두 비는 시간: 고른 사람(나 포함)의 앞으로 평일 5일 바쁜 시간을 겹쳐 보고, 모두 비어 있는 흰 칸을 고른다.
 * 회의 길이는 일정 창의 시작~종료 그대로. 점심(12~13시)은 뺀다.
 */
export function FreeFinder({ who, dur, skipId, pick, onPick }: {
  who: string[]; dur: number; skipId?: string
  pick: { date: string; start: number } | null
  onPick: (p: { date: string; start: number }) => void
}) {
  const { busyOf, userOf, me } = useStore()
  const today = todayStr()
  const now = new Date()
  const nowMin = now.getHours() * 60 + now.getMinutes()
  // 앞으로의 평일만: 오늘부터 (오늘 남은 시간이 회의 길이보다 짧으면 내일부터) 평일 5일씩 넘겨 본다
  const first = nowMin + dur <= DAY_TO ? today : addDays(today, 1)
  const [page, setPage] = useState(0)
  const days = useMemo(() => workdays(first, SPAN * (page + 1)).slice(SPAN * page), [first, page])
  const [busy, setBusy] = useState<BusyEvent[] | null>(null)
  const key = who.join(',')
  useEffect(() => {
    let alive = true
    setBusy(null)
    void busyOf(who, days[0], days[days.length - 1]).then((b) => alive && setBusy(b))
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0], key])

  // 사람별 바쁜 구간 → 30분 칸마다 바쁜 사람 수 (주황이 진할수록 바쁜 사람이 많다)
  const people = [me?.id ?? '', ...who.filter((x) => x !== me?.id)]
  const nameOf = (id: string) => (id === me?.id ? t('나') : userOf(id).name)
  const cols = days.map((d) => {
    const each = people.map((u) => (busy ? busyOn(busy.filter((b) => b.userId === u), d, skipId) : []))
    const blocks = each.flat()
    const free = !busy || d < today ? [] : freeRanges(blocks, dur, d === today ? nowMin : 0)
    const slots = Array.from({ length: (DAY_TO - DAY_FROM) / 30 }, (_, k) => {
      const m = DAY_FROM + k * 30
      const busyWho = people.filter((_, i) => each[i].some(([a, b]) => a < m + 30 && b > m))
      return { m, busyWho }
    })
    return { d, free, slots }
  })
  const picks = cols.flatMap((c) => c.free.map(([a]) => ({ date: c.d, start: a }))).slice(0, 3)
  // 주를 불러올 때마다: 고른 시간이 이 주에 없으면 이 주의 가장 빠른 시간을 골라 둔다
  useEffect(() => {
    if (busy && picks[0] && !(pick && days.includes(pick.date))) onPick(picks[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy])

  // 흰 칸(모두 가능)을 누르면 그 자리부터, 회의가 빈 구간을 넘지 않게
  const choose = (d: string, free: [number, number][], m: number) => {
    const r = free.find(([a, b]) => m >= a && m < b)
    if (r) onPick({ date: d, start: Math.max(r[0], Math.min(r[1] - dur, m)) })
  }
  const N = people.length
  const heat = (n: number) => (n === 0 ? undefined : n >= N ? '#e8590c' : `rgba(255, 140, 40, ${(0.16 + 0.5 * (n / N)).toFixed(2)})`)
  const hours = Array.from({ length: (DAY_TO - DAY_FROM) / 60 }, (_, i) => DAY_FROM / 60 + i)

  return (
    <div className="ff">
      <div className="ff-top">
        <div className="ff-who">
          {[me?.id ?? '', ...who.filter((x) => x !== me?.id)].map((id) => (
            <span key={id} className="att-chip"><Avatar name={userOf(id).name} size={22} />{id === me?.id ? t('나') : userOf(id).name}</span>
          ))}
        </div>
        <div className="ff-week">
          <span className="ff-dur">{dur % 60 ? t('{h}시간 {m}분', { h: Math.floor(dur / 60), m: dur % 60 }).replace(/^0시간 /, '') : t('{h}시간', { h: dur / 60 })}</span>
          <button type="button" className="icon-btn" disabled={page === 0} onClick={() => setPage((v) => Math.max(0, v - 1))} aria-label={t('이전 날짜')}><Icon name="chevL" size={16} /></button>
          <b>{fmtHead(days[0])} ~ {fmtHead(days[days.length - 1])}</b>
          <button type="button" className="icon-btn" onClick={() => setPage((v) => v + 1)} aria-label={t('다음 날짜')}><Icon name="chevR" size={16} /></button>
        </div>
      </div>
      <div className="ff-body">
        <div className="ff-grid" style={{ ['--cols' as string]: cols.length }}>
          <div />
          {/* 날짜·요일 두 줄 (휴대폰에서도 칸에 맞게) */}
          {cols.map((c) => <div key={c.d} className={'ff-day' + (c.d === today ? ' today' : '')}><b>{md(c.d)}</b><small>{dowLabel(c.d)}</small></div>)}
          <div className="ff-hours">{hours.map((h) => <div key={h} style={{ height: H }}>{h}:00</div>)}</div>
          {cols.map((c) => (
            <div key={c.d} className="ff-col" style={{ height: H * hours.length }}>
              {c.slots.map(({ m, busyWho }) => {
                const lunch = m >= LUNCH[0] && m < LUNCH[1]
                const n = busyWho.length
                const ok = !lunch && c.free.some(([a, b]) => m >= a && m < b)
                // 이미 지난 시간 (지난 날, 또는 오늘 지금보다 앞)
                const gone = c.d < today || (c.d === today && m + 30 <= nowMin)
                const tip = lunch ? t('점심시간')
                  : `${dowLabel(c.d)} ${fmtMin(m)} · ${t('{n}명 가능', { n: N - n })}` + (n ? `\n${t('바쁨')}: ${busyWho.map(nameOf).join('·')}` : '')
                return (
                  <button
                    key={m}
                    type="button"
                    className={'ff-cell' + (lunch ? ' lunch' : '') + (ok ? ' ok' : '') + (gone ? ' gone' : '') + (m % 60 === 0 ? ' on-hour' : '')}
                    style={{ top: top(m), height: H / 2, background: lunch ? undefined : heat(n) }}
                    data-tip={tip}
                    // disabled 를 쓰면 마우스 올림 설명이 안 떠서, 누를 수 없음은 aria 로만 알린다
                    aria-disabled={!ok}
                    tabIndex={ok ? 0 : -1}
                    onClick={() => { if (ok) choose(c.d, c.free, m) }}
                    aria-label={tip.replace('\n', ', ')}
                  />
                )
              })}
              {pick && pick.date === c.d && (
                <div className="ff-pick" style={{ top: top(pick.start) + 1, height: top(pick.start + dur) - top(pick.start) - 2 }}>
                  {fmtMin(pick.start)}–{fmtMin(pick.start + dur)}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="ff-side">
          <div className="ff-side-h">{t('추천 시간')}</div>
          {busy === null && <p className="hint">{t('불러오는 중…')}</p>}
          {busy && picks.length === 0 && <p className="hint">{t('이 주에는 모두 비는 시간이 없어요. 다음 주를 보거나 회의 길이를 줄여 보세요.')}</p>}
          {picks.map((p) => {
            const on = pick?.date === p.date && pick.start === p.start
            return (
              <button key={p.date + p.start} type="button" className={'ff-sug' + (on ? ' on' : '')} onClick={() => onPick(p)}>
                <small>{fmtHead(p.date)}</small>
                <b>{fmtMin(p.start)} – {fmtMin(p.start + dur)}</b>
              </button>
            )
          })}
          {/* 범례: 흰색(모두 가능) → 진한 주황(모두 바쁨) */}
          <div className="ff-side-h ff-scale-h">{t('바쁜 사람 수')}</div>
          <div className="ff-scale">{Array.from({ length: N + 1 }, (_, n) => <i key={n} style={{ background: heat(n) }} />)}</div>
          <div className="ff-scale-l"><span>{t('모두 가능')}</span><span>{t('모두 바쁨')}</span></div>
        </div>
      </div>
      <p className="hint ff-hint">{t('흰 칸이 모두 비는 시간이에요. 주황이 진할수록 바쁜 사람이 많아요. 흰 칸을 누르면 그 시간으로 정해져요.')}</p>
    </div>
  )
}


/**
 * 마우스를 올리면 뜨는 작은 설명 (data-tip 이 붙은 곳 어디서나).
 * 표 칸 밖으로 잘리지 않도록 화면 맨 위에 띄운다. 줄바꿈은 \n.
 */
export function TipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; up: boolean } | null>(null)
  useEffect(() => {
    let cur: Element | null = null
    const over = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return
      const el = (e.target as Element | null)?.closest?.('[data-tip]') ?? null
      if (el === cur) return
      cur = el
      const text = el?.getAttribute('data-tip')
      if (!el || !text) { setTip(null); return }
      const r = el.getBoundingClientRect()
      const up = r.top > 90
      setTip({ text, x: Math.min(innerWidth - 12, Math.max(12, r.left + r.width / 2)), y: up ? r.top - 8 : r.bottom + 8, up })
    }
    const hide = () => { cur = null; setTip(null) }
    document.addEventListener('pointerover', over)
    window.addEventListener('scroll', hide, true)
    document.addEventListener('pointerdown', hide)
    return () => {
      document.removeEventListener('pointerover', over)
      window.removeEventListener('scroll', hide, true)
      document.removeEventListener('pointerdown', hide)
    }
  }, [])
  if (!tip) return null
  return (
    <div className={'hover-tip' + (tip.up ? ' up' : '')} style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.text.split('\n').map((l, i) => <div key={i}>{l}</div>)}
    </div>
  )
}
