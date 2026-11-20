import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { dowHeads, fmtMonthDay, holidayLabel, holidayName, monthGrid, monthTitle, parse, todayStr } from '../lib/date'
import { isMultiDay, occurrencesOn } from '../lib/events'
import { canPromptInstall, isIOS, isStandalone, onInstallChange, promptInstall } from '../lib/install'
import { CATEGORY_LABEL, type EventItem, type Occurrence } from '../lib/types'
import { Rich, t } from '../lib/i18n'
import { Avatar, Icon, Modal } from './ui'

/* ─────────── 팀원 메뉴: 월간 일정 보기 / 1:1 대화 / 메일 보내기 ─────────── */
export function MemberMenu({ userId, x, y }: { userId: string; x?: number; y?: number }) {
  const { userOf, tableMembers, me } = useStore()
  const { closeModal, openModal, openDM, isMobile } = useUI()
  const u = userOf(userId)
  const m = tableMembers.find((x) => x.userId === userId)
  const mine = userId === me?.id
  const role = m?.role === 'leader' ? t('팀장') : m?.title || ''
  const at = !isMobile && x !== undefined && y !== undefined ? { x, y } : undefined
  return (
    <Modal title={u.name} onClose={closeModal} width={280} at={at} className="member-menu">
      <div className="mm-who">
        <Avatar name={u.name} size={36} />
        <div>
          <b>{role}{mine ? (role ? ' · ' : '') + t('나') : ''}</b>
          <small>{u.email}</small>
        </div>
      </div>
      <div className="mm-list">
        <button className="mm-item" data-autofocus onClick={() => openModal({ type: 'month', userId })}>
          <Icon name="cal" size={18} /> {mine ? t('내 월간 일정 보기') : t('월간 일정 보기')}
        </button>
        {!mine && (
          <button className="mm-item" onClick={() => openDM(userId)}>
            <Icon name="chat" size={18} /> {t('1:1 대화')}
          </button>
        )}
        {!mine && u.email && (
          <button className="mm-item" onClick={() => openModal({ type: 'mail', userId })}>
            <Icon name="mail" size={18} /> {t('메일 보내기')}
          </button>
        )}
      </div>
    </Modal>
  )
}

/* ─────────── 월간 일정 ─────────── */
type Bar = { e: EventItem; lane: number }

/** 한 주(7칸) 안에서 여러 날 일정이 겹치지 않게 줄(lane)을 나눈다 */
function barsOfWeek(spans: EventItem[], week: string[]): Bar[] {
  const inWeek = spans
    .filter((e) => e.date <= week[6] && e.endDate! >= week[0])
    .sort((a, b) => a.date.localeCompare(b.date) || b.endDate!.localeCompare(a.endDate!))
  const laneEnd: string[] = []
  return inWeek.map((e) => {
    let lane = laneEnd.findIndex((end) => end < e.date)
    if (lane < 0) lane = laneEnd.length
    laneEnd[lane] = e.endDate!
    return { e, lane }
  })
}

export function MonthModal({ userId: firstUser, date: firstDate }: { userId: string; date?: string }) {
  const { db, me, myMember, userOf, tableMembers } = useStore()
  const { closeModal, openLayer, setSelected, selected, isMobile } = useUI()
  const today = todayStr()
  const [ym, setYm] = useState(() => {
    const d = parse(firstDate ?? selected)
    return { y: d.getFullYear(), m: d.getMonth() }
  })
  const [pick, setPick] = useState(firstDate ?? selected)
  // 위쪽 사진을 누르면 그 사람의 월간 일정으로 바꿔 본다
  const [userId, setUserId] = useState(firstUser)
  const mine = userId === me?.id
  // 나 → 팀장 → 팀원 순서
  const people = [...tableMembers.filter((x) => x.userId === me?.id), ...tableMembers.filter((x) => x.userId !== me?.id)]

  // 다른 사람은 팀에 공유한 일정만, 나는 전부
  const evs = useMemo(() => db.events.filter((e) => e.ownerId === userId && (mine || e.shared)), [db.events, userId, mine])
  const spans = evs.filter(isMultiDay)
  const timed = evs.filter((e) => !isMultiDay(e))

  let days = monthGrid(ym.y, ym.m)
  if (parse(days[35]).getMonth() !== ym.m) days = days.slice(0, 35)
  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days.slice(i * 7, i * 7 + 7))
  const inMonth = (d: string) => parse(d).getMonth() === ym.m
  const move = (n: number) => setYm(({ y, m }) => ({ y: m + n < 0 ? y - 1 : m + n > 11 ? y + 1 : y, m: (m + n + 12) % 12 }))
  const goToday = () => {
    const d = parse(today)
    setYm({ y: d.getFullYear(), m: d.getMonth() })
    setPick(today)
  }
  // 쓰인 카테고리만 아래 설명에

  // 일정을 누르면 월간 일정은 그대로 두고 그 위에 상세를 보여 준다
  const openOcc = (o: Occurrence) => openLayer({ type: 'detail', occ: o })

  // 일정 추가: 내 달력은 바로 추가, 팀장 달력은 팀원이 요청, 다른 팀원 달력은 추가 없음
  const leaderCal = tableMembers.find((x) => x.userId === userId)?.role === 'leader' && myMember?.role === 'member'
  const canAdd = mine || leaderCal
  const addLabel = mine ? t('일정 추가') : t('일정 요청')
  const add = (d: string) => {
    // 월간 일정은 뒤에 그대로 두고 그 위에 추가 창을 연다 (저장하거나 닫으면 월간 일정만 남는다)
    if (mine) openLayer({ type: 'event', date: d })
    else openLayer({ type: 'request', mode: 'add', date: d })
  }
  const goWeek = (d: string) => {
    setSelected(d)
    closeModal()
  }

  const head = (
    <div className="mo-top">
      <button className="icon-btn" onClick={() => move(-1)} aria-label={t('이전 달')}><Icon name="chevL" /></button>
      <strong>{monthTitle(ym.y, ym.m)}</strong>
      <button className="icon-btn" onClick={() => move(1)} aria-label={t('다음 달')}><Icon name="chevR" /></button>
      <button className="btn small ghost" onClick={goToday}>{t('오늘')}</button>
      <span className="mo-note">
        {mine ? t('나만 보기 일정도 함께 보여요') : t('팀에 공유한 일정만 보여요')}
        {!isMobile && ' · ' + (canAdd ? t('빈 칸을 누르면 일정 추가, 날짜 숫자를 누르면 그 주 팀 표로, 일정을 누르면 상세를 볼 수 있어요') : t('날짜 숫자를 누르면 그 주 팀 표로, 일정을 누르면 상세를 볼 수 있어요'))}
      </span>
    </div>
  )
  const title = (
    <span className="mo-title">
      <span className="mo-title-text">{t('월간 일정')}</span>
      <span className="mo-people" role="tablist" aria-label={t('누구의 일정')}>
        {people.map((p) => {
          const name = userOf(p.userId).name
          return (
            <button
              key={p.userId}
              role="tab"
              aria-selected={p.userId === userId}
              className={'mo-person' + (p.userId === userId ? ' on' : '')}
              onClick={() => setUserId(p.userId)}
              title={p.userId === me?.id ? `${name} (${t('나')})` : name}
            >
              <Avatar name={name} size={30} />
              {/* 사진 아래 작은 표시: 나 / 팀장 / 직급 */}
              <span className="mo-tag">{p.userId === me?.id ? t('나') : p.role === 'leader' ? t('팀장') : p.title || ''}</span>
            </button>
          )
        })}
      </span>
    </span>
  )


  /* 폰: 달력(점) + 고른 날의 목록 */
  if (isMobile) {
    const list = occurrencesOn(evs, pick)
    return (
      <Modal title={title} onClose={closeModal} className="month-modal">
        {head}
        <div className="mo-mgrid">
          {dowHeads().map((d, i) => <span key={i} className={'mo-w' + (i === 0 ? ' sun' : '')}>{d}</span>)}
          {days.map((d) => {
            const occ = occurrencesOn(evs, d)
            const red = parse(d).getDay() === 0 || !!holidayName(d)
            return (
              <button
                key={d}
                className={'mo-d' + (inMonth(d) ? '' : ' out') + (red ? ' red' : '') + (d === today ? ' today' : '') + (d === pick ? ' sel' : '')}
                onClick={() => setPick(d)}
              >
                <span className="n">{parse(d).getDate()}</span>
                <span className="dots">{occ.slice(0, 3).map((o) => <i key={o.id} data-cat={o.category} />)}</span>
              </button>
            )
          })}
        </div>
        <h4 className="mo-day">{fmtMonthDay(pick)}{holidayName(pick) ? ` · ${holidayLabel(pick)}` : ''}</h4>
        {list.length === 0 ? (
          <p className="m-none">{t('일정 없음')}</p>
        ) : (
          <ul className="mo-list">
            {list.map((o) => (
              <li key={o.id}>
                <button className="m-item" data-cat={o.category} onClick={() => openOcc(o)}>
                  {isMultiDay(o) ? <span className="m-time allday-time">{t('종일')}</span> : <span className="m-time">{o.start}<small>{o.end}</small></span>}
                  <span className="m-main"><b>{o.title}</b>{o.place && <small>{o.place}</small>}</span>
                  <span className="cat-tag" data-cat={o.category}>{t(CATEGORY_LABEL[o.category])}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <button className="btn ghost mo-week" onClick={() => goWeek(pick)}>{t('이 주 팀 표 보기')}</button>
      </Modal>
    )
  }

  /* 데스크탑: 칸마다 일정 */
  return (
    <Modal title={title} onClose={closeModal} width={1040} className="month-modal">
      {head}
      <div className="mo-grid">
        {dowHeads().map((d, i) => <span key={i} className={'mo-w' + (i === 0 ? ' sun' : '')}>{d}</span>)}
        {weeks.map((week) => {
          const bars = barsOfWeek(spans, week)
          const lanes = bars.reduce((a, b) => Math.max(a, b.lane + 1), 0)
          return week.map((d, di) => {
            const occ = occurrencesOn(timed, d)
            const red = di === 0 || !!holidayName(d)
            const room = Math.max(1, 3 - lanes)
            return (
              <div
                key={d}
                className={'mo-cell' + (inMonth(d) ? '' : ' out') + (di === 0 || di === 6 ? ' wkend' : '') + (canAdd ? ' addable' : '')}
                // 팀 표처럼 칸을 누르면 그 날에 일정 추가 (칸 안의 버튼은 각자 동작)
                onClick={canAdd ? (e) => { if (!(e.target as HTMLElement).closest('button')) add(d) } : undefined}
                title={canAdd ? t('{date}에 {what}', { date: fmtMonthDay(d), what: addLabel }) : undefined}
              >
                <button className={'mo-num' + (red ? ' red' : '') + (d === today ? ' today' : '')} onClick={() => goWeek(d)} title={t('그 주 팀 표로 이동')}>
                  {parse(d).getDate() === 1 || !inMonth(d) ? fmtShort(d) : parse(d).getDate()}
                </button>
                {holidayName(d) && <small className="mo-hol">{holidayLabel(d)}</small>}
                {Array.from({ length: lanes }, (_, lane) => {
                  const b = bars.find((x) => x.lane === lane && x.e.date <= d && x.e.endDate! >= d)
                  if (!b) return <div key={'l' + lane} className="mo-bar empty" />
                  const s = b.e.date === d || di === 0
                  const e = b.e.endDate === d || di === 6
                  return (
                    <button
                      key={'l' + lane}
                      className={'mo-bar' + (s ? ' s' : '') + (e ? ' e' : '')}
                      data-cat={b.e.category}
                      onClick={() => openOcc({ ...b.e, baseId: b.e.id })}
                      title={b.e.title}
                    >
                      {s ? `${b.e.title} · ${t('종일')}` : ' '}
                    </button>
                  )
                })}
                {occ.slice(0, room).map((o) => (
                  <button key={o.id} className="mo-chip" data-cat={o.category} onClick={() => openOcc(o)} title={`${o.start}–${o.end} ${o.title}`}>
                    <i>{o.start}</i>{o.title}
                  </button>
                ))}
                {occ.length > room && (
                  <button className="mo-more" onClick={() => goWeek(d)}>{t('+{n}개 더', { n: occ.length - room })}</button>
                )}
              </div>
            )
          })
        })}
      </div>
    </Modal>
  )
}

/** 달이 바뀌는 칸: "12월 1일" (영어: "Dec 1") */
function fmtShort(d: string) {
  return fmtMonthDay(d).replace(/\s*\(.*\)$/, '').replace(/^[A-Z][a-z]{2}, /, '')
}

/* ─────────── 메일 보내기 ─────────── */
export function MailModal({ userId }: { userId: string }) {
  const { userOf, team, me } = useStore()
  const { closeModal, showToast } = useUI()
  const u = userOf(userId)
  const subject = team ? `[${team.name}] ` : ''
  // Gmail 작성 화면 (받는 사람·제목을 미리 채움). 보내는 것은 사용자가 Gmail에서 직접
  // authuser: 지금 로그인한 계정으로 열기 (로그인이 필요하면 아이디가 미리 채워짐)
  const who = me?.email ? `authuser=${encodeURIComponent(me.email)}&` : ''
  const gmail = `https://mail.google.com/mail/?${who}view=cm&fs=1&to=${encodeURIComponent(u.email)}&su=${encodeURIComponent(subject)}`
  const mailto = `mailto:${u.email}?subject=${encodeURIComponent(subject)}`
  // 휴대폰: 웹 주소로는 Gmail 앱이 받는 사람을 받지 못하므로 앱으로 직접 연다
  //  · 아이폰: Gmail 앱 주소 (앱이 없으면 1.5초 뒤 기본 메일 앱으로)
  //  · 안드로이드: mailto (대개 Gmail 이 받는 사람을 채운 채로 열림)
  const ios = isIOS()
  const android = /Android/i.test(navigator.userAgent)
  const openGmail = (e: React.MouseEvent) => {
    if (!ios && !android) { closeModal(); return } // PC: 링크 그대로 (웹 Gmail 새 창)
    e.preventDefault()
    closeModal()
    if (android) { window.location.href = mailto; return }
    const timer = window.setTimeout(() => { if (document.visibilityState === 'visible') window.location.href = mailto }, 1500)
    document.addEventListener('visibilitychange', () => window.clearTimeout(timer), { once: true })
    window.location.href = `googlegmail:///co?to=${encodeURIComponent(u.email)}&subject=${encodeURIComponent(subject)}`
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(u.email)
      showToast(t('메일 주소를 복사했어요'))
    } catch {
      showToast(t('복사하지 못했어요. 주소를 길게 눌러 복사해주세요'))
    }
  }
  return (
    <Modal title={t('{name}님에게 메일 보내기', { name: u.name })} onClose={closeModal} width={380}>
      <p className="hint mail-hint">{t('내 메일 작성 화면이 새로 열려요. 받는 사람은 미리 채워져 있어요.')}</p>
      <div className="mail-to">
        <small>{t('받는 사람')}</small>
        <span>{u.name} &lt;{u.email}&gt;</span>
      </div>
      <div className="mail-actions">
        <a className="btn primary" href={gmail} target="_blank" rel="noopener noreferrer" onClick={openGmail} data-autofocus>
          <Icon name="mail" size={16} /> {t('Gmail로 쓰기')}
        </a>
        <a className="btn ghost" href={mailto} onClick={closeModal}>{t('기본 메일 앱으로 쓰기')}</a>
        <button className="btn ghost" onClick={copy}><Icon name="copy" size={14} /> {t('주소 복사')}</button>
      </div>
    </Modal>
  )
}

/* ─────────── 홈 화면에 추가 ─────────── */

/** 프로필 메뉴에 "홈 화면에 추가"를 보여줄지 (이미 앱으로 열었으면 숨김) */
export function useInstallable(): boolean {
  const { isMobile } = useUI()
  const [, bump] = useState(0)
  useEffect(() => onInstallChange(() => bump((n) => n + 1)), [])
  if (isStandalone()) return false
  // 버튼 한 번에 설치 가능하거나, 폰 화면(아이폰 안내)일 때
  return canPromptInstall() || isMobile || isIOS()
}

/** "홈 화면에 추가"를 눌렀을 때: 바로 설치 창, 안 되면 안내 */
export async function startInstall(openGuide: () => void, done: (msg: string) => void) {
  if (canPromptInstall()) {
    const ok = await promptInstall()
    if (ok) done(t('홈 화면에 Weekendar를 추가했어요'))
    return
  }
  openGuide()
}

export function InstallModal() {
  const { closeModal } = useUI()
  const ios = isIOS()
  return (
    <Modal title={t('홈 화면에 Weekendar 추가')} onClose={closeModal} width={420}>
      <p className="hint install-lead">
        {ios ? t('아이폰은 Safari에서 직접 추가해야 해요. 세 번만 누르면 돼요.') : t('브라우저 메뉴에서 추가할 수 있어요.')}
      </p>
      <ol className="install-steps">
        {ios ? (
          <>
            <li><span className="no">1</span><span><Rich text={t('Safari의 <b>공유</b> 버튼을 눌러요 (안 보이면 ⋯ 버튼을 먼저)')} /></span><span className="ico"><Icon name="share" size={20} /></span></li>
            <li><span className="no">2</span><span><Rich text={t('목록에서 <b>홈 화면에 추가</b>를 눌러요')} /></span><span className="ico"><Icon name="addBox" size={20} /></span></li>
            <li><span className="no">3</span><span><Rich text={t('오른쪽 위 <b>추가</b>를 누르면 끝!')} /></span><span className="ico txt">{t('추가')}</span></li>
          </>
        ) : (
          <>
            <li><span className="no">1</span><span><Rich text={t('브라우저의 <b>⋮ 메뉴</b>를 눌러요')} /></span><span className="ico txt">⋮</span></li>
            <li><span className="no">2</span><span><Rich text={t('<b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 눌러요')} /></span><span className="ico"><Icon name="install" size={20} /></span></li>
          </>
        )}
      </ol>
      <p className="hint">{t('홈 화면 아이콘으로 열면 앱처럼 전체 화면으로 열리고, 휴대폰 알림도 받을 수 있어요.')}</p>
    </Modal>
  )
}
