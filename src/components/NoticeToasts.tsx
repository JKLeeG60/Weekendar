import { useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { mentionsMe } from '../lib/chat'
import { onPopup } from '../lib/bus'
import { Icon } from './ui'

const SHOW_MS = 5000

interface Item {
  id: string
  kind: 'notice' | 'mention' | 'remind'
  title: string
  text: string
  tag?: string
  icon?: 'clock' | 'cal'
}

const noticeTitle = (k: string) => (k === 'request' ? '일정 요청' : k === 'join' ? '팀 참여 요청' : '요청 결과')

/**
 * 오른쪽 아래 알림 팝업 (5초).
 * - 새 알림(요청·결과·참여)
 * - 대화에서 누가 나를 @호출했을 때 (대화창을 보고 있으면 띄우지 않음)
 * 일반 대화는 팝업 없이 말풍선 숫자만 올라간다.
 */
export function NoticeToasts() {
  const { db, me, messages, userOf } = useStore()
  const { chatOpen, setChatOpen } = useUI()
  const [items, setItems] = useState<Item[]>([])
  const seenNotice = useRef<Set<string> | null>(null)
  const seenMsg = useRef<Set<string> | null>(null)
  const owner = useRef<string | null>(null)

  const push = (fresh: Item[]) => {
    if (fresh.length === 0) return
    setItems((prev) => [...prev, ...fresh].slice(-3))
    fresh.forEach((n) => setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== n.id)), SHOW_MS))
  }

  // 미리 알림 등 다른 곳에서 보낸 팝업
  useEffect(() => onPopup((m) => push([{ id: m.id, kind: 'remind', title: m.title, text: m.text, tag: m.tag, icon: m.icon }])), [])

  // 계정이 바뀌면 이미 있던 것은 띄우지 않는다
  useEffect(() => {
    if (owner.current !== (me?.id ?? null)) {
      owner.current = me?.id ?? null
      seenNotice.current = null
      seenMsg.current = null
      setItems([])
    }
  }, [me?.id])

  useEffect(() => {
    const mine = db.notices.filter((n) => n.userId === me?.id)
    if (seenNotice.current === null) {
      seenNotice.current = new Set(mine.map((n) => n.id))
      return
    }
    const fresh = mine.filter((n) => !seenNotice.current!.has(n.id) && !n.read)
    mine.forEach((n) => seenNotice.current!.add(n.id))
    push(fresh.map((n) => ({ id: n.id, kind: 'notice', title: noticeTitle(n.kind), text: n.text })))
  }, [db.notices, me?.id])

  useEffect(() => {
    if (seenMsg.current === null) {
      seenMsg.current = new Set(messages.map((m) => m.id))
      return
    }
    const fresh = messages.filter(
      (m) => !seenMsg.current!.has(m.id) && mentionsMe(m, me?.id) && Date.now() - m.createdAt < 60000,
    )
    messages.forEach((m) => seenMsg.current!.add(m.id))
    if (chatOpen) return // 대화를 보고 있으면 이미 보인다
    push(fresh.map((m) => ({ id: 'm_' + m.id, kind: 'mention', title: `${userOf(m.authorId).name}님이 나를 호출했어요`, text: m.body })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, me?.id])

  // 대화창을 열면 호출 팝업은 바로 닫는다 (이미 대화창에서 보이므로)
  useEffect(() => {
    if (chatOpen) setItems((prev) => prev.filter((x) => x.kind !== 'mention'))
  }, [chatOpen])

  if (items.length === 0) return null
  return (
    <div className={'ntoast-stack' + (chatOpen ? ' beside-chat' : '')} role="status" aria-live="polite">
      {items.map((n) => (
        <button
          key={n.id}
          className={'ntoast' + (n.kind !== 'notice' ? ' ' + n.kind : '') + (n.icon === 'cal' ? ' info' : '')}
          onClick={() => {
            setItems((p) => p.filter((x) => x.id !== n.id))
            if (n.kind === 'mention') setChatOpen(true)
          }}
        >
          <span className="ntoast-ico">{n.kind === 'mention' ? <b>@</b> : <Icon name={n.kind === 'remind' ? n.icon ?? 'clock' : 'bell'} size={18} />}</span>
          <span className="ntoast-body">
            <strong>{n.title}</strong>
            <span>{n.text}</span>
          </span>
          <span className="ntoast-time">{n.tag ?? '지금'}</span>
        </button>
      ))}
    </div>
  )
}
