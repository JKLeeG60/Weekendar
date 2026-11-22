import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { CharacterCount, Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import { TableKit } from '@tiptap/extension-table'
import Highlight from '@tiptap/extension-highlight'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight } from 'lowlight'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import xml from 'highlight.js/lib/languages/xml'
import java from 'highlight.js/lib/languages/java'
import yaml from 'highlight.js/lib/languages/yaml'
import { useStore } from '../lib/store'
import { t } from '../lib/i18n'
import { Callout, DateLink, DateMenu, FoldHeadings, SlashMenu, Tags, dateLabel, type MenuItem, type MenuView } from './memoExtensions'

/**
 * 날짜별 메모 편집기 (서식이 바로 보이는 방식, 저장은 옵시디언과 같은 마크다운)
 * - "# " 제목, "- " 목록, "[ ] " 체크, "> " 인용, "```" 코드, "==형광펜==" 을 치면 바로 바뀐다
 * - "/" 명령 메뉴, "[[" 날짜 링크, "#태그", 표, 콜아웃, 제목 접기, 원문(마크다운) 보기
 * - 타자를 멈추고 1초 뒤 자동 저장. 한글 조합 중에는 저장하지 않는다
 * - 앱 첫 화면이 느려지지 않도록 이 파일은 메모를 열 때만 불러온다(지연 로딩)
 */

export type MemoStatus = 'loading' | 'idle' | 'saving' | 'saved' | 'error'

const MAX = 20000
// 코드 색 구분: 자주 쓰는 언어만 (전부 넣으면 편집기 용량이 크게 는다)
const lowlight = createLowlight({ javascript, typescript, python, sql, json, bash, css, xml, java, yaml })
lowlight.registerAlias({ javascript: ['js', 'jsx'], typescript: ['ts', 'tsx'], python: ['py'], bash: ['sh', 'shell', 'zsh'], xml: ['html'], yaml: ['yml'] })

interface Props {
  date: string
  /** 휴대폰: 도구 줄을 입력할 때만 키보드 위에 띄운다 */
  mobile?: boolean
  onStatus?: (s: MemoStatus, at?: Date) => void
  onChange?: (md: string) => void
  /** 날짜 링크나 '이 날을 언급한 메모'를 누르면 그 날로 */
  onOpenDate?: (date: string) => void
  /** #태그를 누르면 같은 태그 메모 찾기 */
  onTag?: (tag: string) => void
}

export default function MemoEditor({ date, mobile, onStatus, onChange, onOpenDate, onTag }: Props) {
  const { loadMemo, saveMemo, findMemos } = useStore()
  const [focused, setFocused] = useState(false)
  const [source, setSource] = useState(false) // 원문(마크다운 글자) 보기
  const [src, setSrc] = useState('')
  const saved = useRef('') // 마지막으로 저장된(불러온) 글
  const dateRef = useRef(date)
  const timer = useRef<number | undefined>(undefined)
  const ready = useRef(false)
  const sourceRef = useRef(false)
  sourceRef.current = source
  const srcRef = useRef('')
  srcRef.current = src
  // 플러그인 안에서 최신 함수를 부르도록 (편집기는 한 번만 만든다)
  const cbRef = useRef({ onOpenDate, onTag })
  cbRef.current = { onOpenDate, onTag }

  // / 와 [[ 팝업 메뉴 (편집기 플러그인이 여기로 열고 닫는다)
  const [menu, setMenu] = useState<{ items: MenuItem[]; rect: DOMRect | null; pick: (i: MenuItem) => void; sel: number } | null>(null)
  const menuRef = useRef(menu)
  menuRef.current = menu
  const view = useMemo<MenuView>(() => ({
    open: (items, rect, pick) => setMenu({ items, rect, pick, sel: 0 }),
    update: (items, rect, pick) => setMenu((m) => ({ items, rect, pick, sel: Math.min(m?.sel ?? 0, Math.max(0, items.length - 1)) })),
    close: () => setMenu(null),
    key: (e) => {
      const m = menuRef.current
      if (!m || !m.items.length) return false
      if (e.key === 'ArrowDown') { setMenu({ ...m, sel: (m.sel + 1) % m.items.length }); return true }
      if (e.key === 'ArrowUp') { setMenu({ ...m, sel: (m.sel - 1 + m.items.length) % m.items.length }); return true }
      if (e.key === 'Enter' || e.key === 'Tab') { m.pick(m.items[m.sel]); return true }
      return false
    },
  }), [])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, codeBlock: false, link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
      CodeBlockLowlight.configure({ lowlight, defaultLanguage: null }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      Highlight,
      Callout,
      DateLink,
      Tags,
      FoldHeadings,
      SlashMenu(() => view),
      DateMenu(() => view, () => dateRef.current),
      Placeholder.configure({ placeholder: t('메모를 적어 보세요. / 를 치면 메뉴, [[ 는 날짜 링크, #태그') }),
      CharacterCount.configure({ limit: MAX }),
      Markdown,
    ],
    content: '',
    editorProps: {
      attributes: { class: 'memo-prose', 'aria-label': t('메모') },
      // 날짜 링크 누르기
      handleClickOn: (_v, _pos, node) => {
        if (node.type.name === 'dateLink' && node.attrs.date) { cbRef.current.onOpenDate?.(node.attrs.date); return true }
        return false
      },
      handleDOMEvents: {
        click: (_v, e) => {
          const el = e.target as HTMLElement
          // #태그 누르기 → 같은 태그 메모 찾기
          const tag = el.closest('.memo-tag') as HTMLElement | null
          if (tag?.dataset.tag && cbRef.current.onTag) { cbRef.current.onTag(tag.dataset.tag); return true }
          // 링크는 ⌘/Ctrl + 클릭으로 새 창
          const a = el.closest('a') as HTMLAnchorElement | null
          if (a && (e.metaKey || e.ctrlKey)) { window.open(a.href, '_blank', 'noopener'); return true }
          return false
        },
      },
    },
    onUpdate: ({ editor }) => {
      if (!ready.current) return
      onChange?.(editor.getMarkdown())
      schedule()
    },
    onFocus: () => setFocused(true),
    onBlur: () => { setFocused(false); void flush() },
  })

  // 지금 글(서식 화면 또는 원문)을 마크다운으로
  const current = () => (sourceRef.current ? srcRef.current : editor?.getMarkdown() ?? '')

  // 지금 글을 저장 (바뀐 게 있을 때만)
  async function flush(forDate = dateRef.current) {
    window.clearTimeout(timer.current)
    if (!editor || !ready.current || (!sourceRef.current && editor.view.composing)) return
    const md = current()
    if (md === saved.current) return
    onStatus?.('saving')
    const ok = await saveMemo(forDate, md)
    if (ok) { saved.current = md; onStatus?.('saved', new Date()); setBackTick((n) => n + 1) } else onStatus?.('error')
  }
  function schedule() {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { if (sourceRef.current || !editor?.view.composing) void flush() }, 1000)
  }

  // 날짜가 바뀌면: 이전 날짜 글을 먼저 저장하고 새 날짜 글을 불러온다
  useEffect(() => {
    if (!editor) return
    let alive = true
    const prev = dateRef.current
    ;(async () => {
      if (prev !== date) await flush(prev)
      dateRef.current = date
      ready.current = false
      onStatus?.('loading')
      const md = await loadMemo(date)
      if (!alive) return
      saved.current = md
      editor.commands.setContent(md, { contentType: 'markdown', emitUpdate: false })
      setSrc(md)
      ready.current = true
      onChange?.(md)
      onStatus?.('idle')
    })()
    return () => { alive = false }
  }, [editor, date]) // eslint-disable-line react-hooks/exhaustive-deps

  // 창을 닫을 때(편집기가 사라질 때) 남은 글 저장
  useEffect(() => () => { void flush() }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

  // 원문 보기 전환: 들어갈 때는 지금 글을, 나올 때는 고친 원문을 서식 화면에 다시 넣는다
  const toggleSource = () => {
    if (!editor) return
    if (!source) { setSrc(editor.getMarkdown()); setSource(true) }
    else {
      editor.commands.setContent(src, { contentType: 'markdown', emitUpdate: false })
      setSource(false)
      onChange?.(src)
      void flush()
    }
  }

  // 이 날을 언급한 다른 날 메모 (되돌아오는 링크)
  const [backTick, setBackTick] = useState(0)
  const [backs, setBacks] = useState<{ date: string; line: string }[]>([])
  useEffect(() => {
    let alive = true
    findMemos(`[[${date}]]`).then((rows) => {
      if (!alive) return
      setBacks(rows.filter((r) => r.date !== date).map((r) => {
        const line = r.body.split('\n').find((l) => l.includes(`[[${date}]]`)) ?? ''
        return {
          date: r.date,
          line: line
            .replace(/^\s*(?:[-*+]\s(?:\[[ xX]\]\s)?|\d+\.\s|>\s?|#{1,6}\s)/, '')
            .replace(/\[\[(\d{4}-\d{2}-\d{2})[^\]]*\]\]/g, (_, d) => dateLabel(d))
            .replace(/[*_~`=]/g, '')
            .trim(),
        }
      }))
    })
    return () => { alive = false }
  }, [date, backTick, findMemos])

  // 휴대폰: 키보드가 올라온 만큼 도구 줄을 위로 (화면에 보이는 영역 기준)
  const [kb, setKb] = useState(0)
  useEffect(() => {
    if (!mobile || !focused) return
    const vv = window.visualViewport
    if (!vv) return
    const fit = () => setKb(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))
    fit()
    vv.addEventListener('resize', fit)
    vv.addEventListener('scroll', fit)
    return () => { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit) }
  }, [mobile, focused])

  if (!editor) return null
  const bar = <MemoToolbar editor={editor} source={source} onSource={toggleSource} onDone={mobile ? () => editor.commands.blur() : undefined} />
  return (
    <div className={'memo-editor' + (mobile ? ' mobile' : '') + (focused ? ' focused' : '')}>
      {(!mobile || source) && bar}
      <div className="memo-content">
        {source ? (
          <textarea
            className="memo-source"
            value={src}
            maxLength={MAX}
            spellCheck={false}
            aria-label={t('마크다운 원문')}
            onChange={(e) => { setSrc(e.target.value); onChange?.(e.target.value); schedule() }}
            onBlur={() => void flush()}
          />
        ) : (
          <EditorContent editor={editor} />
        )}
        {backs.length > 0 && (
          <div className="memo-backs">
            <div className="mb-title">{t('이 날을 언급한 메모 {n}', { n: backs.length })}</div>
            {backs.map((b) => (
              <button key={b.date} className="mb-item" onClick={() => onOpenDate?.(b.date)}>
                <b>{dateLabel(b.date)}</b>
                <span>{b.line}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {mobile && focused && !source && <div className="memo-kbbar" style={{ bottom: kb }} onMouseDown={(e) => e.preventDefault()}>{bar}</div>}
      {menu && menu.items.length > 0 && <MemoMenu {...menu} onHover={(i) => setMenu({ ...menu, sel: i })} />}
    </div>
  )
}

/* ───────── / 와 [[ 팝업 목록 ───────── */
function MemoMenu({ items, rect, pick, sel, onHover }: { items: MenuItem[]; rect: DOMRect | null; pick: (i: MenuItem) => void; sel: number; onHover: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { ref.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }) }, [sel])
  if (!rect) return null
  // 아래 공간이 모자라면 위로 띄운다
  const below = window.innerHeight - rect.bottom > 300
  const style: React.CSSProperties = {
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 270)),
    ...(below ? { top: rect.bottom + 6 } : { bottom: window.innerHeight - rect.top + 6 }),
  }
  return (
    <div className="memo-menu" style={style} ref={ref} role="listbox" onMouseDown={(e) => e.preventDefault()}>
      {items.map((it, i) => (
        <button key={it.id} role="option" aria-selected={i === sel} className={i === sel ? 'on' : ''} onMouseEnter={() => onHover(i)} onClick={() => pick(it)}>
          <span className="mm-ic">{it.icon}</span>
          <span className="mm-label">{it.label}</span>
          {it.hint && <span className="mm-hint">{it.hint}</span>}
        </button>
      ))}
    </div>
  )
}

/* ───────── 도구 줄 ───────── */
const I = (d: React.ReactNode) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
)

function MemoToolbar({ editor, source, onSource, onDone }: { editor: Editor; source: boolean; onSource: () => void; onDone?: () => void }) {
  // 커서 위치의 서식이 바뀔 때마다 버튼 눌림 상태를 다시 그린다
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h: e.isActive('heading'), b: e.isActive('bold'), i: e.isActive('italic'), st: e.isActive('strike'), hl: e.isActive('highlight'),
      ul: e.isActive('bulletList'), ol: e.isActive('orderedList'), task: e.isActive('taskList'),
      q: e.isActive('blockquote'), code: e.isActive('codeBlock'), link: e.isActive('link'), table: e.isActive('table'),
    }),
  })
  const c = () => editor.chain().focus()
  const link = () => {
    if (s.link) { c().extendMarkRange('link').unsetLink().run(); return }
    const url = window.prompt(t('링크 주소를 입력하세요'), 'https://')
    if (!url || url === 'https://') return
    c().extendMarkRange('link').setLink({ href: url }).run()
  }
  const o = source // 원문 보기 중에는 서식 버튼을 잠근다
  const B = ({ on, label, keys, onClick, children, cls }: { on: boolean; label: string; keys?: string; onClick: () => void; children: React.ReactNode; cls?: string }) => (
    <button type="button" className={'mt-btn' + (on && !o ? ' on' : '') + (cls ? ' ' + cls : '')} aria-pressed={on} aria-label={label} title={keys ? `${label} ${keys}` : label}
      disabled={o} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{children}</button>
  )
  const chip = (label: string, run: () => void, danger?: boolean) => (
    <button type="button" className={'mt-chip' + (danger ? ' danger' : '')} onMouseDown={(e) => e.preventDefault()} onClick={run}>{label}</button>
  )
  return (
    <div className="memo-tools" role="toolbar" aria-label={t('서식')}>
      <B on={s.h} label={t('제목')} onClick={() => c().toggleHeading({ level: 2 }).run()} cls="tx">Aa</B>
      <i className="mt-sep" />
      <B on={s.b} label={t('굵게')} keys="⌘B" onClick={() => c().toggleBold().run()} cls="tx b">B</B>
      <B on={s.i} label={t('기울임')} keys="⌘I" onClick={() => c().toggleItalic().run()} cls="tx i">I</B>
      <B on={s.st} label={t('취소선')} onClick={() => c().toggleStrike().run()} cls="tx s">S</B>
      <B on={s.hl} label={t('형광펜')} keys="==" onClick={() => c().toggleHighlight().run()} cls="hl">
        {I(<><path d="M14.5 4.5l5 5L11 18H6v-5z" /><path d="M12 7l5 5" /><path className="hl-line" d="M4 21h16" /></>)}
      </B>
      <i className="mt-sep" />
      <B on={s.ul} label={t('목록')} onClick={() => c().toggleBulletList().run()}>
        {I(<><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>)}
      </B>
      <B on={s.ol} label={t('번호 목록')} onClick={() => c().toggleOrderedList().run()}>
        {I(<><path d="M10 6h10M10 12h10M10 18h10" /><path d="M4 5h1.5v4M4 9h3" /><path d="M4 15.5a1.5 1.5 0 0 1 3 0c0 1.2-3 2-3 3.5h3" /></>)}
      </B>
      <B on={s.task} label={t('체크리스트')} onClick={() => c().toggleTaskList().run()}>
        {I(<><rect x="3.5" y="4.5" width="6" height="6" rx="1.5" /><path d="M5 7.5l1.2 1.2L8.3 6.4" /><path d="M13 7.5h7.5" /><rect x="3.5" y="13.5" width="6" height="6" rx="1.5" /><path d="M13 16.5h7.5" /></>)}
      </B>
      <i className="mt-sep" />
      <B on={s.q} label={t('인용')} onClick={() => c().toggleBlockquote().run()}>
        {I(<><path d="M5 18c1.8 0 3-1.2 3-3V9H4v5h3" /><path d="M14 18c1.8 0 3-1.2 3-3V9h-4v5h3" /></>)}
      </B>
      <B on={s.code} label={t('코드 블록')} keys="```" onClick={() => c().toggleCodeBlock().run()}>
        {I(<path d="M8 7l-5 5 5 5M16 7l5 5-5 5" />)}
      </B>
      <B on={s.table} label={t('표')} onClick={() => { if (!s.table) c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() }}>
        {I(<><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M3.5 10h17M3.5 15h17M9.5 4.5v15" /></>)}
      </B>
      <B on={s.link} label={s.link ? t('링크 지우기') : t('링크')} onClick={link}>
        {I(<><path d="M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1" /><path d="M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1" /></>)}
      </B>
      {/* 표 안에 있을 때만: 행·열 추가/삭제 */}
      {s.table && !o && (
        <span className="mt-table">
          <i className="mt-sep" />
          {chip(t('+ 행'), () => c().addRowAfter().run())}
          {chip(t('+ 열'), () => c().addColumnAfter().run())}
          {chip(t('행 삭제'), () => c().deleteRow().run())}
          {chip(t('열 삭제'), () => c().deleteColumn().run())}
          {chip(t('표 삭제'), () => c().deleteTable().run(), true)}
        </span>
      )}
      <i className="mt-sep" />
      <button type="button" className={'mt-src' + (source ? ' on' : '')} aria-pressed={source} title={t('마크다운 원문 보기')} onMouseDown={(e) => e.preventDefault()} onClick={onSource}>
        {source ? t('서식 보기') : t('원문')}
      </button>
      {onDone && !source && <button type="button" className="mt-done" onMouseDown={(e) => e.preventDefault()} onClick={onDone}>{t('완료')}</button>}
    </div>
  )
}
