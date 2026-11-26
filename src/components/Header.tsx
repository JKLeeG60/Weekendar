import { useEffect, useState } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { addDays, isoWeek, mondayOf, monthTitle, parse, weekPill, weekRangeLabel } from '../lib/date'
import { t } from '../lib/i18n'
import { Avatar, Icon } from './ui'
import { PrintShareItems } from './PrintShare'
import { Notifications } from './Notifications'
import { ChatButton } from './Chat'

/** 모바일에서는 탭마다 큰 제목이 바뀜 (팀 주간표 / 내 일정 / 할 일 / 대화) */
export function Header({ mobileTitle, eyebrow, teamMenu }: { mobileTitle?: string; eyebrow?: string; teamMenu?: boolean } = {}) {
  const { team, me, isAdmin, unreadCount, logout, login, db, mode, myTeams } = useStore()
  // 두 팀에 속해 있으면 팀 전환 (데스크탑: 왼쪽 끝 버튼, 휴대폰: 제목을 눌러 목록)
  const multi = myTeams.length > 1
  const [teamOpen, setTeamOpen] = useState(false)
  const { selected, setSelected, panelOpen, togglePanel, openModal, monthView, setMonthView, searchOpen, setSearchOpen } = useUI()
  const [pop, setPop] = useState<'bell' | 'menu' | null>(null)
  // 단축키(알림)로 알림 목록 열고 닫기
  useEffect(() => {
    const h = () => setPop((p) => (p === 'bell' ? null : 'bell'))
    window.addEventListener('wk:notices', h)
    return () => window.removeEventListener('wk:notices', h)
  }, [])
  const mon = mondayOf(selected)

  return (
    <header className="topbar">
      {/* 월간 보기일 때 팀원 사진 줄이 이 자리에 들어온다 (People.tsx) */}
      <div className="tb-side" id={mobileTitle === undefined ? 'tb-left' : undefined} aria-hidden={monthView || (multi && mobileTitle === undefined) ? undefined : true}>
        {multi && mobileTitle === undefined && !monthView && <TeamSeg />}
      </div>
      <div className="titles">
        {(eyebrow || (teamMenu && multi)) && <span className="eyebrow">{teamMenu && multi ? team?.name : eyebrow}</span>}
        <div className="title-row">
          {teamMenu && multi ? (
            <div className="rel">
              <button className={'team-title' + (teamOpen ? ' open' : '')} onClick={() => setTeamOpen((v) => !v)} aria-haspopup="listbox" aria-expanded={teamOpen}>
                <h1>{mobileTitle}</h1>
                <Icon name="chevD" size={18} />
              </button>
              {teamOpen && <TeamMenu onClose={() => setTeamOpen(false)} />}
            </div>
          ) : (
            <h1>{mobileTitle ?? (monthView ? t('{team} 월간 일정', { team: team?.name ?? '' }) : t('{team} 주간예정사항', { team: team?.name ?? '' }))}</h1>
          )}
        </div>
        {/* 주 이동: 화살표가 바꾸는 대상(날짜) 양옆에 둔다. 모바일에서는 숨김(주간 카드에 따로 있음) */}
        {/* 월간 보기: 주간의 '‹ 날짜 › 주차' 자리에 '‹ 2026년 11월 ›' */}
        {monthView && mobileTitle === undefined && (() => {
          const d = parse(monthView.date ?? selected)
          const ym = monthView.ym ?? { y: d.getFullYear(), m: d.getMonth() }
          const go = (n: number) => setMonthView({ ...monthView, ym: { y: ym.m + n < 0 ? ym.y - 1 : ym.m + n > 11 ? ym.y + 1 : ym.y, m: (ym.m + n + 12) % 12 } })
          const now = new Date()
          const isNow = now.getFullYear() === ym.y && now.getMonth() === ym.m
          return (
            <div className="week-nav">
              <button className="icon-btn week-arrow" onClick={() => go(-1)} aria-label={t('이전 달')} title={t('이전 달 (←)')}><Icon name="chevL" /></button>
              <span className="week-range">{monthTitle(ym.y, ym.m)}</span>
              <button className="icon-btn week-arrow" onClick={() => go(1)} aria-label={t('다음 달')} title={t('다음 달 (→) · 이번 달로: T')}><Icon name="chevR" /></button>
              {isNow
                ? <span className="week-pill">{t('이번 달')}</span>
                : <button className="week-pill" onClick={() => setMonthView({ ...monthView, ym: { y: now.getFullYear(), m: now.getMonth() } })}>{t('오늘')}</button>}
            </div>
          )
        })()}
        {!monthView && <div className="week-nav">
          <button className="icon-btn week-arrow" onClick={() => setSelected(addDays(selected, -7))} aria-label={t('이전 주')} title={t('이전 주 (←)')}><Icon name="chevL" /></button>
          <span className="week-range">{weekRangeLabel(mon)}</span>
          <button className="icon-btn week-arrow" onClick={() => setSelected(addDays(selected, 7))} aria-label={t('다음 주')} title={t('다음 주 (→) · 이번 주로 돌아가기: T')}><Icon name="chevR" /></button>
          <span className="week-pill">{weekPill(isoWeek(mon))}</span>
        </div>}
      </div>
      <div className="tools">
        <div className="toolgroup">
        {/* 검색 (데스크탑 ⌘F, 휴대폰은 달력 아이콘 왼쪽) */}
        <button className={'icon-btn' + (searchOpen ? ' on' : '')} onClick={() => setSearchOpen(true)} aria-label={t('검색')} title={t('검색 (⌘F)')}><Icon name="search" /></button>
        <ChatButton />
        {/* 내 월간 일정 */}
        <button className={'icon-btn' + (monthView ? ' on' : '')} onClick={() => (monthView ? setMonthView(null) : me && openModal({ type: 'month', userId: me.id }))} aria-label={t('내 월간 일정')} title={monthView ? t('주간 팀 표로') : t('내 월간 일정')}>
          <Icon name="cal" />
        </button>
        <div className="rel">
          <button className="icon-btn" onClick={() => setPop(pop === 'bell' ? null : 'bell')} aria-label={t('알림')} title={t('알림')}>
            <Icon name="bell" />
            {unreadCount > 0 && <span className="dot-badge">{unreadCount}</span>}
          </button>
          {pop === 'bell' && <Notifications onClose={() => setPop(null)} />}
        </div>
        {isAdmin && (
          <button className="icon-btn" onClick={() => openModal({ type: 'admin' })} aria-label={t('팀 관리')} title={t('팀 관리')}>
            <Icon name="users" />
          </button>
        )}
        <button className={'icon-btn panel-toggle' + (panelOpen ? '' : ' off')} onClick={togglePanel} aria-label={t('내 일정 패널 접기/펴기')} title={panelOpen ? t('내 일정·할 일 패널 숨기기') : t('내 일정·할 일 패널 보이기')}>
          <Icon name="panel" />
        </button>
        </div>
        <div className="rel">
          <button className="avatar-btn" onClick={() => setPop(pop === 'menu' ? null : 'menu')} aria-label={t('계정 메뉴')}>
            <Avatar name={me?.name ?? '?'} size={32} />
          </button>
          {pop === 'menu' && (
            <>
              <div className="popover-scrim" onMouseDown={() => setPop(null)} />
              <div className="menu">
                <div className="menu-me">
                  <strong>{me?.name}</strong>
                  <span>{me?.email}</span>
                </div>
                {mode === 'demo' && <div className="menu-label">{t('데모 계정 전환')}</div>}
                {mode === 'demo' && ['u_admin', 'u_leader', 'u_m2', 'u_m3', 'u_m4', 'u_m5'].map((id) => {
                  const u = db.users.find((x) => x.id === id)
                  if (!u) return null
                  return (
                    <button key={id} className={'menu-item' + (u.id === me?.id ? ' cur' : '')} onClick={() => { login(id); setPop(null) }}>
                      {u.name}
                      {u.id === me?.id && <Icon name="check" size={14} />}
                    </button>
                  )
                })}
                <div className="menu-sep" />
                {/* 인쇄·공유하기: 주간 보기면 이번 주 팀 표, 월간 보기면 그 달 */}
                <PrintShareItems onDone={() => setPop(null)} />
                {/* 화면·언어·할 일·알림 같은 설정은 "설정" 창에 모았다 */}
                <button className="menu-item" onClick={() => { setPop(null); openModal({ type: 'settings' }) }}>
                  <span><Icon name="gear" size={15} /> {t('설정')}</span>
                </button>
                <button className="menu-item" onClick={() => { setPop(null); logout() }}>
                  <span><Icon name="logout" size={15} /> {t('로그아웃')}</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

/** 팀 전환 (데스크탑, 왼쪽 끝): [마케팅팀 | 사업본부] */
function TeamSeg() {
  const { myTeams, switchTeam } = useStore()
  const { showToast } = useUI()
  return (
    <div className="team-seg" role="tablist" aria-label={t('팀 전환')}>
      {myTeams.map((x) => {
        const pending = x.role === 'pending'
        return (
          <button
            key={x.id}
            role="tab"
            aria-selected={x.current}
            className={x.current ? 'on' : ''}
            disabled={pending}
            title={pending ? t('관리자의 승인을 기다리고 있어요') : x.name}
            onClick={() => { if (!x.current) { void switchTeam(x.id); showToast(t('{team}(으)로 바꿨어요', { team: x.name })) } }}
          >
            {x.name}{pending && <small>{t('대기')}</small>}
          </button>
        )
      })}
    </div>
  )
}

/** 팀 전환 (휴대폰): 제목을 누르면 아래로 펼쳐지는 팀 목록 */
function TeamMenu({ onClose }: { onClose: () => void }) {
  const { myTeams, switchTeam } = useStore()
  const { showToast } = useUI()
  return (
    <>
      <div className="popover-scrim" onClick={onClose} />
      <div className="team-menu" role="listbox" aria-label={t('팀 전환')}>
        {myTeams.map((x) => {
          const pending = x.role === 'pending'
          return (
            <button
              key={x.id}
              role="option"
              aria-selected={x.current}
              className={x.current ? 'on' : ''}
              disabled={pending}
              onClick={() => { onClose(); if (!x.current) { void switchTeam(x.id); showToast(t('{team}(으)로 바꿨어요', { team: x.name })) } }}
            >
              <Avatar name={x.name} size={30} />
              <span className="tm-name">
                <b>{x.name}</b>
                <small>{pending ? t('승인 대기 중') : x.isAdmin ? t('관리자') : x.role === 'leader' ? t('팀장') : t('구성원')}</small>
              </span>
              {x.current && <Icon name="check" size={18} />}
            </button>
          )
        })}
      </div>
    </>
  )
}
