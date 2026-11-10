/** Supabase 데이터 계층. Store 인터페이스는 체험 모드(store.tsx)와 동일하다. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from './supabase'
import { Ctx, type Store } from './store'
import type { ChangeRequest, DB, EventItem, Member, Notice, Role, Todo } from './types'

const EMPTY: DB = { users: [], teams: [], members: [], events: [], requests: [], todos: [], notices: [], currentUserId: null }

/* ─ 행 ↔ 앱 모델 변환 ─ */
const evFrom = (r: any): EventItem => ({
  id: r.id, ownerId: r.owner_id, title: r.title, date: r.date,
  start: r.start_time, end: r.end_time, place: r.place ?? '', category: r.category,
  shared: r.shared, repeat: r.repeat_rule, until: r.until ?? undefined,
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
  return o
}
const todoFrom = (r: any): Todo => ({
  id: r.id, ownerId: r.owner_id, text: r.title, date: r.date, done: r.done, priority: r.priority,
})
const reqFrom = (r: any): ChangeRequest => ({
  id: r.id, requesterId: r.requester_id, leaderId: r.leader_id, type: r.type,
  eventId: r.event_id ?? undefined, payload: r.payload, status: r.status,
  reason: r.reason || undefined, createdAt: Date.parse(r.created_at),
})
const noticeFrom = (r: any): Notice => ({
  id: r.id, userId: r.user_id, kind: r.kind, text: r.text, refId: r.request_id ?? undefined,
  read: r.read, createdAt: Date.parse(r.created_at),
})
const memberFrom = (r: any): Member => ({
  userId: r.user_id, teamId: r.team_id, role: r.role as Role, isAdmin: r.is_admin, title: r.title, sort: r.sort,
})

const fail = (e: unknown) => {
  console.error(e)
  alert('저장하지 못했어요. 네트워크를 확인하고 다시 시도해주세요.\n' + ((e as any)?.message ?? ''))
}

export function CloudStoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB>(EMPTY)
  const [loading, setLoading] = useState(true)
  const uidRef = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    const uid = uidRef.current
    if (!uid) return
    const [p, t, m, e, r, n, td] = await Promise.all([
      supabase.from('profiles').select('*'),
      supabase.from('teams').select('*'),
      supabase.from('members').select('*'),
      supabase.from('events').select('*'),
      supabase.from('requests').select('*'),
      supabase.from('notices').select('*').order('created_at', { ascending: false }).limit(100),
      supabase.from('todos').select('*'),
    ])
    const err = [p, t, m, e, r, n, td].find((x) => x.error)?.error
    if (err) { console.error(err); return }
    setDb({
      currentUserId: uid,
      users: (p.data ?? []).map((x: any) => ({ id: x.id, name: x.name || x.email || '이름 없음', email: x.email ?? '' })),
      teams: (t.data ?? []).map((x: any) => ({ id: x.id, name: x.name, inviteCode: x.invite_code })),
      members: (m.data ?? []).map(memberFrom),
      events: (e.data ?? []).map(evFrom),
      requests: (r.data ?? []).map(reqFrom),
      notices: (n.data ?? []).map(noticeFrom),
      todos: (td.data ?? []).map(todoFrom),
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
    const id = setInterval(tick, 20000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick) }
  }, [refresh])

  const store = useMemo<Store>(() => {
    const userOf = (id: string) => db.users.find((u) => u.id === id) ?? { id, name: '알 수 없음', email: '' }
    const me = db.users.find((u) => u.id === db.currentUserId) ?? null
    const myMember = db.members.find((m) => m.userId === db.currentUserId)
    const team = db.teams.find((t) => t.id === myMember?.teamId)
    const isAdmin = !!myMember?.isAdmin
    const isLeader = myMember?.role === 'leader'
    const tableMembers = db.members
      .filter((m) => m.teamId === myMember?.teamId && (m.role === 'leader' || m.role === 'member'))
      .sort((a, b) => (a.role === 'leader' ? -1 : b.role === 'leader' ? 1 : a.sort - b.sort))
    const unreadCount = db.notices.filter((n) => n.userId === db.currentUserId && !n.read).length
    const me_id = db.currentUserId!

    /** 서버 호출 후 새로고침. 실패하면 알림 */
    const run = async (fn: () => PromiseLike<{ error: any }>) => {
      try {
        const { error } = await fn()
        if (error) throw error
        await refresh()
      } catch (e) { fail(e); await refresh() }
    }

    return {
      mode: 'cloud', loading, db, me, myMember, team, isAdmin, isLeader, tableMembers, userOf, unreadCount,

      loginGoogle: () => {
        supabase.auth.signInWithOAuth({
          provider: 'google',
          options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
        })
      },
      login: () => {},
      logout: async () => { await supabase.auth.signOut(); uidRef.current = null; setDb(EMPTY) },

      createTeam: async (name) => { await run(() => supabase.rpc('create_team', { p_name: name })) },
      joinTeam: async (code) => {
        const { error } = await supabase.rpc('join_team', { p_code: code })
        if (error) return error.message
        await refresh()
        return null
      },

      renameTeam: (name) => run(() => supabase.from('teams').update({ name }).eq('id', team!.id)) as unknown as void,

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
        if (Object.keys(row).length) await run(() => supabase.from('members').update(row).eq('user_id', userId))
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
          const rs = await Promise.all(order.map((id, idx) => supabase.from('members').update({ sort: idx + 1 }).eq('user_id', id)))
          return { error: rs.find((x) => x.error)?.error ?? null }
        })
        void a; void b
      },

      removeMember: (userId) => run(() => supabase.from('members').delete().eq('user_id', userId)) as unknown as void,

      addEvent: (e) => run(() => supabase.from('events').insert({ ...evTo(e), owner_id: me_id })) as unknown as void,
      updateEvent: (id, patch) => run(() => supabase.from('events').update(evTo(patch)).eq('id', id)) as unknown as void,
      deleteEvent: (id) => run(() => supabase.from('events').delete().eq('id', id)) as unknown as void,

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

      addTodo: (text, date) => run(() => supabase.from('todos').insert({ owner_id: me_id, title: text, date })) as unknown as void,
      // 체크/중요 표시는 즉시 반영하고 서버에 저장
      toggleTodo: (id) => {
        const t = db.todos.find((x) => x.id === id); if (!t) return
        setDb((p) => ({ ...p, todos: p.todos.map((x) => (x.id === id ? { ...x, done: !x.done } : x)) }))
        run(() => supabase.from('todos').update({ done: !t.done }).eq('id', id))
      },
      togglePriority: (id) => {
        const t = db.todos.find((x) => x.id === id); if (!t) return
        setDb((p) => ({ ...p, todos: p.todos.map((x) => (x.id === id ? { ...x, priority: !x.priority } : x)) }))
        run(() => supabase.from('todos').update({ priority: !t.priority }).eq('id', id))
      },
      removeTodo: (id) => {
        setDb((p) => ({ ...p, todos: p.todos.filter((x) => x.id !== id) }))
        run(() => supabase.from('todos').delete().eq('id', id))
      },

      markAllRead: () => {
        setDb((p) => ({ ...p, notices: p.notices.map((n) => ({ ...n, read: true })) }))
        run(() => supabase.from('notices').update({ read: true }).eq('user_id', me_id).eq('read', false))
      },
    }
  }, [db, loading, refresh])

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}
