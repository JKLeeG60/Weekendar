import { useStore } from './lib/store'
import { useUI } from './lib/ui'
import { Login, PendingScreen, TeamChoice } from './components/Onboarding'
import { Main } from './components/Main'
import { t } from './lib/i18n'
import { useEffect, useState } from 'react'

/** 불러오는 중 화면 (index.html 의 첫 화면과 같은 모양). out 이면 부드럽게 사라진다 */
function Splash({ out }: { out: boolean }) {
  return (
    <div className={'splash' + (out ? ' out' : '')} role="status" aria-label={t('불러오는 중…')}>
      <div className="splash-box">
        <img className="splash-ic" src="/icons/icon-192.png" alt="" width={88} height={88} />
        <div className="splash-name">Weekendar</div>
        <div className="splash-tag">{t('우리 팀의 한 주를, 한눈에')}</div>
        <div className="splash-spin">
          {Array.from({ length: 12 }, (_, i) => (
            <i key={i} style={{ transform: `rotate(${i * 30}deg)`, animationDelay: `${-1 + i / 12}s` }} />
          ))}
        </div>
      </div>
    </div>
  )
}

/** 로그인·프로필 확인이 끝날 때까지 첫 화면을 보여 주고, 끝나면 0.35초 동안 사라지게 */
function useBusy() {
  const { me, loading, mode, db } = useStore()
  const busy = loading || (mode === 'cloud' && !!db.currentUserId && !me)
  const [shown, setShown] = useState(true)
  useEffect(() => {
    if (busy) { setShown(true); return }
    const id = window.setTimeout(() => setShown(false), 400)
    return () => window.clearTimeout(id)
  }, [busy])
  return { busy, shown }
}

function Screen() {
  const { me, myMember, loading, mode, db } = useStore()
  // 불러오는 중에는 화면을 비워 두고 위의 첫 화면(Splash)이 덮는다
  if (loading || (mode === 'cloud' && db.currentUserId && !me)) return null
  if (!me) return <Login />
  if (!myMember) return <TeamChoice />
  if (myMember.role === 'pending') return <PendingScreen />
  return <Main />
}

export default function App() {
  const { isMobile, preview, narrow } = useUI()
  const { busy, shown } = useBusy()
  const splash = shown && <Splash out={!busy} />
  // 데스크탑에서 미리보기를 켜면 폰 모양 프레임 안에 모바일 화면을 보여준다.
  if (preview && !narrow) {
    return (
      <div className="stage">
        <div className="phone-frame shell" data-mobile="true">
          <Screen />
        </div>
        {splash}
      </div>
    )
  }
  return (
    <div className="shell" data-mobile={isMobile}>
      <Screen />
      {splash}
    </div>
  )
}
