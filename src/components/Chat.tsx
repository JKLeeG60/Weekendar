import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { occurrencesOn } from '../lib/events'
import { fmtHead, fmtLong, weekDays } from '../lib/date'
import { ALL, mentionsMe, splitMentions, timeLabel } from '../lib/chat'
import type { ChatRef, Message } from '../lib/types'
import { Avatar, Icon } from './ui'

const dayKey = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 상단 툴바의 말풍선: 안 읽은 수, 나를 호출하면 @가 붙는다 */
export function ChatButton() {
  const { chatUnread, chatMentions } = useStore()
  const { chatOpen, setChatOpen } = useUI()
  const label = chatMentions > 0 ? `나를 호출한 메시지 포함 안 읽은 대화 ${chatUnread}개` : `안 읽은 대화 ${chatUnread}개`
  return (
    <button
      className={'icon-btn tb-chat' + (chatOpen ? ' open' : '')}
      onClick={() => setChatOpen(!chatOpen)}
      aria-label={'팀 대화' + (chatUnread ? ` (${label})` : '')}
      title="팀 대화"
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
    <div className="chat-window" role="dialog" aria-label="팀 대화">
      <ChatPanel onClose={() => setChatOpen(false)} />
    </div>
  )
}

/** 대화 목록 + 입력창 (데스크탑 창과 모바일 탭에서 함께 사용) */
export function ChatPanel({ onClose }: { onClose?: () => void }) {
  const { messages, me, team, tableMembers, userOf, sendMessage, deleteMessage, markChatRead, db } = useStore()
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
    markChatRead()
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages.length])

  // @ 입력 중이면 팀원 목록
  const q = /@(\S*)$/.exec(text.slice(0, caret))
  const people = tableMembers
    .filter((m) => m.userId !== me?.id)
    .map((m) => ({ id: m.userId, name: userOf(m.userId).name, sub: m.role === 'leader' ? '팀장' : m.title }))
  const options = q ? [...people, { id: 'all', name: ALL, sub: '팀 모두에게' }].filter((o) => o.name.startsWith(q[1])) : []

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
    sendMessage(text, ref ?? undefined)
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
    <section className="chat">
      <header className="chat-head">
        <strong>{team?.name} 대화</strong>
        <small>{tableMembers.length}명</small>
        {onClose && (
          <button className="icon-btn chat-close" onClick={onClose} aria-label="대화창 닫기" title="닫기 (Esc)">
            <Icon name="x" size={16} />
          </button>
        )}
      </header>

      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && <p className="chat-empty">아직 대화가 없어요. 첫 메시지를 남겨보세요.</p>}
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
              />
            </Fragment>
          )
        })}
      </div>

      <footer className="chat-foot">
        {options.length > 0 && (
          <div className="mention-pick" role="listbox" aria-label="호출할 사람">
            {options.map((o, i) => (
              <button
                key={o.id}
                role="option"
                aria-selected={i === pickIdx}
                className={i === pickIdx ? 'on' : ''}
                onMouseDown={(e) => { e.preventDefault(); pick(o.name) }}
              >
                {o.id === 'all' ? <span className="pick-all">@</span> : <Avatar name={o.name} size={24} />}
                <span>{o.id === 'all' ? '@전체' : o.name}</span>
                <small>{o.sub}</small>
              </button>
            ))}
          </div>
        )}
        {attachOpen && (
          <>
            <div className="popover-scrim" onMouseDown={() => setAttachOpen(false)} />
            <div className="attach-pick">
              <div className="attach-title">이번 주 일정 첨부</div>
              {attachables.length === 0 && <p className="chat-empty">이번 주 팀 표에 일정이 없어요.</p>}
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
            <button className="icon-btn" onClick={() => setRef(null)} aria-label="첨부 취소"><Icon name="x" size={14} /></button>
          </div>
        )}
        <div className="chat-input">
          <button className="icon-btn" onClick={() => setAttachOpen((v) => !v)} aria-label="일정 첨부" title="일정 첨부">
            <Icon name="cal" size={18} />
          </button>
          <textarea
            ref={taRef}
            rows={1}
            value={text}
            maxLength={1000}
            placeholder="메시지 입력 (@로 호출)"
            onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart); setPickIdx(0) }}
            onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart)}
            onKeyDown={onKey}
            onCompositionStart={() => { composing.current = true }}
            onCompositionEnd={(e) => { composing.current = false; setCaret((e.target as HTMLTextAreaElement).selectionStart) }}
            aria-label="메시지 입력"
          />
          <button className="send-btn" onClick={send} disabled={!text.trim() && !ref} aria-label="보내기">
            <Icon name="send" size={16} />
          </button>
        </div>
      </footer>
    </section>
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
    <button className="ref-card" onClick={onClick} title="이 주의 팀 표로 이동">{body}</button>
  ) : (
    <div className="ref-card">{body}</div>
  )
}

function Bubble(props: {
  m: Message; mine: boolean; hit: boolean; grouped: boolean; names: string[]; author: string; isLeader: boolean
  onDelete: () => void; onRef: (r: ChatRef) => void
}) {
  const { m, mine, hit, grouped, names, author, isLeader } = props
  const [confirm, setConfirm] = useState(false)
  return (
    <div className={'bub-row' + (mine ? ' mine' : '') + (hit ? ' hit' : '') + (grouped ? ' grouped' : '')}>
      {!mine && <span className="bub-av">{!grouped && <Avatar name={author} size={30} />}</span>}
      <div className="bub-col">
        {!mine && !grouped && <span className="bub-name">{author}{isLeader ? ' · 팀장' : ''}</span>}
        <div className="bub-line">
          <div className={'bub' + (m.deleted ? ' deleted' : '')}>
            {m.deleted ? '삭제된 메시지예요' : (
              <>
                {m.body && splitMentions(m.body, names).map((p, i) => (p.mention ? <span key={i} className="mn">{p.text}</span> : <Fragment key={i}>{p.text}</Fragment>))}
                {m.ref && <RefCard r={m.ref} onClick={() => props.onRef(m.ref!)} />}
              </>
            )}
          </div>
          <span className="bub-meta">
            {mine && !m.deleted && (
              confirm ? (
                <button className="bub-del sure" onClick={props.onDelete}>삭제할까요?</button>
              ) : (
                <button className="bub-del" onClick={() => { setConfirm(true); setTimeout(() => setConfirm(false), 3000) }} aria-label="메시지 삭제">삭제</button>
              )
            )}
            <time>{timeLabel(m.createdAt)}</time>
          </span>
        </div>
      </div>
    </div>
  )
}
