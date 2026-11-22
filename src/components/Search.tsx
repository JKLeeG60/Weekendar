import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { t, getLang } from '../lib/i18n'
import { addDays, dowLabel, parse, todayStr } from '../lib/date'
import { occurrencesOn } from '../lib/events'
import type { EventItem, Message, Occurrence } from '../lib/types'
import { Icon } from './ui'

type Kind = 'event' | 'todo' | 'memo' | 'chat'
type Row =
  | { kind: 'event'; key: string; date: string; occ: Occurrence; owner: string }
  | { kind: 'todo'; key: string; date: string; text: string; done: boolean }
  | { kind: 'memo'; key: string; date: string; snip: string }
  | { kind: 'chat'; key: string; date: string; m: Message; who: string; where: string }

const SECTIONS: { kind: Kind; label: string }[] = [
  { kind: 'event', label: '일정' },
  { kind: 'todo', label: '할 일' },
  { kind: 'memo', label: '메모' },
  { kind: 'chat', label: '채팅' },
]
/** 전체 보기에서 칸마다 처음 보여 줄 개수 */
const FIRST = 3

/** "'26. 11. 23.(월)" (영어: "Mon, Nov 23 '26") */
function shortDate(s: string) {
  const d = parse(s)
  const yy = String(d.getFullYear()).slice(2)
  if (getLang() === 'en') return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} '${yy}`
  return `'${yy}. ${d.getMonth() + 1}. ${d.getDate()}.(${dowLabel(s)})`
}

const dateOf = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 반복 일정은 오늘부터 가장 가까운 날(없으면 처음 날)을 보여 준다 */
function pickOcc(e: EventItem, today: string): Occurrence {
  if (e.repeat !== 'none') {
    for (let i = 0, d = e.date > today ? e.date : today; i < 400; i++, d = addDays(d, 1)) {
      const o = occurrencesOn([e], d)[0]
      if (o) return o
    }
  }
  return { ...e, baseId: e.id }
}

/** 마크다운 메모 → 찾은 글자 둘레만 짧게 */
function snippet(md: string, q: string) {
  const plain = md.replace(/\[\[(\d{4}-\d{2}-\d{2})\]\]/g, '$1').replace(/[#>*_`~[\]|-]+/g, ' ').replace(/\s+/g, ' ').trim()
  const i = plain.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return plain.slice(0, 60)
  const from = Math.max(0, i - 16)
  return (from > 0 ? '…' : '') + plain.slice(from, i + q.length + 44) + (i + q.length + 44 < plain.length ? '…' : '')
}

/** 찾은 글자만 파랗게 */
function Mark({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const lower = text.toLowerCase(), k = q.toLowerCase()
  const out: React.ReactNode[] = []
  let at = 0
  for (let i = lower.indexOf(k); i >= 0; i = lower.indexOf(k, at)) {
    if (i > at) out.push(text.slice(at, i))
    out.push(<b key={i} className="sr-hl">{text.slice(i, i + k.length)}</b>)
    at = i + k.length
  }
  out.push(text.slice(at))
  return <>{out}</>
}

/** 위쪽 돋보기(⌘K, /)로 여는 검색 창: 일정·할 일·메모·채팅을 한 번에 찾는다 */
export function SearchSheet() {
  const { db, me, tableMembers, userOf, rooms, findMemos, findMessages, revealMessage } = useStore()
  const { setSearchOpen, setSelected, openModal, setMonthView, panelOpen, togglePanel, setChatOpen, setChatTab, setDmPeer, setChatJump } = useUI()
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<Kind | 'all'>('all')
  const [more, setMore] = useState<Kind | null>(null)
  const [cur, setCur] = useState(0)
  const [memos, setMemos] = useState<{ date: string; body: string }[]>([])
  const [msgs, setMsgs] = useState<Message[]>([])
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const s = q.trim()
  const close = () => setSearchOpen(false)

  useEffect(() => { inputRef.current?.focus() }, [])

  // 메모·채팅은 서버에서 찾으므로 입력이 잠깐 멈췄을 때 한 번만
  useEffect(() => {
    if (!s) { setMemos([]); setMsgs([]); setBusy(false); return }
    let alive = true
    setBusy(true)
    const tm = window.setTimeout(() => {
      Promise.all([findMemos(s), findMessages(s)]).then(([a, b]) => {
        if (!alive) return
        setMemos(a)
        setMsgs(b)
        setBusy(false)
      })
    }, 220)
    return () => { alive = false; window.clearTimeout(tm) }
  }, [s, findMemos, findMessages])

  const rows = useMemo(() => {
    const out: Record<Kind, Row[]> = { event: [], todo: [], memo: [], chat: [] }
    if (!s || !me) return out
    const k = s.toLowerCase()
    const today = todayStr()
    const team = new Set(tableMembers.map((x) => x.userId))
    // 일정: 내 일정 전부 + 팀원이 팀에 공유한 일정
    out.event = db.events
      .filter((e) => (e.ownerId === me.id || (e.shared && team.has(e.ownerId))) && (e.title.toLowerCase().includes(k) || e.place.toLowerCase().includes(k)))
      .map((e) => {
        const occ = pickOcc(e, today)
        return { kind: 'event' as const, key: 'e' + e.id, date: occ.date, occ, owner: e.ownerId === me.id ? t('나') : userOf(e.ownerId).name, inTitle: e.title.toLowerCase().includes(k) }
      })
      // 제목에 들어 있는 일정을 먼저, 장소에만 들어 있는 일정은 뒤로 (각각 최근 날짜부터)
      .sort((a, b) => Number(b.inTitle) - Number(a.inTitle) || b.date.localeCompare(a.date))
      .map(({ inTitle: _, ...r }) => r)
    // 할 일: 내 것만
    out.todo = db.todos
      .filter((x) => x.ownerId === me.id && x.text.toLowerCase().includes(k))
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((x) => ({ kind: 'todo' as const, key: 't' + x.id, date: x.date, text: x.text, done: x.done }))
    out.memo = memos.map((m) => ({ kind: 'memo' as const, key: 'm' + m.date, date: m.date, snip: snippet(m.body, s) }))
    out.chat = msgs.map((m) => {
      let where = t('팀 대화')
      if (m.toId) where = t('{name}님과의 대화', { name: userOf(m.authorId === me.id ? m.toId : m.authorId).name })
      else if (m.roomId) {
        const r = rooms.find((x) => x.id === m.roomId)
        where = r ? r.memberIds.filter((x) => x !== me.id).map((x) => userOf(x).name).join(', ') : t('대화방')
      }
      return { kind: 'chat' as const, key: 'c' + m.id, date: dateOf(m.createdAt), m, who: m.authorId === me.id ? t('나') : userOf(m.authorId).name, where }
    })
    return out
  }, [s, me, db.events, db.todos, tableMembers, userOf, memos, msgs, rooms])

  const total = SECTIONS.reduce((a, x) => a + rows[x.kind].length, 0)
  // 화면에 보이는 칸 (전체 보기에서는 칸마다 3개, '모두 보기'를 누른 칸은 다)
  const shown = SECTIONS.filter((x) => (tab === 'all' || tab === x.kind) && rows[x.kind].length > 0).map((x) => ({
    ...x,
    all: rows[x.kind].length,
    list: tab === 'all' && more !== x.kind ? rows[x.kind].slice(0, FIRST) : rows[x.kind],
  }))
  const flat = shown.flatMap((x) => x.list)

  useEffect(() => { setCur(0) }, [s, tab])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>('.sr-row.sel')?.scrollIntoView({ block: 'nearest' })
  }, [cur])

  function go(r: Row) {
    close()
    setMonthView(null)
    if (r.kind === 'event') {
      setSelected(r.date)
      openModal({ type: 'detail', occ: r.occ })
    } else if (r.kind === 'todo') {
      setSelected(r.date)
      if (!panelOpen) togglePanel()
    } else if (r.kind === 'memo') {
      setSelected(r.date)
      if (!panelOpen) togglePanel()
      window.setTimeout(() => window.dispatchEvent(new Event('wk:memo-open')), 80)
    } else {
      const m = r.m
      if (m.toId) { setChatTab('dm'); setDmPeer(m.authorId === me?.id ? m.toId : m.authorId) }
      else if (m.roomId) { setChatTab('dm'); setDmPeer('room:' + m.roomId) }
      else setChatTab('team')
      setChatJump(m.id)
      setChatOpen(true)
      void revealMessage(m)
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setCur((c) => Math.min(c + 1, flat.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCur((c) => Math.max(c - 1, 0)) }
    else if (e.key === 'Enter' && flat[cur]) { e.preventDefault(); go(flat[cur]) }
  }

  let idx = -1
  return (
    <div className="sr-wrap" onKeyDown={onKey}>
      <div className="sr-dim" onClick={close} />
      <div className="sr" role="dialog" aria-modal="true" aria-label={t('검색')}>
        <div className="sr-in">
          <Icon name="search" size={20} />
          {/* 한글 입력이 끊기지 않도록 입력은 그대로 두고, 찾기만 잠깐 늦춘다 */}
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('일정, 할 일, 메모, 채팅 검색')}
            aria-label={t('검색어')}
            spellCheck={false}
          />
          {q && <button className="sr-clear" onClick={() => { setQ(''); inputRef.current?.focus() }} aria-label={t('지우기')}><Icon name="x" size={14} /></button>}
          <kbd className="sr-esc" onClick={close}>esc</kbd>
        </div>
        {s && (
          <div className="sr-chips" role="tablist">
            <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'on' : ''} onClick={() => setTab('all')}>{t('전체')} {total}</button>
            {SECTIONS.map((x) => (
              <button key={x.kind} role="tab" aria-selected={tab === x.kind} className={tab === x.kind ? 'on' : ''} disabled={!rows[x.kind].length} onClick={() => setTab(x.kind)}>
                {t(x.label)} {rows[x.kind].length}
              </button>
            ))}
          </div>
        )}
        <div className="sr-body" ref={listRef}>
          {!s && <p className="sr-empty">{t('찾을 글자를 입력하세요')}</p>}
          {s && !total && <p className="sr-empty">{busy ? t('찾는 중…') : t('‘{q}’에 맞는 결과가 없어요', { q: s })}</p>}
          {shown.map((sec) => (
            <section key={sec.kind} className="sr-sec">
              <div className="sr-h">
                {t(sec.label)} <i>{sec.all}</i>
                {tab === 'all' && sec.all > FIRST && (
                  <button onClick={() => setMore(more === sec.kind ? null : sec.kind)}>{more === sec.kind ? t('접기') : t('모두 보기')}</button>
                )}
              </div>
              {sec.list.map((r) => {
                idx++
                const i = idx
                return (
                  <button key={r.key} className={'sr-row' + (i === cur ? ' sel' : '') + (r.kind === 'todo' && r.done ? ' dn' : '')} onMouseMove={() => i !== cur && setCur(i)} onClick={() => go(r)}>
                    <span className="sr-d">{shortDate(r.date)}</span>
                    {r.kind === 'event' && <>
                      <span className="sr-dot" data-cat={r.occ.category} />
                      <span className="sr-t"><Mark text={r.occ.title} q={s} />{r.occ.place && <small> · <Mark text={r.occ.place} q={s} /></small>}</span>
                      <span className="sr-m">{r.owner}{r.occ.repeat !== 'none' ? ' · ' + t('반복') : ''}</span>
                    </>}
                    {r.kind === 'todo' && <>
                      <span className={'sr-chk' + (r.done ? ' done' : '')} />
                      <span className="sr-t"><Mark text={r.text} q={s} /></span>
                    </>}
                    {r.kind === 'memo' && <span className="sr-t sr-soft"><Mark text={r.snip} q={s} /></span>}
                    {r.kind === 'chat' && <>
                      <span className="sr-t"><b className="sr-who">{r.who}</b>“<Mark text={r.m.body} q={s} />”</span>
                      <span className="sr-m">{r.where}</span>
                    </>}
                  </button>
                )
              })}
            </section>
          ))}
        </div>
        <div className="sr-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd>{t('이동')}</span>
          <span><kbd>↵</kbd>{t('열기')}</span>
          <span><kbd>⌘K</kbd>{t('어디서나 검색')}</span>
        </div>
      </div>
    </div>
  )
}
