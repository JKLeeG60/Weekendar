import React, { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { occurrencesOn } from '../lib/events'
import { fmtHead, fmtLong, weekDays } from '../lib/date'
import { ALL, ALL_EN, mentionsMe, splitMentions, timeLabel } from '../lib/chat'
import { getLang, localize, t } from '../lib/i18n'
import type { ChatRef, Message } from '../lib/types'
import { Avatar, Icon } from './ui'

/** 자주 쓰는 반응 이모지 */
const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🙏']

/** 답장·전달 미리보기용 한 줄 요약 */
const snippet = (m: Message | undefined) =>
  !m ? t('원본 메시지를 찾을 수 없어요')
    : m.deleted ? t('삭제된 메시지예요')
    : m.body ? m.body.split('\n')[0]
    : m.ref ? t('일정을 공유했어요') + ' · ' + m.ref.title
    : ''

/** Esc 로 닫기 (대화창 전체가 닫히지 않게 먼저 가로챈다) */
function useEsc(onClose: () => void) {
  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onClose])
}

const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 상단 툴바의 말풍선: 안 읽은 수, 나를 호출하면 @가 붙는다 */
export function ChatButton() {
  const { chatUnread: teamUnread, chatMentions, dmUnread } = useStore()
  const { chatOpen, setChatOpen } = useUI()
  // 팀 대화 + 1:1 대화 안 읽은 수
  const chatUnread = teamUnread + dmUnread
  const label = chatMentions > 0 ? t('나를 호출한 메시지 포함 안 읽은 대화 {n}개', { n: chatUnread }) : t('안 읽은 대화 {n}개', { n: chatUnread })
  return (
    <button
      className={'icon-btn tb-chat' + (chatOpen ? ' open' : '')}
      onClick={() => setChatOpen(!chatOpen)}
      aria-label={t('팀 대화') + (chatUnread ? ` (${label})` : '')}
      title={t('팀 대화')}
    >
      <Icon name="chat" />
      {chatUnread > 0 && (
        <span className={'chat-badge' + (chatMentions > 0 ? ' at' : '')}>
          {chatMentions > 0 && <i>@</i>}
          {chatUnread > 99 ? '99+' : chatUnread}
        </span>
      )}
    </button>
  )
}

/** 데스크탑: 오른쪽 위에 뜨는 대화창 */
export function ChatWindow() {
  const { chatOpen, setChatOpen, modal } = useUI()
  useEffect(() => {
    if (!chatOpen) return
    const h = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !modal) setChatOpen(false)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [chatOpen, modal, setChatOpen])
  // 위쪽(제목 줄)을 끌어서 창을 옮긴다. null 이면 기본 자리(오른쪽)
  const [pos, setPos] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const winRef = useRef<HTMLDivElement>(null)
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = winRef.current
    if (!el || e.button !== 0) return
    const target = e.target as HTMLElement
    if (!target.closest('.chat-head') || target.closest('button')) return
    const r = el.getBoundingClientRect()
    const dx = e.clientX - r.left
    const dy = e.clientY - r.top
    setPos({ x: r.left, y: r.top, w: r.width, h: r.height })
    setDragging(true)
    e.preventDefault()
    const move = (ev: PointerEvent) =>
      setPos({ w: r.width, h: r.height, x: clamp(ev.clientX - dx, 8, innerWidth - r.width - 8), y: clamp(ev.clientY - dy, 8, innerHeight - r.height - 8) })
    const up = () => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  // 브라우저 창이 작아지면 옮긴 창이 화면 밖으로 나가지 않게 다시 맞춘다
  useEffect(() => {
    if (!pos) return
    const fit = () => setPos((p) => p && { ...p, x: clamp(p.x, 8, Math.max(8, innerWidth - p.w - 8)), y: clamp(p.y, 8, Math.max(8, innerHeight - p.h - 8)) })
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [pos])
  if (!chatOpen) return null
  return (
    <div
      ref={winRef}
      className={'chat-window' + (dragging ? ' dragging' : '')}
      role="dialog"
      aria-label={t('팀 대화')}
      onPointerDown={startDrag}
      style={pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto', width: pos.w, height: pos.h } : undefined}
    >
      <ChatPanel onClose={() => setChatOpen(false)} />
    </div>
  )
}

/** 대화창: [팀 대화 | 1:1 대화] 탭 (데스크탑 창과 모바일 탭에서 함께 사용) */
export function ChatPanel({ onClose }: { onClose?: () => void }) {
  const { team, tableMembers, userOf, chatUnread, dmUnread, rooms, me, createRoom, inviteToRoom, leaveRoom } = useStore()
  const { chatTab, setChatTab, dmPeer, setDmPeer } = useUI()
  const sel = chatTab === 'dm' ? dmPeer : null
  // "room:방id" 이면 그룹 대화방, 아니면 1:1 상대 id
  const roomId = sel?.startsWith('room:') ? sel.slice(5) : null
  const peer = roomId ? null : sel
  const peerMember = tableMembers.find((m) => m.userId === peer)
  const room = roomId ? rooms.find((r) => r.id === roomId) : undefined
  const roomOthers = room ? room.memberIds.filter((x) => x !== me?.id) : []
  const [invite, setInvite] = useState(false)
  // 방이 없어지면(나가기 등) 목록으로
  useEffect(() => { if (roomId && !room) setDmPeer(null) }, [roomId, room, setDmPeer])
  return (
    <section className="chat">
      <header className="chat-head">
        {room ? (
          <>
            <button className="icon-btn dm-back" onClick={() => setDmPeer(null)} aria-label={t('개인 대화 목록')}>
              <Icon name="chevL" size={18} />
            </button>
            <GroupAvatar ids={roomOthers} size={30} />
            <div className="dm-who">
              <strong>{roomOthers.map((x) => userOf(x).name).join(', ')}</strong>
              <small>{t('그룹 대화 · {n}명', { n: room.memberIds.length })}</small>
            </div>
            <button className="icon-btn dm-tool" onClick={() => setInvite(true)} aria-label={t('대화상대 초대')} title={t('대화상대 초대')}>
              <Icon name="userPlus" size={18} />
            </button>
            <button
              className="icon-btn dm-tool"
              onClick={() => { if (window.confirm(t('이 대화방에서 나갈까요? 나가면 대화 내용이 내 목록에서 사라져요.'))) leaveRoom(room.id) }}
              aria-label={t('대화방 나가기')}
              title={t('대화방 나가기')}
            >
              <Icon name="logout" size={17} />
            </button>
          </>
        ) : peer ? (
          <>
            <button className="icon-btn dm-back" onClick={() => setDmPeer(null)} aria-label={t('개인 대화 목록')}>
              <Icon name="chevL" size={18} />
            </button>
            <Avatar name={userOf(peer).name} size={28} />
            <div className="dm-who">
              <strong>{userOf(peer).name}</strong>
              <small>{peerMember?.role === 'leader' ? t('팀장') + ' · ' : peerMember?.title ? peerMember.title + ' · ' : ''}{t('1:1 대화')}</small>
            </div>
            <button className="icon-btn dm-tool" onClick={() => setInvite(true)} aria-label={t('대화상대 초대')} title={t('대화상대 초대')}>
              <Icon name="userPlus" size={18} />
            </button>
          </>
        ) : (
          <>
            <strong>{t('{team} 대화', { team: team?.name ?? '' })}</strong>
            <small>{t('{n}명', { n: tableMembers.length })}</small>
          </>
        )}
        {onClose && (
          <button className="icon-btn chat-close" onClick={onClose} aria-label={t('대화창 닫기')} title={t('닫기 (Esc)')}>
            <Icon name="x" size={16} />
          </button>
        )}
      </header>
      <div className="chat-seg" role="tablist" aria-label={t('대화 종류')}>
        <button role="tab" aria-selected={chatTab === 'team'} className={chatTab === 'team' ? 'on' : ''} onClick={() => setChatTab('team')}>
          {t('팀 대화')}{chatUnread > 0 && <em>{chatUnread > 99 ? '99+' : chatUnread}</em>}
        </button>
        <button role="tab" aria-selected={chatTab === 'dm'} className={chatTab === 'dm' ? 'on' : ''} onClick={() => setChatTab('dm')}>
          {t('개인 대화')}{dmUnread > 0 && <em>{dmUnread > 99 ? '99+' : dmUnread}</em>}
        </button>
      </div>
      {chatTab === 'team' ? <ChatBody key="team" /> : room ? <ChatBody key={sel!} room={room.id} /> : peer ? <ChatBody key={peer} peer={peer} /> : <DmList onPick={setDmPeer} />}
      {invite && (peer || room) && (
        <InviteSheet
          locked={room ? room.memberIds.filter((x) => x !== me?.id) : [peer!]}
          group={!!room}
          onClose={() => setInvite(false)}
          onDone={async (ids) => {
            setInvite(false)
            if (room) { inviteToRoom(room.id, ids); return }
            const id = await createRoom([peer!, ...ids])
            if (id) setDmPeer('room:' + id)
          }}
        />
      )}
    </section>
  )
}

/** 1:1 대화 목록: 대화한 사람(최근 먼저) + 아직 대화하지 않은 팀원 */
function DmList({ onPick }: { onPick: (id: string) => void }) {
  const { dmThreads, tableMembers, userOf, me, rooms } = useStore()
  // 1:1 대화와 그룹 대화방을 최근 대화 순서로 함께
  const rows = [
    ...dmThreads.map((th) => ({ kind: 'dm' as const, at: th.last.createdAt, th })),
    ...rooms.map((r) => ({ kind: 'room' as const, at: r.last?.createdAt ?? r.joinedAt, r })),
  ].sort((a, b) => b.at - a.at)
  const lastText = (m: Message) => m.system ? localize(m.body) : m.deleted ? t('삭제된 메시지예요') : m.body || (m.ref ? t('일정을 공유했어요') : '')
  const talked = new Set(dmThreads.map((x) => x.peerId))
  const others = tableMembers.filter((m) => m.userId !== me?.id && !talked.has(m.userId))
  const sub = (id: string) => {
    const m = tableMembers.find((x) => x.userId === id)
    return m?.role === 'leader' ? t('팀장') : m?.title ?? ''
  }
  return (
    <div className="dm-list">
      {rows.map((row) => {
        if (row.kind === 'room') {
          const r = row.r
          const others = r.memberIds.filter((x) => x !== me?.id)
          return (
            <button key={'room:' + r.id} className="dm-row" onClick={() => onPick('room:' + r.id)}>
              <GroupAvatar ids={others} size={38} />
              <span className="dm-txt">
                <b>{others.map((x) => userOf(x).name).join(', ')} <small>{r.memberIds.length}</small></b>
                <span>{r.last ? (r.last.system || r.last.authorId === me?.id ? '' : userOf(r.last.authorId).name + ': ') + lastText(r.last) : t('그룹 대화를 시작했어요')}</span>
              </span>
              <span className="dm-side">
                {r.last && <time>{timeLabel(r.last.createdAt)}</time>}
                {r.unread > 0 && <em>{r.unread}</em>}
              </span>
            </button>
          )
        }
        const th = row.th
        return (
        <button key={th.peerId} className="dm-row" onClick={() => onPick(th.peerId)}>
          <Avatar name={userOf(th.peerId).name} size={38} />
          <span className="dm-txt">
            <b>{userOf(th.peerId).name} <small>{sub(th.peerId)}</small></b>
            <span>{lastText(th.last)}</span>
          </span>
          <span className="dm-side">
            <time>{timeLabel(th.last.createdAt)}</time>
            {th.unread > 0 && <em>{th.unread}</em>}
          </span>
        </button>
        )
      })}
      {others.length > 0 && <div className="dm-label">{rows.length ? t('새 대화 시작') : t('대화할 팀원을 고르세요')}</div>}
      {others.map((m) => (
        <button key={m.userId} className="dm-row new" onClick={() => onPick(m.userId)}>
          <Avatar name={userOf(m.userId).name} size={38} />
          <span className="dm-txt">
            <b>{userOf(m.userId).name} <small>{sub(m.userId)}</small></b>
          </span>
          <span className="dm-side"><Icon name="chat" size={16} /></span>
        </button>
      ))}
      {rows.length === 0 && others.length === 0 && <p className="chat-empty">{t('대화할 팀원이 아직 없어요.')}</p>}
    </div>
  )
}

/** 메시지 목록 + 입력창. peer 가 있으면 그 사람과의 1:1 대화 */
function ChatBody({ peer, room }: { peer?: string; room?: string }) {
  const { messages: teamMessages, me, tableMembers, userOf, sendMessage, deleteMessage, markChatRead, db, getReadReceipts, dmMessages, markDmRead, reactions, react, rooms, roomMessages, markRoomRead } = useStore()
  // 대화 종류: 그룹 대화방 / 1:1 / 팀 대화
  const roomInfo = room ? rooms.find((r) => r.id === room) : undefined
  const messages = room ? roomMessages(room) : peer ? dmMessages(peer) : teamMessages
  const markRead = room ? () => markRoomRead(room) : peer ? () => markDmRead(peer) : markChatRead
  const priv = !!(peer || room) // 1:1·그룹은 @호출 없음
  const { openModal, isMobile, showToast } = useUI()
  const [receipt, setReceipt] = useState<{ m: Message; rect: DOMRect } | null>(null)
  // 답장할 메시지, 메시지 메뉴, 이모지 줄·전체 고르기, 반응한 사람, 전달하기
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [menu, setMenu] = useState<{ m: Message; x: number; y: number; rect: DOMRect } | null>(null)
  const [tray, setTray] = useState<string | null>(null)
  const [picker, setPicker] = useState<string | null>(null)
  const [whoRx, setWhoRx] = useState<{ id: string; emoji: string; rect: DOMRect } | null>(null)
  const [forward, setForward] = useState<Message | null>(null)
  const byId = useMemo(() => new Map(db.messages.map((x) => [x.id, x])), [db.messages])
  const { selected, setSelected } = useUI()
  const listRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [pickIdx, setPickIdx] = useState(0)
  const [ref, setRef] = useState<ChatRef | null>(null)
  const [attachOpen, setAttachOpen] = useState(false)
  const composing = useRef(false)
  const nextCaret = useRef<number | null>(null)

  // 사람을 고른 직후 커서를 바로 이름 뒤로 옮긴다 (빠르게 이어 쳐도 순서가 섞이지 않게)
  useLayoutEffect(() => {
    if (nextCaret.current === null || !taRef.current) return
    taRef.current.focus()
    taRef.current.setSelectionRange(nextCaret.current, nextCaret.current)
    nextCaret.current = null
  }, [text])

  const names = useMemo(() => tableMembers.map((m) => userOf(m.userId).name), [tableMembers, userOf])

  // 보이는 동안은 읽음 처리, 새 메시지가 오면 맨 아래로
  useEffect(() => {
    markRead()
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length])

  // @ 입력 중이면 팀원 목록
  // 1:1 대화에서는 @호출 목록을 띄우지 않는다
  const q = priv ? null : /@(\S*)$/.exec(text.slice(0, caret))
  const people = tableMembers
    .filter((m) => m.userId !== me?.id)
    .map((m) => ({ id: m.userId, name: userOf(m.userId).name, sub: m.role === 'leader' ? t('팀장') : m.title }))
  // 팀 모두 부르기: 한국어 화면은 @전체, 영어 화면은 @all
  const allName = getLang() === 'en' ? ALL_EN : ALL
  const options = q ? [...people, { id: 'all', name: allName, sub: t('팀 모두에게') }].filter((o) => o.name.toLowerCase().startsWith(q[1].toLowerCase())) : []

  function pick(name: string) {
    if (!q) return
    const start = caret - q[0].length
    const next = text.slice(0, start) + '@' + name + ' ' + text.slice(caret)
    const pos = start + name.length + 2
    nextCaret.current = pos
    setText(next)
    setCaret(pos)
    setPickIdx(0)
  }

  function send() {
    if (!text.trim() && !ref) return
    sendMessage(text, ref ?? undefined, peer, room || replyTo ? { ...(replyTo ? { replyTo: replyTo.id } : {}), ...(room ? { roomId: room } : {}) } : undefined)
    setText('')
    setCaret(0)
    setRef(null)
    setReplyTo(null)
  }

  /** 반응 달기: 같은 이모지를 다시 고르면 취소, 다른 이모지면 바꾼다 (1개만) */
  function pickReaction(id: string, emoji: string) {
    const mineNow = me ? reactions[id]?.[me.id] : undefined
    react(id, mineNow === emoji ? null : emoji)
    setTray(null)
    setPicker(null)
    setMenu(null)
  }

  // 검색 결과에서 왔으면 그 메시지로 이동 (불러오는 중이면 메시지가 생길 때까지 기다린다)
  const { chatJump, setChatJump } = useUI()
  useEffect(() => {
    if (!chatJump || !messages.some((m) => m.id === chatJump)) return
    const id = chatJump
    const tm = window.setTimeout(() => { setChatJump(null); jump(id) }, 120)
    return () => window.clearTimeout(tm)
  }, [chatJump, messages]) // eslint-disable-line react-hooks/exhaustive-deps

  /** 답장 인용을 누르면 원본 메시지로 이동해서 잠깐 반짝인다 */
  function jump(id: string) {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-mid="${id}"]`)
    if (!el) { showToast(t('원본 메시지를 찾을 수 없어요')); return }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.remove('flash')
    void el.offsetWidth // 애니메이션을 처음부터 다시
    el.classList.add('flash')
    window.setTimeout(() => el.classList.remove('flash'), 1700)
  }

  function startReply(m: Message) {
    setReplyTo(m)
    setMenu(null)
    window.setTimeout(() => taRef.current?.focus(), 0)
  }

  async function copy(m: Message) {
    setMenu(null)
    try {
      await navigator.clipboard.writeText(m.body)
      showToast(t('복사했어요'))
    } catch {
      showToast(t('복사하지 못했어요'))
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (composing.current || e.nativeEvent.isComposing) return // 한글 조합 중에는 무시
    if (options.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPickIdx((i) => (i + 1) % options.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setPickIdx((i) => (i - 1 + options.length) % options.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(options[Math.min(pickIdx, options.length - 1)].name); return }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  // 첨부할 수 있는 일정: 이번 주 팀 표에 보이는 일정
  const attachables = useMemo(() => {
    const out: (ChatRef & { key: string })[] = []
    for (const d of weekDays(selected)) {
      for (const m of tableMembers) {
        const evs = db.events.filter((e) => e.ownerId === m.userId && (e.shared || e.ownerId === me?.id))
        for (const o of occurrencesOn(evs, d)) {
          out.push({ key: o.id + d, date: d, start: o.start, end: o.end, title: o.title, ownerName: userOf(m.userId).name })
        }
      }
    }
    return out.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start))
  }, [selected, tableMembers, db.events, me?.id, userOf])

  return (
    <>
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && (
          <p className="chat-empty">
            {peer && !room ? t('{name}님과 아직 대화가 없어요. 첫 메시지를 남겨보세요.', { name: userOf(peer).name }) : t('아직 대화가 없어요. 첫 메시지를 남겨보세요.')}
          </p>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt)
          const grouped = !newDay && prev && !prev.system && prev.authorId === m.authorId && m.createdAt - prev.createdAt < 5 * 60000
          // 초대·나가기 안내는 가운데 회색 글씨
          if (m.system) return (
            <Fragment key={m.id}>
              {newDay && <span className="chat-day">{fmtLong(dayKey(m.createdAt))}</span>}
              <span className="chat-sys">{localize(m.body)}</span>
            </Fragment>
          )
          return (
            <Fragment key={m.id}>
              {newDay && <span className="chat-day">{fmtLong(dayKey(m.createdAt))}</span>}
              <Bubble
                m={m}
                mine={m.authorId === me?.id}
                hit={mentionsMe(m, me?.id)}
                grouped={!!grouped}
                names={names}
                author={userOf(m.authorId).name}
                isLeader={tableMembers.find((x) => x.userId === m.authorId)?.role === 'leader'}
                quote={m.replyTo ? { author: byId.get(m.replyTo) ? userOf(byId.get(m.replyTo)!.authorId).name : '', text: snippet(byId.get(m.replyTo)) } : null}
                rx={reactions[m.id] ?? {}}
                meId={me?.id}
                trayOpen={tray === m.id}
                onTray={() => setTray((v) => (v === m.id ? null : m.id))}
                onReact={(e) => pickReaction(m.id, e)}
                onMore={() => { setTray(null); setPicker(m.id) }}
                onChip={(emoji, rect) => setWhoRx({ id: m.id, emoji, rect })}
                onQuote={() => m.replyTo && jump(m.replyTo)}
                onDelete={() => deleteMessage(m.id)}
                onRef={(r) => setSelected(r.date)}
                onMenu={(x, y, rect) => { setTray(null); setMenu({ m, x, y, rect }) }}
                onWho={(x, y) => openModal({ type: 'member', userId: m.authorId, ...(isMobile ? {} : { x, y }) })}
              />
            </Fragment>
          )
        })}
      </div>

      {receipt && (
        <ReadReceipts
          m={receipt.m}
          rect={receipt.rect}
          load={getReadReceipts}
          people={tableMembers.filter((x) => x.userId !== receipt.m.authorId && (room ? !!roomInfo?.memberIds.includes(x.userId) : !peer || x.userId === peer)).map((x) => ({ id: x.userId, name: userOf(x.userId).name, leader: x.role === 'leader' }))}
          onClose={() => setReceipt(null)}
        />
      )}

      {menu && (
        <MsgMenu
          m={menu.m}
          at={menu}
          mobile={isMobile}
          mine={menu.m.authorId === me?.id}
          myEmoji={me ? reactions[menu.m.id]?.[me.id] : undefined}
          onReact={(e) => pickReaction(menu.m.id, e)}
          onMore={() => { setPicker(menu.m.id); setMenu(null) }}
          onReply={() => startReply(menu.m)}
          onForward={() => { setForward(menu.m); setMenu(null) }}
          onCopy={() => copy(menu.m)}
          onReads={() => { setReceipt({ m: menu.m, rect: menu.rect }); setMenu(null) }}
          onDelete={() => { deleteMessage(menu.m.id); setMenu(null); if (replyTo?.id === menu.m.id) setReplyTo(null) }}
          onClose={() => setMenu(null)}
        />
      )}
      {picker && <EmojiPicker mobile={isMobile} onPick={(e) => pickReaction(picker, e)} onClose={() => setPicker(null)} />}
      {whoRx && (
        <ReactionWho
          rx={reactions[whoRx.id] ?? {}}
          emoji={whoRx.emoji}
          rect={whoRx.rect}
          meId={me?.id}
          nameOf={(id) => userOf(id).name}
          onToggle={() => { pickReaction(whoRx.id, whoRx.emoji); setWhoRx(null) }}
          onClose={() => setWhoRx(null)}
        />
      )}
      {forward && (
        <ForwardPicker
          m={forward}
          targets={tableMembers.filter((x) => x.userId !== me?.id).map((x) => ({ id: x.userId, name: userOf(x.userId).name, sub: x.role === 'leader' ? t('팀장') : x.title }))}
          onSend={(toId) => {
            sendMessage(forward.body, forward.ref, toId ?? undefined, { forwarded: true })
            setForward(null)
            showToast(toId ? t('{name}님에게 전달했어요', { name: userOf(toId).name }) : t('팀 대화로 전달했어요'))
          }}
          onClose={() => setForward(null)}
        />
      )}

      {peer && <div className="dm-lock">🔒 {t('두 사람만 볼 수 있는 대화예요')}</div>}
      {roomInfo && <div className="dm-lock">🔒 {t('{n}명만 볼 수 있는 대화예요', { n: roomInfo.memberIds.length })}</div>}
      <footer className="chat-foot">
        {options.length > 0 && (
          <div className="mention-pick" role="listbox" aria-label={t('호출할 사람')}>
            {options.map((o, i) => (
              <button
                key={o.id}
                role="option"
                aria-selected={i === pickIdx}
                className={i === pickIdx ? 'on' : ''}
                onMouseDown={(e) => { e.preventDefault(); pick(o.name) }}
              >
                {o.id === 'all' ? <span className="pick-all">@</span> : <Avatar name={o.name} size={24} />}
                <span>{o.id === 'all' ? '@' + allName : o.name}</span>
                <small>{o.sub}</small>
              </button>
            ))}
          </div>
        )}
        {attachOpen && (
          <>
            <div className="popover-scrim" onMouseDown={() => setAttachOpen(false)} />
            <div className="attach-pick">
              <div className="attach-title">{t('이번 주 일정 첨부')}</div>
              {attachables.length === 0 && <p className="chat-empty">{t('이번 주 팀 표에 일정이 없어요.')}</p>}
              {attachables.map((a) => (
                <button key={a.key} onClick={() => { setRef(a); setAttachOpen(false); taRef.current?.focus() }}>
                  <b>{fmtHead(a.date)} {a.start}</b>
                  <span>{a.title}</span>
                  <small>{a.ownerName}</small>
                </button>
              ))}
            </div>
          </>
        )}
        {replyTo && (
          <div className="reply-bar">
            <div className="reply-txt">
              <b>{t('{name}님에게 답장', { name: userOf(replyTo.authorId).name })}</b>
              <span>{snippet(replyTo)}</span>
            </div>
            <button className="icon-btn" onClick={() => setReplyTo(null)} aria-label={t('답장 취소')}><Icon name="x" size={14} /></button>
          </div>
        )}
        {ref && (
          <div className="ref-draft">
            <RefCard r={ref} />
            <button className="icon-btn" onClick={() => setRef(null)} aria-label={t('첨부 취소')}><Icon name="x" size={14} /></button>
          </div>
        )}
        <div className="chat-input">
          <button className="icon-btn" onClick={() => setAttachOpen((v) => !v)} aria-label={t('일정 첨부')} title={t('일정 첨부')}>
            <Icon name="cal" size={18} />
          </button>
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            maxLength={1000}
            placeholder={room ? t('메시지 입력') : peer ? t('{name}님에게 메시지', { name: userOf(peer).name }) : t('메시지 입력 (@로 호출)')}
            onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); setPickIdx(0) }}
            onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
            onKeyDown={onKey}
            onCompositionStart={() => { composing.current = true }}
            onCompositionEnd={(e) => { composing.current = false; setCaret((e.target as HTMLTextAreaElement).selectionStart) }}
            aria-label={t('메시지 입력')}
          />
          <button className="send-btn" onClick={send} disabled={!text.trim() && !ref} aria-label={t('보내기')}>
            <Icon name="send" size={16} />
          </button>
        </div>
      </footer>
    </>
  )
}

function RefCard({ r, onClick }: { r: ChatRef; onClick?: () => void }) {
  const body = (
    <>
      <b>{fmtHead(r.date)} {r.start}</b>
      <span>{r.title}</span>
      <small>{r.ownerName}</small>
    </>
  )
  return onClick ? (
    <button className="ref-card" onClick={onClick} title={t('이 주의 팀 표로 이동')}>{body}</button>
  ) : (
    <div className="ref-card">{body}</div>
  )
}

function Bubble(props: {
  m: Message; mine: boolean; hit: boolean; grouped: boolean; names: string[]; author: string; isLeader: boolean
  /** 답장한 원본 (보낸 사람, 한 줄 요약) */
  quote: { author: string; text: string } | null
  /** 이 메시지의 반응: 사람 id → 이모지 */
  rx: Record<string, string>
  meId?: string
  trayOpen: boolean
  onTray: () => void
  onReact: (emoji: string) => void
  onMore: () => void
  onChip: (emoji: string, rect: DOMRect) => void
  onQuote: () => void
  onDelete: () => void; onRef: (r: ChatRef) => void
  /** 메시지 메뉴 열기 (누른 위치, 말풍선 위치) */
  onMenu: (x: number, y: number, rect: DOMRect) => void
  /** 보낸 사람 이름·사진을 누르면 (누른 위치) */
  onWho: (x: number, y: number) => void
}) {
  const { m, mine, hit, grouped, names, author, isLeader, quote, rx, meId } = props
  const [confirm, setConfirm] = useState(false)
  const [pressed, setPressed] = useState(false)
  const timer = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const bubRef = useRef<HTMLDivElement>(null)
  const live = !m.deleted // 지운 메시지에는 메뉴·반응이 없다

  const cancel = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    start.current = null
    setPressed(false)
  }
  const open = (x?: number, y?: number) => {
    cancel()
    const r = bubRef.current?.getBoundingClientRect()
    if (r) props.onMenu(x ?? r.left + 12, y ?? r.bottom + 6, r)
  }
  // 길게 누르기(휴대폰) · 오른쪽 클릭(PC) → 메시지 메뉴
  const hold = live
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.button !== 0) return
          start.current = { x: e.clientX, y: e.clientY }
          setPressed(true)
          timer.current = window.setTimeout(() => open(), 500)
        },
        onPointerMove: (e: React.PointerEvent) => {
          if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) cancel()
        },
        onPointerUp: cancel,
        onPointerLeave: cancel,
        onPointerCancel: cancel,
        onContextMenu: (e: React.MouseEvent) => {
          e.preventDefault()
          open(e.clientX, e.clientY)
        },
      }
    : {}

  // 이모지별로 모으기 (먼저 달린 순서)
  const groups: { emoji: string; ids: string[] }[] = []
  for (const [uid, e] of Object.entries(rx)) {
    const g = groups.find((x) => x.emoji === e)
    if (g) g.ids.push(uid)
    else groups.push({ emoji: e, ids: [uid] })
  }
  const myEmoji = meId ? rx[meId] : undefined

  return (
    <div className={'bub-row' + (mine ? ' mine' : '') + (hit ? ' hit' : '') + (grouped ? ' grouped' : '')} data-mid={m.id}>
      {!mine && (
        <span className="bub-av">
          {!grouped && (
            <button className="who-btn" onClick={(e) => props.onWho(e.clientX, e.clientY)} aria-label={t('{name}님 메뉴', { name: author })}>
              <Avatar name={author} size={30} />
            </button>
          )}
        </span>
      )}
      <div className="bub-col">
        {!mine && !grouped && (
          <button className="bub-name who-btn" onClick={(e) => props.onWho(e.clientX, e.clientY)}>{author}{isLeader ? ' · ' + t('팀장') : ''}</button>
        )}
        <div className="bub-line">
          <div
            ref={bubRef}
            className={'bub' + (m.deleted ? ' deleted' : '') + (live ? ' holdable' : '') + (pressed ? ' pressed' : '')}
            title={live ? t('길게 누르거나 오른쪽 클릭하면 메뉴가 열려요') : undefined}
            {...hold}
          >
            {m.deleted ? t('삭제된 메시지예요') : (
              <>
                {m.forwarded && <span className="fwd-tag">↗ {t('전달됨')}</span>}
                {quote && (
                  <button className="quote" onClick={props.onQuote} title={t('원본 메시지로 이동')}>
                    {quote.author && <b>{quote.author}</b>}
                    <span>{quote.text}</span>
                  </button>
                )}
                {m.body && splitMentions(m.body, names).map((p, i) => (p.mention ? <span key={i} className="mn">{p.text}</span> : <Fragment key={i}>{p.text}</Fragment>))}
                {m.ref && <RefCard r={m.ref} onClick={() => props.onRef(m.ref!)} />}
              </>
            )}
          </div>
          {live && (
            <span className="bub-tools">
              <button className={'rx-btn' + (props.trayOpen ? ' on' : '')} onClick={props.onTray} aria-label={t('이모지 반응')} aria-expanded={props.trayOpen} title={t('이모지 반응')}>
                <Icon name="smile" size={14} />
              </button>
              <button
                className="rx-btn more-btn"
                onClick={(e) => { const r = bubRef.current?.getBoundingClientRect(); if (r) props.onMenu(e.clientX, e.clientY, r) }}
                aria-label={t('메시지 메뉴')}
                title={t('메시지 메뉴')}
              >
                <Icon name="more" size={14} />
              </button>
            </span>
          )}
          <span className="bub-meta">
            {mine && !m.deleted && (
              confirm ? (
                <button className="bub-del sure" onClick={props.onDelete}>{t('삭제할까요?')}</button>
              ) : (
                <button className="bub-del" onClick={() => { setConfirm(true); setTimeout(() => setConfirm(false), 3000) }} aria-label={t('메시지 삭제')}>{t('삭제')}</button>
              )
            )}
            <time>{timeLabel(m.createdAt)}</time>
          </span>
        </div>
        {groups.length > 0 && (
          <div className="rx-row">
            {groups.map((g) => (
              <button
                key={g.emoji}
                className={'rx-chip' + (g.emoji === myEmoji ? ' me' : '')}
                onClick={(e) => props.onChip(g.emoji, e.currentTarget.getBoundingClientRect())}
                aria-label={t('{emoji} 반응 {n}명', { emoji: g.emoji, n: g.ids.length })}
              >
                <span className="rx-e">{g.emoji}</span>{g.ids.length}
              </button>
            ))}
          </div>
        )}
        {props.trayOpen && (
          <div className="rx-tray" role="menu" aria-label={t('이모지 반응')}>
            {QUICK.map((e) => (
              <button key={e} role="menuitem" className={e === myEmoji ? 'me' : ''} onClick={() => props.onReact(e)}>{e}</button>
            ))}
            <button className="rx-more" onClick={props.onMore} aria-label={t('다른 이모지 고르기')} title={t('다른 이모지 고르기')}>＋</button>
          </div>
        )}
      </div>
    </div>
  )
}

/** 화면 위치 맞추기: 누른 곳 근처, 화면 밖으로 나가지 않게 */
function usePlace(at: { x: number; y: number }, dep?: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const w = el.offsetWidth, h = el.offsetHeight, pad = 10
    const left = Math.min(Math.max(pad, at.x), window.innerWidth - w - pad)
    let top = at.y
    if (top + h > window.innerHeight - pad) top = Math.max(pad, at.y - h - 8)
    setPos({ left, top })
  }, [at.x, at.y, dep])
  return { ref, style: pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' as const } }
}

/** 메시지 메뉴: PC는 누른 곳에 작은 메뉴, 휴대폰은 아래에서 올라오는 시트 */
function MsgMenu(props: {
  m: Message
  at: { x: number; y: number }
  mobile: boolean
  mine: boolean
  myEmoji?: string
  onReact: (e: string) => void
  onMore: () => void
  onReply: () => void
  onForward: () => void
  onCopy: () => void
  onReads: () => void
  onDelete: () => void
  onClose: () => void
}) {
  const { m, mobile, mine, onClose } = props
  const [sure, setSure] = useState(false)
  useEsc(onClose)
  const place = usePlace(props.at, sure)
  // 길게 눌러 연 뒤 손가락을 떼는 순간, 그 자리 메뉴가 눌리지 않게:
  // 메뉴 안에서 새로 누른 경우(또는 키보드)만 누른 것으로 친다
  const pressed = useRef(false)
  const guard = {
    onPointerDownCapture: () => { pressed.current = true },
    onClickCapture: (e: React.MouseEvent) => {
      if (!pressed.current && e.detail !== 0) { e.preventDefault(); e.stopPropagation() }
    },
  }
  const items = (
    <>
      <button onClick={props.onReply}><Icon name="reply" size={16} />{t('답장')}</button>
      <button onClick={props.onForward}><Icon name="forward" size={16} />{t('전달')}</button>
      {m.body && <button onClick={props.onCopy}><Icon name="copy" size={16} />{t('복사')}</button>}
      {mine && <button onClick={props.onReads}><Icon name="eye" size={16} />{t('읽은 사람')}</button>}
      {mine && (
        <button className="red" onClick={() => (sure ? props.onDelete() : setSure(true))}>
          <Icon name="trash" size={16} />{sure ? t('삭제할까요?') : t('삭제')}
        </button>
      )}
    </>
  )
  const quick = (
    <div className="mm-emo">
      {QUICK.map((e) => (
        <button key={e} className={e === props.myEmoji ? 'me' : ''} onClick={() => props.onReact(e)}>{e}</button>
      ))}
      <button className="rx-more" onClick={props.onMore} aria-label={t('다른 이모지 고르기')}>＋</button>
    </div>
  )
  return createPortal(
    mobile ? (
      <>
        <div className="mm-scrim dim" onPointerDown={onClose} />
        <div className="mm-sheet" role="dialog" aria-label={t('메시지 메뉴')} {...guard}>
          {quick}
          <div className="mm-group">{items}</div>
          <button className="mm-cancel" onClick={onClose}>{t('취소')}</button>
        </div>
      </>
    ) : (
      <>
        <div className="mm-scrim" onPointerDown={onClose} onContextMenu={(e) => { e.preventDefault(); onClose() }} />
        <div ref={place.ref} className="mm-menu" role="menu" aria-label={t('메시지 메뉴')} style={place.style} {...guard}>
          {quick}
          {items}
        </div>
      </>
    ),
    document.body,
  )
}

/** 휴대폰 기본 이모지 전체 (국기·피부색 변형 제외, 직접 입력으로 고를 수 있음) */
const EMOJI_SECTIONS: { label: string; ranges: [number, number][] }[] = [
  { label: '표정', ranges: [[0x1f600, 0x1f64f], [0x1f910, 0x1f92f], [0x1f970, 0x1f97f], [0x1fae0, 0x1faef], [0x1f9d0, 0x1f9d0]] },
  { label: '손·사람', ranges: [[0x1f440, 0x1f450], [0x1f466, 0x1f487], [0x1f4aa, 0x1f4aa], [0x1f90c, 0x1f90f], [0x1f930, 0x1f93a], [0x1f9b0, 0x1f9b9], [0x1f9d1, 0x1f9df], [0x1faf0, 0x1faf8], [0x270a, 0x270b]] },
  { label: '하트', ranges: [[0x1f493, 0x1f49f], [0x1f5a4, 0x1f5a4], [0x1f90d, 0x1f90e], [0x1f9e1, 0x1f9e1], [0x1fa75, 0x1fa77], [0x1f48b, 0x1f48c], [0x1f4a2, 0x1f4af]] },
  { label: '동물·자연', ranges: [[0x1f400, 0x1f43f], [0x1f980, 0x1f9ae], [0x1f330, 0x1f344], [0x1fab0, 0x1fabf], [0x1f300, 0x1f32f]] },
  { label: '음식', ranges: [[0x1f345, 0x1f37f], [0x1f950, 0x1f96f], [0x1f9c0, 0x1f9cb], [0x1fad0, 0x1fadb]] },
  { label: '활동·물건', ranges: [[0x1f380, 0x1f3ff], [0x1f4b0, 0x1f4ff], [0x1f500, 0x1f5ff], [0x1f680, 0x1f6ff], [0x1f9e0, 0x1f9ff], [0x1fa70, 0x1faaf], [0x1f93b, 0x1f94f]] },
  { label: '기호', ranges: [[0x2600, 0x27bf], [0x2b00, 0x2bff]] },
]
let emojiCache: { label: string; list: string[] }[] | null = null
function emojiSections() {
  if (emojiCache) return emojiCache
  const seen = new Set<string>()
  const ok = /^\p{Emoji_Presentation}$/u
  emojiCache = EMOJI_SECTIONS.map((sec) => {
    const list: string[] = sec.label === '하트' ? ['❤️'] : []
    for (const [a, b] of sec.ranges) {
      for (let c = a; c <= b; c++) {
        const ch = String.fromCodePoint(c)
        if (ok.test(ch) && !seen.has(ch)) { seen.add(ch); list.push(ch) }
      }
    }
    return { label: sec.label, list }
  })
  return emojiCache
}

/** 입력한 글자에서 첫 이모지 하나를 꺼낸다 (국기·피부색 이모지도 그대로) */
function firstEmoji(text: string): string | null {
  // 글자 단위 나누기 (지원하지 않는 브라우저는 한 글자씩)
  const Seg = (Intl as any).Segmenter
  const parts: string[] = Seg
    ? [...new Seg(undefined, { granularity: 'grapheme' }).segment(text)].map((x: { segment: string }) => x.segment)
    : Array.from(text)
  // 국기는 지역 문자 2개가 모여야 완성
  return parts.find((p) => /\p{Extended_Pictographic}/u.test(p) || /^\p{Regional_Indicator}{2}$/u.test(p)) ?? null
}

/** 이모지 전체에서 고르기 */
function EmojiPicker({ mobile, onPick, onClose }: { mobile: boolean; onPick: (e: string) => void; onClose: () => void }) {
  useEsc(onClose)
  const sections = useMemo(emojiSections, [])
  const composing = useRef(false)
  const tryInput = (v: string) => {
    const e = firstEmoji(v)
    if (e) onPick(e)
  }
  return createPortal(
    <>
      <div className="mm-scrim dim" onPointerDown={onClose} />
      <div className={'emo-pick' + (mobile ? ' sheet' : '')} role="dialog" aria-label={t('이모지 고르기')}>
        <div className="emo-head">
          <b>{t('이모지 고르기')}</b>
          <button className="icon-btn" onClick={onClose} aria-label={t('닫기')}><Icon name="x" size={16} /></button>
        </div>
        <input
          className="emo-input"
          placeholder={t('휴대폰 이모지 키보드로 직접 입력')}
          onCompositionStart={() => { composing.current = true }}
          onCompositionEnd={(e) => { composing.current = false; tryInput(e.currentTarget.value) }}
          onChange={(e) => { if (!composing.current) tryInput(e.target.value) }}
          aria-label={t('이모지 직접 입력')}
        />
        <div className="emo-scroll">
          {sections.map((sec) => (
            <section key={sec.label}>
              <h5>{t(sec.label)}</h5>
              <div className="emo-grid">
                {sec.list.map((e) => <button key={e} onClick={() => onPick(e)}>{e}</button>)}
              </div>
            </section>
          ))}
        </div>
      </div>
    </>,
    document.body,
  )
}

/** 반응 칩을 누르면: 누가 어떤 이모지를 달았는지 + 나도 달기/취소 */
function ReactionWho(props: {
  rx: Record<string, string>
  emoji: string
  rect: DOMRect
  meId?: string
  nameOf: (id: string) => string
  onToggle: () => void
  onClose: () => void
}) {
  const { rx, emoji, rect, meId, nameOf, onToggle, onClose } = props
  useEsc(onClose)
  const place = usePlace({ x: rect.left, y: rect.bottom + 6 })
  const groups = new Map<string, string[]>()
  for (const [uid, e] of Object.entries(rx)) groups.set(e, [...(groups.get(e) ?? []), uid])
  const ordered = [...groups.entries()].sort((a, b) => (a[0] === emoji ? -1 : b[0] === emoji ? 1 : 0))
  const mineIs = meId ? rx[meId] === emoji : false
  return createPortal(
    <>
      <div className="mm-scrim" onPointerDown={onClose} />
      <div ref={place.ref} className="rx-who" role="dialog" aria-label={t('반응한 사람')} style={place.style}>
        {ordered.map(([e, ids]) => (
          <div key={e} className="rx-who-row">
            <span className="rx-e">{e}</span>
            <span>{ids.map((id) => (id === meId ? t('나') : nameOf(id))).join(', ')}</span>
          </div>
        ))}
        <button className="rx-who-btn" onClick={onToggle}>{mineIs ? t('내 반응 취소') : t('나도 {emoji} 달기', { emoji })}</button>
      </div>
    </>,
    document.body,
  )
}

/** 전달하기: 팀 대화 또는 1:1 상대 고르기 */
function ForwardPicker(props: {
  m: Message
  targets: { id: string; name: string; sub: string }[]
  onSend: (toId: string | null) => void
  onClose: () => void
}) {
  const { m, targets, onSend, onClose } = props
  useEsc(onClose)
  const [pick, setPick] = useState<string | null | undefined>(undefined) // null = 팀 대화
  const pickName = pick === null ? t('팀 대화') : targets.find((x) => x.id === pick)?.name
  return createPortal(
    <>
      <div className="mm-scrim dim" onPointerDown={onClose} />
      <div className="fwd-pick" role="dialog" aria-label={t('전달하기')}>
        <div className="emo-head">
          <b>{t('전달하기')}</b>
          <button className="icon-btn" onClick={onClose} aria-label={t('닫기')}><Icon name="x" size={16} /></button>
        </div>
        <div className="fwd-preview">{snippet(m)}</div>
        <div className="fwd-list">
          <button className={'fwd-row' + (pick === null ? ' on' : '')} onClick={() => setPick(null)}>
            <span className="fwd-team"><Icon name="users" size={16} /></span>
            <span className="fwd-name">{t('팀 대화')}<small>{t('팀 모두에게')}</small></span>
            {pick === null && <Icon name="check" size={16} />}
          </button>
          {targets.map((x) => (
            <button key={x.id} className={'fwd-row' + (pick === x.id ? ' on' : '')} onClick={() => setPick(x.id)}>
              <Avatar name={x.name} size={30} />
              <span className="fwd-name">{x.name}<small>{x.sub}</small></span>
              {pick === x.id && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
        <button className="fwd-send" disabled={pick === undefined} onClick={() => pick !== undefined && onSend(pick)}>
          {pick === undefined ? t('보낼 곳을 고르세요') : pick === null ? t('팀 대화로 보내기') : t('{name}님에게 보내기', { name: pickName ?? '' })}
        </button>
      </div>
    </>,
    document.body,
  )
}

/** 내 메시지를 길게 눌렀을 때: 팀원별 읽은 시각 */
function ReadReceipts(props: {
  m: Message
  rect: DOMRect
  people: { id: string; name: string; leader: boolean }[]
  load: (id: string) => Promise<Record<string, number>>
  onClose: () => void
}) {
  const { m, rect, people, load, onClose } = props
  const [reads, setReads] = useState<Record<string, number> | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useEffect(() => {
    let alive = true
    load(m.id).then((r) => alive && setReads(r))
    return () => { alive = false }
  }, [m.id, load])

  useEffect(() => {
    const h = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
  }, [onClose])

  // 말풍선 바로 위(공간이 없으면 아래)에, 화면 밖으로 나가지 않게
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const w = el.offsetWidth, h = el.offsetHeight, pad = 10
    const left = Math.min(Math.max(pad, rect.right - w), window.innerWidth - w - pad)
    let top = rect.top - h - 8
    if (top < pad) top = Math.min(rect.bottom + 8, window.innerHeight - h - pad)
    setPos({ left, top })
  }, [rect, reads])

  const read = people.filter((p) => reads?.[p.id]).sort((a, b) => reads![a.id] - reads![b.id])
  const unread = people.filter((p) => !reads?.[p.id])

  return (
    <>
      <div className="rr-scrim" onPointerDown={onClose} />
      <div ref={boxRef} className="rr" role="dialog" aria-label={t('읽은 사람')} style={pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }}>
        <h4>{t('읽음')} <b>{reads ? read.length : '–'}/{people.length}</b></h4>
        {reads === null ? (
          <p className="rr-loading">{t('불러오는 중…')}</p>
        ) : (
          <>
            {read.map((p) => (
              <div key={p.id} className="rr-row">
                <Avatar name={p.name} size={26} />
                <span>{p.name}{p.leader ? ' · ' + t('팀장') : ''}</span>
                <small>{timeLabel(reads[p.id])}</small>
              </div>
            ))}
            {read.length > 0 && unread.length > 0 && <div className="rr-sep" />}
            {unread.map((p) => (
              <div key={p.id} className="rr-row no">
                <Avatar name={p.name} size={26} />
                <span>{p.name}{p.leader ? ' · ' + t('팀장') : ''}</span>
                <small>{t('아직 안 읽음')}</small>
              </div>
            ))}
          </>
        )}
        <div className="rr-lock">{t('읽은 시각은 보낸 사람에게만 보여요')}</div>
      </div>
    </>
  )
}

/** 그룹 대화방 사진: 사람 사진을 최대 3장 겹쳐서 */
function GroupAvatar({ ids, size }: { ids: string[]; size: number }) {
  const { userOf } = useStore()
  const show = ids.slice(0, 3)
  const s = Math.round(size * 0.66)
  const spots = show.length === 1 ? [[0, 0]] : show.length === 2 ? [[0, 0], [size - s, size - s]] : [[0, 0], [size - s, 2], [(size - s) / 2, size - s]]
  return (
    <span className="group-av" style={{ width: size, height: size }} aria-hidden="true">
      {show.map((id, i) => (
        <span key={id} style={{ left: spots[i][0], top: spots[i][1] }}>
          <Avatar name={userOf(id).name} size={show.length === 1 ? size : s} />
        </span>
      ))}
    </span>
  )
}

/**
 * 대화상대 초대: 팀원을 체크해서 고른다 (여러 명)
 * - locked: 이미 대화에 있는 사람 (회색 체크, 바꿀 수 없음)
 * - 1:1 대화에서 고르면 새 그룹 대화방, 그룹 대화방에서 고르면 그 방에 초대
 */
function InviteSheet({ locked, group, onClose, onDone }: { locked: string[]; group: boolean; onClose: () => void; onDone: (ids: string[]) => void }) {
  const { tableMembers, userOf, me } = useStore()
  const { isMobile } = useUI()
  useEsc(onClose)
  const [picked, setPicked] = useState<string[]>([])
  const people = tableMembers.filter((m) => m.userId !== me?.id)
  const toggle = (id: string) => setPicked((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]))
  const sub = (id: string) => {
    const m = tableMembers.find((x) => x.userId === id)
    return m?.role === 'leader' ? t('팀장') : m?.title ?? ''
  }
  const chosen = [...locked, ...picked]
  const label = picked.length === 0
    ? t('초대할 사람을 고르세요')
    : group
      ? t('{n}명 초대하기', { n: picked.length })
      : t('{n}명과 그룹 대화 시작', { n: chosen.length })
  return createPortal(
    <>
      <div className="mm-scrim dim" onPointerDown={onClose} />
      <div className={'inv-sheet' + (isMobile ? ' sheet' : '')} role="dialog" aria-label={t('대화상대 초대')}>
        <div className="emo-head">
          <b>{t('대화상대 초대')}</b>
          <button className="icon-btn" onClick={onClose} aria-label={t('닫기')}><Icon name="x" size={16} /></button>
        </div>
        <div className="inv-chips">
          {chosen.map((id) => (
            <button key={id} className="inv-chip" onClick={() => !locked.includes(id) && toggle(id)} disabled={locked.includes(id)} aria-label={userOf(id).name}>
              <Avatar name={userOf(id).name} size={38} />
              <span>{userOf(id).name}</span>
              {!locked.includes(id) && <i><Icon name="x" size={10} /></i>}
            </button>
          ))}
        </div>
        <div className="inv-list">
          {people.map((m) => {
            const lock = locked.includes(m.userId)
            const on = lock || picked.includes(m.userId)
            return (
              <button key={m.userId} className="inv-row" onClick={() => !lock && toggle(m.userId)} disabled={lock} role="checkbox" aria-checked={on}>
                <Avatar name={userOf(m.userId).name} size={34} />
                <span className="inv-name">{userOf(m.userId).name} <small>{sub(m.userId)}</small></span>
                <span className={'inv-ck' + (lock ? ' lock' : on ? ' on' : '')}>{on && <Icon name="check" size={14} />}</span>
              </button>
            )
          })}
        </div>
        <button className="fwd-send" disabled={picked.length === 0} onClick={() => onDone(picked)}>{label}</button>
      </div>
    </>,
    document.body,
  )
}
