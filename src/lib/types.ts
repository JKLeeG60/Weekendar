export type Role = 'leader' | 'member' | 'none' | 'pending'

export interface User {
  id: string
  name: string
  email: string
  /** 처음 사용 안내를 이미 봤는지 (false 일 때만 처음 한 번 보여준다. 없으면 본 것으로 취급) */
  tutorialSeen?: boolean
  /** 못 끝낸 할 일을 다음 날로 넘길지 (없으면 켜짐) */
  todoCarry?: boolean
  /** 아침 브리핑: 켜짐(없으면 켜짐) · 보내는 시각("08:30") · 요일 */
  briefOn?: boolean
  briefTime?: string
  briefDays?: BriefDays
  /** 바꾼 단축키만 (단축키 id → 키). 없으면 기본 단축키 */
  shortcuts?: Record<string, string>
  /** 동의한 약관 버전 (0 또는 없음 = 아직 동의 안 함) */
  termsVersion?: number
  /** "이번 주 시작" 카드를 마지막으로 보여준 주의 월요일 (같은 주에는 다시 띄우지 않음) */
  weekCardSeen?: string
}

export interface Team {
  id: string
  name: string
  inviteCode: string
  /** 대화 보관 기간(일). 없으면 영구 보관 */
  chatRetentionDays?: number | null
  /** 혼자 쓰기 공간 (팀 없이 나 혼자). 팀 만들기를 하면 일반 팀으로 바뀐다 */
  personal?: boolean
  /** 휴가·출장 자동 승인: none 끔 · all 휴가·출장 · trip 출장만 · leave 휴가만 */
  autoApprove?: AutoApprove
}

export type AutoApprove = 'none' | 'all' | 'trip' | 'leave'

/** 아침 브리핑 요일: 평일만 · 매일 */
export type BriefDays = 'weekdays' | 'daily'

/** 1인 1팀: userId 는 유일해야 한다 (Supabase 에서는 unique 제약). */
export interface Member {
  userId: string
  teamId: string
  role: Role // none = 관리자 전용(표에 표시되지 않음)
  isAdmin: boolean
  title: string // 직급
  sort: number // 팀원 표시 순서
  /** 올해 총 연차 (없으면 15일) */
  leaveTotal?: number
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
  /** 구글 캘린더에도 추가 (켠 일정만 구글의 "Weekendar" 캘린더로 보냄) */
  gcal?: boolean
  /** 팀장이 공유 일정을 바꾼 시각(ms). 팀원 확인을 받아야 하는 변경이 있을 때만 있음 */
  changedAt?: number
  /** 바뀐 내용 요약 (예: "14:00–15:00 → 15:00–16:00"). 시간이 안 바뀌고 제목·장소만 바뀌면 빈 글 */
  changeText?: string
  /** 회의 참석자 (만든 사람은 빼고). 참석자 줄에도 이 일정이 보인다 */
  attendees?: Attendee[]
}

/** 회의 참석자와 응답: 응답 대기 · 참석 · 불참 */
export type AttendStatus = 'pending' | 'accepted' | 'declined'
export interface Attendee {
  userId: string
  status: AttendStatus
}

/** "모두 비는 시간 찾기"에 쓰는 바쁜 시간 (제목 없이). 반복·여러 날 정보는 그대로 */
export interface BusyEvent {
  id: string
  userId: string
  date: string
  endDate?: string
  start: string
  end: string
  repeat: Repeat
  until?: string
  category: Category
}

/** 팀원이 "확인했어요"를 누른 기록 (changedAt 은 확인한 변경의 시각) */
export interface EventConfirm {
  eventId: string
  userId: string
  changedAt: number
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
  /** 상위 할 일 (한 단계까지) */
  parentId?: string
  /** 목록 안 순서 (작을수록 위). 없으면 예전 순서(중요 → 만든 순) */
  position?: number
  /** 업무 배정: 맡긴 사람 (팀장·관리자). 있으면 "배정받은 업무" */
  assignedBy?: string
  /** 업무 배정: 마감 날짜·시각("HH:MM")·메모 */
  dueDate?: string
  dueTime?: string
  note?: string
}

/** 휴가·출장 신청 종류: 연차 · 오전 반차 · 오후 반차 · 병가 · 경조사 · 출장 */
export type AbsenceKind = 'annual' | 'am' | 'pm' | 'sick' | 'family' | 'trip'
export type AbsenceStatus = 'pending' | 'approved' | 'rejected' | 'canceled'

/** 휴가·출장 신청 (승인되면 일정이 자동으로 생긴다) */
export interface Absence {
  id: string
  teamId: string
  userId: string
  kind: AbsenceKind
  date: string
  /** 여러 날이면 마지막 날 */
  endDate?: string
  /** 출장지 */
  place: string
  reason: string
  /** 평일 기준 일수 (반차 0.5). 연차에서 빠지는 건 연차·반차만 */
  days: number
  status: AbsenceStatus
  rejectReason?: string
  decidedBy?: string
  /** 자동 승인으로 처리됨 */
  auto?: boolean
  eventId?: string
  createdAt: number
}

/** 날짜별 메모 (마크다운, 나만 보임) */
export interface Memo {
  ownerId: string
  date: string
  body: string
}

/** 이번 주 목표: 할 일과 따로, 한 주에 하나, 나만 보임 (week = 그 주의 월요일) */
export interface WeekGoal {
  id: string
  ownerId: string
  week: string
  text: string
  done: boolean
}

export interface Notice {
  id: string
  userId: string
  kind: 'request' | 'result' | 'join' | 'confirm' | 'invite' | 'decline' | 'assign' | 'done' | 'absence'
  text: string
  refId?: string
  /** 'confirm' 알림이 가리키는 일정 */
  eventId?: string
  /** 'absence' 알림이 가리키는 휴가·출장 신청 */
  absenceId?: string
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

/** 대화 공지: 대화방마다 1개. scope 는 chatScope() 로 만든다 */
export interface ChatPin {
  scope: string
  messageId: string
  body: string
  /** 원래 글쓴이 */
  authorId?: string
  /** 공지로 올린 사람 */
  pinnedBy: string
  pinnedAt: number
}

/** 예약 보내기: 보낼 때까지 쓴 사람만 본다 */
export interface ScheduledMessage {
  id: string
  body: string
  sendAt: number
  toId?: string
  roomId?: string
  replyTo?: string
  mentions: string[]
  mentionAll: boolean
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
  /** 1:1 대화면 받는 사람 id (없으면 팀 대화) */
  toId?: string
  /** 답장한 원본 메시지 id */
  replyTo?: string
  /** 다른 대화에서 전달한 메시지 */
  forwarded?: boolean
  /** 이모티콘 메시지: '묶음/이름' (예: 'weeki/good') */
  sticker?: string
  /** 그룹 대화방 id (있으면 그 방 사람만 봄) */
  roomId?: string
  /** 초대·나가기 같은 안내 (가운데 회색 글씨로 보여줌) */
  system?: boolean
}

/** 그룹 대화방: 사람마다 들어온 시각(그 전 대화는 안 보임)과 마지막 읽은 시각 */
export interface ChatRoom {
  id: string
  teamId: string
  members: { userId: string; joinedAt: number; lastReadAt: number }[]
}

export interface DB {
  users: User[]
  teams: Team[]
  members: Member[]
  events: EventItem[]
  requests: ChangeRequest[]
  /** 팀장 일정 변경에 대한 팀원 확인 기록 */
  confirms?: EventConfirm[]
  /** 휴가·출장 신청 (같은 팀) */
  absences?: Absence[]
  todos: Todo[]
  /** 이번 주 목표 (없으면 빈 목록) */
  goals?: WeekGoal[]
  memos?: Memo[]
  notices: Notice[]
  /** 대화 공지 (대화방마다 1개) */
  pins?: ChatPin[]
  /** 내가 예약해 둔 메시지 */
  scheduled?: ScheduledMessage[]
  messages: Message[]
  /** 사람별 대화 마지막 읽은 시각(ms) */
  chatReads: Record<string, number>
  /** 메시지별 읽은 기록: 메시지 id → (사람 id → 읽은 시각 ms) */
  messageReads: Record<string, Record<string, number>>
  /** 1:1 대화 마지막 읽은 시각(ms): "내id>상대id" → 시각 */
  dmReads?: Record<string, number>
  /** 이모지 반응: 메시지 id → (사람 id → 이모지) */
  reactions?: Record<string, Record<string, string>>
  /** 그룹 대화방 (내가 들어가 있는 방) */
  rooms?: ChatRoom[]
  /** 내가 속한 팀 목록 (실서비스: 서버에서 받아 옴, 체험: members 에서 계산) */
  myTeams?: MyTeam[]
  /** 체험 모드: 사람별 지금 보고 있는 팀 */
  currentTeams?: Record<string, string>
  currentUserId: string | null
}

/** 내가 속한 팀 (한 사람은 최대 2개 팀) */
export interface MyTeam {
  id: string
  name: string
  role: Role
  isAdmin: boolean
  /** 지금 보고 있는 팀인지 */
  current: boolean
}

/** 한 사람이 속할 수 있는 팀 수 */
export const MAX_TEAMS = 2

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
