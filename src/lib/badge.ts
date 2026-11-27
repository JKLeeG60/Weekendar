/**
 * 앱 아이콘 숫자 배지 (홈 화면에 추가한 앱)
 * - 숫자 = 안 읽은 알림 + 내가 승인할 휴가·출장 + 안 읽은 대화
 * - 앱이 꺼져 있을 때는 서비스워커(sw.js)가 푸쉬를 받을 때마다 1씩 올린다.
 *   그래서 같은 숫자를 캐시('wk-badge')에도 적어 두어 서비스워커와 맞춘다.
 * - 지원하지 않는 브라우저(아이폰 일반 사파리 등)에서는 아무 일도 하지 않는다.
 */
import { useEffect } from 'react'
import { useStore } from './store'
import { canApprove } from './absence'

export function useAppBadge() {
  const { db, me, unreadCount, absences, chatUnread, dmUnread, mode } = useStore()
  const approve = absences.filter((a) => canApprove(db.members, me?.id, a)).length
  const n = me ? unreadCount + approve + chatUnread + dmUnread : 0
  useEffect(() => {
    // 체험 모드에서는 배지를 쓰지 않는다
    if (mode !== 'cloud') return
    setBadge(n)
  }, [n, mode])
}

export function setBadge(n: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  try {
    if (n > 0) void nav.setAppBadge?.(n).catch(() => {})
    else void nav.clearAppBadge?.().catch(() => {})
  } catch { /* 지원 안 함 */ }
  // 서비스워커가 이어서 셀 수 있게 기록
  if ('caches' in window) void caches.open('wk-badge').then((c) => c.put('/__badge', new Response(String(n)))).catch(() => {})
}
