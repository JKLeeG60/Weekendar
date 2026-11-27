import { useState } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { t } from '../lib/i18n'
import { addDays, holidayName, isWeekend, todayStr } from '../lib/date'
import type { Absence, AbsenceKind, AutoApprove } from '../lib/types'
import {
  absenceLabel, absenceWhen, canApprove, countDays, DEFAULT_LEAVE, deducts, isHalf, KIND_LABEL, LEAVE_KINDS, leaveSummary,
} from '../lib/absence'
import { Avatar, Icon, Modal } from './ui'
import { PickerField } from './Modals'

type Tab = 'leave' | 'trip' | 'team'
const STATUS_LABEL = { pending: '승인 대기', approved: '승인', rejected: '반려', canceled: '취소' } as const
/** 숫자를 "1.5" · "2" 처럼 */
const num = (n: number) => String(Math.round(n * 10) / 10)

/** 다음 평일 (주말·공휴일 건너뜀) */
function nextWorkday(from = addDays(todayStr(), 1)) {
  let d = from
  while (isWeekend(d) || holidayName(d)) d = addDays(d, 1)
  return d
}

/* ───────── 내 목록 → 부재 관리 ───────── */
export function AbsenceModal({ tab: tab0 }: { tab?: Tab }) {
  const { db, me, myMember, absences } = useStore()
  const { closeModal } = useUI()
  const approver = !!myMember && (myMember.role === 'leader' || myMember.isAdmin)
  const toApprove = absences.filter((a) => canApprove(db.members, me?.id, a))
  const [tab, setTab] = useState<Tab>(tab0 ?? (toApprove.length ? 'team' : 'leave'))
  const [form, setForm] = useState<'leave' | 'trip' | null>(null)

  if (form) return <AbsenceForm trip={form === 'trip'} onBack={() => setForm(null)} />
  return (
    <Modal title={t('부재 관리')} onClose={closeModal} width={520} className="abs-modal">
      <div className="theme-seg abs-seg" role="tablist">
        <button role="tab" aria-selected={tab === 'leave'} className={tab === 'leave' ? 'on' : ''} onClick={() => setTab('leave')}>{t('휴가')}</button>
        <button role="tab" aria-selected={tab === 'trip'} className={tab === 'trip' ? 'on' : ''} onClick={() => setTab('trip')}>{t('출장')}</button>
        {approver && (
          <button role="tab" aria-selected={tab === 'team'} className={tab === 'team' ? 'on' : ''} onClick={() => setTab('team')}>
            {t('팀원')}{toApprove.length > 0 && <span className="abs-count">{toApprove.length}</span>}
          </button>
        )}
      </div>
      {tab === 'leave' && <LeaveTab onNew={() => setForm('leave')} />}
      {tab === 'trip' && <TripTab onNew={() => setForm('trip')} />}
      {tab === 'team' && approver && <TeamTab />}
    </Modal>
  )
}

/** 휴가 탭: 남은 연차 + 올해 기록 */
function LeaveTab({ onNew }: { onNew: () => void }) {
  const { me, myMember, absences } = useStore()
  const year = todayStr().slice(0, 4)
  const s = leaveSummary(absences, me?.id ?? '', myMember?.teamId, myMember?.leaveTotal ?? DEFAULT_LEAVE, year)
  const mine = absences.filter((a) => a.userId === me?.id && a.kind !== 'trip' && a.date >= `${year}-01-01`).sort((a, b) => b.date.localeCompare(a.date))
  const pct = (n: number) => `${Math.max(0, Math.min(100, (n / Math.max(s.total, 0.5)) * 100))}%`
  return (
    <div className="abs-body">
      <div className="abs-sum">
        <div className="abs-sum-top"><span>{t('{y}년 연차', { y: year })}</span><span>{t('총 {n}일', { n: num(s.total) })}</span></div>
        <div className="abs-big">{t('{n}일', { n: num(s.left) })} <small>{t('남음')}</small></div>
        <div className="abs-bar" aria-hidden><i className="used" style={{ width: pct(s.used) }} /><i className="wait" style={{ width: pct(s.pending) }} /></div>
        <div className="abs-legend"><span><i className="used" />{t('사용 {n}일', { n: num(s.used) })}</span>{s.pending > 0 && <span><i className="wait" />{t('승인 대기 {n}일', { n: num(s.pending) })}</span>}</div>
      </div>
      <button className="btn primary abs-new" onClick={onNew}><Icon name="plus" size={16} /> {t('휴가 신청')}</button>
      <div className="menu-label">{t('{y}년 기록', { y: year })}</div>
      {mine.length === 0 ? <p className="abs-empty">{t('아직 휴가 기록이 없어요.')}</p> : mine.map((a) => <AbsenceRow key={a.id} a={a} />)}
    </div>
  )
}

/** 출장 탭: 올해 횟수 · 가장 많이 간 곳 + 다가오는 / 지난 출장 */
function TripTab({ onNew }: { onNew: () => void }) {
  const { me, absences } = useStore()
  const today = todayStr()
  const year = today.slice(0, 4)
  const mine = absences.filter((a) => a.userId === me?.id && a.kind === 'trip')
  const done = mine.filter((a) => a.status === 'approved' && a.date.startsWith(year))
  const places = new Map<string, number>()
  done.forEach((a) => places.set(a.place, (places.get(a.place) ?? 0) + 1))
  const top = [...places.entries()].sort((a, b) => b[1] - a[1])[0]
  const upcoming = mine.filter((a) => (a.endDate ?? a.date) >= today && (a.status === 'pending' || a.status === 'approved')).sort((a, b) => a.date.localeCompare(b.date))
  const past = mine.filter((a) => !upcoming.includes(a)).sort((a, b) => b.date.localeCompare(a.date))
  return (
    <div className="abs-body">
      <div className="abs-sum abs-trip-sum">
        <div><span>{t('올해 출장')}</span><div className="abs-big">{t('{n}회', { n: done.length })} <small>· {t('{n}일', { n: num(done.reduce((s, a) => s + a.days, 0)) })}</small></div></div>
        <div><span>{t('가장 많이 간 곳')}</span><div className="abs-mid">{top ? t('{place} {n}회', { place: top[0], n: top[1] }) : '–'}</div></div>
      </div>
      <button className="btn primary abs-new" onClick={onNew}><Icon name="plus" size={16} /> {t('출장 신청')}</button>
      <div className="menu-label">{t('다가오는 출장')}</div>
      {upcoming.length === 0 ? <p className="abs-empty">{t('예정된 출장이 없어요.')}</p> : upcoming.map((a) => <AbsenceRow key={a.id} a={a} />)}
      {past.length > 0 && <div className="menu-label">{t('지난 출장')}</div>}
      {past.map((a) => <AbsenceRow key={a.id} a={a} />)}
    </div>
  )
}

/** 신청 한 줄: 기간 · 종류 / 사유 · 상태 (+ 취소) */
function AbsenceRow({ a, who }: { a: Absence; who?: string }) {
  const { cancelAbsence, me } = useStore()
  const { showToast } = useUI()
  const today = todayStr()
  const mine = a.userId === me?.id
  const cancelable = mine && (a.status === 'pending' || (a.status === 'approved' && (a.endDate ?? a.date) >= today))
  const sub = a.status === 'rejected' && a.rejectReason ? t('반려 · "{r}"', { r: a.rejectReason }) : a.reason
  const days = a.kind === 'trip' ? (a.endDate && a.endDate > a.date ? t('{n}일', { n: num(a.days) }) : t('당일')) : ''
  return (
    <div className={'abs-row ' + a.status} data-kind={a.kind}>
      <span className="abs-dot" />
      <div className="abs-row-main">
        <b>{who ? `${who} · ` : ''}{absenceWhen(a)} · {a.kind === 'trip' ? a.place : absenceLabel(a)}</b>
        {(sub || days) && <small>{[sub, days].filter(Boolean).join(' · ')}</small>}
      </div>
      <span className={'abs-st ' + a.status}>{t(STATUS_LABEL[a.status])}{a.auto && a.status === 'approved' ? ` · ${t('자동')}` : ''}</span>
      {cancelable && (
        <button className="link-btn abs-cancel" onClick={async () => {
          if (!window.confirm(a.status === 'approved' ? t('승인된 신청을 취소할까요? 팀 일정에서도 지워져요.') : t('신청을 취소할까요?'))) return
          const e = await cancelAbsence(a.id)
          showToast(e || t('신청을 취소했어요.'))
        }}>{t('취소')}</button>
      )}
    </div>
  )
}

/** 팀원 탭 (팀장·관리자): 승인할 신청 + 팀원 연차 */
function TeamTab() {
  const { db, me, team, tableMembers, absences, userOf, setLeaveTotal, setAutoApprove } = useStore()
  const toApprove = absences.filter((a) => canApprove(db.members, me?.id, a)).sort((a, b) => a.date.localeCompare(b.date))
  const today = todayStr()
  const upcoming = absences.filter((a) => a.status === 'approved' && (a.endDate ?? a.date) >= today).sort((a, b) => a.date.localeCompare(b.date))
  const mode = team?.autoApprove ?? 'none'
  return (
    <div className="abs-body">
      {mode !== 'none' && (
        <p className="abs-auto">
          {t(mode === 'all' ? '휴가·출장 자동 승인이 켜져 있어요' : mode === 'trip' ? '출장 자동 승인이 켜져 있어요' : '휴가 자동 승인이 켜져 있어요')}
          <button className="link-btn" onClick={() => setAutoApprove('none')}>{t('끄기')}</button>
        </p>
      )}
      <div className="menu-label">{t('승인할 신청 {n}건', { n: toApprove.length })}</div>
      {toApprove.length === 0 ? <p className="abs-empty">{t('기다리는 신청이 없어요.')}</p> : toApprove.map((a) => <DecideCard key={a.id} a={a} />)}
      {upcoming.length > 0 && <div className="menu-label">{t('다가오는 팀 부재')}</div>}
      {upcoming.slice(0, 8).map((a) => <AbsenceRow key={a.id} a={a} who={userOf(a.userId).name} />)}
      <div className="menu-label">{t('팀원 연차')}</div>
      <div className="abs-team">
        {tableMembers.map((m) => {
          const s = leaveSummary(absences, m.userId, m.teamId, m.leaveTotal ?? DEFAULT_LEAVE)
          return (
            <div key={m.userId} className="abs-mem">
              <Avatar name={userOf(m.userId).name} size={26} />
              <span className="abs-mem-name">{userOf(m.userId).name}</span>
              <span className="abs-mem-left">{t('{n}일 남음', { n: num(s.left) })}</span>
              <label className="abs-total" title={t('총 연차')}>
                <input
                  type="number" min={0} max={100} step={0.5} defaultValue={s.total} aria-label={t('{name} 총 연차', { name: userOf(m.userId).name })}
                  // 입력이 끝날 때 저장
                  onBlur={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v) && v >= 0 && v <= 100 && v !== s.total) setLeaveTotal(m.userId, v) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                />
                <span>{t('일')}</span>
              </label>
            </div>
          )
        })}
      </div>
      <p className="hint">{t('총 연차를 바꾸면 그 팀원의 남은 연차가 다시 계산돼요.')}</p>
    </div>
  )
}

/** 승인·반려 카드 (부재 관리 · 알림창) */
export function DecideCard({ a, onDone }: { a: Absence; onDone?: () => void }) {
  const { absences, decideAbsence, userOf } = useStore()
  const { showToast } = useUI()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  // 같은 기간에 이미 부재 중인 팀원 수
  const end = a.endDate ?? a.date
  const others = new Set(absences.filter((x) => x.id !== a.id && x.userId !== a.userId && x.status === 'approved' && x.date <= end && (x.endDate ?? x.date) >= a.date).map((x) => x.userId)).size
  const decide = async (ok: boolean) => {
    const e = await decideAbsence(a.id, ok, ok ? undefined : reason.trim() || undefined)
    showToast(e || (ok ? t('승인했어요. 팀 일정에 반영돼요.') : t('반려했어요.')))
    onDone?.()
  }
  return (
    <div className="abs-card" data-kind={a.kind}>
      <span className="abs-dot" />
      <div className="abs-row-main">
        <b>{userOf(a.userId).name} · {a.kind === 'trip' ? t('{place} 출장', { place: a.place }) : absenceLabel(a)}</b>
        <small>{absenceWhen(a)}{a.reason ? ` · ${a.reason}` : ''}{others ? ` · ${t('그 기간 부재 {n}명', { n: others })}` : ''}</small>
        {rejecting ? (
          <div className="req-reject">
            <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('반려 사유 (선택)')} />
            <div className="row-end">
              <button className="btn small ghost" onClick={() => setRejecting(false)}>{t('취소')}</button>
              <button className="btn small danger" onClick={() => void decide(false)}>{t('반려 확정')}</button>
            </div>
          </div>
        ) : (
          <div className="row-end">
            <button className="btn small ghost" onClick={() => setRejecting(true)}>{t('반려')}</button>
            <button className="btn small primary" onClick={() => void decide(true)}>{t('승인')}</button>
          </div>
        )}
      </div>
    </div>
  )
}

/* ───────── 휴가·출장 신청 창 ───────── */
function AbsenceForm({ trip, onBack }: { trip: boolean; onBack: () => void }) {
  const { me, myMember, absences, requestAbsence, team, db } = useStore()
  const { closeModal, showToast } = useUI()
  const [kind, setKind] = useState<AbsenceKind>(trip ? 'trip' : 'annual')
  const [date, setDate] = useState(nextWorkday)
  const [end, setEnd] = useState(date)
  const [place, setPlace] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const half = isHalf(kind)
  const endDate = half || end <= date ? undefined : end
  const days = countDays(kind, date, endDate)
  const s = leaveSummary(absences, me?.id ?? '', myMember?.teamId, myMember?.leaveTotal ?? DEFAULT_LEAVE, date.slice(0, 4))
  const short = deducts(kind) && days > s.left
  const ok = !busy && !short && days > 0 && (!trip || !!place.trim())
  // 승인할 사람 (팀장, 팀장 본인이면 관리자)
  const approver = db.members.find((m) => m.teamId === myMember?.teamId && m.userId !== me?.id && m.role === 'leader')
    ?? db.members.find((m) => m.teamId === myMember?.teamId && m.userId !== me?.id && m.isAdmin)
  const auto = myMember?.isAdmin || !approver || (team?.autoApprove === 'all' || (team?.autoApprove === 'trip' && trip) || (team?.autoApprove === 'leave' && !trip))
  const approverName = approver ? db.users.find((u) => u.id === approver.userId)?.name : ''
  const submit = async () => {
    if (!ok) return
    setBusy(true)
    const e = await requestAbsence({ kind, date, endDate, place, reason })
    setBusy(false)
    if (e) { setErr(e); return }
    closeModal()
    showToast(auto ? t(trip ? '출장이 등록됐어요. 팀 일정에 반영돼요.' : '휴가가 등록됐어요. 팀 일정에 반영돼요.') : t('{name}님에게 승인을 요청했어요.', { name: approverName ?? '' }))
  }
  return (
    <Modal
      title={trip ? t('출장 신청') : t('휴가 신청')}
      onClose={closeModal}
      width={460}
      className="abs-form"
      footer={
        <>
          <span className="abs-approver left">{auto ? t('바로 승인돼요') : t('승인자 · {name}', { name: approverName ?? '' })}</span>
          <button className="btn ghost" onClick={onBack}>{t('뒤로')}</button>
          <button className="btn primary" disabled={!ok} onClick={() => void submit()}>{t('신청')}</button>
        </>
      }
    >
      <div className="form">
        {!trip && (
          <div className="seg abs-kinds" role="radiogroup" aria-label={t('종류')}>
            {LEAVE_KINDS.map((k) => (
              <button key={k} type="button" role="radio" aria-checked={kind === k} data-cat={isHalf(k) ? 'halfday' : 'leave'} className={'seg-item' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}>{t(KIND_LABEL[k])}</button>
            ))}
          </div>
        )}
        {trip && <input className="title-input" autoFocus data-autofocus value={place} onChange={(e) => setPlace(e.target.value)} placeholder={t('출장지 (예: 대구)')} />}
        <div className="group">
          <div className="gr">
            <span>{half ? t('날짜') : t('시작')}</span>
            <span className="pills"><PickerField kind="date" value={date} onChange={(v) => { setDate(v); if (end < v) setEnd(v) }} label={t('시작 날짜')} /></span>
          </div>
          {!half && (
            <div className="gr">
              <span>{t('종료')}</span>
              <span className="pills"><PickerField kind="date" value={end < date ? date : end} min={date} onChange={setEnd} label={t('종료 날짜')} /></span>
            </div>
          )}
          <div className="gr">
            <span>{t('일수')}</span>
            <span className="abs-days">
              {days === 0 ? t('평일이 없어요') : t('{n}일', { n: num(days) })}
              {deducts(kind) && <small className={short ? 'bad' : ''}>{t('남은 연차 {a}일 → {b}일', { a: num(s.left), b: num(s.left - days) })}</small>}
              {!deducts(kind) && !trip && <small>{t('연차에서 빠지지 않아요')}</small>}
            </span>
          </div>
        </div>
        <div className="group">
          <textarea className="assign-note" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={trip ? t('목적 (예: 거래처 제품 설명회)') : t('사유 (선택)')} rows={2} />
        </div>
        {short && <p className="error">{t('남은 연차가 부족해요')}</p>}
        {err && <p className="error">{err}</p>}
        <p className="hint">{trip ? t('승인되면 팀 일정에 출장으로 표시돼요.') : t('승인되면 팀 일정에 휴가로 표시되고, 주말·공휴일은 일수에서 빠져요.')}</p>
      </div>
    </Modal>
  )
}

/** 자동 승인 설정 (설정 창) */
export const AUTO_OPTIONS: [AutoApprove, string][] = [['all', '휴가·출장'], ['trip', '출장만'], ['leave', '휴가만']]
