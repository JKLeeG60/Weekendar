import { Extension, Node, mergeAttributes, type Editor, type Range } from '@tiptap/core'
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import Suggestion, { type SuggestionOptions } from '@tiptap/suggestion'
import { t } from '../lib/i18n'
import type {} from '@tiptap/extension-table' // 표 명령 타입
import type {} from '@tiptap/extension-highlight' // 형광펜 명령 타입

/**
 * 메모 편집기용 옵시디언식 기능 모음 (모두 옵시디언과 같은 문법으로 저장)
 * - 콜아웃:     > [!note] 제목  /  > 내용
 * - 날짜 링크:  [[2026-11-25]]  → 누르면 그 날 메모로
 * - 태그:       #고객사          → 색 표시, 누르면 같은 태그 메모 모아 보기
 * - 제목 접기:  제목 왼쪽 ▸ 를 누르면 다음 같은 단계 제목 전까지 숨김
 * - / 명령, [[ 날짜 고르기 팝업
 */

/* ───────── 콜아웃 ───────── */
export const CALLOUT_TYPES: Record<string, { label: string; tone: string }> = {
  note: { label: '메모', tone: 'blue' },
  info: { label: '정보', tone: 'blue' },
  todo: { label: '할 일', tone: 'blue' },
  tip: { label: '팁', tone: 'green' },
  success: { label: '완료', tone: 'green' },
  question: { label: '질문', tone: 'orange' },
  warning: { label: '주의', tone: 'orange' },
  danger: { label: '위험', tone: 'red' },
  failure: { label: '실패', tone: 'red' },
  bug: { label: '버그', tone: 'red' },
  example: { label: '예시', tone: 'purple' },
  quote: { label: '인용', tone: 'gray' },
  abstract: { label: '요약', tone: 'teal' },
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: { setCallout: (type?: string) => ReturnType }
    dateLink: { insertDateLink: (date: string) => ReturnType }
  }
}

export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      type: { default: 'note', parseHTML: (el) => el.getAttribute('data-callout') || 'note' },
      title: { default: '', parseHTML: (el) => el.getAttribute('data-title') || '' },
    }
  },
  parseHTML: () => [{ tag: 'div[data-callout]' }],
  renderHTML({ node, HTMLAttributes }) {
    const ty = String(node.attrs.type || 'note').toLowerCase()
    const meta = CALLOUT_TYPES[ty] ?? CALLOUT_TYPES.note
    return ['div', mergeAttributes(HTMLAttributes, {
      class: 'callout', 'data-callout': ty, 'data-tone': meta.tone,
      'data-title': node.attrs.title || '', 'data-label': node.attrs.title || t(meta.label),
    }), 0]
  },
  addCommands() {
    return {
      setCallout: (type = 'note') => ({ commands }) => commands.wrapIn(this.name, { type }),
    }
  },
  // 마크다운: > [!type] 제목 다음 > 로 시작하는 줄들
  markdownTokenizer: {
    name: 'callout',
    level: 'block',
    start: (src: string) => { const m = /(^|\n)> ?\[!/.exec(src); return m ? m.index + m[1].length : -1 },
    tokenize(src, _tokens, lexer) {
      const m = /^> ?\[!(\w+)\][+-]? ?([^\n]*)(?:\n|$)((?:>[^\n]*(?:\n|$))*)/.exec(src)
      if (!m) return undefined
      const body = m[3].split('\n').map((l) => l.replace(/^> ?/, '')).join('\n').trim()
      return { type: 'callout', raw: m[0], calloutType: m[1].toLowerCase(), title: m[2].trim(), tokens: lexer.blockTokens(body || '') }
    },
  },
  parseMarkdown(token, h) {
    const kids = h.parseChildren(token.tokens ?? [])
    return h.createNode('callout', { type: token.calloutType, title: token.title }, kids.length ? kids : [h.createNode('paragraph')])
  },
  renderMarkdown(node, h) {
    const head = `> [!${node.attrs?.type || 'note'}]${node.attrs?.title ? ' ' + node.attrs.title : ''}`
    const inner = h.renderChildren(node.content ?? [], '\n\n').trimEnd()
    return head + (inner ? '\n' + inner.split('\n').map((l) => (l ? '> ' + l : '>')).join('\n') : '')
  },
})

/* ───────── 날짜 링크 [[YYYY-MM-DD]] ───────── */
const ISO = /^\d{4}-\d{2}-\d{2}$/
export const dateLabel = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const dow = t(['일', '월', '화', '수', '목', '금', '토'][dt.getDay()])
  const thisYear = new Date().getFullYear() === y
  return `${thisYear ? '' : y + '. '}${m}. ${d}.(${dow})`
}

export const DateLink = Node.create({
  name: 'dateLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { date: { default: '', parseHTML: (el) => el.getAttribute('data-date') || '' } }
  },
  parseHTML: () => [{ tag: 'span[data-date-link]' }],
  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-date-link': '', 'data-date': node.attrs.date, class: 'memo-dlink', title: t('이 날 메모로 이동') }), dateLabel(node.attrs.date)]
  },
  renderText: ({ node }) => `[[${node.attrs.date}]]`,
  addCommands() {
    return {
      insertDateLink: (date: string) => ({ commands }) => commands.insertContent([{ type: this.name, attrs: { date } }, { type: 'text', text: ' ' }]),
    }
  },
  markdownTokenizer: {
    name: 'dateLink',
    level: 'inline',
    start: '[[',
    tokenize(src) {
      const m = /^\[\[(\d{4}-\d{2}-\d{2})(?:\|[^\]\n]*)?\]\]/.exec(src)
      if (!m || !ISO.test(m[1])) return undefined
      return { type: 'dateLink', raw: m[0], date: m[1] }
    },
  },
  parseMarkdown: (token, h) => h.createNode('dateLink', { date: token.date }),
  renderMarkdown: (node) => `[[${node.attrs?.date ?? ''}]]`,
})

/* ───────── 태그 #이름 (글자는 그대로, 색만 입힌다) ───────── */
export const TAG_RE = /(^|[\s(（])(#[\p{L}\p{N}_\-/]*[\p{L}_][\p{L}\p{N}_\-/]*)/gu
export const Tags = Extension.create({
  name: 'memoTags',
  addProseMirrorPlugins() {
    const build = (state: EditorState) => {
      const decos: Decoration[] = []
      state.doc.descendants((node, pos, parent) => {
        if (!node.isText || !node.text) return
        if (parent?.type.name === 'codeBlock' || node.marks.some((m) => m.type.name === 'code' || m.type.name === 'link')) return
        for (const m of node.text.matchAll(TAG_RE)) {
          const from = pos + (m.index ?? 0) + m[1].length
          decos.push(Decoration.inline(from, from + m[2].length, { class: 'memo-tag', 'data-tag': m[2] }))
        }
      })
      return DecorationSet.create(state.doc, decos)
    }
    return [new Plugin({
      key: new PluginKey('memoTags'),
      state: { init: (_, s) => build(s), apply: (tr, old, _o, s) => (tr.docChanged ? build(s) : old) },
      props: { decorations(s) { return this.getState(s) } },
    })]
  },
})

/* ───────── 제목 접기 ───────── */
const foldKey = new PluginKey<Set<number>>('memoFold')
export const FoldHeadings = Extension.create({
  name: 'memoFold',
  addProseMirrorPlugins() {
    return [new Plugin<Set<number>>({
      key: foldKey,
      state: {
        init: () => new Set(),
        apply(tr, set) {
          const toggle = tr.getMeta(foldKey) as number | undefined
          let next = set
          if (tr.docChanged) {
            next = new Set()
            set.forEach((p) => { const m = tr.mapping.mapResult(p); if (!m.deleted) next.add(m.pos) })
          }
          if (toggle !== undefined) {
            next = new Set(next)
            if (next.has(toggle)) next.delete(toggle); else next.add(toggle)
          }
          return next
        },
      },
      props: {
        decorations(state) {
          const folded = foldKey.getState(state) ?? new Set<number>()
          const decos: Decoration[] = []
          let hideUntil = 0 // 이 단계 이하의 제목이 나올 때까지 숨김 (0 = 숨기지 않음)
          state.doc.forEach((node, pos) => {
            const level = node.type.name === 'heading' ? (node.attrs.level as number) : 0
            if (hideUntil && level && level <= hideUntil) hideUntil = 0
            if (hideUntil) { decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'fold-hidden' })); return }
            if (level) {
              const on = folded.has(pos)
              decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'foldable' + (on ? ' folded' : '') }))
              decos.push(Decoration.widget(pos + 1, () => {
                const b = document.createElement('span')
                b.className = 'fold-btn'
                b.setAttribute('role', 'button')
                b.setAttribute('aria-label', on ? t('펼치기') : t('접기'))
                b.contentEditable = 'false'
                b.dataset.foldPos = String(pos)
                return b
              }, { side: -1, key: 'fold-' + pos + (on ? '-on' : '') }))
              if (on) hideUntil = level
            }
          })
          return DecorationSet.create(state.doc, decos)
        },
        handleDOMEvents: {
          mousedown(view, e) {
            const el = (e.target as HTMLElement).closest('.fold-btn') as HTMLElement | null
            if (!el) return false
            e.preventDefault()
            view.dispatch(view.state.tr.setMeta(foldKey, Number(el.dataset.foldPos)))
            return true
          },
        },
      },
    })]
  },
})

/* ───────── 팝업 메뉴 (/ 명령, [[ 날짜) ───────── */
export interface MenuItem {
  id: string
  label: string
  hint?: string
  icon?: string
  keywords?: string
  run: (editor: Editor, range: Range) => void
}

/** 팝업 목록을 화면에 그리는 쪽 (편집기 컴포넌트가 넘겨 준다) */
export interface MenuView {
  open: (items: MenuItem[], rect: DOMRect | null, pick: (i: MenuItem) => void) => void
  update: (items: MenuItem[], rect: DOMRect | null, pick: (i: MenuItem) => void) => void
  key: (e: KeyboardEvent) => boolean
  close: () => void
}

function menuSuggestion(name: string, char: string, getItems: (q: string) => MenuItem[], view: () => MenuView | null, extra?: Partial<SuggestionOptions<MenuItem>>) {
  return Extension.create({
    name,
    addProseMirrorPlugins() {
      return [Suggestion<MenuItem>({
        editor: this.editor,
        pluginKey: new PluginKey(name),
        char,
        allowSpaces: false,
        ...extra,
        items: ({ query }) => getItems(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => ({
          onStart: (p) => view()?.open(p.items, p.clientRect?.() ?? null, (i) => p.command(i)),
          onUpdate: (p) => view()?.update(p.items, p.clientRect?.() ?? null, (i) => p.command(i)),
          onKeyDown: ({ event }) => (event.key === 'Escape' ? (view()?.close(), true) : view()?.key(event) ?? false),
          onExit: () => view()?.close(),
        }),
      })]
    },
  })
}

const match = (q: string, i: MenuItem) => {
  if (!q) return true
  const s = (i.label + ' ' + (i.keywords ?? '')).toLowerCase()
  return q.toLowerCase().split(/\s+/).every((w) => s.includes(w))
}

/** / 명령 메뉴 */
export const slashItems = (): MenuItem[] => {
  const del = (e: Editor, r: Range) => e.chain().focus().deleteRange(r)
  const call = (ty: string, label: string, icon: string, kw: string): MenuItem => ({
    id: 'callout-' + ty, label, icon, keywords: 'callout 콜아웃 상자 ' + kw, hint: `> [!${ty}]`,
    run: (e, r) => del(e, r).setCallout(ty).run(),
  })
  return [
    { id: 'h1', label: t('큰 제목'), icon: 'H1', keywords: 'heading title 제목', hint: '#', run: (e, r) => del(e, r).setNode('heading', { level: 1 }).run() },
    { id: 'h2', label: t('중간 제목'), icon: 'H2', keywords: 'heading 제목', hint: '##', run: (e, r) => del(e, r).setNode('heading', { level: 2 }).run() },
    { id: 'h3', label: t('작은 제목'), icon: 'H3', keywords: 'heading 제목', hint: '###', run: (e, r) => del(e, r).setNode('heading', { level: 3 }).run() },
    { id: 'ul', label: t('목록'), icon: '•', keywords: 'bullet list 글머리', hint: '-', run: (e, r) => del(e, r).toggleBulletList().run() },
    { id: 'ol', label: t('번호 목록'), icon: '1.', keywords: 'number ordered 순서', hint: '1.', run: (e, r) => del(e, r).toggleOrderedList().run() },
    { id: 'task', label: t('체크리스트'), icon: '☑', keywords: 'todo task check 할일', hint: '[ ]', run: (e, r) => del(e, r).toggleTaskList().run() },
    { id: 'table', label: t('표'), icon: '⊞', keywords: 'table 테이블', run: (e, r) => del(e, r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { id: 'code', label: t('코드 블록'), icon: '</>', keywords: 'code 코드', hint: '```', run: (e, r) => del(e, r).toggleCodeBlock().run() },
    { id: 'quote', label: t('인용'), icon: '❝', keywords: 'quote 인용', hint: '>', run: (e, r) => del(e, r).toggleBlockquote().run() },
    call('note', t('콜아웃 · 메모'), 'ℹ︎', 'note 메모 정보'),
    call('tip', t('콜아웃 · 팁'), '✓', 'tip 팁'),
    call('warning', t('콜아웃 · 주의'), '!', 'warning 주의 경고'),
    call('danger', t('콜아웃 · 위험'), '⚠︎', 'danger 위험'),
    { id: 'hl', label: t('형광펜'), icon: '▍', keywords: 'highlight mark 강조', hint: '==', run: (e, r) => del(e, r).toggleHighlight().run() },
    { id: 'hr', label: t('구분선'), icon: '—', keywords: 'divider line hr 줄', hint: '---', run: (e, r) => del(e, r).setHorizontalRule().run() },
    { id: 'date', label: t('날짜 링크'), icon: '📅', keywords: 'date link 날짜 연결', hint: '[[', run: (e, r) => del(e, r).insertContent('[[').run() },
  ]
}

/** [[ 다음에 칠 수 있는 날짜 후보 */
export function dateItems(q: string, base: string): MenuItem[] {
  const pad = (n: number) => String(n).padStart(2, '0')
  const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const [by, bm, bd] = base.split('-').map(Number)
  const at = (off: number) => { const d = new Date(by, bm - 1, bd); d.setDate(d.getDate() + off); return iso(d) }
  const today = new Date()
  const out: { date: string; label: string; kw?: string }[] = []
  // 직접 친 날짜: 2026-11-25, 11/25, 11.25, 11월 25일, 25일
  const s = q.trim()
  let m: RegExpExecArray | null
  if ((m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s))) out.push({ date: `${m[1]}-${pad(+m[2])}-${pad(+m[3])}`, label: '' })
  else if ((m = /^(\d{1,2})\s*[/.월]\s*(\d{1,2})\s*일?$/.exec(s))) out.push({ date: `${by}-${pad(+m[1])}-${pad(+m[2])}`, label: '' })
  else if ((m = /^(\d{1,2})\s*일$/.exec(s))) out.push({ date: `${by}-${pad(bm)}-${pad(+m[1])}`, label: '' })
  const quick: { date: string; label: string; kw: string }[] = [
    { date: iso(today), label: t('오늘'), kw: 'today 오늘' },
    { date: at(1), label: t('다음 날'), kw: 'tomorrow 내일 다음' },
    { date: at(-1), label: t('전날'), kw: 'yesterday 어제 전날' },
    { date: at(7), label: t('일주일 뒤'), kw: 'next week 다음주 일주일' },
    { date: at(-7), label: t('일주일 전'), kw: 'last week 지난주 일주일' },
  ]
  quick.forEach((x) => { if (!s || (x.label + ' ' + x.kw).includes(s)) out.push(x) })
  const seen = new Set<string>()
  return out
    .filter((x) => { const [y, mo, d] = x.date.split('-').map(Number); const ok = !isNaN(new Date(y, mo - 1, d).getTime()) && mo >= 1 && mo <= 12 && d >= 1 && d <= 31; if (!ok || seen.has(x.date)) return false; seen.add(x.date); return true })
    .slice(0, 6)
    .map((x) => ({ id: 'd-' + x.date, label: dateLabel(x.date), hint: x.label, icon: '📅', run: (e: Editor, r: Range) => e.chain().focus().deleteRange(r).insertDateLink(x.date).run() }))
}

export const SlashMenu = (view: () => MenuView | null) =>
  menuSuggestion('memoSlash', '/', (q) => slashItems().filter((i) => match(q, i)).slice(0, 12), view, {
    // 줄 처음이나 띄어쓰기 뒤에서만 (주소 속 / 는 무시)
    allowedPrefixes: [' '],
  })

export const DateMenu = (view: () => MenuView | null, base: () => string) =>
  menuSuggestion('memoDate', '[[', (q) => dateItems(q, base()), view, { allowSpaces: true, allowedPrefixes: null })
