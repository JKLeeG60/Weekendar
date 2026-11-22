import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { addDays, fmtHead, todayStr } from '../lib/date'
import { getLang, t } from '../lib/i18n'
import { memoPreview } from '../lib/memo'
import type { MemoStatus } from './MemoEditor'
import { MiniCalendar } from './MiniCalendar'
import { Icon } from './ui'

/**
 * 날짜별 메모
 * - 데스크탑: 할 일 아래 "메모" 줄 → 누르면 오른쪽 칸 전체로 미끄러지듯 올라오고, 숨기기로 내려간다
 * - 휴대폰: 아래 "메모" 탭
 * - 날짜는 일정·할 일과 같은 날짜(selected)를 함께 쓴다
 */

// 편집기는 무거워서 메모를 열 때만 불러온다
const MemoEditor = lazy(() => import('./MemoEditor'))

/** 일정·할 일과 같은 날짜를 움직이는 줄 (메모 창 머리에 쓴다) */
function MemoDateNav({ hint }: { hint?: boolean }) {
  const { selected, setSelected } = useUI()
  const [cal, setCal] = useState(false)
  return (
    <div className="datenav memo-datenav">
      <button className="icon-btn" onClick={() => setSelected(addDays(selected, -1))} aria-label={t('전날')}><Icon name="chevL" /></button>
      <div className="datebtn-wrap">
        <button className="datebtn" onClick={() => setCal((v) => !v)} aria-haspopup="dialog" aria-expanded={cal}>{fmtHead(selected)}</button>
        {cal && <MiniCalendar selected={selected} onPick={(d) => { setSelected(d); setCal(false) }} onClose={() => setCal(false)} />}
      </div>
      <button className="icon-btn" onClick={() => setSelected(addDays(selected, 1))} aria-label={t('다음날')}><Icon name="chevR" /></button>
      {selected === todayStr() && <span className="today-tag">{t('오늘')}</span>}
      {hint && <small className="memo-samedate">{t('일정·할 일과 같은 날짜')}</small>}
    </div>
  )
}

/** 메모 검색 (모든 날짜). #태그를 누르면 이 화면이 태그로 열린다 */
function MemoSearch({ initial, onPick, onClose }: { initial: string; onPick: (date: string) => void; onClose: () => void }) {
  const { findMemos } = useStore()
  const [q, setQ] = useState(initial)
  const [rows, setRows] = useState<{ date: string; snip: string }[] | null>(null)
  const inp = useRef<HTMLInputElement>(null)
  useEffect(() => { inp.current?.focus(); inp.current?.select() }, [])
  // 타자를 멈추고 0.25초 뒤에 찾는다
  useEffect(() => {
    const s = q.trim()
    if (!s) { setRows(null); return }
    let alive = true
    const h = window.setTimeout(async () => {
      const found = await findMemos(s)
      if (!alive) return
      // #태그는 글자 경계까지 맞는 것만 (#고객 이 #고객사 에 걸리지 않게)
      const tag = /^#[^\s#]+$/.test(s) ? new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_\\-/])', 'u') : null
      setRows(found.filter((r) => !tag || tag.test(r.body)).map((r) => ({ date: r.date, snip: snippet(r.body, s) })))
    }, 250)
    return () => { alive = false; window.clearTimeout(h) }
  }, [q, findMemos])
  return (
    <div className="memo-search" onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
      <div className="ms-bar">
        <Icon name="search" size={16} />
        <input ref={inp} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('메모에서 찾기 (#태그도 돼요)')} aria-label={t('메모 검색')} />
        <button className="ms-close" onClick={onClose}>{t('닫기')}</button>
      </div>
      <div className="ms-list">
        {rows === null ? <p className="ms-empty">{t('모든 날짜의 메모에서 찾아요')}</p>
          : rows.length === 0 ? <p className="ms-empty">{t('찾는 메모가 없어요')}</p>
          : rows.map((r) => (
            <button key={r.date} className="ms-item" onClick={() => onPick(r.date)}>
              <b>{fmtHead(r.date)}</b>
              <span>{r.snip.split(/(\u0001[^\u0002]*\u0002)/).map((p, i) => p.startsWith('\u0001') ? <mark key={i}>{p.slice(1, -1)}</mark> : p)}</span>
            </button>
          ))}
      </div>
    </div>
  )
}

/** 찾은 글자 앞뒤 일부를 보여 준다 (찾은 부분은 \u0001…\u0002 로 감싸 표시) */
function snippet(body: string, q: string) {
  const plain = body.replace(/\[\[(\d{4}-\d{2}-\d{2})[^\]]*\]\]/g, '$1').replace(/^\s*(?:[-*+]\s(?:\[[ xX]\]\s)?|\d+\.\s|>\s?(?:\[![^\]]+\]\s?)?|#{1,6}\s)/gm, '').replace(/[*_~`=|]/g, '').replace(/\s+/g, ' ').trim()
  const i = plain.toLowerCase().indexOf(q.replace(/[\[\]]/g, '').toLowerCase())
  if (i < 0) return plain.slice(0, 80)
  const a = Math.max(0, i - 30), b = Math.min(plain.length, i + q.length + 50)
  return (a > 0 ? '…' : '') + plain.slice(a, i) + '\u0001' + plain.slice(i, i + q.length) + '\u0002' + plain.slice(i + q.length, b) + (b < plain.length ? '…' : '')
}

/** 저장 상태 한 줄 */
function StatusLine({ s, at }: { s: MemoStatus; at?: Date }) {
  const time = at ? at.toLocaleTimeString(getLang() === 'en' ? 'en-US' : 'ko-KR', { hour: 'numeric', minute: '2-digit' }) : ''
  const text =
    s === 'saving' ? t('저장 중…') :
    s === 'saved' ? t('자동 저장됨 · {time}', { time }) :
    s === 'error' ? t('저장하지 못했어요. 인터넷 연결을 확인해 주세요') :
    s === 'loading' ? t('불러오는 중…') : t('입력하면 자동으로 저장돼요')
  return <div className={'memo-status' + (s === 'error' ? ' err' : '')} role="status">{text}</div>
}

/** 데스크탑: 할 일 아래 "메모" 줄 + 올라오는 메모 창 */
export function MemoDock() {
  const { loadMemo } = useStore()
  const { selected, setSelected } = useUI()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState<string | null>(null) // 열려 있으면 찾는 글자
  const [mounted, setMounted] = useState(false) // 내려가는 동안에도 편집기를 잠시 남겨 둔다
  const [preview, setPreview] = useState('')
  const [status, setStatus] = useState<MemoStatus>('idle')
  const [at, setAt] = useState<Date>()
  const closeTimer = useRef<number | undefined>(undefined)

  // 닫혀 있을 때 줄에 보일 첫 줄 미리보기
  useEffect(() => {
    if (open) return
    let alive = true
    loadMemo(selected).then((md) => { if (alive) setPreview(memoPreview(md)) })
    return () => { alive = false }
  }, [selected, open, loadMemo])

  const show = () => { window.clearTimeout(closeTimer.current); setMounted(true); requestAnimationFrame(() => setOpen(true)) }
  const hide = () => { setOpen(false); closeTimer.current = window.setTimeout(() => setMounted(false), 320) }
  // 검색 결과에서 메모를 누르면 그날 메모 창을 연다
  useEffect(() => {
    const h = () => show()
    window.addEventListener('wk:memo-open', h)
    return () => window.removeEventListener('wk:memo-open', h)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  // Esc 로 닫기
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]') && !e.defaultPrevented && search === null) hide() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open, search])

  return (
    <>
      <button className="memo-bar" onClick={show} aria-expanded={open} aria-controls="memo-sheet">
        <b>{t('메모')}</b>
        <span className="memo-pv">{preview || t('이 날의 메모를 적어 보세요')}</span>
        <Icon name="chevU" size={16} />
      </button>
      <section id="memo-sheet" className={'memo-sheet' + (open ? ' open' : '')} aria-hidden={!open} aria-label={t('메모')}>
        <div className="memo-head">
          <button className="memo-title" onClick={hide} title={t('메모 숨기기')}>{t('메모')}</button>
          <MemoDateNav hint />
          <button className="icon-btn memo-find" onClick={() => setSearch('')} aria-label={t('메모 검색')} title={t('메모 검색')}><Icon name="search" size={17} /></button>
          <button className="memo-hide" onClick={hide}>{t('숨기기')}<Icon name="chevD" size={14} /></button>
        </div>
        {mounted && (
          <Suspense fallback={<div className="memo-loading">{t('불러오는 중…')}</div>}>
            <MemoEditor
              date={selected}
              onStatus={(s, d) => { setStatus(s); if (d) setAt(d) }}
              onChange={(md) => setPreview(memoPreview(md))}
              onOpenDate={(d) => setSelected(d)}
              onTag={(tag) => setSearch(tag)}
            />
          </Suspense>
        )}
        {search !== null && <MemoSearch key={search} initial={search} onPick={(d) => { setSelected(d); setSearch(null) }} onClose={() => setSearch(null)} />}
        <StatusLine s={status} at={at} />
      </section>
    </>
  )
}

/** 휴대폰: 메모 탭 */
export function MemoTab() {
  const { selected, setSelected } = useUI()
  const [status, setStatus] = useState<MemoStatus>('idle')
  const [at, setAt] = useState<Date>()
  const [search, setSearch] = useState<string | null>(null)
  return (
    <section className="panel-half memo-tab">
      <div className="panel-head">
        <MemoDateNav />
        <button className="icon-btn memo-find" onClick={() => setSearch('')} aria-label={t('메모 검색')}><Icon name="search" size={18} /></button>
      </div>
      <Suspense fallback={<div className="memo-loading">{t('불러오는 중…')}</div>}>
        <MemoEditor date={selected} mobile onStatus={(s, d) => { setStatus(s); if (d) setAt(d) }} onOpenDate={(d) => setSelected(d)} onTag={(tag) => setSearch(tag)} />
      </Suspense>
      {search !== null && <MemoSearch key={search} initial={search} onPick={(d) => { setSelected(d); setSearch(null) }} onClose={() => setSearch(null)} />}
      <StatusLine s={status} at={at} />
    </section>
  )
}
