import { useState } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { GoogleMark, Icon } from './ui'

export function Logo({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5ac8fa" />
          <stop offset="1" stopColor="#007aff" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="11" fill="url(#lg)" />
      <rect x="9" y="14" width="30" height="24" rx="4" fill="#fff" fillOpacity=".95" />
      <rect x="9" y="14" width="30" height="7" rx="3" fill="#ff3b30" />
      {[0, 1, 2, 3, 4].map((i) => (
        <rect key={i} x={12.5 + i * 5.4} y="25" width="3.6" height="9" rx="1.2" fill="#007aff" fillOpacity={i === 2 ? 1 : 0.28} />
      ))}
    </svg>
  )
}

export function Login() {
  const { login, db } = useStore()
  const { narrow, preview, setPreview } = useUI()
  const demo = [
    { id: 'u_admin', label: '관리자 · 김하늘' },
    { id: 'u_leader', label: '팀장 · 박서준' },
    { id: 'u_m3', label: '팀원 · 최유리' },
    { id: 'u_new', label: '신규 사용자 (팀 없음)' },
  ]
  return (
    <div className="center-screen">
      <div className="auth-card">
        <Logo size={64} />
        <h1 className="brand">Weekendar</h1>
        <p className="tagline">우리 팀의 한 주를, 한눈에.</p>
        <button className="btn google" onClick={() => login('u_new')}>
          <GoogleMark />
          Google로 계속하기
        </button>
        <div className="demo-box">
          <div className="demo-title">데모 계정으로 둘러보기</div>
          <div className="demo-list">
            {demo.map((d) => (
              <button key={d.id} className="chip-btn" onClick={() => login(d.id)} disabled={!db.users.some((u) => u.id === d.id)}>
                {d.label}
              </button>
            ))}
          </div>
          {!narrow && (
            <button className="link-btn preview-link" onClick={() => setPreview(!preview)}>
              {preview ? '데스크탑 화면으로 보기' : '폰 화면으로 미리보기'}
            </button>
          )}
          <p className="fine">현재는 브라우저에 저장되는 체험용 데이터입니다. 실제 Google 로그인은 서버 연결 후 활성화됩니다.</p>
        </div>
      </div>
    </div>
  )
}

export function TeamChoice() {
  const { me, createTeam, joinTeam, logout } = useStore()
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [err, setErr] = useState<string | null>(null)

  return (
    <div className="center-screen">
      <div className="auth-card wide">
        <Logo size={48} />
        <h1 className="brand sm">{me?.name}님, 환영합니다</h1>
        <p className="tagline">팀을 만들거나 기존 팀에 참여해 시작하세요.</p>

        {mode === 'choose' && (
          <div className="choice-row">
            <button className="choice" onClick={() => setMode('create')}>
              <span className="choice-ico"><Icon name="plus" size={26} /></span>
              <strong>팀 만들기</strong>
              <span>관리자가 되어 구성원을 초대하고 팀을 운영합니다.</span>
            </button>
            <button className="choice" onClick={() => setMode('join')}>
              <span className="choice-ico alt"><Icon name="users" size={26} /></span>
              <strong>팀 참여하기</strong>
              <span>관리자에게 받은 초대 코드로 팀에 들어갑니다. 팀장·팀원 역할은 관리자가 지정합니다.</span>
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
              <span>팀 이름</span>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 마케팅팀" />
            </label>
            <p className="hint">표 제목이 “{name.trim() || '000팀'} 주간예정사항”으로 표시됩니다.</p>
            <div className="row-end">
              <button type="button" className="btn ghost" onClick={() => setMode('choose')}>뒤로</button>
              <button className="btn primary" disabled={!name.trim()}>팀 만들기</button>
            </div>
          </form>
        )}

        {mode === 'join' && (
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              setErr(joinTeam(code))
            }}
          >
            <label className="field">
              <span>초대 코드</span>
              <input autoFocus value={code} onChange={(e) => { setCode(e.target.value); setErr(null) }} placeholder="예: WKND-2026" />
            </label>
            {err && <p className="error">{err}</p>}
            <div className="row-end">
              <button type="button" className="btn ghost" onClick={() => setMode('choose')}>뒤로</button>
              <button className="btn primary" disabled={!code.trim()}>참여 요청</button>
            </div>
          </form>
        )}

        <button className="link-btn" onClick={logout}>다른 계정으로 로그인</button>
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
        <h1 className="brand sm">관리자 승인을 기다리고 있어요</h1>
        <p className="tagline">
          {me?.name}님의 {team?.name ?? '팀'} 참여 요청이 전달되었습니다.
          <br />
          관리자가 역할(팀장·팀원)과 직급을 지정하면 바로 이용할 수 있어요.
        </p>
        <button className="btn ghost" onClick={logout}>로그아웃</button>
      </div>
    </div>
  )
}
