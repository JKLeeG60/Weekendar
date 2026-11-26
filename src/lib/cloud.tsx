/** Supabase 데이터 계층. Store 인터페이스는 체험 모드(store.tsx)와 동일하다. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { Ctx, type Store } from './store'
import type { ChangeRequest, ChatPin, ChatRoom, DB, EventConfirm, EventItem, Member, Message, MyTeam, Notice, Role, ScheduledMessage, Todo, WeekGoal } from './types'
import { chatCounts, chatScope, dmPeer, dmThreads, parseMentions, roomThreads } from './chat'
import { localize, t as tr, useLang } from './i18n'
import { TERMS_VERSION } from './legal'

const EMPTY: DB = { users: [], teams: [], members: [], events: [], requests: [], todos: [], goals: [], notices: [], messages: [], chatReads: {}, messageReads: {}, currentUserId: null }

/* ─ 행 ↔ 앱 모델 변환 ─ */
const evFrom = (r: any): EventItem => ({
  id: r.id, ownerId: r.owner_id, title: r.title, date: r.date,
  start: r.start_time, end: r.end_time, place: r.place ?? '', category: r.category,
  shared: r.shared, repeat: r.repeat_rule, until: r.until ?? undefined, endDate: r.end_date ?? undefined,
  remind: r.remind_min ?? undefined,
  gcal: !!r.gcal,
  ...(r.changed_at ? { changedAt: Date.parse(r.changed_at), changeText: r.change_text ?? '' } : {}),
})
const evTo = (e: Partial<EventItem>) => {
  const o: Record<string, unknown> = {}
  if (e.title !== undefined) o.title = e.title
  if (e.date !== undefined) o.date = e.date
  if (e.start !== undefined) o.start_time = e.start
  if (e.end !== undefined) o.end_time = e.end
  if (e.place !== undefined) o.place = e.place
  if (e.category !== undefined) o.category = e.category
  if (e.shared !== undefined) o.shared = e.shared
  if (e.repeat !== undefined) o.repeat_rule = e.repeat
  if ('until' in e) o.until = e.until || null
  if ('endDate' in e) o.end_date = e.endDate || null
  if ('remind' in e) o.remind_min = e.remind ?? null
  if (e.gcal !== undefined) o.gcal = e.gcal
  return o
}
const todoFrom = (r: any): Todo => ({
  id: r.id, ownerId: r.owner_id, text: r.title, date: r.date, done: r.done, priority: r.priority,
  ...(r.parent_id ? { parentId: r.parent_id } : {}), ...(r.position != null ? { position: r.position } : {}),
})
const reqFrom = (r: any): ChangeRequest => ({
  id: r.id, requesterId: r.requester_id, leaderId: r.leader_id, type: r.type,
  eventId: r.event_id ?? undefined, payload: r.payload, status: r.status,
  reason: r.reason || undefined, createdAt: Date.parse(r.created_at),
})
const noticeFrom = (r: any): Notice => ({
  id: r.id, userId: r.user_id, kind: r.kind, text: r.text, refId: r.request_id ?? undefined, eventId: r.event_id ?? undefined,
  read: r.read, createdAt: Date.parse(r.created_at),
})
const msgFrom = (r: any): Message => ({
  id: r.id, teamId: r.team_id, authorId: r.author_id, body: r.body ?? '', mentions: r.mentions ?? [],
  mentionAll: !!r.mention_all, ref: r.ref ?? undefined, createdAt: Date.parse(r.created_at), deleted: !!r.deleted_at,
  ...(r.recipient_id ? { toId: r.recipient_id } : {}),
  ...(r.reply_to ? { replyTo: r.reply_to } : {}),
  ...(r.forwarded ? { forwarded: true } : {}),
  ...(r.sticker && !r.deleted_at ? { sticker: r.sticker } : {}),
  ...(r.room_id ? { roomId: r.room_id } : {}),
  ...(r.system ? { system: true } : {}),
})
/** 같은 id는 새 값으로 바꾸고 시간순 정렬 */
const mergeMsgs = (list: Message[], add: Message[]) => {
  const map = new Map(list.map((m) => [m.id, m]))
  add.forEach((m) => map.set(m.id, m))
  return [...map.values()].sort((a, b) => a.createdAt - b.createdAt)
}

const memberFrom = (r: any): Member => ({
  userId: r.user_id, teamId: r.team_id, role: r.role as Role, isAdmin: r.is_admin, title: r.title, sort: r.sort,
})

const schedFrom = (x: any): ScheduledMessage => ({
  id: x.id, body: x.body, sendAt: Date.parse(x.send_at), mentions: x.mentions ?? [], mentionAll: !!x.mention_all,
  ...(x.recipient_id ? { toId: x.recipient_id } : {}), ...(x.room_id ? { roomId: x.room_id } : {}), ...(x.reply_to ? { replyTo: x.reply_to } : {}),
})

const fail = (e: unknown) => {
  console.error(e)
  alert(tr('저장하지 못했어요. 네트워크를 확인하고 다시 시도해주세요.') + '\n' + ((e as any)?.message ?? ''))
}

export function CloudStoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB>(EMPTY)
  const [loading, setLoading] = useState(true)
  const uidRef = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    const uid = uidRef.current
    if (!uid) return
    const [p, t, m, e, r, n, td, ms, cr, dr] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('teams').select('*'),
      supabase.from('members').select('*'),
      supabase.from('events').select('*'),
      supabase.from('requests').select('*'),
      supabase.from('notices').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('todos').select('*'),
      supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('chat_reads').select('*').eq('user_id', uid),
      // 1:1 대화 읽은 위치 (migration_015 전이면 비어 있음)
      supabase.from('dm_reads').select('*').eq('user_id', uid),
    ])
    // 내가 속한 팀 목록 (migration_032 전이면 비어 있음 → 지금 팀 하나로 본다)
    const mt = await supabase.rpc('my_teams')
    if (mt.error) console.warn('팀 목록을 불러오지 못했어요', mt.error.message)
    const myTeams: MyTeam[] = ((mt.data ?? []) as any[]).filter((x) => !x.personal).map((x) => ({ id: x.team_id, name: x.name, role: x.role as Role, isAdmin: !!x.is_admin, current: !!x.is_current }))
    // 그룹 대화방: 내가 들어간 방의 사람들 (migration_020 전이면 비어 있음)
    const rm = await supabase.from('chat_room_members').select('room_id, user_id, joined_at, last_read_at, chat_rooms(team_id)')
    if (rm.error) console.warn('대화방을 불러오지 못했어요', rm.error.message)
    const roomMap = new Map<string, ChatRoom>()
    for (const x of (rm.data ?? []) as any[]) {
      const r: ChatRoom = roomMap.get(x.room_id) ?? { id: x.room_id, teamId: x.chat_rooms?.team_id ?? '', members: [] }
      r.members.push({ userId: x.user_id, joinedAt: Date.parse(x.joined_at), lastReadAt: Date.parse(x.last_read_at) })
      roomMap.set(x.room_id, r)
    }
    // 팀장 일정 변경 확인 기록 (migration_023 전이면 비어 있음)
    const cf = await supabase.from('event_confirms').select('event_id, user_id, changed_at')
    if (cf.error) console.warn('확인 기록을 불러오지 못했어요', cf.error.message)
    const confirms: EventConfirm[] = ((cf.data ?? []) as any[]).map((x) => ({ eventId: x.event_id, userId: x.user_id, changedAt: Date.parse(x.changed_at) }))
    // 이번 주 목표 (migration_025 전이면 비어 있음)
    const gl = await supabase.from('week_goals').select('id, owner_id, week, title, done')
    if (gl.error) console.warn('이번 주 목표를 불러오지 못했어요', gl.error.message)
    const goals: WeekGoal[] = ((gl.data ?? []) as any[]).map((x) => ({ id: x.id, ownerId: x.owner_id, week: x.week, text: x.title, done: !!x.done }))
    // 대화 공지·내 예약 메시지 (migration_027 전이면 비어 있음)
    const [pn, sc] = await Promise.all([
      supabase.from('chat_pins').select('scope, message_id, body, author_id, pinned_by, pinned_at'),
      supabase.from('scheduled_messages').select('*').eq('author_id', uid).order('send_at'),
    ])
    if (pn.error) console.warn('대화 공지를 불러오지 못했어요', pn.error.message)
    if (sc.error) console.warn('예약 메시지를 불러오지 못했어요', sc.error.message)
    const pins: ChatPin[] = ((pn.data ?? []) as any[]).map((x) => ({ scope: x.scope, messageId: x.message_id, body: x.body, authorId: x.author_id ?? undefined, pinnedBy: x.pinned_by, pinnedAt: Date.parse(x.pinned_at) }))
    const scheduled: ScheduledMessage[] = ((sc.data ?? []) as any[]).map(schedFrom)
    const err = [p, t, m, e, r, n, td].find((x) => x.error)?.error
    // 대화 테이블이 아직 없으면(마이그레이션 전) 대화만 비워 두고 나머지는 정상 동작
    if (ms.error) console.warn('대화를 불러오지 못했어요', ms.error.message)
    if (err) { console.error(err); return }
    // 불러온 메시지의 이모지 반응 (migration_017 전이면 비어 있음)
    const ids = (ms.data ?? []).map((x: any) => x.id)
    const rx = ids.length ? await supabase.from('message_reactions').select('message_id, user_id, emoji').in('message_id', ids) : { data: [], error: null }
    if (rx.error) console.warn('반응을 불러오지 못했어요', rx.error.message)
    const reactions: Record<string, Record<string, string>> = {}
    for (const x of (rx.data ?? []) as any[]) (reactions[x.message_id] ??= {})[x.user_id] = x.emoji
    setDb({
      currentUserId: uid,
      users: (p.data ?? []).map((x: any) => ({ id: x.id, name: x.name || x.email || tr('이름 없음'), email: x.email ?? '', tutorialSeen: x.tutorial_seen ?? true, todoCarry: x.todo_carry ?? true, shortcuts: x.shortcuts ?? {}, termsVersion: x.terms_version ?? 0, weekCardSeen: x.week_card_seen ?? undefined })),
      teams: (t.data ?? []).map((x: any) => ({ id: x.id, name: x.name, inviteCode: x.invite_code, chatRetentionDays: x.chat_retention_days ?? null, personal: !!x.personal })),
      members: (m.data ?? []).map(memberFrom),
      events: (e.data ?? []).map(evFrom),
      requests: (r.data ?? []).map(reqFrom),
      confirms,
      notices: (n.data ?? []).map(noticeFrom),
      todos: (td.data ?? []).map(todoFrom),
      goals,
      pins,
      scheduled,
      messages: (ms.data ?? []).map(msgFrom).reverse(),
      chatReads: Object.fromEntries((cr.data ?? []).map((x: any) => [x.user_id, Date.parse(x.last_read_at)])),
      messageReads: {},
      reactions,
      rooms: [...roomMap.values()],
      myTeams,
      dmReads: Object.fromEntries((dr.data ?? []).map((x: any) => [`${x.user_id}>${x.peer_id}`, Date.parse(x.last_read_at)])),
    })
  }, [])

  // 로그인 상태 추적
  useEffect(() => {
    let alive = true
    const apply = async (userId: string | null) => {
      uidRef.current = userId
      if (!userId) { if (alive) { setDb(EMPTY); setLoading(false) } return }
      await refresh()
      if (alive) setLoading(false)
    }
    supabase.auth.getSession().then(({ data }) => apply(data.session?.user.id ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_ev, session) => {
      const id = session?.user.id ?? null
      if (id !== uidRef.current) apply(id)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [refresh])

  // 다른 사람의 변경 반영: 주기적 + 창으로 돌아올 때 새로고침
  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') refresh() }
    const id = setInterval(tick, 60000) // 실시간이 끊겼을 때를 대비한 보조 갱신
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [refresh])

  // 팀 표·요청·알림·구성원·할 일 실시간: 바뀌면 바로 다시 불러온다 (여러 변경은 묶어서 한 번)
  useEffect(() => {
    const me = db.currentUserId
    const teamId = db.members.find((m) => m.userId === me)?.teamId
    if (!me) return
    let timer: number | undefined
    const kick = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => refresh(), 350)
    }
    const ch = supabase.channel('data-' + me)
    const on = (table: string, filter?: string) =>
      ch.on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, kick)
    on('events')
    on('event_confirms')
    on('notices', `user_id=eq.${me}`)
    on('todos', `owner_id=eq.${me}`)
    on('week_goals', `owner_id=eq.${me}`)
    on('members', teamId ? `team_id=eq.${teamId}` : `user_id=eq.${me}`)
    // 대화방에 초대되거나 누가 나가면 (서버 규칙상 내 방의 변화만 온다)
    on('chat_room_members')
    on('scheduled_messages', `author_id=eq.${me}`)
    if (teamId) {
      on('chat_pins', `team_id=eq.${teamId}`)
      on('requests', `team_id=eq.${teamId}`)
      on('teams', `id=eq.${teamId}`)
    }
    ch.subscribe()
    return () => { window.clearTimeout(timer); supabase.removeChannel(ch) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db.currentUserId, db.members.find((m) => m.userId === db.currentUserId)?.teamId, refresh])

  // 화면 언어를 계정에 저장: 휴대폰 푸쉬를 같은 언어로 보내기 위해 (migration_016 전이면 조용히 실패)
  const { lang } = useLang()
  useEffect(() => {
    if (!db.currentUserId) return
    supabase.from('profiles').update({ lang }).eq('id', db.currentUserId).then(({ error }) => { if (error) console.warn('언어 저장 실패', error.message) })
  }, [db.currentUserId, lang])

  // 팀 대화 실시간: 새 메시지·삭제를 서버가 바로 밀어준다
  const myTeamId = db.members.find((m) => m.userId === db.currentUserId)?.teamId
  useEffect(() => {
    if (!myTeamId) return
    const ch = supabase
      .channel('chat-' + myTeamId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `team_id=eq.${myTeamId}` }, (payload: any) => {
        if (!payload.new?.id) return
        setDb((p) => ({ ...p, messages: mergeMsgs(p.messages, [msgFrom(payload.new)]) }))
      })
      // 이모지 반응: 서버 규칙상 내가 볼 수 있는 메시지의 반응만 온다
      .on('postgres_changes', { event: '*', schema: 'public', table: 'message_reactions' }, (payload: any) => {
        const row = payload.eventType === 'DELETE' ? payload.old : payload.new
        if (!row?.message_id || !row?.user_id) return
        setDb((p) => {
          // 지울 때는 내가 가진 메시지의 반응만 고친다
          if (payload.eventType === 'DELETE' && !p.reactions?.[row.message_id]) return p
          const cur = { ...(p.reactions?.[row.message_id] ?? {}) }
          if (payload.eventType === 'DELETE') delete cur[row.user_id]
          else cur[row.user_id] = row.emoji
          return { ...p, reactions: { ...p.reactions, [row.message_id]: cur } }
        })
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [myTeamId])

  const store = useMemo<Store>(() => {
    const userOf = (id: string) => db.users.find((u) => u.id === id) ?? { id, name: tr('알 수 없음'), email: '' }
    const me = db.users.find((u) => u.id === db.currentUserId) ?? null
    const myMember = db.members.find((m) => m.userId === db.currentUserId)
    const team = db.teams.find((t) => t.id === myMember?.teamId)
    // 내가 속한 팀 목록 (서버 함수가 없으면 지금 팀 하나)
    // 지금 혼자 쓰기 공간을 보고 있는지 (팀 목록에는 넣지 않는다)
    const solo = !!team?.personal
    const myTeams: MyTeam[] = db.myTeams?.length ? db.myTeams
      : team && myMember && !solo ? [{ id: team.id, name: team.name, role: myMember.role, isAdmin: myMember.isAdmin, current: true }] : []
    const isAdmin = !!myMember?.isAdmin
    const isLeader = myMember?.role === 'leader'
    const tableMembers = db.members
      .filter((m) => m.teamId === myMember?.teamId && (m.role === 'leader' || m.role === 'member'))
      .sort((a, b) => (a.role === 'leader' ? -1 : b.role === 'leader' ? 1 : a.sort - b.sort))
    const unreadCount = db.notices.filter((n) => n.userId === db.currentUserId && !n.read).length
    const me_id = db.currentUserId!
    const inTeam = db.messages.filter((m) => m.teamId === myMember?.teamId)
    const messages = inTeam.filter((m) => !m.toId && !m.roomId)
    // 1:1 대화 (서버 규칙상 내가 보냈거나 나에게 온 것만 내려온다)
    const dms = inTeam.filter((m) => m.toId && (m.authorId === me_id || m.toId === me_id))
    const threads = dmThreads(dms, me_id, db.dmReads ?? {})
    // 그룹 대화방 (서버 규칙상 내가 들어온 뒤의 메시지만 내려온다)
    const rooms = roomThreads(db.rooms ?? [], inTeam, me_id, myMember?.teamId)
    const roomMessages = (roomId: string) => {
      const r = rooms.find((x) => x.id === roomId)
      return r ? inTeam.filter((m) => m.roomId === roomId && m.createdAt >= r.joinedAt) : []
    }
    const dmUnread = threads.reduce((a, x) => a + x.unread, 0) + rooms.reduce((a, x) => a + x.unread, 0)
    const dmMessages = (peerId: string) => dms.filter((m) => dmPeer(m, me_id) === peerId)
    const lastRead = db.chatReads[me_id] ?? 0
    const { unread: chatUnread, mentions: chatMentions } = chatCounts(messages, me_id, lastRead)
    // 대화 공지: 지운 메시지의 공지는 보이지 않게 (서버도 지울 때 함께 내린다)
    const pins: Record<string, ChatPin> = Object.fromEntries(
      (db.pins ?? []).filter((x) => !db.messages.find((m) => m.id === x.messageId)?.deleted).map((x) => [x.scope, x]),
    )
    const scheduled = [...(db.scheduled ?? [])].sort((a, b) => a.sendAt - b.sendAt)

    /** 서버 호출 후 새로고침. 실패하면 알림 */
    const run = async (fn: () => PromiseLike<{ error: any }>) => {
      try {
        const { error } = await fn()
        if (error) throw error
        await refresh()
      } catch (e) { fail(e); await refresh() }
    }

    return {
      mode: 'cloud', loading, db, messages, chatUnread, chatMentions, dmThreads: threads, dmUnread, dmMessages, rooms, roomMessages, me, myMember, team, myTeams, solo, isAdmin, isLeader, tableMembers, userOf, unreadCount,

      loginGoogle: () => {
        supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
        })
      },
      login: () => {},
      logout: async () => { await supabase.auth.signOut(); uidRef.current = null; setDb(EMPTY) },
      // 처음 사용 안내를 봤다고 기록 (실패해도 앱 사용에는 영향 없음)
      finishTutorial: () => {
        if (me?.tutorialSeen !== false) return
        setDb((p) => ({ ...p, users: p.users.map((u) => (u.id === me.id ? { ...u, tutorialSeen: true } : u)) }))
        supabase.from('profiles').update({ tutorial_seen: true }).eq('id', me.id).then(({ error }) => {
          if (error) console.warn('안내 확인 표시를 저장하지 못했어요', error.message)
        })
      },

      // 메모: 화면에 띄울 때 그날 것만 불러오고, 저장은 덮어쓰기 (빈 글이면 지움)
      loadMemo: async (date) => {
        if (!me_id) return ''
        const { data } = await supabase.from('memos').select('body').eq('owner_id', me_id).eq('date', date).maybeSingle()
        return (data as { body?: string } | null)?.body ?? ''
      },
      findMemos: async (q) => {
        const s = q.trim()
        if (!me_id || !s) return []
        // ilike 의 특수 문자(% _ \)는 글자 그대로 찾도록 막는다
        const pat = '%' + s.replace(/[\\%_]/g, (c) => '\\' + c) + '%'
        const { data } = await supabase.from('memos').select('date, body').eq('owner_id', me_id).ilike('body', pat).order('date', { ascending: false }).limit(50)
        return ((data ?? []) as { date: string; body: string }[]).map((m) => ({ date: m.date, body: m.body }))
      },
      findMessages: async (q) => {
        const s = q.trim()
        if (!s || !myMember?.teamId) return []
        const pat = '%' + s.replace(/[\\%_]/g, (c) => '\\' + c) + '%'
        // 서버 규칙(RLS)이 내가 볼 수 있는 대화(팀·내 1:1·내가 들어간 방)만 돌려준다
        const { data } = await supabase.from('messages').select('*').eq('team_id', myMember.teamId).is('deleted_at', null).ilike('body', pat).order('created_at', { ascending: false }).limit(60)
        return ((data ?? []) as any[]).map(msgFrom).filter((m) => {
          if (m.system) return false
          if (!m.roomId) return true
          const r = rooms.find((x) => x.id === m.roomId)
          return !!r && m.createdAt >= r.joinedAt
        }).slice(0, 50)
      },
      revealMessage: async (m) => {
        if (db.messages.some((x) => x.id === m.id) || !myMember?.teamId) return
        // 처음 불러온 가장 오래된 메시지 앞까지, 찾은 메시지부터 이어서 불러온다
        const oldest = db.messages[0]?.createdAt ?? Date.now()
        const { data } = await supabase.from('messages').select('*').eq('team_id', myMember.teamId)
          .gte('created_at', new Date(m.createdAt).toISOString()).lt('created_at', new Date(oldest).toISOString())
          .order('created_at', { ascending: true }).limit(1000)
        const add = [m, ...((data ?? []) as any[]).map(msgFrom)]
        setDb((p) => ({ ...p, messages: mergeMsgs(p.messages, add) }))
      },
      chatDays: async (scope, from, to) => {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul'
        const { data, error } = await supabase.rpc('chat_day_counts', { p_scope: scope, p_from: from, p_to: to, p_tz: tz })
        if (error || !data) return {}
        const out: Record<string, number> = {}
        for (const r of data as { day: string; n: number }[]) out[r.day] = r.n
        return out
      },
      revealDay: async (scope, day) => {
        if (!myMember?.teamId) return null
        // 그날(내 시간대 0시~24시) 그 대화의 첫 메시지
        const [y, mo, d] = day.split('-').map(Number)
        const start = new Date(y, mo - 1, d).toISOString()
        const end = new Date(y, mo - 1, d + 1).toISOString()
        let q = supabase.from('messages').select('*').eq('team_id', myMember.teamId).is('deleted_at', null).eq('system', false)
          .gte('created_at', start).lt('created_at', end)
        if (scope === 'team') q = q.is('room_id', null).is('recipient_id', null)
        else if (scope.startsWith('room:')) q = q.eq('room_id', scope.slice(5))
        else {
          const [, a, b] = scope.split(':')
          q = q.is('room_id', null).or(`and(author_id.eq.${a},recipient_id.eq.${b}),and(author_id.eq.${b},recipient_id.eq.${a})`)
        }
        const { data } = await q.order('created_at', { ascending: true }).limit(1)
        const row = (data as any[] | null)?.[0]
        if (!row) return null
        const m = msgFrom(row)
        if (!db.messages.some((x) => x.id === m.id)) {
          // 그 메시지부터 지금 불러온 가장 오래된 메시지 앞까지 이어서 불러온다
          const oldest = db.messages[0]?.createdAt ?? Date.now()
          const { data: more } = await supabase.from('messages').select('*').eq('team_id', myMember.teamId)
            .gte('created_at', new Date(m.createdAt).toISOString()).lt('created_at', new Date(oldest).toISOString())
            .order('created_at', { ascending: true }).limit(1000)
          const add = [m, ...((more ?? []) as any[]).map(msgFrom)]
          setDb((p) => ({ ...p, messages: mergeMsgs(p.messages, add) }))
        }
        return m.id
      },
      saveMemo: async (date, body) => {
        if (!me_id) return false
        const text = body.slice(0, 20000)
        const { error } = text.trim()
          ? await supabase.from('memos').upsert({ owner_id: me_id, date, body: text, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,date' })
          : await supabase.from('memos').delete().eq('owner_id', me_id).eq('date', date)
        return !error
      },

      // 이번 주 목표: 주마다 한 개. 빈 글이면 삭제, 있으면 덮어쓰기(달성 여부는 유지)
      setGoal: (week, text) => {
        const body = text.trim().slice(0, 100)
        const old = (db.goals ?? []).find((g) => g.ownerId === me_id && g.week === week)
        if (!body && !old) return
        setDb((p) => {
          const rest = (p.goals ?? []).filter((g) => !(g.ownerId === me_id && g.week === week))
          return { ...p, goals: body ? [...rest, { id: old?.id ?? 'tmp-' + week, ownerId: me_id, week, text: body, done: old?.done ?? false }] : rest }
        })
        if (!body) run(() => supabase.from('week_goals').delete().eq('owner_id', me_id).eq('week', week))
        else run(() => supabase.from('week_goals').upsert({ owner_id: me_id, week, title: body, done: old?.done ?? false }, { onConflict: 'owner_id,week' }))
      },
      toggleGoal: (id) => {
        const g = (db.goals ?? []).find((x) => x.id === id && x.ownerId === me_id)
        if (!g) return
        setDb((p) => ({ ...p, goals: (p.goals ?? []).map((x) => (x.id === id ? { ...x, done: !x.done } : x)) }))
        run(() => supabase.from('week_goals').update({ done: !g.done }).eq('owner_id', me_id).eq('week', g.week))
      },
      // 월요일 카드를 봤다고 기록 (실패해도 앱 사용에는 영향 없음)
      finishWeekCard: (week) => {
        if (me?.weekCardSeen === week) return
        setDb((p) => ({ ...p, users: p.users.map((u) => (u.id === me_id ? { ...u, weekCardSeen: week } : u)) }))
        supabase.from('profiles').update({ week_card_seen: week }).eq('id', me_id).then(({ error }) => {
          if (error) console.warn('월요일 카드 확인 표시를 저장하지 못했어요', error.message)
        })
      },

      // 단축키 설정: 먼저 화면에 반영하고, 실패하면 되돌린다
      setShortcuts: async (map) => {
        if (!me) return
        const before = me.shortcuts ?? {}
        const put = (v: Record<string, string>) => setDb((p) => ({ ...p, users: p.users.map((u) => (u.id === me.id ? { ...u, shortcuts: v } : u)) }))
        put(map)
        const { error } = await supabase.from('profiles').update({ shortcuts: map }).eq('id', me.id)
        if (error) { put(before); fail(error) }
      },

      // 약관 동의: 저장에 성공하면 화면을 넘긴다
      agreeTerms: async () => {
        if (!me) return
        const { error } = await supabase.rpc('agree_terms', { p_version: TERMS_VERSION })
        if (error) { fail(error); return }
        setDb((p) => ({ ...p, users: p.users.map((u) => (u.id === me.id ? { ...u, termsVersion: TERMS_VERSION } : u)) }))
      },

      // 탈퇴: 서버에서 계정을 지운 뒤 로그아웃 (팀에 속해 있으면 서버가 막는다)
      deleteAccount: async () => {
        const { error } = await supabase.rpc('delete_account')
        if (error) return localize(error.message)
        await supabase.auth.signOut(); uidRef.current = null; setDb(EMPTY)
        return null
      },

      // 할 일 넘기기 설정: 먼저 화면에 반영하고, 실패하면 되돌린다
      setTodoCarry: async (on) => {
        if (!me) return
        const put = (v: boolean) => setDb((p) => ({ ...p, users: p.users.map((u) => (u.id === me.id ? { ...u, todoCarry: v } : u)) }))
        put(on)
        const { error } = await supabase.from('profiles').update({ todo_carry: on }).eq('id', me.id)
        if (error) { put(!on); fail(error) }
      },

      createTeam: async (name) => { await run(() => supabase.rpc('create_team', { p_name: name })) },
      startPersonal: async () => { await run(() => supabase.rpc('start_personal')) },
      switchTeam: async (teamId) => {
        if (teamId === team?.id) return
        const { error } = await supabase.rpc('switch_team', { p_team: teamId })
        if (error) { fail(error); return }
        await refresh()
      },
      joinTeam: async (code) => {
        const { error } = await supabase.rpc('join_team', { p_code: code })
        if (error) return error.message
        await refresh()
        return null
      },

      renameTeam: (name) => run(() => supabase.from('teams').update({ name }).eq('id', team!.id)) as unknown as void,
      setChatRetention: (days) => run(() => supabase.from('teams').update({ chat_retention_days: days }).eq('id', team!.id)) as unknown as void,
      teamChatUsage: async () => {
        const { data, error } = await supabase.rpc('team_chat_usage')
        return error ? 0 : Number(data ?? 0)
      },

      updateMember: async (userId, patch) => {
        if (patch.role === 'leader') {
          const { error } = await supabase.rpc('set_leader', { p_user: userId })
          if (error) { fail(error); return }
        }
        const row: Record<string, unknown> = {}
        if (patch.role && patch.role !== 'leader') row.role = patch.role
        if (patch.title !== undefined) row.title = patch.title
        if (patch.isAdmin !== undefined) row.is_admin = patch.isAdmin
        // 승인된 사람은 맨 아래 순서로
        if (patch.role === 'member') {
          const max = Math.max(0, ...db.members.filter((m) => m.teamId === team?.id && m.role === 'member' && m.userId !== userId).map((m) => m.sort))
          row.sort = max + 1
        }
        if (Object.keys(row).length) await run(() => supabase.from('members').update(row).eq('user_id', userId).eq('team_id', team!.id))
        else await refresh()
      },

      moveMember: async (userId, dir) => {
        const list = db.members
          .filter((m) => m.teamId === team?.id && m.role === 'member')
          .sort((a, b) => a.sort - b.sort)
        const i = list.findIndex((m) => m.userId === userId)
        const j = i + dir
        if (i < 0 || j < 0 || j >= list.length) return
        const a = list[i], b = list[j]
        // 정렬값이 같을 수 있어 순번으로 다시 매긴다
        const order = list.map((m) => m.userId)
        ;[order[i], order[j]] = [order[j], order[i]]
        await run(async () => {
          const rs = await Promise.all(order.map((id, idx) => supabase.from('members').update({ sort: idx + 1 }).eq('user_id', id).eq('team_id', team!.id)))
          return { error: rs.find((x) => x.error)?.error ?? null }
        })
        void a; void b
      },

      // 구성원 삭제: 소속과 함께 그 사람의 일정·할 일·대기 요청까지 서버 함수가 한 번에 정리
      removeMember: (userId) => run(() => supabase.rpc('remove_member', { p_user: userId })) as unknown as void,
      leaveTeam: (newAdmin) => run(() => supabase.rpc('leave_team', { p_new_admin: newAdmin ?? null })) as unknown as void,
      transferAdmin: (userId) => run(() => supabase.rpc('transfer_admin', { p_user: userId })) as unknown as void,

      addEvent: (e) => run(() => supabase.from('events').insert({ ...evTo(e), owner_id: me_id })) as unknown as void,
      updateEvent: (id, patch) => run(() => supabase.from('events').update(evTo(patch)).eq('id', id)) as unknown as void,
      deleteEvent: (id) => run(() => supabase.from('events').delete().eq('id', id)) as unknown as void,
      confirmEvent: (id) => {
        // 눌렀을 때 바로 반영하고, 서버에 기록 (실패하면 다시 불러와 원래대로)
        const e = db.events.find((x) => x.id === id)
        if (e?.changedAt && me_id) {
          setDb((p) => ({
            ...p,
            confirms: [...(p.confirms ?? []).filter((c) => !(c.eventId === id && c.userId === me_id)), { eventId: id, userId: me_id, changedAt: e.changedAt! }],
            notices: p.notices.map((n) => (n.kind === 'confirm' && n.eventId === id ? { ...n, read: true } : n)),
          }))
        }
        return run(() => supabase.rpc('confirm_event', { p_event: id })) as unknown as void
      },

      createRequest: (r) => {
        const leader = tableMembers.find((m) => m.role === 'leader')
        if (!leader || !team) return
        run(() => supabase.from('requests').insert({
          team_id: team.id, requester_id: me_id, leader_id: leader.userId,
          type: r.type, event_id: r.eventId ?? null, payload: r.payload,
        }))
      },
      decideRequest: (id, accept, reason) => {
        run(() => supabase.rpc('decide_request', { p_id: id, p_accept: accept, p_reason: reason ?? '' }))
      },

      addTodo: (text, date, priority = false) => run(() => supabase.from('todos').insert({ owner_id: me_id, title: text, date, ...(priority ? { priority: true } : {}) })) as unknown as void,
      // 체크/중요 표시는 즉시 반영하고 서버에 저장
      // 상위 할 일을 끝내면 하위 할 일도 모두 끝낸다
      toggleTodo: (id) => {
        const t = db.todos.find((x) => x.id === id); if (!t) return
        const done = !t.done
        setDb((p) => ({ ...p, todos: p.todos.map((x) => (x.id === id || (done && x.parentId === id) ? { ...x, done } : x)) }))
        run(async () => {
          const r = await supabase.from('todos').update({ done }).eq('id', id)
          if (r.error || !done || !db.todos.some((x) => x.parentId === id)) return r
          return supabase.from('todos').update({ done: true }).eq('parent_id', id)
        })
      },
      togglePriority: (id) => {
        const t = db.todos.find((x) => x.id === id); if (!t) return
        setDb((p) => ({ ...p, todos: p.todos.map((x) => (x.id === id ? { ...x, priority: !x.priority } : x)) }))
        run(() => supabase.from('todos').update({ priority: !t.priority }).eq('id', id))
      },
      // 하위 할 일은 서버에서 함께 지워진다 (on delete cascade)
      removeTodo: (id) => {
        setDb((p) => ({ ...p, todos: p.todos.filter((x) => x.id !== id && x.parentId !== id) }))
        run(() => supabase.from('todos').delete().eq('id', id))
      },
      // 하위 할 일도 함께 옮긴다
      moveTodo: (id, date) => {
        const kids = db.todos.some((x) => x.parentId === id)
        setDb((p) => ({ ...p, todos: p.todos.map((x) => (x.id === id || x.parentId === id ? { ...x, date } : x)) }))
        run(async () => {
          const r = await supabase.from('todos').update({ date }).eq('id', id)
          if (r.error || !kids) return r
          return supabase.from('todos').update({ date }).eq('parent_id', id)
        })
      },
      restoreTodo: (t, children = []) =>
        run(async () => {
          const row = (x: Omit<Todo, 'id' | 'ownerId'>) => ({ owner_id: me_id, title: x.text, date: x.date, done: x.done, priority: x.priority, ...(x.position != null ? { position: x.position } : {}) })
          const r = await supabase.from('todos').insert(row(t)).select('id').single()
          if (r.error || !children.length) return r
          return supabase.from('todos').insert(children.map((c) => ({ ...row(c), parent_id: r.data.id })))
        }) as unknown as void,
      arrangeTodos: (updates) => {
        setDb((p) => ({
          ...p,
          todos: p.todos.map((t) => {
            const u = updates.find((x) => x.id === t.id)
            if (!u) return t
            const { parentId: _old, ...rest } = t
            return { ...rest, ...(u.parentId ? { parentId: u.parentId } : {}), position: u.position }
          }),
        }))
        // 상위에서 빠지는 것을 먼저 저장해야 '한 단계까지' 검사에 걸리지 않는다
        const order = [...updates].sort((a, b) => Number(!!a.parentId) - Number(!!b.parentId))
        run(async () => {
          for (const u of order) {
            const r = await supabase.from('todos').update({ parent_id: u.parentId, position: u.position }).eq('id', u.id)
            if (r.error) return r
          }
          return { error: null }
        })
      },

      sendMessage: async (body, ref, toId, opts) => {
        const text = body.trim()
        if ((!text && !ref && !opts?.sticker) || !team) return
        const people = tableMembers.map((x) => ({ id: x.userId, name: userOf(x.userId).name }))
        // 1:1 대화·전달한 메시지에서는 @호출을 쓰지 않는다
        const { mentions, mentionAll } = toId || opts?.roomId || opts?.forwarded ? { mentions: [] as string[], mentionAll: false } : parseMentions(text, people)
        const { data, error } = await supabase.from('messages').insert({
          team_id: team.id, author_id: me_id, body: text,
          mentions: mentions.filter((id) => id !== me_id), mention_all: mentionAll, ref: ref ?? null,
          ...(toId ? { recipient_id: toId } : {}),
          ...(opts?.replyTo ? { reply_to: opts.replyTo } : {}),
          ...(opts?.forwarded ? { forwarded: true } : {}),
          ...(opts?.roomId ? { room_id: opts.roomId } : {}),
          ...(opts?.sticker ? { sticker: opts.sticker } : {}),
        }).select().single()
        if (error) { fail(error); return }
        const m = msgFrom(data)
        if (opts?.roomId) {
          const rid = opts.roomId
          setDb((p) => ({ ...p, messages: mergeMsgs(p.messages, [m]), rooms: (p.rooms ?? []).map((r) => (r.id === rid ? { ...r, members: r.members.map((x) => (x.userId === me_id ? { ...x, lastReadAt: m.createdAt } : x)) } : r)) }))
          supabase.rpc('mark_room_read', { p_room: rid }).then(() => {})
          return
        }
        if (toId) {
          setDb((p) => ({ ...p, messages: mergeMsgs(p.messages, [m]), dmReads: { ...p.dmReads, [`${me_id}>${toId}`]: m.createdAt } }))
          supabase.from('dm_reads').upsert({ user_id: me_id, peer_id: toId, last_read_at: new Date(m.createdAt).toISOString() }).then(() => {})
          return
        }
        setDb((p) => ({ ...p, messages: mergeMsgs(p.messages, [m]), chatReads: { ...p.chatReads, [me_id]: m.createdAt } }))
        supabase.from('chat_reads').upsert({ user_id: me_id, team_id: team?.id, last_read_at: new Date(m.createdAt).toISOString() }).then(() => {})
      },
      deleteMessage: async (id) => {
        const { error } = await supabase.rpc('delete_message', { p_id: id })
        if (error) { fail(error); return }
        setDb((p) => ({
          ...p,
          messages: p.messages.map((m) => (m.id === id ? { ...m, body: '', ref: undefined, mentions: [], mentionAll: false, deleted: true } : m)),
          reactions: Object.fromEntries(Object.entries(p.reactions ?? {}).filter(([k]) => k !== id)),
        }))
      },
      markChatRead: () => {
        const last = messages.length ? messages[messages.length - 1].createdAt : 0
        if (lastRead >= last) return
        const at = Math.max(last, Date.now())
        const fresh = messages.filter((m) => m.authorId !== me_id && !m.deleted && m.createdAt > lastRead).map((m) => m.id)
        setDb((p) => ({ ...p, chatReads: { ...p.chatReads, [me_id]: at } }))
        supabase.from('chat_reads').upsert({ user_id: me_id, team_id: team?.id, last_read_at: new Date(at).toISOString() }).then(() => {})
        // 메시지별 읽은 시각 기록 (마이그레이션 6 전이면 조용히 실패)
        if (fresh.length) supabase.rpc('mark_messages_read', { p_ids: fresh }).then(({ error }) => { if (error) console.warn(error.message) })
      },
      markDmRead: (peerId) => {
        const list = dmMessages(peerId)
        const last = list.length ? list[list.length - 1].createdAt : 0
        const key = `${me_id}>${peerId}`
        const read = db.dmReads?.[key] ?? 0
        if (read >= last) return
        const at = Math.max(last, Date.now())
        const fresh = list.filter((m) => m.authorId !== me_id && !m.deleted && m.createdAt > read).map((m) => m.id)
        setDb((p) => ({ ...p, dmReads: { ...p.dmReads, [key]: at } }))
        supabase.from('dm_reads').upsert({ user_id: me_id, peer_id: peerId, last_read_at: new Date(at).toISOString() }).then(() => {})
        if (fresh.length) supabase.rpc('mark_messages_read', { p_ids: fresh }).then(({ error }) => { if (error) console.warn(error.message) })
      },
      // ── 그룹 대화방 ──
      createRoom: async (ids) => {
        const { data, error } = await supabase.rpc('create_room', { p_members: ids })
        if (error) { fail(error); return null }
        await refresh()
        return (data as string) ?? null
      },
      inviteToRoom: (roomId, ids) => run(() => supabase.rpc('invite_to_room', { p_room: roomId, p_members: ids })),
      leaveRoom: (roomId) => run(() => supabase.rpc('leave_room', { p_room: roomId })),
      markRoomRead: (roomId) => {
        const r = rooms.find((x) => x.id === roomId)
        if (!r || r.unread === 0) return
        const fresh = roomMessages(roomId).filter((m) => m.authorId !== me_id && !m.deleted && !m.system && m.createdAt > (db.rooms?.find((x) => x.id === roomId)?.members.find((y) => y.userId === me_id)?.lastReadAt ?? 0)).map((m) => m.id)
        const now = Date.now()
        setDb((p) => ({ ...p, rooms: (p.rooms ?? []).map((x) => (x.id === roomId ? { ...x, members: x.members.map((y) => (y.userId === me_id ? { ...y, lastReadAt: now } : y)) } : x)) }))
        supabase.rpc('mark_room_read', { p_room: roomId }).then(({ error }) => { if (error) console.warn(error.message) })
        if (fresh.length) supabase.rpc('mark_messages_read', { p_ids: fresh }).then(({ error }) => { if (error) console.warn(error.message) })
      },
      pins,
      pinMessage: (m) => {
        if (!team || m.deleted || m.system) return
        const pin: ChatPin = { scope: chatScope(me_id, m), messageId: m.id, body: m.body, authorId: m.authorId, pinnedBy: me_id, pinnedAt: Date.now() }
        setDb((p) => ({ ...p, pins: [...(p.pins ?? []).filter((x) => x.scope !== pin.scope), pin] }))
        run(() => supabase.from('chat_pins').upsert({ team_id: team.id, scope: pin.scope, message_id: m.id, body: m.body, author_id: m.authorId, pinned_by: me_id, pinned_at: new Date().toISOString() }, { onConflict: 'team_id,scope' }))
      },
      unpin: (scope) => {
        if (!team) return
        setDb((p) => ({ ...p, pins: (p.pins ?? []).filter((x) => x.scope !== scope) }))
        run(() => supabase.from('chat_pins').delete().eq('team_id', team.id).eq('scope', scope))
      },
      scheduled,
      scheduleMessage: async (body, sendAt, toId, opts) => {
        const text = body.trim()
        if (!text || !team || sendAt <= Date.now()) return false
        const people = tableMembers.map((x) => ({ id: x.userId, name: userOf(x.userId).name }))
        const { mentions, mentionAll } = toId || opts?.roomId ? { mentions: [] as string[], mentionAll: false } : parseMentions(text, people)
        const { data, error } = await supabase.from('scheduled_messages').insert({
          team_id: team.id, author_id: me_id, body: text, send_at: new Date(sendAt).toISOString(),
          mentions: mentions.filter((id) => id !== me_id), mention_all: mentionAll,
          ...(toId ? { recipient_id: toId } : {}), ...(opts?.roomId ? { room_id: opts.roomId } : {}), ...(opts?.replyTo ? { reply_to: opts.replyTo } : {}),
        }).select().single()
        if (error) { fail(error); return false }
        setDb((p) => ({ ...p, scheduled: [...(p.scheduled ?? []), schedFrom(data)] }))
        return true
      },
      reschedule: (id, sendAt) => {
        setDb((p) => ({ ...p, scheduled: (p.scheduled ?? []).map((x) => (x.id === id ? { ...x, sendAt } : x)) }))
        run(() => supabase.from('scheduled_messages').update({ send_at: new Date(sendAt).toISOString() }).eq('id', id))
      },
      editScheduled: (id, body) => {
        const text = body.trim()
        if (!text) return
        setDb((p) => ({ ...p, scheduled: (p.scheduled ?? []).map((x) => (x.id === id ? { ...x, body: text } : x)) }))
        run(() => supabase.from('scheduled_messages').update({ body: text }).eq('id', id))
      },
      cancelScheduled: (id) => {
        setDb((p) => ({ ...p, scheduled: (p.scheduled ?? []).filter((x) => x.id !== id) }))
        run(() => supabase.from('scheduled_messages').delete().eq('id', id))
      },
      sendScheduledNow: (id) => {
        const x = (db.scheduled ?? []).find((y) => y.id === id)
        if (!x || !team) return
        // 예약을 지운 뒤(이미 서버가 보냈으면 지울 것이 없으니 다시 보내지 않는다) 보통 메시지로 보낸다
        setDb((p) => ({ ...p, scheduled: (p.scheduled ?? []).filter((y) => y.id !== id) }))
        void (async () => {
          const { data, error } = await supabase.from('scheduled_messages').delete().eq('id', id).select('id')
          if (error) { fail(error); return }
          if (!data?.length) return
          const { data: row, error: e2 } = await supabase.from('messages').insert({
            team_id: team.id, author_id: me_id, body: x.body, mentions: x.mentions, mention_all: x.mentionAll,
            ...(x.toId ? { recipient_id: x.toId } : {}), ...(x.roomId ? { room_id: x.roomId } : {}), ...(x.replyTo ? { reply_to: x.replyTo } : {}),
          }).select().single()
          if (e2) { fail(e2); return }
          setDb((p) => ({ ...p, messages: mergeMsgs(p.messages, [msgFrom(row)]) }))
        })()
      },
      getCalendarUrl: async (reset) => {
        const { data, error } = await supabase.rpc(reset ? 'reset_calendar_token' : 'get_calendar_token')
        if (error || !data) { console.warn(error?.message); return null }
        return `${window.location.origin}/cal/${data}.ics`
      },
      getReadReceipts: async (messageId) => {
        const m = inTeam.find((x) => x.id === messageId)
        if (!m || m.authorId !== me_id) return {}
        const { data, error } = await supabase.from('message_reads').select('user_id, read_at').eq('message_id', messageId)
        if (error) { console.warn(error.message); return {} }
        return Object.fromEntries((data ?? []).map((x: any) => [x.user_id, Date.parse(x.read_at)]))
      },

      reactions: db.reactions ?? {},
      react: async (messageId, emoji) => {
        const before = db.reactions?.[messageId]?.[me_id]
        const put = (e: string | null | undefined) => setDb((p) => {
          const cur = { ...(p.reactions?.[messageId] ?? {}) }
          if (e) cur[me_id] = e
          else delete cur[me_id]
          return { ...p, reactions: { ...p.reactions, [messageId]: cur } }
        })
        put(emoji) // 먼저 화면에 보여 주고
        const { error } = emoji
          ? await supabase.from('message_reactions').upsert({ message_id: messageId, user_id: me_id, emoji })
          : await supabase.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', me_id)
        if (error) { put(before); fail(error) } // 실패하면 되돌린다
      },

      markAllRead: () => {
        setDb((p) => ({ ...p, notices: p.notices.map((n) => ({ ...n, read: true })) }))
        run(() => supabase.from('notices').update({ read: true }).eq('user_id', me_id).eq('read', false))
      },
    }
  }, [db, loading, refresh])

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}
