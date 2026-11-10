import { useState } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { addDays, fmtHead, holidayName, mondayOf, weekRangeLabel } from '../lib/date'
import { initialDate } from '../lib/store'
import { Avatar, Icon } from './ui'
import { Notifications } from './Notifications'

export function Header() {
  const { team, me, isAdmin, unreadCount, logout, login, db, mode } = useStore()
  const { selected, setSelected, theme, toggleTheme, panelOpen, togglePanel, openModal, narrow, preview, setPreview } = useUI()
  const [pop, setPop] = useState<'bell' | 'menu' | null>(null)
  const mon = mondayOf(selected)
  const skipped = [0, 1, 2, 3, 4].map((i) => addDays(mon, i)).filter((d) => holidayName(d))

  return (
    <header className="topbar">
      <div className="titles">
        <h1>{team?.name} 주간예정사항</h1>
        <p>
          {weekRangeLabel(mon)}
          {skipped.length > 0 && (
            <span className="skipped"> · 제외: {skipped.map((d) => `${fmtHead(d)} ${holidayName(d)}`).join(', ')}</span>
          )}
        </p>
      </div>
      <div className="tools">
        <div className="weeknav">
          <button className="icon-btn" onClick={() => setSelected(addDays(selected, -7))} aria-label="이전 주" title="이전 주 (←)"><Icon name="chevL" /></button>
          <button className="btn small" onClick={() => setSelected(initialDate())} title="오늘 (T)">오늘</button>
          <button className="icon-btn" onClick={() => setSelected(addDays(selected, 7))} aria-label="다음 주" title="다음 주 (→)"><Icon name="chevR" /></button>
        </div>
        <span className="sep" />
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
        <button className="icon-btn" onClick={toggleTheme} aria-label="테마 전환" title="라이트/다크">
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <button className={'icon-btn panel-toggle' + (panelOpen ? '' : ' off')} onClick={togglePanel} aria-label="개인 패널 접기/펴기" title="개인 패널">
          <Icon name="panel" />
        </button>
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
