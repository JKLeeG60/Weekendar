import { fmtTime } from './date'
import type { ChatRoom, Message } from './types'

export const ALL = '전체'
/** 영어 화면에서 쓰는 @all (한국어 @전체 와 똑같이 팀 모두를 부른다) */
export const ALL_EN = 'all'

/** 본문에서 @이름 / @전체 를 찾아 호출 대상을 만든다 */
export function parseMentions(body: string, people: { id: string; name: string }[]) {
  const mentions = people.filter((p) => body.includes('@' + p.name)).map((p) => p.id)
  return { mentions, mentionAll: body.includes('@' + ALL) || new RegExp('@' + ALL_EN + '\\b', 'i').test(body) }
}

/** 본문을 일반 글자와 @호출 조각으로 나눈다 (화면 강조용) */
export function splitMentions(body: string, names: string[]): { text: string; mention: boolean }[] {
  const list = [...names, ALL, ALL_EN].filter(Boolean).sort((a, b) => b.length - a.length)
  if (list.length === 0) return [{ text: body, mention: false }]
  const esc = list.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp('@(' + esc.join('|') + ')', 'g')
  const out: { text: string; mention: boolean }[] = []
  let last = 0
  for (const m of body.matchAll(re)) {
    if (m.index! > last) out.push({ text: body.slice(last, m.index), mention: false })
    out.push({ text: m[0], mention: true })
    last = m.index! + m[0].length
  }
  if (last < body.length) out.push({ text: body.slice(last), mention: false })
  return out
}

export const mentionsMe = (m: Message, me?: string | null) =>
  !!me && m.authorId !== me && !m.deleted && (m.mentionAll || m.mentions.includes(me))

/** 안 읽은 대화 수와 그중 나를 호출한 수 */
/** 1:1 대화에서 나와 대화하는 상대 id (팀 대화면 null) */
export function dmPeer(m: Message, me: string | null | undefined): string | null {
  if (!m.toId) return null
  return m.authorId === me ? m.toId : m.authorId
}

/** 1:1 대화 목록: 상대별 마지막 메시지와 안 읽은 수 (최근 대화 먼저) */
export function dmThreads(messages: Message[], me: string | null | undefined, reads: Record<string, number>) {
  const map = new Map<string, { peerId: string; last: Message; unread: number }>()
  for (const m of messages) {
    const peer = dmPeer(m, me)
    if (!peer || (m.authorId !== me && m.toId !== me)) continue
    const th = map.get(peer) ?? { peerId: peer, last: m, unread: 0 }
    if (m.createdAt >= th.last.createdAt) th.last = m
    if (m.authorId !== me && !m.deleted && m.createdAt > (reads[`${me}>${peer}`] ?? 0)) th.unread++
    map.set(peer, th)
  }
  return [...map.values()].sort((a, b) => b.last.createdAt - a.last.createdAt)
}

export function chatCounts(messages: Message[], me: string | null | undefined, lastRead: number) {
  const unread = messages.filter((m) => m.authorId !== me && !m.deleted && m.createdAt > lastRead)
  return { unread: unread.length, mentions: unread.filter((m) => mentionsMe(m, me)).length }
}

export function timeLabel(ms: number) {
  const d = new Date(ms)
  return fmtTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
}

/** 그룹 대화방 목록 한 줄: 방 사람, 마지막 메시지, 안 읽은 수 */
export interface RoomThread { id: string; memberIds: string[]; last: Message | null; unread: number; joinedAt: number }

/** 내가 들어가 있는 대화방들 (최근 대화 먼저). 내가 들어온 뒤의 메시지만 센다 */
export function roomThreads(rooms: ChatRoom[], messages: Message[], me: string | null | undefined, teamId?: string): RoomThread[] {
  const out: RoomThread[] = []
  for (const r of rooms) {
    if (teamId && r.teamId !== teamId) continue
    const mine = r.members.find((x) => x.userId === me)
    if (!mine) continue
    const list = messages.filter((m) => m.roomId === r.id && m.createdAt >= mine.joinedAt)
    out.push({
      id: r.id,
      memberIds: r.members.map((x) => x.userId),
      last: list.length ? list[list.length - 1] : null,
      unread: list.filter((m) => m.authorId !== me && !m.deleted && !m.system && m.createdAt > mine.lastReadAt).length,
      joinedAt: mine.joinedAt,
    })
  }
  return out.sort((a, b) => (b.last?.createdAt ?? b.joinedAt) - (a.last?.createdAt ?? a.joinedAt))
}

/** 대화방 안내 문장 (서버 migration_020 과 같은 모양: "김하늘님이 박서준님, 최유리님을 초대했어요") */
export const inviteNotice = (who: string, names: string[]) => `${who}님이 ${names.map((n) => n + '님').join(', ')}을 초대했어요`
export const leaveNotice = (who: string) => `${who}님이 나갔어요`

/** 대화 공지의 대화방 구분: 팀 대화 'team' / 1:1 'dm:<작은 id>:<큰 id>' / 그룹 'room:<방 id>' */
export function chatScope(me: string, c: { toId?: string; roomId?: string; authorId?: string }): string {
  if (c.roomId) return 'room:' + c.roomId
  const peer = c.toId ? (c.toId === me ? c.authorId : c.toId) : undefined
  if (peer) return 'dm:' + [me, peer].sort().join(':')
  return 'team'
}
