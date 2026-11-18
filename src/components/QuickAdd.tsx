import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { parseQuick } from '../lib/quickParse'
import { fmtMonthDay, fmtTime } from '../lib/date'
import { CATEGORY_LABEL } from '../lib/types'
import { t } from '../lib/i18n'
import { Icon } from './ui'

/**
 * 빠른 입력 (Space): 한 줄로 쓰면 일정인지 할 일인지 판단해서 바로 추가
 * - Enter 저장 · Tab 일정↔할 일 · ⌘/Ctrl+Enter 일정 창에서 자세히 고치기 · Esc 닫기
 * - 내 일정·할 일만 추가 (팀장 일정은 요청을 거쳐야 하므로 여기서는 하지 않음)
 */
export function QuickAddModal() {
  const { addEvent, addTodo } = useStore()
  const { closeModal, openModal, showToast, setSelected } = useUI()
  const [text, setText] = useState('')
  const [force, setForce] = useState<'event' | 'todo' | null>(null)
  const [scroll, setScroll] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const r = useMemo(() => parseQuick(text), [text])
  const kind = force ?? r.kind
  // 일정으로 바꿨는데 시간이 없으면 09:00–10:00
  const start = r.start ?? '09:00'
  const end = r.end ?? '10:00'
  const ready = r.title.length > 0

  useEffect(() => { input.current?.focus() }, [])
  // Esc 로 닫기 (대화창 등 다른 창이 먼저 닫히지 않게 먼저 가로챔)
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); closeModal() } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [closeModal])

  function save() {
    if (!ready) return
    if (kind === 'todo') {
      addTodo(r.title, r.date, r.priority)
      showToast(t('할 일에 추가했어요'))
    } else {
      const multi = !!r.endDate
      addEvent({
        title: r.title, date: r.date, endDate: multi ? r.endDate : undefined,
        start: multi ? '00:00' : start, end: multi ? '23:59' : end,
        place: r.place ?? '', category: r.category, shared: r.shared, repeat: 'none',
      })
      showToast(r.shared ? t('일정을 저장했어요. 팀 표에 공유됩니다.') : t('일정을 저장했어요. 나만 볼 수 있습니다.'))
    }
    setSelected(r.date) // 추가한 날로 이동해서 바로 보이게
    closeModal()
  }

  /** 일정 창을 열어 자세히 고치기 (내용은 채워서) */
  function detail() {
    if (kind === 'todo') { save(); return }
    openModal({
      type: 'event', date: r.date, start: r.endDate ? undefined : start, title: r.title, shared: r.shared,
      draft: { end, place: r.place ?? '', category: r.category, endDate: r.endDate },
    })
  }

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return // 한글 조합 중에는 무시
    if (e.key === 'Tab') { e.preventDefault(); setForce(kind === 'event' ? 'todo' : 'event') }
    else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); detail() }
    else if (e.key === 'Enter') { e.preventDefault(); save() }
  }

  // 알아들은 부분 강조 (입력칸 뒤에 같은 글자를 깔고 배경만 칠한다)
  const pieces: { s: string; hl: boolean }[] = []
  let at = 0
  for (const [a, b] of [...r.marks].sort((x, y) => x[0] - y[0])) {
    if (a > at) pieces.push({ s: text.slice(at, a), hl: false })
    pieces.push({ s: text.slice(Math.max(a, at), b), hl: true })
    at = Math.max(at, b)
  }
  if (at < text.length) pieces.push({ s: text.slice(at), hl: false })

  const why = {
    time: t('시간이 있어서 일정으로 넣어요'),
    range: t('기간이 있어서 여러 날 일정으로 넣어요'),
    absence: t('부재 일정이라 일정으로 넣어요'),
    notime: t('시간이 없어서 할 일로 넣어요'),
  }[r.reason]

  return createPortal(
    <>
      <div className="qa-scrim" onPointerDown={closeModal} />
      <div className="qa" role="dialog" aria-label={t('빠른 입력')}>
        <div className="qa-in">
          <Icon name="plus" size={20} />
          <div className="qa-field">
            <div className="qa-mirror" aria-hidden="true" style={{ transform: `translateX(${-scroll}px)` }}>
              {pieces.map((p, i) => (p.hl ? <mark key={i}>{p.s}</mark> : <span key={i}>{p.s}</span>))}
            </div>
            <input
              ref={input}
              value={text}
              onChange={(e) => { setText(e.target.value); setForce(null) }}
              onScroll={(e) => setScroll(e.currentTarget.scrollLeft)}
              onKeyDown={onKey}
              placeholder={t('예) 내일 3시 고객사 미팅 @본사 · 금요일까지 보고서 제출')}
              aria-label={t('빠른 입력')}
              spellCheck={false}
            />
          </div>
          <div className="qa-kind" role="radiogroup" aria-label={t('종류')}>
            <button role="radio" aria-checked={kind === 'event'} className={kind === 'event' ? 'on' : ''} onClick={() => { setForce('event'); input.current?.focus() }}>{t('일정')}</button>
            <button role="radio" aria-checked={kind === 'todo'} className={kind === 'todo' ? 'on' : ''} onClick={() => { setForce('todo'); input.current?.focus() }}>{t('할 일')}</button>
          </div>
        </div>

        {text.trim() && (
          <div className="qa-pv">
            {kind === 'event' ? (
              <>
                <Row k={t('날짜')} v={r.endDate ? `${fmtMonthDay(r.date)} – ${fmtMonthDay(r.endDate)} · ${t('종일')}` : fmtMonthDay(r.date)} />
                {!r.endDate && <Row k={t('시간')} v={`${fmtTime(start)} – ${fmtTime(end)}${r.start ? '' : ' · ' + t('시간을 정하지 않아 기본값')}`} />}
                <Row k={t('제목')} v={<b>{r.title || <span className="qa-need">{t('제목을 입력하세요')}</span>}</b>} />
                {r.place && <Row k={t('장소')} v={r.place} />}
                <Row k={t('종류')} v={<span className="qa-chip" data-cat={r.category}>{t(CATEGORY_LABEL[r.category])}</span>} />
                <Row k={t('공유')} v={r.shared ? t('팀에 공유 (끄려면 "나만" 입력)') : t('나만 보기')} />
              </>
            ) : (
              <>
                <Row k={t('날짜')} v={fmtMonthDay(r.date)} />
                <Row k={t('내용')} v={<b>{r.title || <span className="qa-need">{t('내용을 입력하세요')}</span>}</b>} />
                {r.priority && <Row k={t('중요')} v={t('깃발 표시')} />}
              </>
            )}
            <p className="qa-why">{force ? t('직접 바꿨어요') : why} · {t('Tab 으로 일정 ↔ 할 일')}</p>
          </div>
        )}

        <div className="qa-foot">
          <span><kbd>Enter</kbd>{t('저장')}</span>
          <span><kbd>Tab</kbd>{t('일정 ↔ 할 일')}</span>
          <span><kbd>{/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl'} Enter</kbd>{t('자세히 고치기')}</span>
          <span><kbd>Esc</kbd>{t('닫기')}</span>
          <button className="qa-save" disabled={!ready} onClick={save}>{kind === 'event' ? t('내 일정에 추가') : t('할 일에 추가')}</button>
        </div>
      </div>
    </>,
    document.body,
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="qa-row"><span className="k">{k}</span><span className="v">{v}</span></div>
}
