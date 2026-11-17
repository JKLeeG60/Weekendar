/**
 * 홈 화면에 추가 (앱처럼 설치)
 * - 안드로이드 크롬·PC 크롬/엣지: 브라우저가 주는 설치 신호(beforeinstallprompt)를 잡아 두었다가 버튼으로 설치 창을 띄운다
 * - 아이폰·아이패드(Safari): 웹에서 설치 창을 띄울 수 없어 공유 버튼 안내를 보여준다
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((f) => f())

// 페이지가 열리자마자 신호를 잡아 둔다 (main.tsx 에서 이 파일을 불러온다)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // 브라우저 기본 안내 띠 대신 우리 버튼으로
    deferred = e as InstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    emit()
  })
}

/** 지금 홈 화면 앱(설치된 앱)으로 열려 있는지 */
export function isStandalone(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
}

/** 아이폰·아이패드인지 (아이패드는 PC처럼 보이기도 해서 터치로 함께 판단) */
export function isIOS(): boolean {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/** 버튼 한 번으로 설치 창을 띄울 수 있는지 */
export const canPromptInstall = () => !!deferred

/** 설치 창 띄우기. 설치했으면 true */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false
  const e = deferred
  deferred = null
  await e.prompt()
  const { outcome } = await e.userChoice
  emit()
  return outcome === 'accepted'
}

/** 설치 가능 상태가 바뀌면 알려준다 */
export function onInstallChange(f: () => void) {
  listeners.add(f)
  return () => {
    listeners.delete(f)
  }
}
