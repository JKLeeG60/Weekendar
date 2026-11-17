import React, { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { occurrencesOn } from '../lib/events'
import { fmtHead, fmtLong, weekDays } from '../lib/date'
import { ALL, ALL_EN, mentionsMe, splitMentions, timeLabel } from '../lib/chat'
import { getLang, t } from '../lib/i18n'
import type { ChatRef, Message } from '../lib/types'
import { Avatar, Icon } from './ui'

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
  if (!chatOpen) return null
  return (
    <div className="chat-window" role="dialog" aria-label={t('팀 대화')}>
      <ChatPanel onClose={() => setChatOpen(false)} />
    </div>
  )
}

/** 대화창: [팀 대화 | 1:1 대화] 탭 (데스크탑 창과 모바일 탭에서 함께 사용) */
export function ChatPanel({ onClose }: { onClose?: () => void }) {
  const { team, tableMembers, userOf, chatUnread, dmUnread } = useStore()
  const { chatTab, setChatTab, dmPeer, setDmPeer } = useUI()
  const peer = chatTab === 'dm' ? dmPeer : null
  const peerMember = tableMembers.find((m) => m.userId === peer)
  return (
    <section className="chat">
      <header className="chat-head">
        {peer ? (
          <>
            <button className="icon-btn dm-back" onClick={() => setDmPeer(null)} aria-label={t('1:1 대화 목록')}>
              <Icon name="chevL" size={18} />
            </button>
            <Avatar name={userOf(peer).name} size={28} />
            <div className="dm-who">
              <strong>{userOf(peer).name}</strong>
              <small>{peerMember?.role === 'leader' ? t('팀장') + ' · ' : peerMember?.title ? peerMember.title + ' · ' : ''}{t('1:1 대화')}</small>
            </div>
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
          {t('1:1 대화')}{dmUnread > 0 && <em>{dmUnread > 99 ? '99+' : dmUnread}</em>}
        </button>
      </div>
      {chatTab === 'team' ? <ChatBody key="team" /> : peer ? <ChatBody key={peer} peer={peer} /> : <DmList onPick={setDmPeer} />}
    </section>
  )
}

/** 1:1 대화 목록: 대화한 사람(최근 먼저) + 아직 대화하지 않은 팀원 */
function DmList({ onPick }: { onPick: (id: string) => void }) {
  const { dmThreads, tableMembers, userOf, me } = useStore()
  const talked = new Set(dmThreads.map((x) => x.peerId))
  const others = tableMembers.filter((m) => m.userId !== me?.id && !talked.has(m.userId))
  const sub = (id: string) => {
    const m = tableMembers.find((x) => x.userId === id)
    return m?.role === 'leader' ? t('팀장') : m?.title ?? ''
  }
  return (
    <div className="dm-list">
      {dmThreads.map((th) => (
        <button key={th.peerId} className="dm-row" onClick={() => onPick(th.peerId)}>
          <Avatar name={userOf(th.peerId).name} size={38} />
          <span className="dm-txt">
            <b>{userOf(th.peerId).name} <small>{sub(th.peerId)}</small></b>
            <span>{th.last.deleted ? t('삭제된 메시지예요') : th.last.body || (th.last.ref ? t('일정을 공유했어요') : '')}</span>
          </span>
          <span className="dm-side">
            <time>{timeLabel(th.last.createdAt)}</time>
            {th.unread > 0 && <em>{th.unread}</em>}
          </span>
        </button>
      ))}
      {others.length > 0 && <div className="dm-label">{dmThreads.length ? t('새 대화 시작') : t('대화할 팀원을 고르세요')}</div>}
      {others.map((m) => (
        <button key={m.userId} className="dm-row new" onClick={() => onPick(m.userId)}>
          <Avatar name={userOf(m.userId).name} size={38} />
          <span className="dm-txt">
            <b>{userOf(m.userId).name} <small>{sub(m.userId)}</small></b>
          </span>
          <span className="dm-side"><Icon name="chat" size={16} /></span>
        </button>
      ))}
      {dmThreads.length === 0 && others.length === 0 && <p className="chat-empty">{t('대화할 팀원이 아직 없어요.')}</p>}
    </div>
  )
}

/** 메시지 목록 + 입력창. peer 가 있으면 그 사람과의 1:1 대화 */
function ChatBody({ peer }: { peer?: string }) {
  const { messages: teamMessages, me, tableMembers, userOf, sendMessage, deleteMessage, markChatRead, db, getReadReceipts, dmMessages, markDmRead } = useStore()
  const messages = peer ? dmMessages(peer) : teamMessages
  const markRead = peer ? () => markDmRead(peer) : markChatRead
  const { openModal, isMobile } = useUI()
  const [receipt, setReceipt] = useState<{ m: Message; rect: DOMRect } | null>(null)
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
  const q = peer ? null : /@(\S*)$/.exec(text.slice(0, caret))
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
    sendMessage(text, ref ?? undefined, peer)
    setText('')
    setCaret(0)
    setRef(null)
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
            {peer ? t('{name}님과 아직 대화가 없어요. 첫 메시지를 남겨보세요.', { name: userOf(peer).name }) : t('아직 대화가 없어요. 첫 메시지를 남겨보세요.')}
          </p>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt)
          const grouped = !newDay && prev && prev.authorId === m.authorId && m.createdAt - prev.createdAt < 5 * 60000
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
                onDelete={() => deleteMessage(m.id)}
                onRef={(r) => setSelected(r.date)}
                onHold={(rect) => setReceipt({ m, rect })}
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
          people={tableMembers.filter((x) => x.userId !== receipt.m.authorId && (!peer || x.userId === peer)).map((x) => ({ id: x.userId, name: userOf(x.userId).name, leader: x.role === 'leader' }))}
          onClose={() => setReceipt(null)}
        />
      )}

      {peer && <div className="dm-lock">🔒 {t('두 사람만 볼 수 있는 대화예요')}</div>}
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
            placeholder={peer ? t('{name}님에게 메시지', { name: userOf(peer).name }) : t('메시지 입력 (@로 호출)')}
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
  onDelete: () => void; onRef: (r: ChatRef) => void; onHold: (rect: DOMRect) => void
  /** 보낸 사람 이름·사진을 누르면 (누른 위치) */
  onWho: (x: number, y: number) => void
}) {
  const { m, mine, hit, grouped, names, author, isLeader } = props
  const [confirm, setConfirm] = useState(false)
  const [pressed, setPressed] = useState(false)
  const timer = useRef<number | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const bubRef = useRef<HTMLDivElement>(null)
  const canHold = mine && !m.deleted // 내가 보낸 메시지만 읽음 확인 가능

  const cancel = () => {
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = null
    start.current = null
    setPressed(false)
  }
  const open = () => {
    cancel()
    if (bubRef.current) props.onHold(bubRef.current.getBoundingClientRect())
  }
  const hold = canHold
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.button !== 0) return
          start.current = { x: e.clientX, y: e.clientY }
          setPressed(true)
          timer.current = window.setTimeout(open, 500)
        },
        onPointerMove: (e: React.PointerEvent) => {
          if (start.current && Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 8) cancel()
        },
        onPointerUp: cancel,
        onPointerLeave: cancel,
        onPointerCancel: cancel,
        onContextMenu: (e: React.MouseEvent) => {
          e.preventDefault()
          open()
        },
      }
    : {}
  return (
    <div className={'bub-row' + (mine ? ' mine' : '') + (hit ? ' hit' : '') + (grouped ? ' grouped' : '')}>
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
            className={'bub' + (m.deleted ? ' deleted' : '') + (canHold ? ' holdable' : '') + (pressed ? ' pressed' : '')}
            title={canHold ? t('길게 누르면 읽은 사람을 볼 수 있어요') : undefined}
            {...hold}
          >
            {m.deleted ? t('삭제된 메시지예요') : (
              <>
                {m.body && splitMentions(m.body, names).map((p, i) => (p.mention ? <span key={i} className="mn">{p.text}</span> : <Fragment key={i}>{p.text}</Fragment>))}
                {m.ref && <RefCard r={m.ref} onClick={() => props.onRef(m.ref!)} />}
              </>
            )}
          </div>
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
      </div>
    </div>
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
