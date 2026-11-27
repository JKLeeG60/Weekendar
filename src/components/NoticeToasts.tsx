import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { mentionsMe } from '../lib/chat'
import { onPopup } from '../lib/bus'
import { Icon } from './ui'
import { localize, t } from '../lib/i18n'
import { confirmedBy } from '../lib/confirm'
import { inviteOf } from '../lib/attend'

const SHOW_MS = 5000
// 확인 버튼이 있는 알림은 눌러야 하므로 더 오래 둔다 (안 눌러도 팀 표에 "확인 필요" 표시가 남는다)
const CONFIRM_MS = 30000

interface Item {
  id: string
  kind: 'notice' | 'mention' | 'remind' | 'confirm' | 'invite'
  /** 'confirm'·'invite' 가 가리키는 일정 */
  eventId?: string
  title: string
  text: string
  tag?: string
  icon?: 'clock' | 'cal'
}

const noticeTitle = (k: string) => t(k === 'request' ? '일정 요청' : k === 'join' ? '팀 참여 요청' : k === 'confirm' ? '팀장이 일정을 변경했어요'
  : k === 'invite' ? '회의 초대' : k === 'decline' ? '회의 불참' : '요청 결과')

/**
 * 오른쪽 아래 알림 팝업 (5초).
 * - 새 알림(요청·결과·참여)
 * - 팀장이 일정을 바꿨을 때: "✅ 확인했어요" 버튼이 있는 알림 (30초)
 * - 대화에서 누가 나를 @호출했을 때 (대화창을 보고 있으면 띄우지 않음)
 * 일반 대화는 팝업 없이 말풍선 숫자만 올라간다.
 */
export function NoticeToasts() {
  const { db, me, messages, userOf, confirmEvent, respondInvite } = useStore()
  const { chatOpen, setChatOpen, modal } = useUI()
  const [items, setItems] = useState<Item[]>([])
  // 입력·상세 창(<dialog>)이 열려 있으면 알림을 그 창 안에 그린다.
  // 브라우저 기본 창은 항상 맨 앞이라, 창 밖에 있으면 어두운 배경 뒤로 가려지고 누를 수도 없기 때문.
  const [dialogEl, setDialogEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    const d = modal ? document.querySelector<HTMLElement>('dialog.modal[open]') : null
    if (!d) return setDialogEl(null)
    // 창이 튀어나오는 애니메이션 중에는 창 안의 알림 위치가 창 기준으로 틀어지므로, 끝난 뒤에 옮긴다
    let alive = true
    // (탭이 백그라운드라 애니메이션이 멈춰 있어도 0.4초 뒤에는 옮긴다)
    Promise.race([Promise.all(d.getAnimations().map((a) => a.finished)), new Promise((r) => setTimeout(r, 400))])
      .catch(() => undefined)
      .then(() => alive && setDialogEl(d))
    return () => {
      alive = false
    }
  }, [modal])
  const host = modal ? dialogEl : null
  const seenNotice = useRef<Set<string> | null>(null)
  const seenMsg = useRef<Set<string> | null>(null)
  const owner = useRef<string | null>(null)

  const push = (fresh: Item[]) => {
    if (fresh.length === 0) return
    setItems((prev) => [...prev, ...fresh].slice(-3))
    fresh.forEach((n) => setTimeout(() => setItems((prev) => prev.filter((x) => x.id !== n.id)), n.kind === 'confirm' || n.kind === 'invite' ? CONFIRM_MS : SHOW_MS))
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
    push(fresh.map((n): Item => ({
      id: n.id,
      // 회의 초대(일정이 남아 있을 때)는 [불참]·[참석] 버튼이 있는 팝업
      kind: n.kind === 'confirm' ? 'confirm' : n.kind === 'invite' && n.eventId ? 'invite' : 'notice',
      title: noticeTitle(n.kind), text: localize(n.text), eventId: n.eventId,
      icon: n.kind === 'decline' ? 'cal' : undefined,
    })))
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
    push(fresh.map((m) => ({ id: 'm_' + m.id, kind: 'mention', title: t('{name}님이 나를 호출했어요', { name: userOf(m.authorId).name }), text: m.body })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, me?.id])

  // 다른 곳에서 이미 확인했거나 일정이 없어졌으면 확인 팝업을 닫는다
  useEffect(() => {
    setItems((prev) => {
      const next = prev.filter((x) => {
        if (x.kind === 'invite') {
          // 이미 답했거나 일정이 없어졌으면 닫는다
          const e = db.events.find((ev) => ev.id === x.eventId)
          return !!e && inviteOf(e, me?.id)?.status === 'pending'
        }
        if (x.kind !== 'confirm') return true
        const e = db.events.find((ev) => ev.id === x.eventId)
        return !!e && !confirmedBy(db, e, me?.id ?? '')
      })
      return next.length === prev.length ? prev : next
    })
  }, [db.events, db.confirms, me?.id])

  // 대화창을 열면 호출 팝업은 바로 닫는다 (이미 대화창에서 보이므로)
  useEffect(() => {
    if (chatOpen) setItems((prev) => prev.filter((x) => x.kind !== 'mention'))
  }, [chatOpen])

  if (items.length === 0) return null
  const stack = (
    <div className={'ntoast-stack' + (chatOpen ? ' beside-chat' : '')} role="status" aria-live="polite">
      {items.map((n) => n.kind === 'invite' ? (
        <div key={n.id} className="ntoast confirm">
          <span className="ntoast-ico"><Icon name="users" size={18} /></span>
          <span className="ntoast-body">
            <strong>{n.title}</strong>
            <span>{n.text}</span>
            <span className="ntoast-actions">
              <button className="ntoast-ok" onClick={() => { void respondInvite(n.eventId!, 'accepted'); setItems((p) => p.filter((x) => x.id !== n.id)) }}>{t('참석')}</button>
              <button className="ntoast-later no" onClick={() => { void respondInvite(n.eventId!, 'declined'); setItems((p) => p.filter((x) => x.id !== n.id)) }}>{t('불참')}</button>
            </span>
          </span>
        </div>
      ) : n.kind === 'confirm' ? (
        <div key={n.id} className="ntoast confirm">
          <span className="ntoast-ico"><Icon name="cal" size={18} /></span>
          <span className="ntoast-body">
            <strong>{n.title}</strong>
            <span>{n.text}</span>
            <span className="ntoast-actions">
              <button className="ntoast-ok" onClick={() => { confirmEvent(n.eventId!); setItems((p) => p.filter((x) => x.id !== n.id)) }}>✅ {t('확인했어요')}</button>
              <button className="ntoast-later" onClick={() => setItems((p) => p.filter((x) => x.id !== n.id))}>{t('나중에')}</button>
            </span>
          </span>
        </div>
      ) : (
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
          <span className="ntoast-time">{n.tag ?? t('지금')}</span>
        </button>
      ))}
    </div>
  )
  return host ? createPortal(stack, host) : stack
}
