import { useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { addDays, fmtHead, isoWeek, mondayOf, todayStr, dow, weekPill } from '../lib/date'
import { t } from '../lib/i18n'
import { Icon, Modal } from './ui'

/** "나만 보여요" 자물쇠 알약 */
function PrivateChip() {
  return (
    <span className="goal-lock">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <rect x="5" y="11" width="14" height="9" rx="2.5" />
        <path d="M8 11V8a4 4 0 018 0v3" />
      </svg>
      {t('나만 보여요')}
    </span>
  )
}

/** 지난주에 달성하지 못한 내 목표 (이번 주 목표가 아직 없을 때만 가져올 수 있다) */
function usePrevGoal(week: string) {
  const { db, me } = useStore()
  const mine = (db.goals ?? []).filter((g) => g.ownerId === me?.id)
  if (mine.some((g) => g.week === week)) return undefined
  const prev = mine.find((g) => g.week === addDays(week, -7))
  return prev && !prev.done ? prev : undefined
}

/** 작은 "지난주 목표 가져오기" 버튼 */
function CarryGoal({ week, onPick }: { week: string; onPick: (text: string) => void }) {
  const prev = usePrevGoal(week)
  if (!prev) return null
  return (
    <button type="button" className="goal-carry" onClick={() => onPick(prev.text)} title={prev.text}>
      {t('지난주 목표 가져오기')}
    </button>
  )
}

/** 선택한 날이 속한 주(월요일 기준)의 목표 한 개. 할 일 패널 맨 위에 보인다 */
export function WeekGoalSection() {
  const { db, me, setGoal, toggleGoal } = useStore()
  const { selected } = useUI()
  const week = mondayOf(selected)
  const goal = (db.goals ?? []).find((g) => g.ownerId === me?.id && g.week === week)
  const [text, setText] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  if (!me) return null

  // 목표가 없으면: 한 줄 추가 칸
  if (!goal) {
    return (
      <div className="goal-block">
        <div className="goal-head"><span>{t('이번 주 목표')}</span><PrivateChip /></div>
        <form
          className="goal-add"
          onSubmit={(e) => {
            e.preventDefault()
            if (!text.trim()) return
            setGoal(week, text)
            setText('')
          }}
        >
          <Icon name="plus" size={16} />
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('이번 주 목표 추가')} aria-label={t('이번 주 목표 추가')} maxLength={100} />
        </form>
        <CarryGoal week={week} onPick={(x) => setGoal(week, x)} />
      </div>
    )
  }

  // 목표가 있으면: 체크 + 글 (글을 누르면 고치기)
  const save = () => {
    setEditing(false)
    if (draft.trim() !== goal.text) setGoal(week, draft)
  }
  return (
    <div className="goal-block">
      <div className="goal-head"><span>{t('이번 주 목표')}</span><PrivateChip /></div>
      <div className={'goal-row' + (goal.done ? ' done' : '')}>
        <button className="check" role="checkbox" aria-checked={goal.done} onClick={() => toggleGoal(goal.id)} aria-label={goal.text}>
          {goal.done && <Icon name="check" size={13} />}
        </button>
        {editing ? (
          <input
            className="goal-edit"
            autoFocus
            value={draft}
            maxLength={100}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={save}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(false) }}
          />
        ) : (
          <button className="goal-text" onClick={() => { setDraft(goal.text); setEditing(true) }} title={t('눌러서 고치기')}>{goal.text}</button>
        )}
        <span className="goal-tag">{t('목표')}</span>
      </div>
    </div>
  )
}

/** 월요일(주 첫 접속) 카드 */
export function WeekStartModal() {
  const { db, me, setGoal, finishWeekCard } = useStore()
  const { closeModal } = useUI()
  const today = todayStr()
  const week = mondayOf(today)
  const old = (db.goals ?? []).find((g) => g.ownerId === me?.id && g.week === week)
  const [text, setText] = useState(old?.text ?? '')

  // 한 번이라도 보여준 순간 "봤음"으로 기록한다 (중간에 닫아도 이번 주엔 다시 뜨지 않음)
  useEffect(() => { finishWeekCard(week) }, [finishWeekCard, week])

  const start = () => {
    if (text.trim() !== (old?.text ?? '')) setGoal(week, text)
    closeModal()
  }

  return (
    <Modal
      title={t('새로운 한 주가 시작됐어요')}
      onClose={closeModal}
      width={440}
      className="weekstart"
      footer={
        <>
          <button className="btn ghost left" onClick={closeModal}>{t('나중에')}</button>
          <button className="btn primary" onClick={start} data-autofocus>{t('이번 주 시작하기')}</button>
        </>
      }
    >
      <div className="ws-eyebrow">{fmtHead(today)} · {weekPill(isoWeek(today))}</div>
      <div className="goal-head"><span>{t('이번 주 목표')}</span><PrivateChip /></div>
      <input
        className="ws-input"
        value={text}
        maxLength={100}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') start() }}
        placeholder={t('예: 신규 기능 시안 확정하기')}
        aria-label={t('이번 주 목표')}
      />
      <CarryGoal week={week} onPick={setText} />
    </Modal>
  )
}

/** 주 첫 접속(월~금)에 카드를 한 번 띄운다. 주소 뒤에 ?weekstart 를 붙이면 항상 띄운다 */
export function useAutoWeekStart() {
  const { me, myMember } = useStore()
  const { modal, openModal } = useUI()
  const done = useRef(false)
  useEffect(() => {
    if (done.current || modal) return
    if (!me || !myMember) return
    if (myMember.role !== 'leader' && myMember.role !== 'member') return
    const forced = new URLSearchParams(location.search).has('weekstart')
    const today = todayStr()
    const d = dow(today)
    // 처음 사용 안내가 먼저 끝나야 하고, 주말에는 띄우지 않는다
    if (!forced && (me.tutorialSeen === false || d === 0 || d === 6 || me.weekCardSeen === mondayOf(today))) return
    done.current = true
    openModal({ type: 'weekstart' })
  }, [me, myMember, modal, openModal])
}
