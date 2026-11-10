/**
 * 임시 데이터 계층 (localStorage).
 * 이 파일의 액션 시그니처를 그대로 두고 내부만 Supabase 호출로 교체하면 화면 코드는 바뀌지 않는다.
 * 권한 규칙(To-do 비공개, 공유 ON 일정만 노출 등)은 selectors 와 액션에서 흉내 내며,
 * 실제 서비스에서는 DB 의 RLS 가 강제한다.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { chatCounts, parseMentions } from './chat'
import type {
  Category,
  ChangeRequest,
  DB,
  EventItem,
  Member,
  Message,
  ChatRef,
  Notice,
  RequestPayload,
  Role,
  Team,
  Todo,
  User,
} from './types'
import { addDays, isWeekend, mondayOf, todayStr } from './date'

const KEY = 'weekendar-v1'
export const uid = () => Math.random().toString(36).slice(2, 10)

/** 평일이면 오늘, 주말이면 다음 주 월요일 */
export function initialDate(): string {
  const t = todayStr()
  return isWeekend(t) ? addDays(mondayOf(t), 7) : t
}

function seed(): DB {
  const sel = initialDate()
  const mon = mondayOf(sel)
  const d = (i: number) => addDays(mon, i)
  const teamId = 't_marketing'

  const users: User[] = [
    { id: 'u_leader', name: '박서준', email: 'seojun.park@example.com' },
    { id: 'u_admin', name: '김하늘', email: 'haneul.kim@example.com' },
    { id: 'u_m2', name: '이민재', email: 'minjae.lee@example.com' },
    { id: 'u_m3', name: '최유리', email: 'yuri.choi@example.com' },
    { id: 'u_m4', name: '정다은', email: 'daeun.jung@example.com' },
    { id: 'u_m5', name: '한지호', email: 'jiho.han@example.com' },
    { id: 'u_p1', name: '오지훈', email: 'jihoon.oh@example.com' },
    { id: 'u_new', name: '신규 사용자', email: 'new.user@example.com' },
  ]
  const teams: Team[] = [{ id: teamId, name: '마케팅팀', inviteCode: 'WKND-2026' }]
  const mk = (userId: string, role: Role, title: string, sort: number, isAdmin = false): Member => ({
    userId, teamId, role, isAdmin, title, sort,
  })
  const members: Member[] = [
    mk('u_leader', 'leader', '팀장', 0),
    mk('u_admin', 'member', '차장', 1, true),
    mk('u_m2', 'member', '과장', 2),
    mk('u_m3', 'member', '대리', 3),
    mk('u_m4', 'member', '사원', 4),
    mk('u_m5', 'member', '사원', 5),
    mk('u_p1', 'pending', '', 99),
  ]

  const ev = (
    ownerId: string, date: string, start: string, end: string, title: string,
    category: Category, shared = true, place = '', repeat: EventItem['repeat'] = 'none',
  ): EventItem => ({ id: uid(), ownerId, date, start, end, title, place, category, shared, repeat })

  const events: EventItem[] = [
    ev('u_leader', d(0), '09:30', '10:30', '팀 주간회의', 'meeting', true, '회의실 A', 'weekly'),
    ev('u_leader', d(1), '14:00', '15:30', '임원 보고', 'work', true, '대회의실'),
    ev('u_leader', d(2), '10:00', '15:00', '고객사 미팅', 'outside', true, '강남 고객사'),
    ev('u_leader', d(3), '15:00', '16:00', '팀원 1:1 면담', 'meeting', true, '소회의실 B'),
    ev('u_leader', d(4), '11:00', '12:00', '분기 목표 점검', 'meeting', true, '회의실 A'),

    ev('u_admin', d(0), '12:00', '13:00', '점심 약속', 'personal', false),
    ev('u_admin', d(1), '10:00', '11:30', '캠페인 기획 회의', 'meeting', true, '회의실 C'),
    ev('u_admin', d(1), '15:00', '16:00', '예산 검토', 'work', true),
    ev('u_admin', d(1), '19:00', '20:00', '치과 예약', 'personal', false),
    ev('u_admin', d(2), '09:00', '18:00', '연차 휴가', 'leave'),
    ev('u_admin', d(3), '13:30', '15:00', '광고 대행사 미팅', 'meeting', true, '회의실 A'),

    ev('u_m2', d(0), '11:00', '12:00', '콘텐츠 리뷰', 'meeting', true, '회의실 C'),
    ev('u_m2', d(1), '09:00', '18:00', '부산 출장', 'trip', true, '부산 지사'),
    ev('u_m2', d(2), '09:00', '18:00', '부산 출장', 'trip', true, '부산 지사'),
    ev('u_m2', d(3), '14:00', '16:00', '성과 보고서 작성', 'work'),

    ev('u_m3', d(0), '14:00', '15:00', 'SNS 운영 점검', 'work'),
    ev('u_m3', d(1), '10:30', '12:00', '인플루언서 미팅', 'outside', true, '성수동'),
    ev('u_m3', d(1), '13:00', '14:00', '촬영 준비', 'work'),
    ev('u_m3', d(1), '15:00', '16:00', '콘텐츠 캘린더 정리', 'work'),
    ev('u_m3', d(1), '16:30', '17:30', '주간 성과 공유', 'meeting', true, '회의실 B'),
    ev('u_m3', d(3), '14:00', '18:00', '오후 반차', 'halfday'),

    ev('u_m4', d(2), '09:00', '18:00', '직무 교육', 'training', true, '본사 교육장'),
    ev('u_m4', d(4), '10:00', '12:00', '데이터 정리', 'work'),

    ev('u_m5', d(0), '13:00', '17:00', '촬영 현장', 'outside', true, '파주 스튜디오'),
    ev('u_m5', d(3), '15:00', '16:00', '시안 리뷰', 'meeting', true, '회의실 C'),
    ev('u_m5', d(4), '09:00', '13:00', '오전 반차', 'halfday'),
  ]

  const requests: ChangeRequest[] = [
    {
      id: 'r_seed1', requesterId: 'u_m2', leaderId: 'u_leader', type: 'add',
      payload: { title: '신규 캠페인 킥오프', date: d(3), start: '16:30', end: '17:30', place: '소회의실 B' },
      status: 'pending', createdAt: Date.now() - 1000 * 60 * 25,
    },
  ]

  const todos: Todo[] = [
    { id: uid(), ownerId: 'u_admin', text: '예산안 초안 마무리', date: sel, done: false, priority: true },
    { id: uid(), ownerId: 'u_admin', text: '광고 대행사 견적 비교', date: sel, done: false, priority: false },
    { id: uid(), ownerId: 'u_admin', text: '주간 보고서 제출', date: sel, done: true, priority: false },
    { id: uid(), ownerId: 'u_admin', text: '캠페인 일정표 공유', date: sel, done: false, priority: false },
    { id: uid(), ownerId: 'u_admin', text: 'KPI 대시보드 점검', date: addDays(sel, -1), done: false, priority: false },
    { id: uid(), ownerId: 'u_leader', text: '임원 보고 자료 검토', date: sel, done: false, priority: true },
  ]

  const notices: Notice[] = [
    {
      id: uid(), userId: 'u_leader', kind: 'request', refId: 'r_seed1', read: false,
      text: '이민재님이 일정 추가를 요청했습니다.', createdAt: Date.now() - 1000 * 60 * 25,
    },
    {
      id: uid(), userId: 'u_admin', kind: 'join', read: false,
      text: '오지훈님이 팀 참여를 요청했습니다.', createdAt: Date.now() - 1000 * 60 * 60,
    },
  ]

  // 팀 대화 예시 (지난 대화 + 안 읽은 대화 3개, 그중 1개는 최유리 호출)
  const ago = (min: number) => Date.now() - min * 60000
  const msg = (authorId: string, body: string, min: number, extra: Partial<Message> = {}): Message => ({
    id: uid(), teamId, authorId, body, mentions: [], mentionAll: false, createdAt: ago(min), ...extra,
  })
  const messages: Message[] = [
    msg('u_admin', '이번 주 캠페인 일정표 공유드렸어요. 확인 부탁드려요!', 180),
    msg('u_m4', '확인했습니다 🙂', 175),
    msg('u_leader', '목요일 고객사 미팅 시간 조금 당겨도 될까요?', 25),
    msg('u_admin', '저는 오전 다 괜찮아요', 22),
    msg('u_leader', '@최유리 인플루언서 미팅 끝나고 결과 공유 부탁해요', 18, { mentions: ['u_m3'] }),
  ]
  const chatReads: Record<string, number> = Object.fromEntries(users.map((u) => [u.id, ago(60)]))

  return { users, teams, members, events, requests, todos, notices, messages, chatReads, messageReads: {}, currentUserId: null }
}

function load(): DB {
  try {
    if (new URLSearchParams(location.search).has('reset')) localStorage.removeItem(KEY)
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const db = JSON.parse(raw) as DB
      // 예전에 저장된 체험 데이터에는 대화가 없을 수 있다
      return { ...db, messages: db.messages ?? [], chatReads: db.chatReads ?? {}, messageReads: db.messageReads ?? {} }
    }
  } catch {
    /* 저장소를 못 읽으면 새로 시작 */
  }
  return seed()
}

export interface Store {
  /** demo = 브라우저 저장 체험 모드, cloud = Supabase */
  mode: 'demo' | 'cloud'
  loading: boolean
  loginGoogle: () => void
  db: DB
  me: User | null
  myMember: Member | undefined
  team: Team | undefined
  isAdmin: boolean
  isLeader: boolean
  /** 표에 표시되는 구성원 (팀장 먼저, 이후 sort 순) */
  tableMembers: Member[]
  userOf: (id: string) => User
  unreadCount: number
  // 인증/온보딩
  login: (userId: string) => void
  logout: () => void
  createTeam: (name: string) => void | Promise<void>
  joinTeam: (code: string) => string | null | Promise<string | null>
  // 팀 관리 (관리자)
  renameTeam: (name: string) => void
  updateMember: (userId: string, patch: Partial<Member>) => void
  moveMember: (userId: string, dir: -1 | 1) => void
  removeMember: (userId: string) => void
  // 일정
  addEvent: (e: Omit<EventItem, 'id' | 'ownerId'>) => void
  updateEvent: (id: string, patch: Partial<EventItem>) => void
  deleteEvent: (id: string) => void
  // 팀장 일정 변경 요청
  createRequest: (r: Pick<ChangeRequest, 'type' | 'eventId'> & { payload: RequestPayload }) => void
  decideRequest: (id: string, accept: boolean, reason?: string) => void
  // To-do
  addTodo: (text: string, date: string) => void
  toggleTodo: (id: string) => void
  togglePriority: (id: string) => void
  removeTodo: (id: string) => void
  // 알림
  markAllRead: () => void
  // 팀 대화
  /** 내 팀의 대화 (오래된 것부터) */
  messages: Message[]
  chatUnread: number
  chatMentions: number
  sendMessage: (body: string, ref?: ChatRef) => void
  deleteMessage: (id: string) => void
  markChatRead: () => void
  /** 내가 보낸 메시지의 읽음 기록 (사람 id → 읽은 시각). 남의 메시지는 빈 값 */
  getReadReceipts: (messageId: string) => Promise<Record<string, number>>
}

export const Ctx = createContext<Store | null>(null)
export const useStore = () => {
  const s = useContext(Ctx)
  if (!s) throw new Error('StoreProvider 필요')
  return s
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB>(load)
  const fromOtherTab = useRef(false)

  useEffect(() => {
    // 다른 탭에서 받은 변경은 다시 저장하지 않는다 (탭끼리 주고받기 반복 방지)
    if (fromOtherTab.current) {
      fromOtherTab.current = false
      return
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(db))
    } catch {
      /* 용량 초과 등은 무시 */
    }
  }, [db])

  // 체험 모드에서도 같은 브라우저의 다른 탭과 바로 동기화 (대화 실시간 흉내)
  useEffect(() => {
    const h = (e: StorageEvent) => {
      if (e.key !== KEY || !e.newValue) return
      try {
        const next = JSON.parse(e.newValue) as DB
        fromOtherTab.current = true
        setDb((p) => ({ ...next, messages: next.messages ?? [], chatReads: next.chatReads ?? {}, messageReads: next.messageReads ?? {}, currentUserId: p.currentUserId }))
      } catch {
        /* 무시 */
      }
    }
    window.addEventListener('storage', h)
    return () => window.removeEventListener('storage', h)
  }, [])

  const store = useMemo<Store>(() => {
    const userOf = (id: string) =>
      db.users.find((u) => u.id === id) ?? { id, name: '알 수 없음', email: '' }
    const me = db.users.find((u) => u.id === db.currentUserId) ?? null
    const myMember = db.members.find((m) => m.userId === db.currentUserId)
    const team = db.teams.find((t) => t.id === myMember?.teamId)
    const isAdmin = !!myMember?.isAdmin
    const isLeader = myMember?.role === 'leader'

    const tableMembers = db.members
      .filter((m) => m.teamId === myMember?.teamId && (m.role === 'leader' || m.role === 'member'))
      .sort((a, b) => (a.role === 'leader' ? -1 : b.role === 'leader' ? 1 : a.sort - b.sort))

    const unreadCount =
      db.notices.filter((n) => n.userId === db.currentUserId && !n.read).length

    const messages = db.messages
      .filter((m) => m.teamId === myMember?.teamId && myMember?.role !== 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)
    const { unread: chatUnread, mentions: chatMentions } = chatCounts(
      messages, db.currentUserId, db.chatReads[db.currentUserId ?? ''] ?? 0,
    )

    const set = (fn: (prev: DB) => DB) => setDb(fn)
    const notify = (prev: DB, userId: string, n: Omit<Notice, 'id' | 'userId' | 'read' | 'createdAt'>): Notice[] => [
      { id: uid(), userId, read: false, createdAt: Date.now(), ...n },
      ...prev.notices,
    ]

    return {
      mode: 'demo', loading: false, loginGoogle: () => {},
      messages, chatUnread, chatMentions,
      db, me, myMember, team, isAdmin, isLeader, tableMembers, userOf, unreadCount,

      login: (userId) => set((p) => ({ ...p, currentUserId: userId })),
      logout: () => set((p) => ({ ...p, currentUserId: null })),

      createTeam: (name) =>
        set((p) => {
          if (!p.currentUserId || p.members.some((m) => m.userId === p.currentUserId)) return p
          const teamId = 't_' + uid()
          const code = 'WKND-' + Math.random().toString(36).slice(2, 6).toUpperCase()
          return {
            ...p,
            teams: [...p.teams, { id: teamId, name, inviteCode: code }],
            members: [
              ...p.members,
              { userId: p.currentUserId, teamId, role: 'member', isAdmin: true, title: '', sort: 1 },
            ],
          }
        }),

      joinTeam: (code) => {
        const t = db.teams.find((x) => x.inviteCode.toLowerCase() === code.trim().toLowerCase())
        if (!t) return '초대 코드를 찾을 수 없어요. 코드를 다시 확인해주세요.'
        if (!db.currentUserId) return '로그인이 필요해요.'
        if (db.members.some((m) => m.userId === db.currentUserId))
          return '이미 팀에 소속되어 있어요.'
        const admins = db.members.filter((m) => m.teamId === t.id && m.isAdmin)
        set((p) => ({
          ...p,
          members: [
            ...p.members,
            { userId: p.currentUserId!, teamId: t.id, role: 'pending', isAdmin: false, title: '', sort: 99 },
          ],
          notices: admins.reduce(
            (acc, a) => [
              { id: uid(), userId: a.userId, kind: 'join', read: false, createdAt: Date.now(),
                text: `${userOf(p.currentUserId!).name}님이 팀 참여를 요청했습니다.` } as Notice,
              ...acc,
            ],
            p.notices,
          ),
        }))
        return null
      },

      renameTeam: (name) =>
        set((p) => ({ ...p, teams: p.teams.map((t) => (t.id === team?.id ? { ...t, name } : t)) })),

      updateMember: (userId, patch) =>
        set((p) => {
          let members = p.members.map((m) => (m.userId === userId ? { ...m, ...patch } : m))
          // 팀장은 팀당 1명: 새로 팀장이 되면 기존 팀장은 팀원으로
          if (patch.role === 'leader') {
            members = members.map((m) =>
              m.userId !== userId && m.teamId === team?.id && m.role === 'leader'
                ? { ...m, role: 'member' as Role }
                : m,
            )
          }
          // 승인된 사람은 맨 아래 순서로 배치
          if (patch.role === 'member') {
            const max = Math.max(0, ...members.filter((m) => m.teamId === team?.id && m.role === 'member' && m.userId !== userId).map((m) => m.sort))
            members = members.map((m) => (m.userId === userId && m.sort === 99 ? { ...m, sort: max + 1 } : m))
          }
          return { ...p, members }
        }),

      moveMember: (userId, dir) =>
        set((p) => {
          const list = p.members
            .filter((m) => m.teamId === team?.id && m.role !== 'leader' && m.role !== 'pending' && m.role !== 'none')
            .sort((a, b) => a.sort - b.sort)
          const i = list.findIndex((m) => m.userId === userId)
          const j = i + dir
          if (i < 0 || j < 0 || j >= list.length) return p
          const a = list[i], b = list[j]
          return {
            ...p,
            members: p.members.map((m) =>
              m.userId === a.userId ? { ...m, sort: b.sort } : m.userId === b.userId ? { ...m, sort: a.sort } : m,
            ),
          }
        }),

      removeMember: (userId) =>
        set((p) => ({
          ...p,
          members: p.members.filter((m) => m.userId !== userId),
          events: p.events.filter((e) => e.ownerId !== userId),
          todos: p.todos.filter((t) => t.ownerId !== userId),
          requests: p.requests.filter((r) => r.requesterId !== userId && r.leaderId !== userId),
        })),

      addEvent: (e) =>
        set((p) => ({ ...p, events: [...p.events, { ...e, id: uid(), ownerId: p.currentUserId! }] })),
      updateEvent: (id, patch) =>
        set((p) => ({ ...p, events: p.events.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
      deleteEvent: (id) => set((p) => ({ ...p, events: p.events.filter((e) => e.id !== id) })),

      createRequest: (r) =>
        set((p) => {
          const leader = p.members.find((m) => m.teamId === myMember?.teamId && m.role === 'leader')
          if (!leader || !p.currentUserId) return p
          const id = 'r_' + uid()
          const verb = r.type === 'add' ? '추가' : r.type === 'edit' ? '수정' : '삭제'
          return {
            ...p,
            requests: [
              ...p.requests,
              { id, requesterId: p.currentUserId, leaderId: leader.userId, status: 'pending', createdAt: Date.now(), ...r },
            ],
            notices: notify(p, leader.userId, {
              kind: 'request', refId: id,
              text: `${userOf(p.currentUserId).name}님이 일정 ${verb}을(를) 요청했습니다.`,
            }),
          }
        }),

      decideRequest: (id, accept, reason) =>
        set((p) => {
          const r = p.requests.find((x) => x.id === id)
          if (!r || r.status !== 'pending') return p
          let events = p.events
          if (accept) {
            if (r.type === 'add') {
              events = [...events, {
                id: uid(), ownerId: r.leaderId, category: 'meeting', shared: true, repeat: 'none', ...r.payload,
              }]
            } else if (r.type === 'edit' && r.eventId) {
              events = events.map((e) => (e.id === r.eventId ? { ...e, ...r.payload, date: e.repeat === 'none' ? r.payload.date : e.date } : e))
            } else if (r.type === 'delete' && r.eventId) {
              events = events.filter((e) => e.id !== r.eventId)
            }
          }
          const verb = r.type === 'add' ? '추가' : r.type === 'edit' ? '수정' : '삭제'
          return {
            ...p,
            events,
            requests: p.requests.map((x) =>
              x.id === id ? { ...x, status: accept ? 'accepted' : 'rejected', reason } : x,
            ),
            notices: [
              ...notify(p, r.requesterId, {
                kind: 'result', refId: id,
                text: accept
                  ? `팀장이 일정 ${verb} 요청에 동의했습니다. (${r.payload.title})`
                  : `팀장이 일정 ${verb} 요청을 거절했습니다. (${r.payload.title})${reason ? ' 사유: ' + reason : ''}`,
              }),
              ...p.notices.map((n) => (n.refId === id && n.userId === r.leaderId ? { ...n, read: true } : n)),
            ].slice(0, 200),
          }
        }),

      addTodo: (text, date) =>
        set((p) => ({
          ...p,
          todos: [...p.todos, { id: uid(), ownerId: p.currentUserId!, text, date, done: false, priority: false }],
        })),
      toggleTodo: (id) =>
        set((p) => ({ ...p, todos: p.todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)) })),
      togglePriority: (id) =>
        set((p) => ({ ...p, todos: p.todos.map((t) => (t.id === id ? { ...t, priority: !t.priority } : t)) })),
      removeTodo: (id) => set((p) => ({ ...p, todos: p.todos.filter((t) => t.id !== id) })),

      markAllRead: () =>
        set((p) => ({
          ...p,
          notices: p.notices.map((n) => (n.userId === p.currentUserId ? { ...n, read: true } : n)),
        })),

      sendMessage: (body, ref) => {
        const text = body.trim()
        if ((!text && !ref) || !myMember || !db.currentUserId) return
        const people = tableMembers.map((m) => ({ id: m.userId, name: userOf(m.userId).name }))
        const { mentions, mentionAll } = parseMentions(text, people)
        const m: Message = {
          id: uid(), teamId: myMember.teamId, authorId: db.currentUserId, body: text,
          mentions: mentions.filter((id) => id !== db.currentUserId), mentionAll, ref, createdAt: Date.now(),
        }
        set((p) => ({ ...p, messages: [...p.messages, m], chatReads: { ...p.chatReads, [m.authorId]: m.createdAt } }))
      },
      deleteMessage: (id) =>
        set((p) => ({
          ...p,
          messages: p.messages.map((m) =>
            m.id === id && m.authorId === p.currentUserId
              ? { ...m, body: '', ref: undefined, mentions: [], mentionAll: false, deleted: true }
              : m,
          ),
        })),
      markChatRead: () => {
        const me = db.currentUserId
        if (!me) return
        const last = messages.length ? messages[messages.length - 1].createdAt : 0
        const lastRead = db.chatReads[me] ?? 0
        if (lastRead >= last) return
        const now = Date.now()
        const fresh = messages.filter((m) => m.authorId !== me && !m.deleted && m.createdAt > lastRead)
        set((p) => {
          const reads = { ...p.messageReads }
          fresh.forEach((m) => {
            if (!reads[m.id]?.[me]) reads[m.id] = { ...reads[m.id], [me]: now }
          })
          return { ...p, messageReads: reads, chatReads: { ...p.chatReads, [me]: Math.max(last, now) } }
        })
      },
      getReadReceipts: async (messageId) => {
        const m = db.messages.find((x) => x.id === messageId)
        if (!m || m.authorId !== db.currentUserId) return {}
        return { ...(db.messageReads[messageId] ?? {}) }
      },
    }
  }, [db])

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}
