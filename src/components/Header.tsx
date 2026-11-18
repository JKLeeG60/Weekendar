import { useState } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { addDays, isoWeek, mondayOf, weekPill, weekRangeLabel } from '../lib/date'
import { t } from '../lib/i18n'
import { Avatar, Icon } from './ui'
import { Notifications } from './Notifications'
import { ChatButton } from './Chat'

/** 모바일에서는 탭마다 큰 제목이 바뀜 (팀 주간표 / 내 일정 / 할 일 / 대화) */
export function Header({ mobileTitle, eyebrow }: { mobileTitle?: string; eyebrow?: string } = {}) {
  const { team, me, myMember, isAdmin, unreadCount, logout, login, db, mode } = useStore()
  const { selected, setSelected, panelOpen, togglePanel, openModal } = useUI()
  const [pop, setPop] = useState<'bell' | 'menu' | null>(null)
  const mon = mondayOf(selected)

  return (
    <header className="topbar">
      <div className="tb-side" aria-hidden="true" />
      <div className="titles">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <div className="title-row">
          <h1>{mobileTitle ?? t('{team} 주간예정사항', { team: team?.name ?? '' })}</h1>
        </div>
        {/* 주 이동: 화살표가 바꾸는 대상(날짜) 양옆에 둔다. 모바일에서는 숨김(주간 카드에 따로 있음) */}
        <div className="week-nav">
          <button className="icon-btn week-arrow" onClick={() => setSelected(addDays(selected, -7))} aria-label={t('이전 주')} title={t('이전 주 (←)')}><Icon name="chevL" /></button>
          <span className="week-range">{weekRangeLabel(mon)}</span>
          <button className="icon-btn week-arrow" onClick={() => setSelected(addDays(selected, 7))} aria-label={t('다음 주')} title={t('다음 주 (→) · 이번 주로 돌아가기: T')}><Icon name="chevR" /></button>
          <span className="week-pill">{weekPill(isoWeek(mon))}</span>
        </div>
      </div>
      <div className="tools">
        <div className="toolgroup">
        <ChatButton />
        {/* 내 월간 일정 */}
        <button className="icon-btn" onClick={() => me && openModal({ type: 'month', userId: me.id })} aria-label={t('내 월간 일정')} title={t('내 월간 일정')}>
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
                {/* 화면·언어·할 일·알림 같은 설정은 "설정" 창에 모았다 */}
                <button className="menu-item" onClick={() => { setPop(null); openModal({ type: 'settings' }) }}>
                  <span><Icon name="gear" size={15} /> {t('설정')}</span>
                </button>
                {myMember && (myMember.role === 'leader' || myMember.role === 'member') && (
                  <button className="menu-item" onClick={() => { setPop(null); openModal({ type: 'tutorial' }) }}>
                    <span><Icon name="help" size={15} /> {t('사용법 다시 보기')}</span>
                  </button>
                )}
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
