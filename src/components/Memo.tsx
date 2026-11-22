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
  const { selected } = useUI()
  const [open, setOpen] = useState(false)
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
  // Esc 로 닫기
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) hide() }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [open])

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
          <button className="memo-hide" onClick={hide}>{t('숨기기')}<Icon name="chevD" size={14} /></button>
        </div>
        {mounted && (
          <Suspense fallback={<div className="memo-loading">{t('불러오는 중…')}</div>}>
            <MemoEditor date={selected} onStatus={(s, d) => { setStatus(s); if (d) setAt(d) }} onChange={(md) => setPreview(memoPreview(md))} />
          </Suspense>
        )}
        <StatusLine s={status} at={at} />
      </section>
    </>
  )
}

/** 휴대폰: 메모 탭 */
export function MemoTab() {
  const { selected } = useUI()
  const [status, setStatus] = useState<MemoStatus>('idle')
  const [at, setAt] = useState<Date>()
  return (
    <section className="panel-half memo-tab">
      <div className="panel-head"><MemoDateNav /></div>
      <Suspense fallback={<div className="memo-loading">{t('불러오는 중…')}</div>}>
        <MemoEditor date={selected} mobile onStatus={(s, d) => { setStatus(s); if (d) setAt(d) }} />
      </Suspense>
      <StatusLine s={status} at={at} />
    </section>
  )
}
