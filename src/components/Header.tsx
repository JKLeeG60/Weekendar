import { useState } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { addDays, isoWeek, mondayOf, weekPill, weekRangeLabel } from '../lib/date'
import { t, useLang, type LangPref } from '../lib/i18n'
import { Avatar, Icon } from './ui'
import { Notifications } from './Notifications'
import { ChatButton } from './Chat'
import { startInstall, useInstallable } from './People'

/** 모바일에서는 탭마다 큰 제목이 바뀜 (팀 주간표 / 내 일정 / 할 일 / 대화) */
export function Header({ mobileTitle, eyebrow }: { mobileTitle?: string; eyebrow?: string } = {}) {
  const { team, me, myMember, isAdmin, unreadCount, logout, login, db, mode } = useStore()
  const { selected, setSelected, themePref, setThemePref, panelOpen, togglePanel, openModal, showToast, narrow, preview, setPreview } = useUI()
  const [pop, setPop] = useState<'bell' | 'menu' | null>(null)
  const { pref, setPref } = useLang()
  const installable = useInstallable()
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
                <div className="menu-theme">
                  <span>{t('화면')}</span>
                  <div className="theme-seg" role="radiogroup" aria-label={t('화면 모드')}>
                    {([['system', '자동'], ['light', '라이트'], ['dark', '다크']] as const).map(([v, l]) => (
                      <button key={v} role="radio" aria-checked={themePref === v} className={themePref === v ? 'on' : ''} onClick={() => setThemePref(v)}>{t(l)}</button>
                    ))}
                  </div>
                </div>
                {/* 언어: 자동(기기 언어) / 한국어 / English — 언어 이름은 늘 그 언어로 */}
                <div className="menu-theme">
                  <span>{t('언어')}</span>
                  <div className="theme-seg" role="radiogroup" aria-label={t('언어')}>
                    {([['auto', t('자동')], ['ko', '한국어'], ['en', 'English']] as [LangPref, string][]).map(([v, l]) => (
                      <button key={v} role="radio" aria-checked={pref === v} className={pref === v ? 'on' : ''} onClick={() => setPref(v)}>{l}</button>
                    ))}
                  </div>
                </div>
                <div className="menu-sep" />
                <button className="menu-item" onClick={() => { setPop(null); openModal({ type: 'calendar' }) }}>
                  {t('캘린더 앱에서 보기')}
                </button>
                {installable && (
                  <button className="menu-item install-item" onClick={() => { setPop(null); startInstall(() => openModal({ type: 'install' }), showToast) }}>
                    <span><Icon name="addBox" size={16} /> {t('홈 화면에 추가')}</span>
                    <small>{t('앱처럼 쓰기')}</small>
                  </button>
                )}
                <button className="menu-item" onClick={() => { setPop(null); openModal({ type: 'push' }) }}>
                  {t('휴대폰 알림')}
                </button>
                {!narrow && (
                  <button className="menu-item" onClick={() => { setPop(null); setPreview(!preview) }}>
                    {preview ? t('데스크탑 화면으로 돌아가기') : t('폰 화면 미리보기')}
                  </button>
                )}
                {myMember && myMember.role !== 'pending' && (
                  <button className="menu-item danger" onClick={() => { setPop(null); openModal({ type: 'leave' }) }}>
                    {t('팀 나가기')}
                  </button>
                )}
                <button className="menu-item" onClick={() => { setPop(null); logout() }}>
                  <Icon name="logout" size={15} /> {t('로그아웃')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
