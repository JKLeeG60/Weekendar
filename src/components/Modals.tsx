import { useEffect, useRef, useState } from 'react'
import { disablePush, enablePush, isIOS, isStandalone, pushState, pushSupported, sendTestPush } from '../lib/push'
import { buildICS, downloadICS } from '../lib/ics'
import { inviteLink } from '../lib/invite'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { isMultiDay, occurrencesOn, spanLabel } from '../lib/events'
import { addDays, fmtLong, holidayName, isWeekend } from '../lib/date'
import {
  CATEGORY_LABEL,
  type Category, type EventItem, type Occurrence, type Repeat, type Role,
} from '../lib/types'
import { Avatar, Icon, Modal, Switch } from './ui'

const CATS = Object.keys(CATEGORY_LABEL) as Category[]
const REPEAT_LABEL: Record<Repeat, string> = { none: '반복 안 함', daily: '매일', weekly: '매주', monthly: '매월' }
export const REMIND_OPTIONS: [number | undefined, string][] = [
  [undefined, '없음'], [0, '정각'], [5, '5분 전'], [10, '10분 전'], [30, '30분 전'], [60, '1시간 전'],
]
/** 브라우저 알림 권한을 한 번만 물어본다 */
function askNotifyPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission()
  } catch { /* 지원 안 하는 브라우저 */ }
}

export function Modals() {
  const { modal } = useUI()
  if (!modal) return null
  switch (modal.type) {
    case 'event': return <EventModal date={modal.date} start={modal.start} occ={modal.event} titleHint={modal.title} sharedHint={modal.shared} />
    case 'detail': return <EventDetail occ={modal.occ} />
    case 'request': return <RequestModal mode={modal.mode} date={modal.date} occ={modal.occ} />
    case 'day': return <DayModal userId={modal.userId} date={modal.date} />
    case 'admin': return <AdminModal />
    case 'calendar': return <CalendarModal />
    case 'push': return <PushModal />
  }
}

/* ───────── 내 일정 추가/수정 ───────── */
const addHour = (t: string) => {
  const m = Math.min(23 * 60 + 59, Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) + 60)
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function EventModal({ date, start: startHint, occ, titleHint, sharedHint }: { date: string; start?: string; occ?: Occurrence; titleHint?: string; sharedHint?: boolean }) {
  const { db, addEvent, updateEvent, deleteEvent } = useStore()
  const { closeModal, showToast } = useUI()
  const base: EventItem | undefined = occ ? db.events.find((e) => e.id === occ.baseId) : undefined
  const [title, setTitle] = useState(base?.title ?? titleHint ?? '')
  const [d, setD] = useState(base?.date ?? date)
  const [start, setStart] = useState(base?.start ?? startHint ?? '09:00')
  const [end, setEnd] = useState(base?.end ?? addHour(startHint ?? '09:00'))
  const [place, setPlace] = useState(base?.place ?? '')
  const [category, setCategory] = useState<Category>(base?.category ?? 'work')
  const [repeat, setRepeat] = useState<Repeat>(base?.repeat ?? 'none')
  const [shared, setShared] = useState(base?.shared ?? sharedHint ?? true) // 기본값: 팀에 공유 ON
  const [remind, setRemind] = useState<number | undefined>(base?.remind)
  // 여러 날(종일) 일정: 예) 월~수 출장
  const [multi, setMulti] = useState(base ? isMultiDay(base) : false)
  const [endDate, setEndDate] = useState(base?.endDate && base.endDate > base.date ? base.endDate : addDays(base?.date ?? date, 2))
  const bad = !title.trim() || (multi ? endDate <= d : end <= start)

  function pickCategory(c: Category) {
    setCategory(c)
  }

  function save() {
    const data = multi
      ? { title: title.trim(), date: d, endDate, start: '00:00', end: '23:59', place: place.trim(), category, repeat: 'none' as Repeat, shared, remind: undefined }
      : { title: title.trim(), date: d, endDate: undefined, start, end, place: place.trim(), category, repeat, shared, remind }
    if (data.remind !== undefined) askNotifyPermission()
    if (base) updateEvent(base.id, data)
    else addEvent(data)
    closeModal()
    showToast(shared ? '일정을 저장했어요. 팀 표에 공유됩니다.' : '일정을 저장했어요. 나만 볼 수 있습니다.')
  }

  return (
    <Modal
      title={base ? '일정 수정' : '새로운 일정'}
      onClose={closeModal}
      footer={
        <>
          {base && (
            <button className="btn danger-ghost left" onClick={() => { deleteEvent(base.id); closeModal(); showToast('일정을 삭제했어요.') }}>삭제</button>
          )}
          <button className="btn ghost" onClick={closeModal}>취소</button>
          <button className="btn primary" disabled={bad} onClick={save}>{base ? '저장' : '추가'}</button>
        </>
      }
    >
      <div className="form">
        <input className="title-input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목 (예: 주간회의)" />
        <div className="group">
          <div className="gr">
            <div className="gr-text">
              <span>여러 날</span>
              <small>{multi ? '하루 종일 일정으로, 기간 전체에 표시돼요' : '휴가·출장처럼 며칠 이어지는 일정'}</small>
            </div>
            <Switch on={multi} onChange={(v) => { setMulti(v); if (v && endDate <= d) setEndDate(addDays(d, 2)) }} label="여러 날" />
          </div>
          {multi ? (
            <>
              <label className="gr"><span>시작 날짜</span><DateField value={d} onChange={setD} label="시작 날짜" /></label>
              <label className="gr"><span>종료 날짜</span><DateField value={endDate} min={addDays(d, 1)} onChange={setEndDate} label="종료 날짜" /></label>
            </>
          ) : (
            <>
              <label className="gr"><span>날짜</span><DateField value={d} onChange={setD} label="날짜" /></label>
              <label className="gr"><span>시작</span><input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></label>
              <label className="gr"><span>종료</span><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
            </>
          )}
          <label className="gr"><span>장소</span><input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="장소 추가" /></label>
        </div>
        {multi ? endDate <= d && <p className="error">종료 날짜는 시작 날짜 이후여야 해요.</p>
          : end <= start && <p className="error">종료 시간은 시작 시간 이후여야 해요.</p>}
        <div className="group">
          <div className="gr col">
            <span>카테고리</span>
            <div className="seg">
              {CATS.map((c) => (
                <button key={c} type="button" data-cat={c} className={'seg-item' + (category === c ? ' on' : '')} onClick={() => pickCategory(c)}>
                  {CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
          </div>
          {!multi && <label className="gr">
            <span>반복</span>
            <select value={repeat} onChange={(e) => setRepeat(e.target.value as Repeat)}>
              {(Object.keys(REPEAT_LABEL) as Repeat[]).map((r) => <option key={r} value={r}>{REPEAT_LABEL[r]}</option>)}
            </select>
          </label>}
          {!multi && <label className="gr">
            <span>알림</span>
            <select value={remind === undefined ? '' : String(remind)} onChange={(e) => setRemind(e.target.value === '' ? undefined : Number(e.target.value))} aria-label="미리 알림">
              {REMIND_OPTIONS.map(([v, l]) => <option key={l} value={v === undefined ? '' : String(v)}>{l}</option>)}
            </select>
          </label>}
          <div className="gr">
            <div className="gr-text">
              <span>팀에 공유</span>
              <small>{shared ? '팀 주간표에 표시됩니다' : '내 패널에만 표시됩니다'}</small>
            </div>
            <Switch on={shared} onChange={(v) => setShared(v)} label="팀에 공유" />
          </div>
        </div>
        {base && base.repeat !== 'none' && <p className="hint">반복 일정은 수정·삭제 시 모든 날짜에 적용됩니다.</p>}
      </div>
    </Modal>
  )
}

/* ───────── 일정 상세 ───────── */
function EventDetail({ occ }: { occ: Occurrence }) {
  const { me, myMember, userOf, db, deleteEvent } = useStore()
  const { closeModal, openModal, showToast } = useUI()
  const owner = db.members.find((m) => m.userId === occ.ownerId)
  const mine = occ.ownerId === me?.id
  const leaderEvent = owner?.role === 'leader'
  const canRequest = !mine && leaderEvent && myMember?.role === 'member'

  return (
    <Modal
      title="일정"
      onClose={closeModal}
      footer={
        mine ? (
          <>
            <button className="btn danger-ghost left" onClick={() => { deleteEvent(occ.baseId); closeModal(); showToast('일정을 삭제했어요.') }}>삭제</button>
            <button className="btn primary" onClick={() => openModal({ type: 'event', date: occ.date, event: occ })}>수정</button>
          </>
        ) : canRequest ? (
          <>
            <button className="btn danger-ghost left" onClick={() => openModal({ type: 'request', mode: 'delete', date: occ.date, occ })}>삭제 요청</button>
            <button className="btn primary" onClick={() => openModal({ type: 'request', mode: 'edit', date: occ.date, occ })}>변경 요청</button>
          </>
        ) : (
          <button className="btn ghost" onClick={closeModal}>닫기</button>
        )
      }
    >
      <div className="detail" data-cat={occ.category}>
        <div className="detail-bar" />
        <div>
          <h3>{occ.title}</h3>
          <p className="detail-line"><Icon name="clock" size={15} /> {isMultiDay(occ) ? `${spanLabel(occ)} · 종일` : `${fmtLong(occ.date)} · ${occ.start}–${occ.end}${occ.repeat !== 'none' ? ` · ${REPEAT_LABEL[occ.repeat]} 반복` : ''}`}</p>
          {occ.place && <p className="detail-line"><Icon name="pin" size={15} /> {occ.place}</p>}
          <p className="detail-line"><Icon name="users" size={15} /> {userOf(occ.ownerId).name}{owner?.role === 'leader' ? ' (팀장)' : ''} · {occ.shared ? '팀에 공유' : '나만 보기'}</p>
          <span className="cat-tag" data-cat={occ.category}>{CATEGORY_LABEL[occ.category]}</span>
        </div>
      </div>
      {canRequest && <p className="hint">팀장 일정은 직접 수정할 수 없어요. 요청을 보내면 팀장이 동의한 뒤 반영됩니다.</p>}
    </Modal>
  )
}

/* ───────── 팀장 일정 변경 요청 ───────── */
function RequestModal({ mode, date, occ }: { mode: 'add' | 'edit' | 'delete'; date: string; occ?: Occurrence }) {
  const { createRequest, db, userOf } = useStore()
  const { closeModal, showToast } = useUI()
  const base = occ ? db.events.find((e) => e.id === occ.baseId) : undefined
  const [title, setTitle] = useState(occ?.title ?? '')
  const [d, setD] = useState(occ?.date ?? date)
  const [start, setStart] = useState(occ?.start ?? '10:00')
  const [end, setEnd] = useState(occ?.end ?? '11:00')
  const [place, setPlace] = useState(occ?.place ?? '')
  const leader = db.members.find((m) => m.role === 'leader')
  const del = mode === 'delete'
  const bad = !del && (!title.trim() || end <= start)
  const heading = mode === 'add' ? '팀장 일정 요청' : mode === 'edit' ? '팀장 일정 변경 요청' : '팀장 일정 삭제 요청'

  function submit() {
    createRequest({
      type: mode,
      eventId: base?.id,
      payload: { title: title.trim(), date: d, start, end, place: place.trim() },
    })
    closeModal()
    showToast('팀장에게 요청을 보냈어요. 동의하면 일정에 반영됩니다.')
  }

  return (
    <Modal
      title={heading}
      onClose={closeModal}
      footer={
        <>
          <button className="btn ghost" onClick={closeModal}>취소</button>
          <button className={'btn ' + (del ? 'danger' : 'primary')} disabled={bad} onClick={submit}>{del ? '삭제 요청 보내기' : '요청 보내기'}</button>
        </>
      }
    >
      <div className="form">
        <div className="to-line">
          <Avatar name={leader ? userOf(leader.userId).name : '?'} size={26} />
          <span><strong>{leader ? userOf(leader.userId).name : ''}</strong> 팀장에게 전달</span>
        </div>
        {del ? (
          <div className="detail" data-cat={occ?.category}>
            <div className="detail-bar" />
            <div>
              <h3>{occ?.title}</h3>
              <p className="detail-line"><Icon name="clock" size={15} /> {fmtLong(d)} · {occ?.start}–{occ?.end}</p>
              {occ?.place && <p className="detail-line"><Icon name="pin" size={15} /> {occ.place}</p>}
            </div>
          </div>
        ) : (
          <>
            <input className="title-input" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="일정 (예: 신규 캠페인 킥오프)" />
            <div className="group">
              <label className="gr"><span>날짜</span><input type="date" value={d} onChange={(e) => setD(e.target.value)} /></label>
              <label className="gr"><span>시작</span><input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></label>
              <label className="gr"><span>종료</span><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} /></label>
              <label className="gr"><span>장소</span><input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="장소 추가" /></label>
            </div>
            {end <= start && <p className="error">종료 시간은 시작 시간 이후여야 해요.</p>}
            {(isWeekend(d) || holidayName(d)) && <p className="hint">선택한 날짜는 주말·공휴일이라 팀 표에는 표시되지 않아요.</p>}
          </>
        )}
        <p className="hint">저장하면 팀장에게 알림이 전달되고, 팀장이 ‘동의’하면 팀장 일정에 반영되어 모든 팀원에게 보입니다.</p>
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
              <span className="agenda-time">{isMultiDay(o) ? '종일' : o.start}</span>
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

/* ───────── 팀 관리 (관리자) ───────── */
function AdminModal() {
  const { db, me, team, userOf, renameTeam, updateMember, moveMember, removeMember } = useStore()
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
    <Modal title="팀 관리" onClose={closeModal} width={720}>
      <div className="admin-panel">
        <section>
          <h3 className="section-label">팀 정보</h3>
          <div className="inline-form">
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="팀 이름" />
            <button className="btn small" disabled={!name.trim() || name === team?.name} onClick={() => { renameTeam(name.trim()); showToast('팀 이름을 변경했어요.') }}>저장</button>
          </div>
          <div className="invite">
            <span>초대 코드</span>
            <code>{team?.inviteCode}</code>
            <button className="btn small ghost" onClick={() => { navigator.clipboard?.writeText(team?.inviteCode ?? ''); showToast('초대 코드를 복사했어요.') }}>
              <Icon name="copy" size={14} /> 코드 복사
            </button>
            <button className="btn small primary" onClick={() => { navigator.clipboard?.writeText(inviteLink(team?.inviteCode ?? '')); showToast('초대 링크를 복사했어요. 카톡이나 메일로 보내주세요.') }}>
              <Icon name="copy" size={14} /> 초대 링크 복사
            </button>
          </div>
        </section>

        {pending.length > 0 && (
          <section>
            <h3 className="section-label">승인 대기 {pending.length}명</h3>
            {pending.map((m) => {
              const u = userOf(m.userId)
              const role = roles[m.userId] ?? 'member'
              return (
                <div key={m.userId} className="member-row pend">
                  <Avatar name={u.name} size={32} />
                  <div className="grow"><strong>{u.name}</strong><small>{u.email}</small></div>
                  <select value={role} onChange={(e) => setRoles({ ...roles, [m.userId]: e.target.value as Role })} aria-label="역할">
                    <option value="member">팀원</option>
                    <option value="leader">팀장{hasLeader ? ' (기존 팀장은 팀원으로)' : ''}</option>
                  </select>
                  <input className="w-title" placeholder="직급" value={titles[m.userId] ?? ''} onChange={(e) => setTitles({ ...titles, [m.userId]: e.target.value })} aria-label="직급" />
                  <button className="btn small ghost" onClick={() => removeMember(m.userId)}>거절</button>
                  <button className="btn small primary" onClick={() => {
                    updateMember(m.userId, { role, title: role === 'leader' ? '팀장' : titles[m.userId] ?? '' })
                    showToast(`${u.name}님의 참여를 승인했어요.`)
                  }}>승인</button>
                </div>
              )
            })}
          </section>
        )}

        <section>
          <h3 className="section-label">구성원 {active.length}명 <small>표에는 팀장이 맨 위, 팀원은 아래 순서대로 표시됩니다</small></h3>
          {active.map((m) => {
            const u = userOf(m.userId)
            const mi = movable.findIndex((x) => x.userId === m.userId)
            return (
              <div key={m.userId} className="member-row">
                <Avatar name={u.name} size={32} />
                <div className="grow">
                  <strong>{u.name}{m.isAdmin && <span className="badge admin">관리자</span>}</strong>
                  <small>{u.email}</small>
                </div>
                <select
                  value={m.role}
                  onChange={(e) => updateMember(m.userId, { role: e.target.value as Role, ...(e.target.value === 'leader' ? { title: '팀장' } : {}) })}
                  aria-label="역할"
                >
                  <option value="leader">팀장</option>
                  <option value="member">팀원</option>
                  {m.isAdmin && <option value="none">관리자 전용 (표 미표시)</option>}
                </select>
                <TitleInput
                  value={m.role === 'leader' ? '팀장' : m.title}
                  disabled={m.role === 'leader' || m.role === 'none'}
                  onSave={(title) => updateMember(m.userId, { title })}
                />
                <span className="order">
                  <button className="icon-btn tiny" disabled={mi <= 0} onClick={() => moveMember(m.userId, -1)} aria-label="위로"><Icon name="up" size={15} /></button>
                  <button className="icon-btn tiny" disabled={mi < 0 || mi >= movable.length - 1} onClick={() => moveMember(m.userId, 1)} aria-label="아래로"><Icon name="down" size={15} /></button>
                </span>
                {m.userId === me?.id ? (
                  <span className="del-slot" />
                ) : confirm === m.userId ? (
                  <button className="btn small danger" onClick={() => { removeMember(m.userId); setConfirm(null); showToast(`${u.name}님을 팀에서 삭제했어요.`) }}>정말 삭제</button>
                ) : (
                  <button className="icon-btn tiny del-slot" onClick={() => setConfirm(m.userId)} aria-label="구성원 삭제"><Icon name="trash" size={15} /></button>
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
    try { await navigator.clipboard.writeText(url); showToast('구독 주소를 복사했어요') } catch { showToast('복사하지 못했어요. 주소를 길게 눌러 복사해주세요') }
  }

  return (
    <Modal title="캘린더 앱에서 보기" onClose={closeModal} width={500}>
      <div className="cal-export">
        <section>
          <h4>구독 주소 <small>일정이 바뀌면 캘린더 앱에도 자동으로 반영돼요</small></h4>
          {mode !== 'cloud' ? (
            <p className="hint">체험 모드에서는 구독 주소를 만들 수 없어요. 아래 파일 내려받기를 이용하세요.</p>
          ) : busy ? (
            <p className="hint">주소를 준비하는 중…</p>
          ) : url ? (
            <>
              <div className="cal-url">
                <input readOnly value={url} onFocus={(e) => e.target.select()} aria-label="구독 주소" />
                <button className="btn small primary" onClick={copy}><Icon name="copy" size={14} /> 복사</button>
              </div>
              <ul className="cal-steps">
                <li><b>구글 캘린더 (PC)</b> 왼쪽 "다른 캘린더" 옆 + → "URL로 추가" → 주소 붙여넣기</li>
                <li><b>아이폰 캘린더</b> 설정 → 캘린더 → 계정 → 계정 추가 → 기타 → "구독 캘린더 추가"</li>
              </ul>
              <p className="hint">구글 캘린더는 반영까지 몇 시간 걸릴 수 있어요. 이 주소를 아는 사람은 내 일정을 볼 수 있으니 공유하지 마세요.</p>
              {confirmReset ? (
                <div className="cal-reset">
                  <span>이전 주소는 더 이상 동작하지 않아요.</span>
                  <button className="btn small ghost" onClick={() => setConfirmReset(false)}>취소</button>
                  <button className="btn small danger" onClick={async () => { setBusy(true); setUrl(await getCalendarUrl(true)); setBusy(false); setConfirmReset(false); showToast('새 주소로 바꿨어요') }}>새 주소로 바꾸기</button>
                </div>
              ) : (
                <button className="link-btn" onClick={() => setConfirmReset(true)}>주소가 유출됐다면: 새 주소로 바꾸기</button>
              )}
            </>
          ) : (
            <p className="hint">주소를 만들지 못했어요. 서버 설정(migration_007)을 확인해주세요.</p>
          )}
        </section>
        <section>
          <h4>파일로 내려받기 <small>지금 시점의 일정만 담겨요</small></h4>
          <button className="btn" onClick={() => downloadICS(buildICS(mine, 'Weekendar · ' + (me?.name ?? '')), 'weekendar.ics')}>
            <Icon name="cal" size={15} /> 내 일정 {mine.length}개 .ics 내려받기
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
      placeholder="직급"
      aria-label="직급"
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
      if (state === 'on') { await disablePush(); setState('off'); showToast('이 기기의 알림을 껐어요') }
      else {
        const e = await enablePush()
        if (e) setErr(e)
        else { setState('on'); showToast('이 기기로 알림을 보내드릴게요') }
      }
    } catch { setErr('알림을 설정하지 못했어요. 잠시 후 다시 시도해주세요.') }
    setBusy(false)
  }
  const test = async () => {
    setBusy(true); setErr(null)
    const e = await sendTestPush()
    if (e) setErr(e); else showToast('테스트 알림을 보냈어요. 잠시 후 도착해요')
    setBusy(false)
  }

  return (
    <Modal title="휴대폰 알림" onClose={closeModal} width={480}>
      <div className="cal-export push-set">
        <section>
          <h4>앱을 닫아도 알려드려요</h4>
          <ul className="push-kinds">
            <li><Icon name="clock" size={15} /> 일정 미리 알림</li>
            <li><Icon name="chat" size={15} /> 팀 대화에서 나를 @로 불렀을 때</li>
            <li><Icon name="bell" size={15} /> 팀장 동의 요청 · 결과, 참여 요청</li>
          </ul>
        </section>
        {mode !== 'cloud' ? (
          <p className="hint">체험 모드에서는 휴대폰 알림을 켤 수 없어요.</p>
        ) : needInstall ? (
          <section>
            <h4>먼저 홈 화면에 추가해주세요 <small>아이폰은 홈 화면 앱에서만 알림을 받을 수 있어요</small></h4>
            <ol className="cal-steps push-steps">
              <li>Safari 아래쪽 <b>공유 버튼</b>(네모에 위쪽 화살표)을 눌러요</li>
              <li><b>홈 화면에 추가</b>를 눌러요</li>
              <li>홈 화면의 <b>Weekendar</b> 아이콘으로 열고, 이 메뉴에서 알림을 켜요</li>
            </ol>
          </section>
        ) : !supported ? (
          <p className="hint">이 브라우저는 휴대폰 알림을 지원하지 않아요. 크롬, 엣지, Safari(홈 화면 앱)를 이용해주세요.</p>
        ) : denied ? (
          <p className="hint">알림이 차단되어 있어요. 기기(또는 브라우저) 설정에서 Weekendar 알림을 허용한 뒤 다시 열어주세요.</p>
        ) : (
          <section>
            <div className="push-row">
              <div>
                <strong>이 기기로 알림 받기</strong>
                <span>{state === 'loading' ? '확인하는 중…' : state === 'on' ? '켜져 있어요' : '꺼져 있어요'}</span>
              </div>
              <button className={'switch' + (state === 'on' ? ' on' : '')} disabled={busy || state === 'loading'} onClick={toggle} role="switch" aria-checked={state === 'on'} aria-label="이 기기로 알림 받기">
                <span />
              </button>
            </div>
            {state === 'on' && <button className="btn small" disabled={busy} onClick={test}>테스트 알림 보내기</button>}
            {!installed && !ios && <p className="hint">주소창 오른쪽의 설치 아이콘을 누르면 Weekendar를 앱처럼 설치할 수 있어요.</p>}
          </section>
        )}
        {err && <p className="push-err">{err}</p>}
      </div>
    </Modal>
  )
}


/** 날짜 칸: 브라우저 언어와 상관없이 "2026. 11. 9." 형태로 보여주고, 누르면 달력이 열림 */
function DateField({ value, onChange, min, label }: { value: string; onChange: (v: string) => void; min?: string; label: string }) {
  const ref = useRef<HTMLInputElement>(null)
  const text = value ? `${Number(value.slice(0, 4))}. ${Number(value.slice(5, 7))}. ${Number(value.slice(8, 10))}.` : '날짜 선택'
  return (
    <span className="date-field">
      <span className="date-text" aria-hidden>{text}</span>
      <input
        ref={ref}
        type="date"
        value={value}
        min={min}
        aria-label={label}
        onChange={(e) => { if (e.target.value) onChange(e.target.value) }}
        onClick={() => { try { ref.current?.showPicker() } catch { /* 지원 안 하는 브라우저는 기본 동작 */ } }}
      />
    </span>
  )
}
