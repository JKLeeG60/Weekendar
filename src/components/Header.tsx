import { useState } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { addDays, isoWeek, mondayOf, weekRangeLabel } from '../lib/date'
import { Avatar, Icon } from './ui'
import { Notifications } from './Notifications'
import { ChatButton } from './Chat'

/** 모바일에서는 탭마다 큰 제목이 바뀜 (팀 주간표 / 내 일정 / 할 일 / 대화) */
export function Header({ mobileTitle, eyebrow }: { mobileTitle?: string; eyebrow?: string } = {}) {
  const { team, me, isAdmin, unreadCount, logout, login, db, mode } = useStore()
  const { selected, setSelected, themePref, setThemePref, panelOpen, togglePanel, openModal, narrow, preview, setPreview } = useUI()
  const [pop, setPop] = useState<'bell' | 'menu' | null>(null)
  const mon = mondayOf(selected)

  return (
    <header className="topbar">
      <div className="tb-side" aria-hidden="true" />
      <div className="titles">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <div className="title-row">
          <button className="icon-btn title-arrow" onClick={() => setSelected(addDays(selected, -7))} aria-label="이전 주" title="이전 주 (←)"><Icon name="chevL" /></button>
          <h1>{mobileTitle ?? `${team?.name} 주간예정사항`}</h1>
          <button className="icon-btn title-arrow" onClick={() => setSelected(addDays(selected, 7))} aria-label="다음 주" title="다음 주 (→) · 이번 주로 돌아가기: T"><Icon name="chevR" /></button>
        </div>
        <p className="subtitle">
          <span>{weekRangeLabel(mon)}</span>
          <span className="week-pill">{isoWeek(mon)}주차</span>
        </p>
      </div>
      <div className="tools">
        <div className="toolgroup">
        <ChatButton />
        <div className="rel">
          <button className="icon-btn" onClick={() => setPop(pop === 'bell' ? null : 'bell')} aria-label="알림" title="알림">
            <Icon name="bell" />
            {unreadCount > 0 && <span className="dot-badge">{unreadCount}</span>}
          </button>
          {pop === 'bell' && <Notifications onClose={() => setPop(null)} />}
        </div>
        {isAdmin && (
          <button className="icon-btn" onClick={() => openModal({ type: 'admin' })} aria-label="팀 관리" title="팀 관리">
            <Icon name="users" />
          </button>
        )}
        <button className={'icon-btn panel-toggle' + (panelOpen ? '' : ' off')} onClick={togglePanel} aria-label="내 일정 패널 접기/펴기" title={panelOpen ? '내 일정·할 일 패널 숨기기' : '내 일정·할 일 패널 보이기'}>
          <Icon name="panel" />
        </button>
        </div>
        <div className="rel">
          <button className="avatar-btn" onClick={() => setPop(pop === 'menu' ? null : 'menu')} aria-label="계정 메뉴">
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
                {mode === 'demo' && <div className="menu-label">데모 계정 전환</div>}
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
                  <span>화면</span>
                  <div className="theme-seg" role="radiogroup" aria-label="화면 모드">
                    {([['system', '자동'], ['light', '라이트'], ['dark', '다크']] as const).map(([v, l]) => (
                      <button key={v} role="radio" aria-checked={themePref === v} className={themePref === v ? 'on' : ''} onClick={() => setThemePref(v)}>{l}</button>
                    ))}
                  </div>
                </div>
                <div className="menu-sep" />
                <button className="menu-item" onClick={() => { setPop(null); openModal({ type: 'calendar' }) }}>
                  캘린더 앱에서 보기
                </button>
                <button className="menu-item" onClick={() => { setPop(null); openModal({ type: 'push' }) }}>
                  휴대폰 알림
                </button>
                {!narrow && (
                  <button className="menu-item" onClick={() => { setPop(null); setPreview(!preview) }}>
                    {preview ? '데스크탑 화면으로 돌아가기' : '폰 화면 미리보기'}
                  </button>
                )}
                <button className="menu-item" onClick={() => { setPop(null); logout() }}>
                  <Icon name="logout" size={15} /> 로그아웃
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
