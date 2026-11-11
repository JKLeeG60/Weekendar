/**
 * 초대 링크: https://사이트/join/WKND-XXXXXX (예전 형식 ?join=WKND-XXXXXX 도 지원)
 * 로그인(구글) 과정에서 주소의 ?join 이 사라지므로, 처음 열 때 코드를 브라우저에 잠시 보관한다.
 */
const KEY = 'weekendar-invite'

export function captureInvite() {
  try {
    const url = new URL(window.location.href)
    const path = url.pathname.match(/^\/join\/([^/]+)\/?$/)
    const code = path ? decodeURIComponent(path[1]) : url.searchParams.get('join')
    if (!code) return
    localStorage.setItem(KEY, code.trim().toUpperCase())
    url.searchParams.delete('join')
    window.history.replaceState(null, '', (path ? '/' : url.pathname) + url.search + url.hash)
  } catch {
    /* 저장소를 못 쓰면 링크 대신 코드 입력으로 참여 */
  }
}

export function getInvite(): string | null {
  try { return localStorage.getItem(KEY) } catch { return null }
}

export function clearInvite() {
  try { localStorage.removeItem(KEY) } catch { /* 무시 */ }
}

/** 팀 관리 화면에서 복사하는 초대 링크 (체험 모드면 체험 모드로 열리게) */
export function inviteLink(code: string) {
  const demo = new URLSearchParams(window.location.search).has('demo')
  if (demo) return `${window.location.origin}/?demo&join=${encodeURIComponent(code)}`
  return `${window.location.origin}/join/${encodeURIComponent(code)}`
}
