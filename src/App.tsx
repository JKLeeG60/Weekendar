import { useStore } from './lib/store'
import { useUI } from './lib/ui'
import { Login, PendingScreen, TeamChoice } from './components/Onboarding'
import { Main } from './components/Main'

function Screen() {
  const { me, myMember } = useStore()
  if (!me) return <Login />
  if (!myMember) return <TeamChoice />
  if (myMember.role === 'pending') return <PendingScreen />
  return <Main />
}

export default function App() {
  const { isMobile, preview, narrow } = useUI()
  // 데스크탑에서 미리보기를 켜면 폰 모양 프레임 안에 모바일 화면을 보여준다.
  if (preview && !narrow) {
    return (
      <div className="stage">
        <div className="phone-frame shell" data-mobile="true">
          <Screen />
        </div>
      </div>
    )
  }
  return (
    <div className="shell" data-mobile={isMobile}>
      <Screen />
    </div>
  )
}
