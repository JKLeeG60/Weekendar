export type Role = 'leader' | 'member' | 'none' | 'pending'

export interface User {
  id: string
  name: string
  email: string
}

export interface Team {
  id: string
  name: string
  inviteCode: string
}

/** 1인 1팀: userId 는 유일해야 한다 (Supabase 에서는 unique 제약). */
export interface Member {
  userId: string
  teamId: string
  role: Role // none = 관리자 전용(표에 표시되지 않음)
  isAdmin: boolean
  title: string // 직급
  sort: number // 팀원 표시 순서
}

export type Category =
  | 'meeting'
  | 'work'
  | 'personal'
  | 'leave'
  | 'halfday'
  | 'outside'
  | 'trip'
  | 'training'

export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly'

export interface EventItem {
  id: string
  ownerId: string
  title: string
  date: string // YYYY-MM-DD
  start: string // HH:mm
  end: string
  place: string
  category: Category
  shared: boolean
  repeat: Repeat
  until?: string
  /** 여러 날 일정의 마지막 날 (있으면 date~endDate 종일 일정) */
  endDate?: string
  /** 미리 알림: 시작 몇 분 전 (없으면 알림 없음) */
  remind?: number
}

export interface Occurrence extends EventItem {
  baseId: string
}

export interface RequestPayload {
  title: string
  date: string
  /** 여러 날 요청이면 마지막 날, 하루 요청이면 null (팀장 동의 시 그대로 반영) */
  endDate?: string | null
  /** 카테고리 (없으면 회의) */
  category?: Category
  start: string
  end: string
  place: string
}

export interface ChangeRequest {
  id: string
  requesterId: string
  leaderId: string
  type: 'add' | 'edit' | 'delete'
  eventId?: string
  payload: RequestPayload
  status: 'pending' | 'accepted' | 'rejected'
  reason?: string
  createdAt: number
}

export interface Todo {
  id: string
  ownerId: string
  text: string
  date: string
  done: boolean
  priority: boolean
}

export interface Notice {
  id: string
  userId: string
  kind: 'request' | 'result' | 'join'
  text: string
  refId?: string
  read: boolean
  createdAt: number
}

/** 대화에 첨부한 일정 요약 */
export interface ChatRef {
  date: string
  start: string
  end: string
  title: string
  ownerName: string
}

export interface Message {
  id: string
  teamId: string
  authorId: string
  body: string
  /** 호출된 사람 id */
  mentions: string[]
  mentionAll: boolean
  ref?: ChatRef
  createdAt: number
  deleted?: boolean
}

export interface DB {
  users: User[]
  teams: Team[]
  members: Member[]
  events: EventItem[]
  requests: ChangeRequest[]
  todos: Todo[]
  notices: Notice[]
  messages: Message[]
  /** 사람별 대화 마지막 읽은 시각(ms) */
  chatReads: Record<string, number>
  /** 메시지별 읽은 기록: 메시지 id → (사람 id → 읽은 시각 ms) */
  messageReads: Record<string, Record<string, number>>
  currentUserId: string | null
}

export const CATEGORY_LABEL: Record<Category, string> = {
  meeting: '회의',
  work: '업무',
  personal: '개인',
  leave: '휴가',
  halfday: '반차',
  outside: '외근',
  trip: '출장',
  training: '교육',
}

/** 부재자 명단에 올라가는 카테고리 */
export const ABSENCE: Category[] = ['leave', 'halfday', 'outside', 'trip', 'training']
export const isAbsence = (c: Category) => ABSENCE.includes(c)
