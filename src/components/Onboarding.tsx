import { useState } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { clearInvite, getInvite } from '../lib/invite'
import { GoogleMark, Icon, Modal } from './ui'
import { PRIVACY_URL, TERMS_URL } from '../lib/legal'
import { localize, Rich, t } from '../lib/i18n'
import { LoginShowcase } from './LoginShowcase'

export function Logo({ size = 44 }: { size?: number }) {
  // 앱 아이콘과 같은 모양: 흰 바탕에 파란 '7'(날짜)과 일정 줄 3개
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="1" stopColor="#F1F1F6" />
        </linearGradient>
      </defs>
      <rect width="1024" height="1024" rx="230" fill="url(#lg)" />
      {/* 밝은 배경에서도 테두리가 보이게 옅은 선 */}
      <rect x="4" y="4" width="1016" height="1016" rx="226" fill="none" stroke="#000" strokeOpacity=".08" strokeWidth="8" />
      <polygon points="140.4,263.9 481.4,263.9 481.4,316.3 257.0,760.1 186.8,760.1 410.2,320.2 140.4,320.2" fill="#007AFF" />
      {[263.9, 489.3, 715.6].map((y) => (
        <rect key={y} x="580.2" y={y} width="303.4" height="43.5" rx="21.7" fill="#A3A9B9" />
      ))}
    </svg>
  )
}

export function Login() {
  const { login, db, mode, loginGoogle } = useStore()
  const { isMobile } = useUI()
  // 방금 탈퇴했으면 한 번만 안내
  const [bye] = useState(() => { try { const v = sessionStorage.getItem('weekendar-bye') === '1'; sessionStorage.removeItem('weekendar-bye'); return v } catch { return false } })
  const demo = [
    { id: 'u_admin', label: `${t('관리자')} · 김하늘` },
    { id: 'u_leader', label: `${t('팀장')} · 박서준` },
    { id: 'u_m3', label: `${t('팀원')} · 최유리` },
    { id: 'u_new', label: t('신규 사용자 (팀 없음)') },
  ]
  const card = (
      <div className="auth-card">
        <Logo size={64} />
        <h1 className="brand">Weekendar</h1>
        <p className="tagline">{t('우리 팀의 한 주를, 한눈에.')}</p>
        {getInvite() && (
          <div className="invite-banner">
            <Icon name="users" size={16} />
            <span><Rich text={t('초대 링크로 들어왔어요. 로그인하면 <b>{code}</b> 팀에 바로 참여 요청할 수 있어요.', { code: getInvite() ?? '' })} /></span>
          </div>
        )}
        {bye && <p className="bye-note">{t('탈퇴가 끝났어요. 그동안 이용해 주셔서 고마워요.')}</p>}
        <button className="btn google" onClick={() => (mode === 'cloud' ? loginGoogle() : login('u_new'))}>
          <GoogleMark />
          {t('Google로 계속하기')}
        </button>
        {mode === 'cloud' && <p className="fine"><Rich text={t('Google 계정으로 로그인하면 팀을 만들거나 <mbr>초대 코드로 참여할 수 있어요.')} /></p>}
        <p className="legal-links">
          <a href={TERMS_URL} target="_blank" rel="noopener">{t('이용약관')}</a>
          <span aria-hidden>·</span>
          <a href={PRIVACY_URL} target="_blank" rel="noopener">{t('개인정보처리방침')}</a>
        </p>
        {mode === 'demo' && <div className="demo-box">
          <div className="demo-title">{t('데모 계정으로 둘러보기')}</div>
          <div className="demo-list">
            {demo.map((d) => (
              <button key={d.id} className="chip-btn" onClick={() => login(d.id)} disabled={!db.users.some((u) => u.id === d.id)}>
                {d.label}
              </button>
            ))}
          </div>
          <p className="fine">{t('현재는 브라우저에 저장되는 체험용 데이터입니다.')}</p>
        </div>}
      </div>
  )
  // 폰 화면: 지금처럼 카드 하나 / 데스크탑: 왼쪽 3/4 소개 슬라이드 + 오른쪽 1/4 로그인
  if (isMobile) return <div className="center-screen">{card}</div>
  return (
    <div className="login-split">
      <LoginShowcase />
      <div className="login-side">{card}</div>
    </div>
  )
}

export function TeamChoice() {
  const { me, createTeam, joinTeam, logout, deleteAccount } = useStore()
  const [bye, setBye] = useState(false) // 탈퇴 확인 창
  const [busy, setBusy] = useState(false)
  const [byeErr, setByeErr] = useState<string | null>(null)
  const invited = getInvite()
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>(invited ? 'join' : 'choose')
  const [name, setName] = useState('')
  const [code, setCode] = useState(invited ?? '')
  const [err, setErr] = useState<string | null>(null)

  return (
    <div className="center-screen">
      <div className="auth-card wide">
        <Logo size={48} />
        <h1 className="brand sm">{t('{name}님, 환영합니다', { name: me?.name ?? '' })}</h1>
        <p className="tagline">{t('팀을 만들거나 기존 팀에 참여해 시작하세요.')}</p>

        {mode === 'choose' && (
          <div className="choice-row">
            <button className="choice" onClick={() => setMode('create')}>
              <span className="choice-ico"><Icon name="plus" size={26} /></span>
              <strong>{t('팀 만들기')}</strong>
              <span>{t('관리자가 되어 구성원을 초대하고 팀을 운영합니다.')}</span>
            </button>
            <button className="choice" onClick={() => setMode('join')}>
              <span className="choice-ico alt"><Icon name="users" size={26} /></span>
              <strong>{t('팀 참여하기')}</strong>
              <span>{t('관리자에게 받은 초대 코드로 팀에 들어갑니다. 팀장·팀원 역할은 관리자가 지정합니다.')}</span>
            </button>
          </div>
        )}

        {mode === 'create' && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              if (name.trim()) createTeam(name.trim())
            }}
          >
            <label className="field">
              <span>{t('팀 이름')}</span>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('예: 마케팅팀')} />
            </label>
            <p className="hint">{t('표 제목이 “{title}”으로 표시됩니다.', { title: t('{team} 주간예정사항', { team: name.trim() || t('000팀') }) })}</p>
            <div className="row-end">
              <button type="button" className="btn ghost" onClick={() => setMode('choose')}>{t('뒤로')}</button>
              <button className="btn primary" disabled={!name.trim()}>{t('팀 만들기')}</button>
            </div>
          </form>
        )}

        {mode === 'join' && (
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault()
              const r = await joinTeam(code)
              setErr(r)
              if (!r) clearInvite()
            }}
          >
            {invited && code === invited && <p className="hint invite-hint">{t('초대 링크로 받은 코드예요. "참여 요청"을 누르면 관리자 승인 후 팀에 들어가요.')}</p>}
            <label className="field">
              <span>{t('초대 코드')}</span>
              <input autoFocus value={code} onChange={(e) => { setCode(e.target.value); setErr(null) }} placeholder={t('예: WKND-2026')} />
            </label>
            {err && <p className="error">{localize(err)}</p>}
            <div className="row-end">
              <button type="button" className="btn ghost" onClick={() => { setMode('choose'); clearInvite() }}>{t('뒤로')}</button>
              <button className="btn primary" disabled={!code.trim()}>{t('참여 요청')}</button>
            </div>
          </form>
        )}

        <button className="link-btn" onClick={logout}>{t('다른 계정으로 로그인')}</button>
        <button className="link-btn withdraw-link" onClick={() => setBye(true)}>{t('Weekendar 탈퇴')}</button>
      </div>
      {bye && (
        <Modal
          title={t('Weekendar에서 탈퇴할까요?')}
          onClose={() => { setBye(false); setByeErr(null) }}
          width={380}
          footer={
            <>
              <button className="btn ghost" onClick={() => { setBye(false); setByeErr(null) }}>{t('취소')}</button>
              <button className="btn danger" disabled={busy} onClick={async () => {
                setBusy(true)
                // 로그인 화면에 완료 안내 (탈퇴하자마자 화면이 바뀌므로 먼저 남기고, 실패하면 지운다)
                try { sessionStorage.setItem('weekendar-bye', '1') } catch { /* 무시 */ }
                const e = await deleteAccount()
                setBusy(false)
                if (e) { try { sessionStorage.removeItem('weekendar-bye') } catch { /* 무시 */ } setByeErr(e) }
              }}>{t('탈퇴하기')}</button>
            </>
          }
        >
          <p className="leave-text"><Rich text={t('내 일정·할 일·메모·대화와 알림·구글 캘린더 연결 정보가 <b>모두 지워지고</b> 되돌릴 수 없어요.')} /></p>
          {byeErr && <p className="error">{byeErr}</p>}
        </Modal>
      )}
    </div>
  )
}

/** 약관 동의: 처음 로그인한 뒤 한 번. 필수 두 개를 모두 체크해야 시작할 수 있다 */
export function TermsAgree() {
  const { agreeTerms, logout } = useStore()
  const [terms, setTerms] = useState(false)
  const [privacy, setPrivacy] = useState(false)
  const [busy, setBusy] = useState(false)
  const all = terms && privacy
  const Check = ({ on }: { on: boolean }) => <span className={'agree-ck' + (on ? ' on' : '')} aria-hidden>{on && <Icon name="check" size={13} />}</span>
  return (
    <div className="center-screen">
      <div className="auth-card">
        <Logo size={56} />
        <h1 className="brand sm">{t('약관에 동의해주세요')}</h1>
        <p className="tagline"><Rich text={t('Weekendar를 시작하려면 <mbr>아래 내용에 동의가 필요해요.')} /></p>
        <div className="agree">
          <label className="agree-row all">
            <input type="checkbox" checked={all} onChange={(e) => { setTerms(e.target.checked); setPrivacy(e.target.checked) }} />
            <Check on={all} />
            <span>{t('전체 동의')}</span>
          </label>
          <label className="agree-row">
            <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
            <Check on={terms} />
            <span><b className="agree-req">{t('[필수]')}</b> {t('이용약관 동의')}</span>
            <a className="agree-view" href={TERMS_URL} target="_blank" rel="noopener">{t('보기')} ›</a>
          </label>
          <label className="agree-row">
            <input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
            <Check on={privacy} />
            <span><b className="agree-req">{t('[필수]')}</b> {t('개인정보 수집·이용 동의')}</span>
            <a className="agree-view" href={PRIVACY_URL} target="_blank" rel="noopener">{t('보기')} ›</a>
          </label>
        </div>
        <button className="btn primary agree-go" disabled={!all || busy} onClick={async () => { setBusy(true); await agreeTerms(); setBusy(false) }}>
          {t('동의하고 시작')}
        </button>
        <button className="link-btn" onClick={logout}>{t('다른 계정으로 로그인')}</button>
      </div>
    </div>
  )
}

export function PendingScreen() {
  const { me, team, logout } = useStore()
  return (
    <div className="center-screen">
      <div className="auth-card">
        <div className="pending-ring"><Icon name="clock" size={30} /></div>
        <h1 className="brand sm">{t('관리자 승인을 기다리고 있어요')}</h1>
        <p className="tagline">
          <Rich text={t('{name}님의 {team} 참여 요청이 전달되었습니다.<br>관리자가 역할(팀장·팀원)과 직급을 지정하면 바로 이용할 수 있어요.', { name: me?.name ?? '', team: team?.name ?? t('팀') })} />
        </p>
        <button className="btn ghost" onClick={logout}>{t('로그아웃')}</button>
      </div>
    </div>
  )
}
