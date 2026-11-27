import { useEffect, useRef, useState } from 'react'
import { TeamUpModal } from './Onboarding'
import { AttendeeField, FreeFinder } from './Meeting'
import { fmtMin, inviteOf, toMin } from '../lib/attend'
import { disablePush, enablePush, isIOS, isStandalone, pushState, pushSupported, sendTestPush } from '../lib/push'
import { buildICS, downloadICS } from '../lib/ics'
import { inviteLink } from '../lib/invite'
import { useStore } from '../lib/store'
import { useUI, type ModalState } from '../lib/ui'
import { isMultiDay, occurrencesOn, spanLabel } from '../lib/events'
import { addDays, fmtDate, fmtHead, fmtLong, fmtMonthDay, fmtTime, holidayName, isWeekend, todayStr } from '../lib/date'
import { changedActive, confirmStatus, needsMyConfirm } from '../lib/confirm'
import { localize, Rich, t } from '../lib/i18n'
import { RETENTION, retentionLabel } from '../lib/chat'
import {
  CATEGORY_LABEL,
  type Category, type EventItem, type Occurrence, type Repeat, type Role,
} from '../lib/types'
import { Avatar, Icon, Modal, Switch } from './ui'
import { InstallModal, MailModal, MemberMenu, MonthModal } from './People'
import { MonthTipModal, TutorialModal } from './Tutorial'
import { WeekStartModal } from './WeekGoals'
import { SettingsModal } from './Settings'
import { QuickAddModal } from './QuickAdd'
import { ShortcutsModal } from './Shortcuts'
import { connectGcal, gcalStatus } from '../lib/gcal'

const CATS = Object.keys(CATEGORY_LABEL) as Category[]
const REPEAT_LABEL: Record<Repeat, string> = { none: '반복 안 함', daily: '매일', weekly: '매주', monthly: '매월' }
export const REMIND_OPTIONS: [number | undefined, string][] = [
  [undefined, '없음'], [0, '정각'], [5, '5분 전'], [10, '10분 전'], [15, '15분 전'], [30, '30분 전'],
  [60, '1시간 전'], [120, '2시간 전'], [180, '3시간 전'], [360, '6시간 전'], [720, '12시간 전'], [1440, '하루 전'],
]
/** 브라우저 알림 권한을 한 번만 물어본다 */
function askNotifyPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()
  } catch { /* 지원 안 하는 브라우저 */ }
}

export function Modals() {
  const { modal, layer } = useUI()
  return (
    <>
      <ModalSwitch modal={modal} />
      {/* 아래 창(예: 월간 일정) 위에 겹쳐 여는 창 */}
      {layer && <div className="layer"><ModalSwitch modal={layer} /></div>}
    </>
  )
}

function ModalSwitch({ modal }: { modal: ModalState }) {
  if (!modal) return null
  switch (modal.type) {
    case 'event': return <EventModal date={modal.date} start={modal.start} occ={modal.event} titleHint={modal.title} sharedHint={modal.shared} draft={modal.draft} />
    case 'detail': return <EventDetail occ={modal.occ} />
    case 'request': return <RequestModal mode={modal.mode} date={modal.date} occ={modal.occ} />
    case 'day': return <DayModal userId={modal.userId} date={modal.date} />
    case 'admin': return <AdminModal />
    case 'calendar': return <CalendarModal />
    case 'leave': return <LeaveModal />
    case 'teamup': return <TeamUpModal />
    case 'push': return <PushModal />
    case 'member': return <MemberMenu userId={modal.userId} x={modal.x} y={modal.y} />
    case 'month': return <MonthModal userId={modal.userId} date={modal.date} />
    case 'mail': return <MailModal userId={modal.userId} />
    case 'install': return <InstallModal />
    case 'tutorial': return <TutorialModal />
    case 'monthTip': return <MonthTipModal />
    case 'weekstart': return <WeekStartModal />
    case 'settings': return <SettingsModal />
    case 'quick': return <QuickAddModal />
    case 'shortcuts': return <ShortcutsModal />
  }
}

/* ───────── 내 일정 추가/수정 ───────── */
const addHour = (t: string) => {
  const m = Math.min(23 * 60 + 59, Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function EventModal({ date, start: startHint, occ, titleHint, sharedHint, draft }: { date: string; start?: string; occ?: Occurrence; titleHint?: string; sharedHint?: boolean; draft?: Partial<EventItem> }) {
  const { db, addEvent, updateEvent, deleteEvent, mode, me, solo } = useStore()
  const { closeModal, showToast } = useUI()
  const base: EventItem | undefined = occ ? db.events.find((e) => e.id === occ.baseId) : undefined
  const [title, setTitle] = useState(draft?.title ?? base?.title ?? titleHint ?? '')
  const [d, setD] = useState(draft?.date ?? base?.date ?? date)
  const [start, setStart] = useState(draft?.start ?? base?.start ?? startHint ?? '09:00')
  const [end, setEnd] = useState(draft?.end ?? base?.end ?? addHour(startHint ?? '09:00'))
  const [place, setPlace] = useState(draft?.place ?? base?.place ?? '')
  const [category, setCategory] = useState<Category>(draft?.category ?? base?.category ?? 'work')
  const [repeat, setRepeat] = useState<Repeat>(draft?.repeat ?? base?.repeat ?? 'none')
  const [shared, setShared] = useState(draft?.shared ?? base?.shared ?? sharedHint ?? true) // 기본값: 팀에 공유 ON
  const [remind, setRemind] = useState<number | undefined>(draft && 'remind' in draft ? draft.remind : base?.remind)
  // 구글 캘린더에 추가 (기본 꺼짐). 실서비스에서만 연결 상태를 확인한다 (연결 전이면 [연결] 버튼)
  const [gcal, setGcal] = useState(draft?.gcal ?? base?.gcal ?? false)
  const [linked, setLinked] = useState<boolean | null>(null)
  useEffect(() => {
    if (mode !== 'cloud') return
    gcalStatus().then((s) => setLinked(s.connected && !s.broken))
  }, [mode])
  // 여러 날(종일) 일정: 예) 월~수 출장
  const [multi, setMulti] = useState(draft ? !!draft.endDate : base ? isMultiDay(base) : false)
  const [endDate, setEndDate] = useState(draft?.endDate ?? (base?.endDate && base.endDate > base.date ? base.endDate : addDays(base?.date ?? date, 2)))
  const bad = !title.trim() || (multi ? endDate <= d : end <= start)
  // 회의 참석자 (나는 빼고). 여러 날 일정·혼자 쓰기에는 없다
  const [att, setAtt] = useState<string[]>((draft?.attendees ?? base?.attendees ?? []).map((a) => a.userId))
  const withAtt = !solo && !multi
  // 모두 비는 시간 화면 (창 안에서 넘어가는 화면)
  const [finding, setFinding] = useState(false)
  const [pick, setPick] = useState<{ date: string; start: number } | null>(null)
  const dur = Math.max(30, toMin(end) - toMin(start))

  function pickCategory(c: Category) {
    setCategory(c)
  }

  function save() {
    const data = multi
      ? { title: title.trim(), date: d, endDate, start: '00:00', end: '23:59', place: place.trim(), category, repeat: 'none' as Repeat, shared, remind: undefined, gcal }
      : { title: title.trim(), date: d, endDate: undefined, start, end, place: place.trim(), category, repeat, shared, remind, gcal }
    if (data.remind !== undefined) askNotifyPermission()
    // 참석자: 있거나 원래 있었을 때만 보낸다 (응답은 저장소가 그대로 지킨다)
    const people = withAtt ? att : []
    const attendees = people.length || base?.attendees?.length ? { attendees: people.map((u) => ({ userId: u, status: 'pending' as const })) } : {}
    void (base ? updateEvent(base.id, { ...data, ...attendees }) : addEvent({ ...data, ...attendees }))
    closeModal()
    const invited = people.filter((u) => !base?.attendees?.some((a) => a.userId === u)).length
    showToast(invited > 0 ? t('일정을 저장하고 {n}명에게 초대를 보냈어요.', { n: invited })
      : solo ? t('일정을 저장했어요.') : shared ? t('일정을 저장했어요. 팀 표에 공유됩니다.') : t('일정을 저장했어요. 나만 볼 수 있습니다.'))
  }

  // [연결]: 지금까지 쓴 내용을 잠깐 저장해 두고 구글 동의 화면으로 (돌아오면 토글이 켜진 채로 다시 열림)
  function linkGoogle() {
    const kept: Partial<EventItem> = multi
      ? { title, date: d, endDate, place, category, shared, gcal: true }
      : { title, date: d, start, end, place, category, repeat, shared, remind, gcal: true, attendees: att.map((u) => ({ userId: u, status: 'pending' as const })) }
    connectGcal({ type: 'event', date: d, event: occ, draft: kept }, me?.email)
  }

  // 모두 비는 시간: 고르면 날짜·시간을 채우고 일정 창으로 돌아간다
  if (finding) {
    return (
      <Modal
        title={t('모두 비는 시간')}
        onClose={closeModal}
        width={780}
        className="ff-modal"
        footer={
          <>
            <button className="btn ghost left" onClick={() => setFinding(false)}>‹ {t('일정으로')}</button>
            <button
              className="btn primary"
              disabled={!pick}
              onClick={() => {
                if (!pick) return
                setD(pick.date); setStart(fmtMin(pick.start)); setEnd(fmtMin(pick.start + dur)); setFinding(false)
              }}
            >
              {pick ? t('{date} {a}–{b}로 정하기', { date: fmtHead(pick.date), a: fmtMin(pick.start), b: fmtMin(pick.start + dur) }) : t('시간을 골라 주세요')}
            </button>
          </>
        }
      >
        <FreeFinder who={[me?.id ?? '', ...att]} dur={dur} skipId={base?.id} pick={pick} onPick={setPick} />
      </Modal>
    )
  }

  return (
    <Modal
      title={base ? t('일정 수정') : t('새로운 일정')}
      onClose={closeModal}
      footer={
        <>
          {base && (
            <button className="btn danger-ghost left" onClick={() => { deleteEvent(base.id); closeModal(); showToast(t('일정을 삭제했어요.')) }}>{t('삭제')}</button>
          )}
          <button className="btn ghost" onClick={closeModal}>{t('취소')}</button>
          <button className="btn primary" disabled={bad} onClick={save}>{base ? t('저장') : t('추가')}</button>
        </>
      }
    >
      <div className="form">
        <input className="title-input" autoFocus data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('제목 (예: 주간회의)')} />
        {/* 하루 일정의 날짜: 평소엔 누른 칸의 날짜 그대로, 바꾸고 싶을 때만 눌러서 변경 */}
        {!multi && <PickerField kind="date" value={d} onChange={setD} label={t('날짜')} variant="line" />}
        {withAtt && <AttendeeField value={att} onChange={setAtt} onFind={() => { setPick(null); setFinding(true) }} />}
        <div className="group">
          <div className="gr">
            <div className="gr-text">
              <span>{t('여러 날')}</span>
              <small>{multi ? t('하루 종일 일정으로, 기간 전체에 표시돼요') : t('휴가·출장처럼 며칠 이어지는 일정')}</small>
            </div>
            <Switch on={multi} onChange={(v) => { setMulti(v); if (v && endDate <= d) setEndDate(addDays(d, 2)) }} label={t('여러 날')} />
          </div>
          {/* 아이폰 캘린더처럼: 줄마다 오른쪽 끝에 맞춘 회색 알약 버튼 */}
          <div className="gr">
            <span>{t('시작')}</span>
            <span className="pills">
              {multi
                ? <PickerField kind="date" value={d} onChange={setD} label={t('시작 날짜')} />
                : <PickerField kind="time" value={start} onChange={setStart} label={t('시작 시간')} />}
            </span>
          </div>
          <div className="gr">
            <span>{t('종료')}</span>
            <span className="pills">
              {multi
                ? <PickerField kind="date" value={endDate} min={addDays(d, 1)} onChange={setEndDate} label={t('종료 날짜')} bad={endDate <= d} />
                : <PickerField kind="time" value={end} onChange={setEnd} label={t('종료 시간')} bad={end <= start} />}
            </span>
          </div>
          <label className="gr"><span>{t('장소')}</span><input value={place} onChange={(e) => setPlace(e.target.value)} placeholder={t('장소 추가')} /></label>
        </div>
        {multi ? endDate <= d && <p className="error">{t('종료 날짜는 시작 날짜 이후여야 해요.')}</p>
          : end <= start && <p className="error">{t('종료 시간은 시작 시간 이후여야 해요.')}</p>}
        <div className="group">
          <div className="gr col">
            <span>{t('카테고리')}</span>
            <div className="seg">
              {CATS.map((c) => (
                <button key={c} type="button" data-cat={c} className={'seg-item' + (category === c ? ' on' : '')} onClick={() => pickCategory(c)}>
                  {t(CATEGORY_LABEL[c])}
                </button>
              ))}
            </div>
          </div>
          {!multi && <label className="gr">
            <span>{t('반복')}</span>
            <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
              {(Object.keys(REPEAT_LABEL) as Repeat[]).map((r) => <option key={r} value={r}>{t(REPEAT_LABEL[r])}</option>)}
            </select>
          </label>}
          {!multi && <label className="gr">
            <span>{t('알림')}</span>
            <select value={remind === undefined ? '' : String(remind)} onChange={(e) => setRemind(e.target.value === '' ? undefined : Number(e.target.value))} aria-label={t('미리 알림')}>
              {REMIND_OPTIONS.map(([v, l]) => <option key={l} value={v === undefined ? '' : String(v)}>{t(l)}</option>)}
            </select>
          </label>}
          {/* 혼자 쓸 때는 공유할 팀이 없어 숨긴다 (나중에 팀이 되면 그대로 팀 표에 보이도록 켜 둔 채 저장) */}
          {!solo && <div className="gr">
            <div className="gr-text">
              <span>{t('팀에 공유')}</span>
              <small>{shared ? t('팀 주간표에 표시됩니다') : t('내 패널에만 표시됩니다')}</small>
            </div>
            <Switch on={shared} onChange={(v) => setShared(v)} label={t('팀에 공유')} />
          </div>}
          {mode === 'cloud' && linked !== true ? (
            <div className="gr">
              <div className="gr-text gcal-text">
                <span className="gcal-label"><GcalIcon />{t('구글 캘린더')}</span>
                <small>{t('연결하면 구글 캘린더에도 저장돼요')}</small>
              </div>
              <button className="btn small primary gcal-link" disabled={linked === null} onClick={linkGoogle}>{t('연결')}</button>
            </div>
          ) : (
            <div className="gr">
              <div className="gr-text">
                <span className="gcal-label"><GcalIcon />{t('구글 캘린더에 추가')}</span>
              </div>
              <Switch on={gcal} onChange={(v) => setGcal(v)} label={t('구글 캘린더에 추가')} />
            </div>
          )}
        </div>
        {base && base.repeat !== 'none' && <p className="hint">{t('반복 일정은 수정·삭제 시 모든 날짜에 적용됩니다.')}</p>}
      </div>
    </Modal>
  )
}

/* ───────── 일정 상세 ───────── */
function EventDetail({ occ }: { occ: Occurrence }) {
  const { me, myMember, userOf, db, deleteEvent, confirmEvent, respondInvite } = useStore()
  const { closeModal, openModal, showToast } = useUI()
  // 회의 초대: 내가 초대받았으면 참석 / 불참
  const inv = inviteOf(db.events.find((e) => e.id === occ.baseId) ?? occ, me?.id)
  const people = (db.events.find((e) => e.id === occ.baseId) ?? occ).attendees ?? []
  const answer = (s: 'accepted' | 'declined') => {
    void respondInvite(occ.baseId, s)
    showToast(s === 'accepted' ? t('참석으로 답했어요.') : t('불참으로 답했어요. {name}님에게 알렸어요.', { name: userOf(occ.ownerId).name }))
  }
  // 지금 보고 있는 팀에서의 역할 (여러 팀에 속할 수 있음)
  const owner = db.members.find((m) => m.userId === occ.ownerId && m.teamId === myMember?.teamId)
  const mine = occ.ownerId === me?.id
  const leaderEvent = owner?.role === 'leader'
  const canRequest = !mine && leaderEvent && myMember?.role === 'member'
  // 팀장이 일정을 바꿨을 때: 바뀐 내용, 확인 현황, 팀원의 "확인했어요" 버튼
  const base = db.events.find((e) => e.id === occ.baseId)
  const today = todayStr()
  const changed = !!base && leaderEvent && changedActive(base, occ.date, today)
  const needConfirm = !!base && needsMyConfirm(db, base, me?.id, occ.date, today)
  const status = base && changed ? confirmStatus(db, base) : null
  const [from, to] = (base?.changeText ?? '').split(' → ')
  const names = (ids: string[]) => ids.map((id) => userOf(id).name).join(', ')

  return (
    <Modal
      title={occ.title}
      big
      className="no-blur"
      onClose={closeModal}
      footer={
        inv ? (
          <>
            <span className="foot-note">{inv.status === 'pending' ? t('회의에 참석하나요?') : inv.status === 'accepted' ? t('참석으로 답했어요') : t('불참으로 답했어요')}</span>
            <button className={'btn nowrap ' + (inv.status === 'declined' ? 'danger' : 'danger-ghost')} onClick={() => answer('declined')} aria-pressed={inv.status === 'declined'}>{t('불참')}</button>
            <button className={'btn nowrap ' + (inv.status !== 'declined' ? 'primary' : 'ghost')} onClick={() => answer('accepted')} aria-pressed={inv.status === 'accepted'}>{t('참석')}</button>
          </>
        ) : mine ? (
          <>
            <button className="btn danger-ghost left" onClick={() => { deleteEvent(occ.baseId); closeModal(); showToast(t('일정을 삭제했어요.')) }}>{t('삭제')}</button>
            <button className="btn primary" onClick={() => openModal({ type: 'event', date: occ.date, event: occ })}>{t('수정')}</button>
          </>
        ) : canRequest ? (
          <>
            {!needConfirm && <span className="foot-note">{t('팀장이 동의하면 반영돼요')}</span>}
            <button className="btn danger-ghost nowrap" onClick={() => openModal({ type: 'request', mode: 'delete', date: occ.date, occ })}>{t('삭제 요청')}</button>
            <button className={'btn nowrap ' + (needConfirm ? 'ghost' : 'primary')} onClick={() => openModal({ type: 'request', mode: 'edit', date: occ.date, occ })}>{t('변경 요청')}</button>
            {needConfirm && <button className="btn primary nowrap" onClick={() => { confirmEvent(occ.baseId); showToast(t('확인했어요.')) }}>✅ {t('확인했어요')}</button>}
          </>
        ) : (
          <button className="btn ghost" onClick={closeModal}>{t('닫기')}</button>
        )
      }
    >
      <div className="detail" data-cat={occ.category}>
        <div className="detail-bar" />
        <div>
          <p className="detail-line"><Icon name="clock" size={15} /> {isMultiDay(occ) ? `${spanLabel(occ)} · ${t('종일')}` : `${fmtLong(occ.date)} · ${occ.start}–${occ.end}${occ.repeat !== 'none' ? ` · ${t(REPEAT_LABEL[occ.repeat] + ' 반복')}` : ''}`}</p>
          {occ.place && <p className="detail-line"><Icon name="pin" size={15} /> {occ.place}</p>}
          <p className="detail-line"><Icon name="users" size={15} /> {userOf(occ.ownerId).name}{owner?.role === 'leader' ? ` (${t('팀장')})` : ''} · {occ.shared ? t('팀에 공유') : t('나만 보기')}</p>
          {occ.gcal && occ.ownerId === me?.id && <p className="detail-line"><GcalIcon /> {t('구글 캘린더에도 저장된 일정')}</p>}
          <span className="cat-tag" data-cat={occ.category}>{t(CATEGORY_LABEL[occ.category])}</span>
          {/* 회의 참석자와 응답 */}
          {people.length > 0 && (
            <div className="att-list">
              <div className="att-row"><Avatar name={userOf(occ.ownerId).name} size={24} /><span className="att-name">{userOf(occ.ownerId).name}{occ.ownerId === me?.id ? ` (${t('나')})` : ''}</span><span className="att-st owner">{t('주최')}</span></div>
              {people.map((a) => (
                <div key={a.userId} className="att-row">
                  <Avatar name={userOf(a.userId).name} size={24} />
                  <span className="att-name">{userOf(a.userId).name}{a.userId === me?.id ? ` (${t('나')})` : ''}</span>
                  <span className={'att-st ' + a.status}>{a.status === 'accepted' ? t('참석') : a.status === 'declined' ? t('불참') : t('응답 대기')}</span>
                </div>
              ))}
            </div>
          )}
          {changed && base && (
            <div className="change-box">
              <p className="change-head">
                <span className="chg-tag">{t('변경')}</span>
                {base.changeText ? <><s>{from}</s> → <b>{to}</b></> : <span>{t('제목이나 장소가 바뀌었어요')}</span>}
              </p>
              {status && status.all.length > 0 && (
                <>
                  <p className="change-line">✅ {t('확인 {a} / {b}명', { a: status.done.length, b: status.all.length })}</p>
                  <div className="change-bar"><i style={{ width: `${(status.done.length / status.all.length) * 100}%` }} /></div>
                  {status.done.length > 0 && <p className="change-line sub">{t('확인 완료')}: {names(status.done)}</p>}
                  {status.waiting.length > 0 && <p className="change-line sub">{t('아직')}: {names(status.waiting)}</p>}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

/* ───────── 팀장 일정 변경 요청 ───────── */
function RequestModal({ mode, date, occ }: { mode: 'add' | 'edit' | 'delete'; date: string; occ?: Occurrence }) {
  const { createRequest, db, myMember, userOf } = useStore()
  const { closeModal, showToast } = useUI()
  const base = occ ? db.events.find((e) => e.id === occ.baseId) : undefined
  const [title, setTitle] = useState(occ?.title ?? '')
  const [d, setD] = useState(occ?.date ?? date)
  const [start, setStart] = useState(occ?.start ?? '10:00')
  const [end, setEnd] = useState(occ?.end ?? '11:00')
  const [place, setPlace] = useState(occ?.place ?? '')
  const [category, setCategory] = useState<Category>(occ?.category ?? 'meeting')
  // 여러 날 요청 (예: 팀장 교육 일정 월~수)
  const [multi, setMulti] = useState(base ? isMultiDay(base) : false)
  const [endDate, setEndDate] = useState(base?.endDate && base.endDate > base.date ? base.endDate : addDays(base?.date ?? date, 2))
  const leader = db.members.find((m) => m.role === 'leader' && m.teamId === myMember?.teamId)
  const del = mode === 'delete'
  const bad = !del && (!title.trim() || (multi ? endDate <= d : end <= start))
  const heading = t(mode === 'add' ? '팀장 일정 요청' : mode === 'edit' ? '팀장 일정 변경 요청' : '팀장 일정 삭제 요청')

  function submit() {
    createRequest({
      type: mode,
      eventId: base?.id,
      payload: multi
        ? { title: title.trim(), date: d, endDate, start: '00:00', end: '23:59', place: place.trim(), category }
        : { title: title.trim(), date: d, endDate: null, start, end, place: place.trim(), category },
    })
    closeModal()
    showToast(t('팀장에게 요청을 보냈어요. 동의하면 일정에 반영됩니다.'))
  }

  return (
    <Modal
      title={heading}
      onClose={closeModal}
      footer={
        <>
          <button className="btn ghost" onClick={closeModal}>{t('취소')}</button>
          <button className={'btn ' + (del ? 'danger' : 'primary')} disabled={bad} onClick={submit}>{del ? t('삭제 요청 보내기') : t('요청 보내기')}</button>
        </>
      }
    >
      <div className="form">
        <div className="to-line">
          <Avatar name={leader ? userOf(leader.userId).name : '?'} size={26} />
          <span><Rich text={t('<b>{name}</b> 팀장에게 전달', { name: leader ? userOf(leader.userId).name : '' })} /></span>
        </div>
        {del ? (
          <div className="detail" data-cat={occ?.category}>
            <div className="detail-bar" />
            <div>
              <h3>{occ?.title}</h3>
              <p className="detail-line"><Icon name="clock" size={15} /> {occ && isMultiDay(occ) ? `${spanLabel(occ)} · ${t('종일')}` : `${fmtLong(d)} · ${occ?.start}–${occ?.end}`}</p>
              {occ?.place && <p className="detail-line"><Icon name="pin" size={15} /> {occ.place}</p>}
            </div>
          </div>
        ) : (
          <>
            <input className="title-input" autoFocus data-autofocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('일정 (예: 신규 캠페인 킥오프)')} />
            {!multi && <PickerField kind="date" value={d} onChange={setD} label={t('날짜')} variant="line" />}
            <div className="group">
              <div className="gr">
                <div className="gr-text">
                  <span>{t('여러 날')}</span>
                  <small>{multi ? t('하루 종일 일정으로, 기간 전체에 표시돼요') : t('교육·출장처럼 며칠 이어지는 일정')}</small>
                </div>
                <Switch on={multi} onChange={(v) => { setMulti(v); if (v && endDate <= d) setEndDate(addDays(d, 2)) }} label={t('여러 날')} />
              </div>
              <div className="gr">
                <span>{t('시작')}</span>
                <span className="pills">
                  {multi
                    ? <PickerField kind="date" value={d} onChange={setD} label={t('시작 날짜')} />
                    : <PickerField kind="time" value={start} onChange={setStart} label={t('시작 시간')} />}
                </span>
              </div>
              <div className="gr">
                <span>{t('종료')}</span>
                <span className="pills">
                  {multi
                    ? <PickerField kind="date" value={endDate} min={addDays(d, 1)} onChange={setEndDate} label={t('종료 날짜')} bad={endDate <= d} />
                    : <PickerField kind="time" value={end} onChange={setEnd} label={t('종료 시간')} bad={end <= start} />}
                </span>
              </div>
              <label className="gr"><span>{t('장소')}</span><input value={place} onChange={(e) => setPlace(e.target.value)} placeholder={t('장소 추가')} /></label>
            </div>
            {multi ? endDate <= d && <p className="error">{t('종료 날짜는 시작 날짜 이후여야 해요.')}</p>
              : end <= start && <p className="error">{t('종료 시간은 시작 시간 이후여야 해요.')}</p>}
            <div className="group">
              <div className="gr col">
                <span>{t('카테고리')}</span>
                <div className="seg">
                  {CATS.map((c) => (
                    <button key={c} type="button" data-cat={c} className={'seg-item' + (category === c ? ' on' : '')} onClick={() => setCategory(c)}>
                      {t(CATEGORY_LABEL[c])}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {!multi && (isWeekend(d) || holidayName(d)) && <p className="hint">{t('선택한 날짜는 주말·공휴일이라 팀 표에는 표시되지 않아요.')}</p>}
          </>
        )}
        <p className="hint">{t('저장하면 팀장에게 알림이 전달되고, 팀장이 ‘동의’하면 팀장 일정에 반영되어 모든 팀원에게 보입니다.')}</p>
      </div>
    </Modal>
  )
}

/* ───────── 하루 전체 보기 ───────── */
function DayModal({ userId, date }: { userId: string; date: string }) {
  const { db, userOf } = useStore()
  const { closeModal, openModal } = useUI()
  const list = occurrencesOn(db.events.filter((e) => e.ownerId === userId && e.shared), date)
  return (
    <Modal title={`${userOf(userId).name} · ${fmtLong(date)}`} onClose={closeModal} width={420}>
      <ul className="agenda">
        {list.map((o) => (
          <li key={o.id}>
            <button className="agenda-item" data-cat={o.category} onClick={() => openModal({ type: 'detail', occ: o })}>
              <span className="agenda-time">{isMultiDay(o) ? t('종일') : o.start}</span>
              <span className="agenda-bar" />
              <span className="agenda-body">
                <span className="agenda-title">{o.title}</span>
                <span className="agenda-sub">{isMultiDay(o) ? spanLabel(o) : `${o.start}–${o.end}`}{o.place ? ` · ${o.place}` : ''}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  )
}

/* ───────── 대화 보관 기간 (팀 관리) ───────── */
const fmtBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(0.1, n / 1024 / 1024).toFixed(1)}MB` : n < 1024 ** 3 ? `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)}MB` : `${(n / 1024 ** 3).toFixed(2)}GB`)

function ChatRetention() {
  const { team, setChatRetention, teamChatUsage } = useStore()
  const { showToast } = useUI()
  const cur = team?.chatRetentionDays ?? null
  const [usage, setUsage] = useState<number | null>(null)
  useEffect(() => { teamChatUsage().then(setUsage) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const LIMIT = 500 * 1024 * 1024 // Weekendar 전체 DB 한도 (Supabase 무료 요금제)
  function pick(days: number | null) {
    if (days === cur) return
    // 기간을 줄이면 오래된 대화가 지워지므로 한 번 더 묻는다
    if (days !== null && (cur === null || days < cur) && !window.confirm(t('{period}이 지난 대화는 내일 새벽에 지워지고 되돌릴 수 없어요. 바꿀까요?', { period: retentionLabel(days) }))) return
    setChatRetention(days)
    showToast(t('대화 보관 기간을 {period}(으)로 바꿨어요.', { period: retentionLabel(days) }))
  }
  return (
    <section className="ret">
      <h3 className="section-label">{t('대화 보관 기간')}</h3>
      <div className="ret-seg" role="radiogroup" aria-label={t('대화 보관 기간')}>
        {RETENTION.map((r) => (
          <button key={r.label} role="radio" aria-checked={cur === r.days} className={cur === r.days ? 'on' : ''} onClick={() => pick(r.days)}>{t(r.label)}</button>
        ))}
      </div>
      <p className="ret-hint">
        {cur === null
          ? t('대화를 지우지 않고 계속 보관해요. 팀 대화·1:1·그룹방 모두 똑같이 적용돼요.')
          : t('{period}이 지난 대화는 매일 새벽 자동으로 지워져요. 팀 대화·1:1·그룹방 모두 똑같이 적용돼요.', { period: retentionLabel(cur) })}
      </p>
      {cur !== null && <p className="ret-hint">{t('공지로 등록한 메시지는 기간이 지나도 남아요. 지운 대화는 되돌릴 수 없어요.')}</p>}
      <div className="ret-use">
        <span>{t('우리 팀 대화 저장량')}</span>
        <span className="ret-bar" aria-hidden><i style={{ width: `${usage === null ? 0 : Math.max(1, Math.min(100, (usage / LIMIT) * 100))}%` }} /></span>
        <b>{usage === null ? '…' : fmtBytes(usage)}</b>
        <span>/ 500MB</span>
      </div>
    </section>
  )
}

/* ───────── 팀 관리 (관리자) ───────── */
function AdminModal() {
  const { db, me, team, userOf, renameTeam, updateMember, moveMember, removeMember, transferAdmin } = useStore()
  const { closeModal, showToast } = useUI()
  const [name, setName] = useState(team?.name ?? '')
  const [confirm, setConfirm] = useState<string | null>(null)
  const [roles, setRoles] = useState<Record<string, Role>>({})
  const [titles, setTitles] = useState<Record<string, string>>({})
  const mems = db.members.filter((m) => m.teamId === team?.id)
  const pending = mems.filter((m) => m.role === 'pending')
  const active = mems
    .filter((m) => m.role !== 'pending')
    .sort((a, b) => (a.role === 'leader' ? -1 : b.role === 'leader' ? 1 : a.role === 'none' ? 1 : b.role === 'none' ? -1 : a.sort - b.sort))
  const hasLeader = mems.some((m) => m.role === 'leader')
  const movable = active.filter((m) => m.role === 'member')

  return (
    <Modal title={t('팀 관리')} onClose={closeModal} width={720}>
      <div className="admin-panel">
        <section>
          <h3 className="section-label">{t('팀 정보')}</h3>
          <div className="inline-form">
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label={t('팀 이름')} />
            <button className="btn small" disabled={!name.trim() || name === team?.name} onClick={() => { renameTeam(name.trim()); showToast(t('팀 이름을 변경했어요.')) }}>{t('저장')}</button>
          </div>
          <div className="invite">
            <span>{t('초대 코드')}</span>
            <code>{team?.inviteCode}</code>
            <button className="btn small ghost" onClick={() => { navigator.clipboard?.writeText(team?.inviteCode ?? ''); showToast(t('초대 코드를 복사했어요.')) }}>
              <Icon name="copy" size={14} /> {t('코드 복사')}
            </button>
            <button className="btn small primary" onClick={() => { navigator.clipboard?.writeText(inviteLink(team?.inviteCode ?? '')); showToast(t('초대 링크를 복사했어요. 카톡이나 메일로 보내주세요.')) }}>
              <Icon name="copy" size={14} /> {t('초대 링크 복사')}
            </button>
          </div>
        </section>

        <ChatRetention />

        {pending.length > 0 && (
          <section>
            <h3 className="section-label">{t('승인 대기 {n}명', { n: pending.length })}</h3>
            {pending.map((m) => {
              const u = userOf(m.userId)
              const role = roles[m.userId] ?? 'member'
              return (
                <div key={m.userId} className="member-row pend">
                  <Avatar name={u.name} size={32} />
                  <div className="grow"><strong>{u.name}</strong><small>{u.email}</small></div>
                  <select value={role} onChange={(e) => setRoles({ ...roles, [m.userId]: e.target.value as Role })} aria-label={t('역할')}>
                    <option value="member">{t('팀원')}</option>
                    <option value="leader">{t('팀장')}{hasLeader ? t(' (기존 팀장은 팀원으로)') : ''}</option>
                  </select>
                  <input className="w-title" placeholder={t('직급')} value={titles[m.userId] ?? ''} onChange={(e) => setTitles({ ...titles, [m.userId]: e.target.value })} aria-label={t('직급')} />
                  <button className="btn small ghost" onClick={() => removeMember(m.userId)}>{t('거절')}</button>
                  <button className="btn small primary" onClick={() => {
                    updateMember(m.userId, { role, title: role === 'leader' ? '팀장' : titles[m.userId] ?? '' })
                    showToast(t('{name}님의 참여를 승인했어요.', { name: u.name }))
                  }}>{t('승인')}</button>
                </div>
              )
            })}
          </section>
        )}

        <section>
          <h3 className="section-label">{t('구성원 {n}명', { n: active.length })} <small>{t('표에는 팀장이 맨 위, 팀원은 아래 순서대로 표시됩니다')}</small></h3>
          {active.map((m) => {
            const u = userOf(m.userId)
            const mi = movable.findIndex((x) => x.userId === m.userId)
            return (
              <div key={m.userId} className="member-row">
                <Avatar name={u.name} size={32} />
                <div className="grow">
                  <strong>{u.name}{m.isAdmin && <span className="badge admin">{t('관리자')}</span>}</strong>
                  <small>{u.email}</small>
                </div>
                <select
                  value={m.role}
                  onChange={(e) => updateMember(m.userId, { role: e.target.value as Role, ...(e.target.value === 'leader' ? { title: '팀장' } : {}) })}
                  aria-label={t('역할')}
                >
                  <option value="leader">{t('팀장')}</option>
                  <option value="member">{t('팀원')}</option>
                  {m.isAdmin && <option value="none">{t('관리자 전용 (표 미표시)')}</option>}
                </select>
                <TitleInput
                  value={m.role === 'leader' ? t('팀장') : m.title}
                  disabled={m.role === 'leader' || m.role === 'none'}
                  onSave={(title) => updateMember(m.userId, { title })}
                />
                <span className="order">
                  <button className="icon-btn tiny" disabled={mi <= 0} onClick={() => moveMember(m.userId, -1)} aria-label={t('위로')}><Icon name="up" size={15} /></button>
                  <button className="icon-btn tiny" disabled={mi < 0 || mi >= movable.length - 1} onClick={() => moveMember(m.userId, 1)} aria-label={t('아래로')}><Icon name="down" size={15} /></button>
                </span>
                {m.userId !== me?.id && !m.isAdmin && m.role !== 'pending' ? (
                  <button className={'icon-btn tiny key-slot' + (confirm === 'admin:' + m.userId ? ' on' : '')} onClick={() => setConfirm(confirm === 'admin:' + m.userId ? null : 'admin:' + m.userId)} aria-label={t('관리자 넘기기')} title={t('{name}님에게 관리자 넘기기', { name: u.name })}><Icon name="key" size={15} /></button>
                ) : (
                  <span className="key-slot" />
                )}
                {m.userId === me?.id ? (
                  <span className="del-slot" />
                ) : confirm === m.userId ? (
                  <button className="btn small danger" onClick={() => { removeMember(m.userId); setConfirm(null); showToast(t('{name}님을 팀에서 삭제했어요.', { name: u.name })) }}>{t('정말 삭제')}</button>
                ) : (
                  <button className="icon-btn tiny del-slot" onClick={() => setConfirm(m.userId)} aria-label={t('구성원 삭제')}><Icon name="trash" size={15} /></button>
                )}
                {/* 관리자 넘기기 확인: 줄 아래에 따로 (줄 정렬이 흐트러지지 않도록) */}
                {confirm === 'admin:' + m.userId && (
                  <div className="row-confirm">
                    <span><Rich text={t('<b>{name}</b>님에게 관리자를 넘길까요? 나는 일반 구성원이 되고 팀 관리 메뉴를 쓸 수 없게 돼요.', { name: u.name })} /></span>
                    <button className="btn small ghost" onClick={() => setConfirm(null)}>{t('취소')}</button>
                    <button className="btn small primary" onClick={() => { transferAdmin(m.userId); setConfirm(null); closeModal(); showToast(t('{name}님에게 관리자를 넘겼어요.', { name: u.name })) }}>{t('넘기기')}</button>
                  </div>
                )}
              </div>
            )
          })}
        </section>
      </div>
    </Modal>
  )
}

/* ───────── 캘린더 앱에서 보기 ───────── */
function CalendarModal() {
  const { db, me, mode, getCalendarUrl } = useStore()
  const { closeModal, showToast } = useUI()
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(mode === 'cloud')
  const [confirmReset, setConfirmReset] = useState(false)

  useEffect(() => {
    if (mode !== 'cloud') return
    getCalendarUrl().then((u) => { setUrl(u); setBusy(false) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const mine = db.events.filter((e) => e.ownerId === me?.id)
  const copy = async () => {
    if (!url) return
    try { await navigator.clipboard.writeText(url); showToast(t('구독 주소를 복사했어요')) } catch { showToast(t('복사하지 못했어요. 주소를 길게 눌러 복사해주세요')) }
  }

  return (
    <Modal title={t('캘린더 앱에서 보기')} onClose={closeModal} width={500}>
      <div className="cal-export">
        <section>
          <h4>{t('구독 주소')} <small>{t('일정이 바뀌면 캘린더 앱에도 자동으로 반영돼요')}</small></h4>
          {mode !== 'cloud' ? (
            <p className="hint">{t('체험 모드에서는 구독 주소를 만들 수 없어요. 아래 파일 내려받기를 이용하세요.')}</p>
          ) : busy ? (
            <p className="hint">{t('주소를 준비하는 중…')}</p>
          ) : url ? (
            <>
              <div className="cal-url">
                <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label={t('구독 주소')} />
                <button className="btn small primary" onClick={copy}><Icon name="copy" size={14} /> {t('복사')}</button>
              </div>
              <ul className="cal-steps">
                <li><Rich text={t('<b>구글 캘린더 (PC)</b> 왼쪽 "다른 캘린더" 옆 + → "URL로 추가" → 주소 붙여넣기')} /></li>
                <li><Rich text={t('<b>아이폰 캘린더</b> 설정 → 캘린더 → 계정 → 계정 추가 → 기타 → "구독 캘린더 추가"')} /></li>
              </ul>
              <p className="hint">{t('구글 캘린더는 반영까지 몇 시간 걸릴 수 있어요. 이 주소를 아는 사람은 내 일정을 볼 수 있으니 공유하지 마세요.')}</p>
              {confirmReset ? (
                <div className="cal-reset">
                  <span>{t('이전 주소는 더 이상 동작하지 않아요.')}</span>
                  <button className="btn small ghost" onClick={() => setConfirmReset(false)}>{t('취소')}</button>
                  <button className="btn small danger" onClick={async () => { setBusy(true); setUrl(await getCalendarUrl(true)); setBusy(false); setConfirmReset(false); showToast(t('새 주소로 바꿨어요')) }}>{t('새 주소로 바꾸기')}</button>
                </div>
              ) : (
                <button className="link-btn" onClick={() => setConfirmReset(true)}>{t('주소가 유출됐다면: 새 주소로 바꾸기')}</button>
              )}
            </>
          ) : (
            <p className="hint">{t('주소를 만들지 못했어요. 서버 설정(migration_007)을 확인해주세요.')}</p>
          )}
        </section>
        <section>
          <h4>{t('파일로 내려받기')} <small>{t('지금 시점의 일정만 담겨요')}</small></h4>
          <button className="btn" onClick={() => downloadICS(buildICS(mine, 'Weekendar · ' + (me?.name ?? '')), 'weekendar.ics')}>
            <Icon name="cal" size={15} /> {t('내 일정 {n}개 .ics 내려받기', { n: mine.length })}
          </button>
        </section>
      </div>
    </Modal>
  )
}

/** 직급 입력: 입력 중에는 화면에만 반영하고, 칸을 벗어나거나 Enter를 누를 때 한 번만 저장 */
function TitleInput({ value, disabled, onSave }: { value: string; disabled: boolean; onSave: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => { if (!focused.current) setDraft(value) }, [value])
  const commit = () => { const v = draft.trim(); if (v !== value) onSave(v); else setDraft(value) }
  return (
    <input
      className="w-title"
      value={draft}
      disabled={disabled}
      onFocus={() => { focused.current = true }}
      onBlur={() => { focused.current = false; commit() }}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur() }}
      placeholder={t('직급')}
      aria-label={t('직급')}
    />
  )
}

/* ───────── 휴대폰 알림 (PWA 푸쉬) ───────── */
function PushModal() {
  const { mode } = useStore()
  const { closeModal, showToast } = useUI()
  const [state, setState] = useState<'loading' | 'on' | 'off'>('loading')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const ios = isIOS()
  const installed = isStandalone()
  const needInstall = ios && !installed
  const supported = pushSupported()
  const denied = supported && Notification.permission === 'denied'

  useEffect(() => { pushState().then(setState) }, [])

  const toggle = async () => {
    setBusy(true); setErr(null)
    try {
      if (state === 'on') { await disablePush(); setState('off'); showToast(t('이 기기의 알림을 껐어요')) }
      else {
        const e = await enablePush()
        if (e) setErr(e)
        else { setState('on'); showToast(t('이 기기로 알림을 보내드릴게요')) }
      }
    } catch { setErr(t('알림을 설정하지 못했어요. 잠시 후 다시 시도해주세요.')) }
    setBusy(false)
  }
  const test = async () => {
    setBusy(true); setErr(null)
    const e = await sendTestPush()
    if (e) setErr(e); else showToast(t('테스트 알림을 보냈어요. 잠시 후 도착해요'))
    setBusy(false)
  }

  return (
    <Modal title={t('휴대폰 알림')} onClose={closeModal} width={480}>
      <div className="cal-export push-set">
        <section>
          <h4>{t('앱을 닫아도 알려드려요')}</h4>
          <ul className="push-kinds">
            <li><Icon name="clock" size={15} /> {t('일정 미리 알림')}</li>
            <li><Icon name="chat" size={15} /> {t('팀 대화에서 나를 @로 불렀을 때')}</li>
            <li><Icon name="bell" size={15} /> {t('팀장 동의 요청 · 결과, 참여 요청')}</li>
          </ul>
        </section>
        {mode !== 'cloud' ? (
          <p className="hint">{t('체험 모드에서는 휴대폰 알림을 켤 수 없어요.')}</p>
        ) : needInstall ? (
          <section>
            <h4>{t('먼저 홈 화면에 추가해주세요')} <small>{t('아이폰은 홈 화면 앱에서만 알림을 받을 수 있어요')}</small></h4>
            <ol className="cal-steps push-steps">
              <li><Rich text={t('Safari 아래쪽 <b>공유 버튼</b>(네모에 위쪽 화살표)을 눌러요')} /></li>
              <li><Rich text={t('<b>홈 화면에 추가</b>를 눌러요')} /></li>
              <li><Rich text={t('홈 화면의 <b>Weekendar</b> 아이콘으로 열고, 이 메뉴에서 알림을 켜요')} /></li>
            </ol>
          </section>
        ) : !supported ? (
          <p className="hint">{t('이 브라우저는 휴대폰 알림을 지원하지 않아요. 크롬, 엣지, Safari(홈 화면 앱)를 이용해주세요.')}</p>
        ) : denied ? (
          <p className="hint">{t('알림이 차단되어 있어요. 기기(또는 브라우저) 설정에서 Weekendar 알림을 허용한 뒤 다시 열어주세요.')}</p>
        ) : (
          <section>
            <div className="push-row">
              <div>
                <strong>{t('이 기기로 알림 받기')}</strong>
                <span>{state === 'loading' ? t('확인하는 중…') : state === 'on' ? t('켜져 있어요') : t('꺼져 있어요')}</span>
              </div>
              <button className={'switch' + (state === 'on' ? ' on' : '')} disabled={busy || state === 'loading'} onClick={toggle} role="switch" aria-checked={state === 'on'} aria-label={t('이 기기로 알림 받기')}>
                <span />
              </button>
            </div>
            {state === 'on' && <button className="btn small" disabled={busy} onClick={test}>{t('테스트 알림 보내기')}</button>}
            {!installed && !ios && <p className="hint">{t('주소창 오른쪽의 설치 아이콘을 누르면 Weekendar를 앱처럼 설치할 수 있어요.')}</p>}
          </section>
        )}
        {err && <p className="push-err">{localize(err)}</p>}
      </div>
    </Modal>
  )
}

/** 날짜·시간 칸: 브라우저 언어와 상관없이 "2026. 11. 9." / "오전 9:00" 형태의 알약 버튼으로 보여주고, 누르면 선택 창이 열림 */
function PickerField({ kind, value, onChange, min, label, bad, variant }: { kind: 'date' | 'time'; value: string; onChange: (v: string) => void; min?: string; label: string; bad?: boolean; variant?: 'line' }) {
  const ref = useRef<HTMLInputElement>(null)
  let text = kind === 'date' ? t('날짜 선택') : t('시간 선택')
  if (value && kind === 'date') text = variant === 'line' ? fmtMonthDay(value) : fmtDate(value)
  if (value && kind === 'time') text = fmtTime(value)
  return (
    <span className={'pick' + (bad ? ' bad' : '') + (variant === 'line' ? ' line' : '')}>
      {variant === 'line' && <Icon name="cal" size={14} />}
      <span className="pick-text" aria-hidden>{text}</span>
      {variant === 'line' && <Icon name="chevD" size={12} />}
      <input
        ref={ref}
        type={kind}
        value={value}
        min={min}
        aria-label={label}
        onChange={(e) => { if (e.target.value) onChange(e.target.value) }}
        onClick={() => { try { ref.current?.showPicker() } catch { /* 지원 안 하는 브라우저는 기본 동작 */ } }}
      />
    </span>
  )
}

/* ───────── 팀 나가기 ───────── */
function LeaveModal() {
  const { team, myMember, db, leaveTeam, userOf } = useStore()
  const { closeModal, showToast } = useUI()
  const others = db.members.filter((m) => m.teamId === myMember?.teamId && m.userId !== myMember?.userId)
  const candidates = others.filter((m) => m.role !== 'pending')
  const mustHand = !!myMember?.isAdmin && others.length > 0 // 관리자는 관리자를 넘겨야 나갈 수 있음
  const blocked = mustHand && candidates.length === 0 // 승인 대기 중인 사람만 있으면 넘길 사람이 없음
  const [heir, setHeir] = useState(candidates[0]?.userId ?? '')
  const alone = others.length === 0
  return (
    <Modal
      title={t('팀 나가기')}
      onClose={closeModal}
      width={440}
      footer={
        blocked ? (
          <button className="btn primary" onClick={closeModal}>{t('확인')}</button>
        ) : (
          <>
            <button className="btn ghost" onClick={closeModal}>{t('취소')}</button>
            <button className="btn danger" disabled={mustHand && !heir} onClick={() => {
              leaveTeam(mustHand ? heir : undefined); closeModal()
              showToast(alone ? t('팀을 삭제하고 나왔어요.') : mustHand ? t('{name}님에게 관리자를 넘기고 나왔어요.', { name: userOf(heir).name }) : t('{team}에서 나왔어요.', { team: team?.name ?? t('팀') }))
            }}>
              {alone ? t('팀 삭제하고 나가기') : mustHand ? t('관리자 넘기고 나가기') : t('팀 나가기')}
            </button>
          </>
        )
      }
    >
      {blocked ? (
        <p className="leave-text">
          <Rich text={t('<b>지금은 관리자를 넘길 사람이 없어요.</b><br>참여 승인을 기다리는 사람만 있어요. 먼저 팀 관리에서 승인하거나 거절한 뒤 다시 시도해주세요.')} />
        </p>
      ) : (
        <>
          <p className="leave-text"><Rich text={t('<b>{team}</b>에서 나갈까요?', { team: team?.name ?? '' })} /></p>
          {mustHand && (
            <div className="group heir">
              <label className="gr">
                <span>{t('관리자 넘겨받을 사람')}</span>
                <select value={heir} onChange={(e) => setHeir(e.target.value)} aria-label={t('관리자 넘겨받을 사람')}>
                  {candidates.map((m) => <option key={m.userId} value={m.userId}>{userOf(m.userId).name}{m.role === 'leader' ? ` (${t('팀장')})` : m.title ? ` (${m.title})` : ''}</option>)}
                </select>
              </label>
            </div>
          )}
          <ul className="leave-list">
            <li><Rich text={t('내 일정과 할 일, 보내거나 받은 대기 중 요청이 <b>모두 삭제</b>돼요.')} /></li>
            <li>{t('팀 대화에 남긴 메시지는 팀 기록으로 남아요.')}</li>
            {alone && <li><Rich text={t('<b>마지막 구성원이라 팀도 함께 삭제</b>돼요.')} /></li>}
            <li>{t('나간 뒤에는 새 팀을 만들거나 초대 코드로 다시 참여할 수 있어요.')}</li>
          </ul>
        </>
      )}
    </Modal>
  )
}

/** 구글 캘린더 모양 작은 아이콘 */
export function GcalIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="gcal-ic">
      <rect x="3" y="4" width="18" height="17" rx="3" fill="#fff" stroke="#dadce0" />
      <rect x="3" y="4" width="18" height="5" rx="2" fill="#4285f4" />
      <text x="12" y="18.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="#4285f4" fontFamily="Arial">31</text>
    </svg>
  )
}
