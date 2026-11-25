/**
 * 임시 데이터 계층 (localStorage).
 * 이 파일의 액션 시그니처를 그대로 두고 내부만 Supabase 호출로 교체하면 화면 코드는 바뀌지 않는다.
 * 권한 규칙(To-do 비공개, 공유 ON 일정만 노출 등)은 selectors 와 액션에서 흉내 내며,
 * 실제 서비스에서는 DB 의 RLS 가 강제한다.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { chatCounts, chatScope, dmPeer, dmThreads, inviteNotice, leaveNotice, parseMentions, roomThreads, type RoomThread } from './chat'
import type {
  Category,
  ChangeRequest,
  DB,
  EventItem,
  Member,
  Message,
  ChatRef,
  ChatPin,
  ScheduledMessage,
  Notice,
  RequestPayload,
  Role,
  Team,
  Todo,
  User,
} from './types'
import { addDays, isWeekend, mondayOf, toStr, todayStr } from './date'
import { t as tr } from './i18n'
import { TERMS_VERSION } from './legal'
import { changeOf } from './confirm'

const KEY = 'weekendar-v1'
export const uid = () => Math.random().toString(36).slice(2, 10)

/** 평일이면 오늘, 주말이면 다음 주 월요일 */
export function initialDate(): string {
  const t = todayStr()
  return isWeekend(t) ? addDays(mondayOf(t), 7) : t
}

/**
 * 팀장이 팀에 공유한 일정을 고쳤으면: "변경" 표시를 남기고, 이전 확인을 지우고, 팀원에게 알림을 보낸다.
 * (실서비스에서는 DB 의 migration_023 트리거가 같은 일을 한다)
 */
function flagLeaderChanges(p: DB, before: EventItem[], after: EventItem[]): DB {
  const today = todayStr()
  let confirms = p.confirms ?? []
  let notices = p.notices
  const events = after.map((e) => {
    const old = before.find((x) => x.id === e.id)
    const owner = p.members.find((m) => m.userId === e.ownerId)
    if (!old || old === e || owner?.role !== 'leader') return e
    const ch = changeOf(old, e)
    if (!ch) return e
    // 이미 지난 일정(반복 아님)을 고치는 것은 알리지 않는다
    if (e.repeat === 'none' && (e.endDate ?? e.date) < today && (old.endDate ?? old.date) < today) return e
    const name = p.users.find((u) => u.id === e.ownerId)?.name ?? ''
    confirms = confirms.filter((c) => c.eventId !== e.id)
    notices = [
      ...p.members
        .filter((m) => m.teamId === owner.teamId && m.role === 'member')
        .map((m): Notice => ({ id: uid(), userId: m.userId, kind: 'confirm', text: ch.noticeText(name), eventId: e.id, read: false, createdAt: Date.now() })),
      ...notices.map((n) => (n.kind === 'confirm' && n.eventId === e.id ? { ...n, read: true } : n)),
    ].slice(0, 200)
    return { ...e, changedAt: Date.now(), changeText: ch.changeText }
  })
  return { ...p, events, confirms, notices }
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
    // 1:1 대화 예시 (박서준 ↔ 김하늘)
    msg('u_admin', '팀장님, 다음 주 예산 검토 자료 미리 드릴까요?', 95, { toId: 'u_leader' }),
    msg('u_leader', '네 좋아요. 목요일 전까지만 주세요 👍', 12, { toId: 'u_admin' }),
  ]
  const chatReads: Record<string, number> = Object.fromEntries(users.map((u) => [u.id, ago(60)]))
  // 답장·이모지 반응 예시
  messages[3].replyTo = messages[2].id
  const reactions: Record<string, Record<string, string>> = {
    [messages[0].id]: { u_m4: '👍', u_leader: '👍' },
    [messages[3].id]: { u_leader: '🙏' },
  }

  // 그룹 대화방 예시: 김하늘 · 박서준 · 최유리 · 정다은
  const roomId = uid()
  const joined = ago(120)
  const rooms = [{
    id: roomId, teamId,
    members: ['u_admin', 'u_leader', 'u_m3', 'u_m4'].map((userId) => ({ userId, joinedAt: joined, lastReadAt: userId === 'u_admin' ? ago(30) : ago(5) })),
  }]
  messages.push(
    { ...msg('u_admin', inviteNotice('김하늘', ['박서준', '최유리', '정다은']), 120), roomId, system: true },
    msg('u_leader', '목요일 고객사 발표 자료는 이 방에서 정리해요', 40, { roomId }),
    msg('u_m4', '네, 초안 오늘 오후에 올릴게요', 8, { roomId }),
  )

  return { users, teams, members, events, requests, todos, notices, messages, chatReads, messageReads: {}, reactions, rooms, currentUserId: null }
}

function load(): DB {
  try {
    if (new URLSearchParams(location.search).has('reset')) localStorage.removeItem(KEY)
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const db = JSON.parse(raw) as DB
      // 예전에 저장된 체험 데이터에는 대화가 없을 수 있다
      return { ...db, messages: db.messages ?? [], chatReads: db.chatReads ?? {}, messageReads: db.messageReads ?? {}, dmReads: db.dmReads ?? {} }
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
  /** 처음 사용 안내를 봤다고 기록 */
  finishTutorial: () => void
  /** 설정: 못 끝낸 할 일을 다음 날로 넘기기 (계정에 저장) */
  setTodoCarry: (on: boolean) => void
  /** 설정: 내 단축키 저장 (바꾼 것만, 빈 값이면 모두 기본값) */
  setShortcuts: (map: Record<string, string>) => void
  /** 약관 동의 기록 (실서비스: 처음 로그인한 뒤 한 번) */
  agreeTerms: () => void | Promise<void>
  /** Weekendar 탈퇴: 팀에 속하지 않은 내 계정과 데이터를 지운다. 실패하면 안내 문구 */
  deleteAccount: () => string | null | Promise<string | null>
  createTeam: (name: string) => void | Promise<void>
  joinTeam: (code: string) => string | null | Promise<string | null>
  // 팀 관리 (관리자)
  renameTeam: (name: string) => void
  updateMember: (userId: string, patch: Partial<Member>) => void
  moveMember: (userId: string, dir: -1 | 1) => void
  removeMember: (userId: string) => void
  /** 내가 팀에서 나가기 (내 일정·할 일·대기 요청 삭제, 혼자 남은 관리자면 팀도 삭제)
   *  관리자는 newAdmin(관리자를 넘겨받을 사람)을 지정해야 나갈 수 있음 */
  leaveTeam: (newAdmin?: string) => void
  /** 관리자 넘기기: 지정한 구성원이 관리자가 되고 나는 일반 구성원이 됨 */
  transferAdmin: (userId: string) => void
  // 일정
  addEvent: (e: Omit<EventItem, 'id' | 'ownerId'>) => void
  updateEvent: (id: string, patch: Partial<EventItem>) => void
  deleteEvent: (id: string) => void
  /** 팀장이 바꾼 일정을 "확인했어요" (팀원) */
  confirmEvent: (id: string) => void
  // 팀장 일정 변경 요청
  createRequest: (r: Pick<ChangeRequest, 'type' | 'eventId'> & { payload: RequestPayload }) => void
  decideRequest: (id: string, accept: boolean, reason?: string) => void
  // To-do
  /** priority: 중요 표시로 바로 추가 (빠른 입력에서 "중요") */
  addTodo: (text: string, date: string, priority?: boolean) => void
  toggleTodo: (id: string) => void
  togglePriority: (id: string) => void
  removeTodo: (id: string) => void
  /** 할 일을 다른 날로 옮기기 */
  moveTodo: (id: string, date: string) => void
  /** 지운 할 일 되살리기 (되돌리기) */
  /** 지운 할 일 되돌리기 (하위 할 일이 있었으면 함께) */
  restoreTodo: (t: Omit<Todo, 'id' | 'ownerId'>, children?: Omit<Todo, 'id' | 'ownerId'>[]) => void
  /** 할 일 순서·상위 바꾸기 (끌어 놓기). parentId 가 null 이면 맨 위 단계로 */
  arrangeTodos: (updates: { id: string; parentId: string | null; position: number }[]) => void
  // 이번 주 목표 (할 일과 따로, 한 주에 하나, 나만 보임)
  /** week(그 주의 월요일)의 목표를 정한다. 이미 있으면 글만 바꾸고, 빈 글이면 지운다 */
  setGoal: (week: string, text: string) => void
  toggleGoal: (id: string) => void
  /** 그날 메모 불러오기 (마크다운 글, 없으면 빈 글) */
  loadMemo: (date: string) => Promise<string>
  /** 그날 메모 저장 (빈 글이면 지움). 실패하면 false */
  saveMemo: (date: string, body: string) => Promise<boolean>
  /** 내 메모 전체에서 글자 찾기 (최근 날짜부터 최대 50개) */
  findMemos: (q: string) => Promise<{ date: string; body: string }[]>
  /** 내가 볼 수 있는 대화(팀·1:1·대화방)에서 글자 찾기 (최근 것부터 최대 50개, 지운 것·안내 글 제외) */
  findMessages: (q: string) => Promise<Message[]>
  /** 검색 결과로 이동할 때: 오래돼서 아직 안 불러온 메시지면 그 뒤 대화까지 불러온다 */
  revealMessage: (m: Message) => Promise<void>
  /** 대화 달력: 그 대화(scope)의 from~to 기간 날짜별 메시지 수 { 'YYYY-MM-DD': n } */
  chatDays: (scope: string, from: string, to: string) => Promise<Record<string, number>>
  /** 대화 달력: 그날 첫 메시지를 불러오고 그 id 를 돌려준다 (없으면 null) */
  revealDay: (scope: string, day: string) => Promise<string | null>
  /** "이번 주 시작" 카드를 그 주에 보여줬다고 기록 */
  finishWeekCard: (week: string) => void
  // 알림
  markAllRead: () => void
  // 팀 대화
  /** 내 팀의 대화 (오래된 것부터) */
  messages: Message[]
  chatUnread: number
  chatMentions: number
  /** toId 가 있으면 그 사람에게만 보이는 1:1 메시지 */
  sendMessage: (body: string, ref?: ChatRef, toId?: string, opts?: SendOpts) => void
  deleteMessage: (id: string) => void
  markChatRead: () => void
  // 1:1 대화
  /** 상대별 1:1 대화 (최근 대화 먼저) */
  dmThreads: { peerId: string; last: Message; unread: number }[]
  /** 1:1 대화 안 읽은 수 합계 */
  dmUnread: number
  /** 이 사람과의 1:1 대화 (오래된 것부터) */
  dmMessages: (peerId: string) => Message[]
  markDmRead: (peerId: string) => void
  // 그룹 대화방
  /** 내가 들어가 있는 대화방 (최근 대화 먼저) */
  rooms: RoomThread[]
  /** 이 방의 대화 (내가 들어온 뒤의 것만, 오래된 것부터) */
  roomMessages: (roomId: string) => Message[]
  /** 나 + 고른 사람(2명 이상)으로 새 방을 만들고 방 id 를 돌려준다 */
  createRoom: (memberIds: string[]) => Promise<string | null>
  /** 방에 사람 더하기 (들어온 사람은 그 뒤의 대화만 봄) */
  inviteToRoom: (roomId: string, memberIds: string[]) => void
  /** 방 나가기 ("○○님이 나갔어요"가 남음) */
  leaveRoom: (roomId: string) => void
  markRoomRead: (roomId: string) => void
  /** 내가 보낸 메시지의 읽음 기록 (사람 id → 읽은 시각). 남의 메시지는 빈 값 */
  getReadReceipts: (messageId: string) => Promise<Record<string, number>>
  /** 메시지 id → (사람 id → 이모지) */
  reactions: Record<string, Record<string, string>>
  /** 내 반응 달기 (emoji 가 null 이면 취소). 한 메시지에 1개만 */
  react: (messageId: string, emoji: string | null) => void
  // 대화 공지 (대화방마다 1개, 그 대화를 볼 수 있는 사람 누구나 올리고 내림)
  /** 대화방 구분(chatScope) → 공지 */
  pins: Record<string, ChatPin>
  /** 이 메시지를 그 대화방의 공지로 (있던 공지는 바뀜) */
  pinMessage: (m: Message) => void
  unpin: (scope: string) => void
  // 예약 보내기
  /** 내가 예약해 둔 메시지 (보낼 시각 순) */
  scheduled: ScheduledMessage[]
  /** sendAt(ms)에 보내도록 예약. 실패하면 false */
  scheduleMessage: (body: string, sendAt: number, toId?: string, opts?: { replyTo?: string; roomId?: string }) => Promise<boolean>
  reschedule: (id: string, sendAt: number) => void
  /** 예약한 메시지 내용 고치기 */
  editScheduled: (id: string, body: string) => void
  cancelScheduled: (id: string) => void
  /** 예약을 지우고 바로 보내기 */
  sendScheduledNow: (id: string) => void
  // 캘린더 구독 주소 (서버 모드만, 체험 모드는 null)
  getCalendarUrl: (reset?: boolean) => Promise<string | null>
}

/** 보낼 때 덧붙이는 정보: 답장 대상, 전달 여부 */
export interface SendOpts { replyTo?: string; forwarded?: boolean; roomId?: string; sticker?: string }

export const Ctx = createContext<Store | null>(null)
export const useStore = () => {
  const s = useContext(Ctx)
  if (!s) throw new Error('StoreProvider 필요')
  return s
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<DB>(load)
  const fromOtherTab = useRef(false)

  // 체험 모드 예약 보내기: 시각이 된 예약을 실제 메시지로 (실서비스에서는 서버가 1분마다 한다)
  const hasScheduled = (db.scheduled ?? []).length > 0
  useEffect(() => {
    if (!hasScheduled) return
    const tick = () => setDb((p) => {
      const now = Date.now()
      const due = (p.scheduled ?? []).filter((x) => x.sendAt <= now)
      const author = p.currentUserId
      const teamId = p.members.find((m) => m.userId === author)?.teamId
      if (!due.length || !author || !teamId) return p
      const sent: Message[] = due.map((x) => ({
        id: uid(), teamId, authorId: author, body: x.body, mentions: x.mentions, mentionAll: x.mentionAll, createdAt: now,
        ...(x.toId ? { toId: x.toId } : {}), ...(x.roomId ? { roomId: x.roomId } : {}), ...(x.replyTo ? { replyTo: x.replyTo } : {}),
      }))
      return { ...p, messages: [...p.messages, ...sent], scheduled: (p.scheduled ?? []).filter((x) => x.sendAt > now) }
    })
    tick()
    const id = window.setInterval(tick, 5000)
    return () => window.clearInterval(id)
  }, [hasScheduled, db.scheduled])

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
      db.users.find((u) => u.id === id) ?? { id, name: tr('알 수 없음'), email: '' }
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

    const inTeam = db.messages
      .filter((m) => m.teamId === myMember?.teamId && myMember?.role !== 'pending')
      .sort((a, b) => a.createdAt - b.createdAt)
    const messages = inTeam.filter((m) => !m.toId && !m.roomId)
    // 1:1 대화: 내가 보냈거나 나에게 온 것만
    const meId = db.currentUserId
    const dms = inTeam.filter((m) => m.toId && (m.authorId === meId || m.toId === meId))
    const threads = dmThreads(dms, meId, db.dmReads ?? {})
    // 그룹 대화방: 내가 들어간 방, 들어온 뒤의 대화만
    const rooms = roomThreads(db.rooms ?? [], inTeam, meId, myMember?.teamId)
    const roomMessages = (roomId: string) => {
      const r = rooms.find((x) => x.id === roomId)
      return r ? inTeam.filter((m) => m.roomId === roomId && m.createdAt >= r.joinedAt) : []
    }
    // 개인 대화 탭의 안 읽은 수 = 1:1 + 그룹
    const dmUnread = threads.reduce((a, x) => a + x.unread, 0) + rooms.reduce((a, x) => a + x.unread, 0)
    const dmMessages = (peerId: string) => dms.filter((m) => dmPeer(m, meId) === peerId)
    const { unread: chatUnread, mentions: chatMentions } = chatCounts(
      messages, db.currentUserId, db.chatReads[db.currentUserId ?? ''] ?? 0,
    )
    // 대화 공지: 지운 메시지의 공지는 보이지 않게
    const pins: Record<string, ChatPin> = Object.fromEntries(
      (db.pins ?? []).filter((x) => !db.messages.find((m) => m.id === x.messageId)?.deleted).map((x) => [x.scope, x]),
    )
    const scheduled = [...(db.scheduled ?? [])].sort((a, b) => a.sendAt - b.sendAt)

    const set = (fn: (prev: DB) => DB) => setDb(fn)
    const notify = (prev: DB, userId: string, n: Omit<Notice, 'id' | 'userId' | 'read' | 'createdAt'>): Notice[] => [
      { id: uid(), userId, read: false, createdAt: Date.now(), ...n },
      ...prev.notices,
    ]

    return {
      mode: 'demo', loading: false, loginGoogle: () => {},
      messages, chatUnread, chatMentions, dmThreads: threads, dmUnread, dmMessages, rooms, roomMessages,
      db, me, myMember, team, isAdmin, isLeader, tableMembers, userOf, unreadCount,

      login: (userId) => set((p) => ({ ...p, currentUserId: userId })),
      logout: () => set((p) => ({ ...p, currentUserId: null })),
      finishTutorial: () =>
        set((p) => ({ ...p, users: p.users.map((u) => (u.id === p.currentUserId ? { ...u, tutorialSeen: true } : u)) })),
      setShortcuts: (map) =>
        set((p) => ({ ...p, users: p.users.map((u) => (u.id === p.currentUserId ? { ...u, shortcuts: map } : u)) })),
      setTodoCarry: (on) =>
        set((p) => ({ ...p, users: p.users.map((u) => (u.id === p.currentUserId ? { ...u, todoCarry: on } : u)) })),
      agreeTerms: () =>
        set((p) => ({ ...p, users: p.users.map((u) => (u.id === p.currentUserId ? { ...u, termsVersion: TERMS_VERSION } : u)) })),
      // 탈퇴(체험): 팀에 속해 있으면 막고, 아니면 내 기록을 지우고 로그아웃
      deleteAccount: () => {
        const id = db.currentUserId
        if (!id) return null
        if (db.members.some((m) => m.userId === id)) return tr('팀에서 먼저 나간 뒤 탈퇴할 수 있어요')
        set((p) => ({
          ...p,
          users: p.users.filter((u) => u.id !== id),
          events: p.events.filter((e) => e.ownerId !== id),
          todos: p.todos.filter((x) => x.ownerId !== id),
          goals: (p.goals ?? []).filter((g) => g.ownerId !== id),
          notices: p.notices.filter((n) => n.userId !== id),
          messages: p.messages.filter((m) => m.authorId !== id),
          requests: p.requests.filter((r) => r.requesterId !== id && r.leaderId !== id),
          currentUserId: null,
        }))
        return null
      },

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
        if (!t) return tr('초대 코드를 찾을 수 없어요. 코드를 다시 확인해주세요.')
        if (!db.currentUserId) return tr('로그인이 필요해요.')
        if (db.members.some((m) => m.userId === db.currentUserId))
          return tr('이미 팀에 소속되어 있어요.')
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

      transferAdmin: (userId) =>
        set((p) => {
          const me = p.currentUserId
          const mm = p.members.find((m) => m.userId === me)
          const target = p.members.find((m) => m.userId === userId)
          if (!me || !mm?.isAdmin || !target || target.teamId !== mm.teamId || target.role === 'pending') return p
          return {
            ...p,
            members: p.members.map((m) =>
              m.userId === userId ? { ...m, isAdmin: true }
              : m.userId === me ? { ...m, isAdmin: false, role: m.role === 'none' ? 'member' : m.role }
              : m),
            notices: notify(p, userId, { kind: 'result', text: '관리자 권한을 넘겨받았어요. 이제 팀 관리 메뉴를 쓸 수 있어요.' }),
          }
        }),

      leaveTeam: (newAdmin) =>
        set((prev) => {
          let p = prev
          const me = p.currentUserId
          const mm0 = p.members.find((m) => m.userId === me)
          // 관리자가 나가면서 관리자를 넘기는 경우: 먼저 넘기고 나감
          if (mm0?.isAdmin && newAdmin) {
            const target = p.members.find((m) => m.userId === newAdmin && m.teamId === mm0.teamId && m.role !== 'pending')
            if (!target) return prev
            p = {
              ...p,
              members: p.members.map((m) => (m.userId === newAdmin ? { ...m, isAdmin: true } : m.userId === me ? { ...m, isAdmin: false } : m)),
              notices: notify(p, newAdmin, { kind: 'result', text: '관리자 권한을 넘겨받았어요. 이제 팀 관리 메뉴를 쓸 수 있어요.' }),
            }
          }
          const mm = p.members.find((m) => m.userId === me)
          if (!me || !mm) return prev
          const others = p.members.filter((m) => m.teamId === mm.teamId && m.userId !== me)
          if (mm.isAdmin && others.length > 0) return prev // 관리자는 다른 사람이 남아 있으면 나갈 수 없음
          const teamGone = others.length === 0
          return {
            ...p,
            teams: teamGone ? p.teams.filter((t) => t.id !== mm.teamId) : p.teams,
            members: p.members.filter((m) => m.userId !== me),
            events: p.events.filter((e) => e.ownerId !== me),
            todos: p.todos.filter((t) => t.ownerId !== me),
            requests: p.requests.filter((r) => r.requesterId !== me && r.leaderId !== me),
            messages: teamGone ? p.messages.filter((x) => x.teamId !== mm.teamId) : p.messages,
          }
        }),

      addEvent: (e) =>
        set((p) => ({ ...p, events: [...p.events, { ...e, id: uid(), ownerId: p.currentUserId! }] })),
      updateEvent: (id, patch) =>
        set((p) => flagLeaderChanges(p, p.events, p.events.map((e) => (e.id === id ? { ...e, ...patch } : e)))),
      deleteEvent: (id) => set((p) => ({ ...p, events: p.events.filter((e) => e.id !== id) })),
      confirmEvent: (id) =>
        set((p) => {
          const e = p.events.find((x) => x.id === id)
          const me = p.currentUserId
          if (!e || !e.changedAt || !me || e.ownerId === me) return p
          return {
            ...p,
            confirms: [...(p.confirms ?? []).filter((c) => !(c.eventId === id && c.userId === me)), { eventId: id, userId: me, changedAt: e.changedAt }],
            notices: p.notices.map((n) => (n.kind === 'confirm' && n.eventId === id && n.userId === me ? { ...n, read: true } : n)),
          }
        }),

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
                id: uid(), ownerId: r.leaderId, category: 'meeting', shared: true, repeat: 'none', ...r.payload, endDate: r.payload.endDate ?? undefined,
              }]
            } else if (r.type === 'edit' && r.eventId) {
              events = events.map((e) => (e.id === r.eventId
                ? { ...e, ...r.payload, date: e.repeat === 'none' ? r.payload.date : e.date, endDate: e.repeat === 'none' ? r.payload.endDate ?? undefined : e.endDate }
                : e))
            } else if (r.type === 'delete' && r.eventId) {
              events = events.filter((e) => e.id !== r.eventId)
            }
          }
          const verb = r.type === 'add' ? '추가' : r.type === 'edit' ? '수정' : '삭제'
          // 팀장 일정이 요청대로 바뀌었으면 팀원 확인을 받는다
          const flagged = flagLeaderChanges(p, p.events, events)
          return {
            ...flagged,
            requests: p.requests.map((x) =>
              x.id === id ? { ...x, status: accept ? 'accepted' : 'rejected', reason } : x,
            ),
            // notify 는 기존 알림 목록까지 포함해 돌려주므로, 읽음 처리한 목록을 넘겨 한 번만 합친다 (중복 방지)
            notices: notify(
              { ...flagged, notices: flagged.notices.map((n) => (n.refId === id && n.userId === r.leaderId ? { ...n, read: true } : n)) },
              r.requesterId,
              {
                kind: 'result', refId: id,
                text: accept
                  ? `팀장이 일정 ${verb} 요청에 동의했습니다. (${r.payload.title})`
                  : `팀장이 일정 ${verb} 요청을 거절했습니다. (${r.payload.title})${reason ? ' 사유: ' + reason : ''}`,
              },
            ).slice(0, 200),
          }
        }),

      addTodo: (text, date, priority = false) =>
        set((p) => ({
          ...p,
          todos: [...p.todos, { id: uid(), ownerId: p.currentUserId!, text, date, done: false, priority }],
        })),
      // 상위 할 일을 끝내면 하위 할 일도 모두 끝낸다
      toggleTodo: (id) =>
        set((p) => {
          const x = p.todos.find((t) => t.id === id)
          if (!x) return p
          const done = !x.done
          return { ...p, todos: p.todos.map((t) => (t.id === id || (done && t.parentId === id) ? { ...t, done } : t)) }
        }),
      togglePriority: (id) =>
        set((p) => ({ ...p, todos: p.todos.map((t) => (t.id === id ? { ...t, priority: !t.priority } : t)) })),
      // 하위 할 일도 함께 지우고, 함께 옮긴다
      removeTodo: (id) => set((p) => ({ ...p, todos: p.todos.filter((t) => t.id !== id && t.parentId !== id) })),
      moveTodo: (id, date) => set((p) => ({ ...p, todos: p.todos.map((t) => (t.id === id || t.parentId === id ? { ...t, date } : t)) })),
      restoreTodo: (t, children = []) => set((p) => {
        const pid = uid()
        const owner = p.currentUserId!
        return { ...p, todos: [...p.todos, { ...t, id: pid, ownerId: owner }, ...children.map((c) => ({ ...c, id: uid(), ownerId: owner, parentId: pid }))] }
      }),
      arrangeTodos: (updates) => set((p) => ({
        ...p,
        todos: p.todos.map((t) => {
          const u = updates.find((x) => x.id === t.id)
          if (!u) return t
          const { parentId: _old, ...rest } = t
          return { ...rest, ...(u.parentId ? { parentId: u.parentId } : {}), position: u.position }
        }),
      })),
      setGoal: (week, text) =>
        set((p) => {
          const me = p.currentUserId
          if (!me) return p
          const body = text.trim().slice(0, 100)
          const rest = (p.goals ?? []).filter((g) => !(g.ownerId === me && g.week === week))
          const old = (p.goals ?? []).find((g) => g.ownerId === me && g.week === week)
          // 빈 글이면 지우고, 글만 바뀌었으면 체크 상태는 그대로 둔다
          return { ...p, goals: body ? [...rest, { id: old?.id ?? uid(), ownerId: me, week, text: body, done: old?.done ?? false }] : rest }
        }),
      toggleGoal: (id) =>
        set((p) => ({ ...p, goals: (p.goals ?? []).map((g) => (g.id === id && g.ownerId === p.currentUserId ? { ...g, done: !g.done } : g)) })),
      finishWeekCard: (week) =>
        set((p) => ({ ...p, users: p.users.map((u) => (u.id === p.currentUserId ? { ...u, weekCardSeen: week } : u)) })),
      loadMemo: async (date) => (db.memos ?? []).find((m) => m.ownerId === db.currentUserId && m.date === date)?.body ?? '',
      findMemos: async (q) => {
        const s = q.trim().toLowerCase()
        if (!s) return []
        return (db.memos ?? [])
          .filter((m) => m.ownerId === db.currentUserId && m.body.toLowerCase().includes(s))
          .sort((a, b) => b.date.localeCompare(a.date))
          .slice(0, 50)
          .map((m) => ({ date: m.date, body: m.body }))
      },
      findMessages: async (q) => {
        const s = q.trim().toLowerCase()
        if (!s) return []
        return [...messages, ...dms, ...rooms.flatMap((r) => roomMessages(r.id))]
          .filter((m) => !m.deleted && !m.system && m.body.toLowerCase().includes(s))
          .sort((a, b) => b.createdAt - a.createdAt)
          .slice(0, 50)
      },
      // 체험 모드는 대화를 모두 갖고 있어 따로 불러올 것이 없다
      revealMessage: async () => {},
      chatDays: async (scope, from, to) => {
        const me = db.currentUserId
        const out: Record<string, number> = {}
        if (!me) return out
        for (const m of db.messages) {
          if (m.deleted || m.system || m.teamId !== myMember?.teamId) continue
          if (chatScope(me, m) !== scope) continue
          const k = toStr(new Date(m.createdAt))
          if (k >= from && k <= to) out[k] = (out[k] ?? 0) + 1
        }
        return out
      },
      revealDay: async (scope, day) => {
        const me = db.currentUserId
        if (!me) return null
        const m = db.messages.find((x) => !x.deleted && !x.system && x.teamId === myMember?.teamId && chatScope(me, x) === scope && toStr(new Date(x.createdAt)) === day)
        return m?.id ?? null
      },
      saveMemo: async (date, body) => {
        set((p) => {
          const me = p.currentUserId
          if (!me) return p
          const rest = (p.memos ?? []).filter((m) => !(m.ownerId === me && m.date === date))
          return { ...p, memos: body.trim() ? [...rest, { ownerId: me, date, body: body.slice(0, 20000) }] : rest }
        })
        return true
      },

      markAllRead: () =>
        set((p) => ({
          ...p,
          notices: p.notices.map((n) => (n.userId === p.currentUserId ? { ...n, read: true } : n)),
        })),

      sendMessage: (body, ref, toId, opts) => {
        const text = body.trim()
        if ((!text && !ref && !opts?.sticker) || !myMember || !db.currentUserId) return
        const people = tableMembers.map((m) => ({ id: m.userId, name: userOf(m.userId).name }))
        // 1:1 대화·전달한 메시지에서는 @호출을 쓰지 않는다
        const { mentions, mentionAll } = toId || opts?.roomId || opts?.forwarded ? { mentions: [], mentionAll: false } : parseMentions(text, people)
        const m: Message = {
          id: uid(), teamId: myMember.teamId, authorId: db.currentUserId, body: text,
          mentions: mentions.filter((id) => id !== db.currentUserId), mentionAll, ref, createdAt: Date.now(),
          ...(toId ? { toId } : {}),
          ...(opts?.roomId ? { roomId: opts.roomId } : {}),
          ...(opts?.replyTo ? { replyTo: opts.replyTo } : {}),
          ...(opts?.forwarded ? { forwarded: true } : {}),
          ...(opts?.sticker ? { sticker: opts.sticker } : {}),
        }
        const rid = opts?.roomId
        set((p) => rid
          ? { ...p, messages: [...p.messages, m], rooms: (p.rooms ?? []).map((r) => (r.id === rid ? { ...r, members: r.members.map((x) => (x.userId === m.authorId ? { ...x, lastReadAt: m.createdAt } : x)) } : r)) }
          : toId
          ? { ...p, messages: [...p.messages, m], dmReads: { ...p.dmReads, [`${m.authorId}>${toId}`]: m.createdAt } }
          : { ...p, messages: [...p.messages, m], chatReads: { ...p.chatReads, [m.authorId]: m.createdAt } })
      },
      deleteMessage: (id) =>
        set((p) => ({
          ...p,
          messages: p.messages.map((m) =>
            m.id === id && m.authorId === p.currentUserId
              ? { ...m, body: '', ref: undefined, mentions: [], mentionAll: false, deleted: true }
              : m,
          ),
          // 지운 메시지의 반응도 함께 지운다
          reactions: Object.fromEntries(Object.entries(p.reactions ?? {}).filter(([k]) => k !== id)),
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
      markDmRead: (peerId) => {
        const me = db.currentUserId
        if (!me) return
        const list = dmMessages(peerId)
        const last = list.length ? list[list.length - 1].createdAt : 0
        const key = `${me}>${peerId}`
        const lastRead = db.dmReads?.[key] ?? 0
        if (lastRead >= last) return
        const now = Date.now()
        const fresh = list.filter((m) => m.authorId !== me && !m.deleted && m.createdAt > lastRead)
        set((p) => {
          const reads = { ...p.messageReads }
          fresh.forEach((m) => {
            if (!reads[m.id]?.[me]) reads[m.id] = { ...reads[m.id], [me]: now }
          })
          return { ...p, messageReads: reads, dmReads: { ...p.dmReads, [key]: Math.max(last, now) } }
        })
      },
      // ── 그룹 대화방 (체험 모드: 브라우저에만 저장) ──
      createRoom: async (ids) => {
        const me = db.currentUserId
        const others = [...new Set(ids)].filter((x) => x !== me)
        if (!me || !myMember || others.length < 2) return null
        const now = Date.now()
        const id = uid()
        const room = { id, teamId: myMember.teamId, members: [me, ...others].map((userId) => ({ userId, joinedAt: now, lastReadAt: now })) }
        const notice: Message = { id: uid(), teamId: myMember.teamId, authorId: me, body: inviteNotice(userOf(me).name, others.map((x) => userOf(x).name)), mentions: [], mentionAll: false, createdAt: now, roomId: id, system: true }
        set((p) => ({ ...p, rooms: [...(p.rooms ?? []), room], messages: [...p.messages, notice] }))
        return id
      },
      inviteToRoom: (roomId, ids) => {
        const me = db.currentUserId
        const room = (db.rooms ?? []).find((r) => r.id === roomId)
        if (!me || !myMember || !room) return
        const fresh = [...new Set(ids)].filter((x) => !room.members.some((m) => m.userId === x))
        if (!fresh.length) return
        const now = Date.now()
        const notice: Message = { id: uid(), teamId: myMember.teamId, authorId: me, body: inviteNotice(userOf(me).name, fresh.map((x) => userOf(x).name)), mentions: [], mentionAll: false, createdAt: now, roomId, system: true }
        set((p) => ({
          ...p,
          rooms: (p.rooms ?? []).map((r) => (r.id === roomId ? { ...r, members: [...r.members, ...fresh.map((userId) => ({ userId, joinedAt: now, lastReadAt: now }))] } : r)),
          messages: [...p.messages, notice],
        }))
      },
      leaveRoom: (roomId) => {
        const me = db.currentUserId
        const room = (db.rooms ?? []).find((r) => r.id === roomId)
        if (!me || !myMember || !room) return
        const left = room.members.filter((m) => m.userId !== me)
        // 마지막 사람이 나가면 방과 대화를 지운다
        if (!left.length) {
          set((p) => ({ ...p, rooms: (p.rooms ?? []).filter((r) => r.id !== roomId), messages: p.messages.filter((m) => m.roomId !== roomId) }))
          return
        }
        const notice: Message = { id: uid(), teamId: myMember.teamId, authorId: me, body: leaveNotice(userOf(me).name), mentions: [], mentionAll: false, createdAt: Date.now(), roomId, system: true }
        set((p) => ({ ...p, rooms: (p.rooms ?? []).map((r) => (r.id === roomId ? { ...r, members: left } : r)), messages: [...p.messages, notice] }))
      },
      markRoomRead: (roomId) => {
        const me = db.currentUserId
        const r = rooms.find((x) => x.id === roomId)
        if (!me || !r || r.unread === 0) return
        const now = Date.now()
        const fresh = roomMessages(roomId).filter((m) => m.authorId !== me && !m.deleted && !m.system)
        set((p) => {
          const reads = { ...p.messageReads }
          fresh.forEach((m) => { if (!reads[m.id]?.[me]) reads[m.id] = { ...reads[m.id], [me]: now } })
          return { ...p, messageReads: reads, rooms: (p.rooms ?? []).map((x) => (x.id === roomId ? { ...x, members: x.members.map((y) => (y.userId === me ? { ...y, lastReadAt: now } : y)) } : x)) }
        })
      },
      getCalendarUrl: async () => null,
      pins,
      pinMessage: (m) => {
        const me = db.currentUserId
        if (!me || m.deleted || m.system) return
        const pin: ChatPin = { scope: chatScope(me, m), messageId: m.id, body: m.body, authorId: m.authorId, pinnedBy: me, pinnedAt: Date.now() }
        set((p) => ({ ...p, pins: [...(p.pins ?? []).filter((x) => x.scope !== pin.scope), pin] }))
      },
      unpin: (scope) => set((p) => ({ ...p, pins: (p.pins ?? []).filter((x) => x.scope !== scope) })),
      scheduled,
      scheduleMessage: async (body, sendAt, toId, opts) => {
        const text = body.trim()
        if (!text || sendAt <= Date.now()) return false
        const people = tableMembers.map((m) => ({ id: m.userId, name: userOf(m.userId).name }))
        const { mentions, mentionAll } = toId || opts?.roomId ? { mentions: [] as string[], mentionAll: false } : parseMentions(text, people)
        const s: ScheduledMessage = {
          id: uid(), body: text, sendAt, mentions: mentions.filter((id) => id !== db.currentUserId), mentionAll,
          ...(toId ? { toId } : {}), ...(opts?.roomId ? { roomId: opts.roomId } : {}), ...(opts?.replyTo ? { replyTo: opts.replyTo } : {}),
        }
        set((p) => ({ ...p, scheduled: [...(p.scheduled ?? []), s] }))
        return true
      },
      reschedule: (id, sendAt) => set((p) => ({ ...p, scheduled: (p.scheduled ?? []).map((x) => (x.id === id ? { ...x, sendAt } : x)) })),
      editScheduled: (id, body) => {
        const text = body.trim()
        if (text) set((p) => ({ ...p, scheduled: (p.scheduled ?? []).map((x) => (x.id === id ? { ...x, body: text } : x)) }))
      },
      cancelScheduled: (id) => set((p) => ({ ...p, scheduled: (p.scheduled ?? []).filter((x) => x.id !== id) })),
      // 체험 모드: 보낼 시각을 지금으로 당기면 아래 타이머가 바로 보낸다
      sendScheduledNow: (id) => set((p) => ({ ...p, scheduled: (p.scheduled ?? []).map((x) => (x.id === id ? { ...x, sendAt: Date.now() - 1 } : x)) })),
      getReadReceipts: async (messageId) => {
        const m = db.messages.find((x) => x.id === messageId)
        if (!m || m.authorId !== db.currentUserId) return {}
        return { ...(db.messageReads[messageId] ?? {}) }
      },
      reactions: db.reactions ?? {},
      react: (messageId, emoji) => {
        const me = db.currentUserId
        if (!me) return
        set((p) => {
          const cur = { ...(p.reactions?.[messageId] ?? {}) }
          if (emoji) cur[me] = emoji
          else delete cur[me]
          return { ...p, reactions: { ...p.reactions, [messageId]: cur } }
        })
      },
    }
  }, [db])

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>
}
