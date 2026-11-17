import { fmtTime } from './date'
import type { Message } from './types'

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
export function chatCounts(messages: Message[], me: string | null | undefined, lastRead: number) {
  const unread = messages.filter((m) => m.authorId !== me && !m.deleted && m.createdAt > lastRead)
  return { unread: unread.length, mentions: unread.filter((m) => mentionsMe(m, me)).length }
}

export function timeLabel(ms: number) {
  const d = new Date(ms)
  return fmtTime(`${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`)
}
