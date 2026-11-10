import { useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import type { Notice } from '../lib/types'
import { Icon } from './ui'

const SHOW_MS = 5000

/** 새 알림이 도착하면 오른쪽 아래에 5초 동안 보여준다. */
export function NoticeToasts() {
  const { db, me } = useStore()
  const [items, setItems] = useState<Notice[]>([])
  const seen = useRef<Set<string> | null>(null)
  const owner = useRef<string | null>(null)

  useEffect(() => {
    const mine = db.notices.filter((n) => n.userId === me?.id)
    // 처음 열었을 때나 계정이 바뀌었을 때 이미 있던 알림은 띄우지 않는다
    if (seen.current === null || owner.current !== (me?.id ?? null)) {
      seen.current = new Set(mine.map((n) => n.id))
      owner.current = me?.id ?? null
      setItems([])
      return
    }
    const fresh = mine.filter((n) => !seen.current!.has(n.id) && !n.read)
    mine.forEach((n) => seen.current!.add(n.id))
    if (fresh.length === 0) return
    setItems((prev) => [...prev, ...fresh].slice(-3))
    fresh.forEach((n) => {
      setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== n.id)), SHOW_MS)
    })
  }, [db.notices, me?.id])

  if (items.length === 0) return null
  return (
    <div className="ntoast-stack" role="status" aria-live="polite">
      {items.map((n) => (
        <button key={n.id} className="ntoast" onClick={() => setItems((p) => p.filter((x) => x.id !== n.id))}>
          <span className="ntoast-ico"><Icon name="bell" size={18} /></span>
          <span className="ntoast-body">
            <strong>{n.kind === 'request' ? '일정 요청' : n.kind === 'join' ? '팀 참여 요청' : '요청 결과'}</strong>
            <span>{n.text}</span>
          </span>
          <span className="ntoast-time">지금</span>
        </button>
      ))}
    </div>
  )
}
