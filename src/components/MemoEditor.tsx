import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { CharacterCount, Placeholder } from '@tiptap/extensions'
import { Markdown } from '@tiptap/markdown'
import { useStore } from '../lib/store'
import { t } from '../lib/i18n'

/**
 * 날짜별 메모 편집기 (서식이 바로 보이는 방식, 저장은 마크다운)
 * - "# " 제목, "- " 목록, "1. " 번호 목록, "[ ] " 체크, "> " 인용 을 치면 바로 바뀐다
 * - 타자를 멈추고 1초 뒤 자동 저장. 한글 조합 중에는 저장하지 않는다
 * - 앱 첫 화면이 느려지지 않도록 이 파일은 메모를 열 때만 불러온다(지연 로딩)
 */

export type MemoStatus = 'loading' | 'idle' | 'saving' | 'saved' | 'error'

const MAX = 20000

interface Props {
  date: string
  /** 휴대폰: 도구 줄을 입력할 때만 키보드 위에 띄운다 */
  mobile?: boolean
  onStatus?: (s: MemoStatus, at?: Date) => void
  onChange?: (md: string) => void
}

export default function MemoEditor({ date, mobile, onStatus, onChange }: Props) {
  const { loadMemo, saveMemo } = useStore()
  const [focused, setFocused] = useState(false)
  const saved = useRef('') // 마지막으로 저장된(불러온) 글
  const dateRef = useRef(date)
  const timer = useRef<number | undefined>(undefined)
  const ready = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] }, link: { openOnClick: false, autolink: true, defaultProtocol: 'https' } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: t('메모를 적어 보세요. # 제목, - 목록, [ ] 체크') }),
      CharacterCount.configure({ limit: MAX }),
      Markdown,
    ],
    content: '',
    editorProps: { attributes: { class: 'memo-prose', 'aria-label': t('메모') } },
    onUpdate: ({ editor }) => {
      if (!ready.current) return
      onChange?.(editor.getMarkdown())
      schedule(editor)
    },
    onFocus: () => setFocused(true),
    onBlur: ({ editor }) => { setFocused(false); flush(editor) },
  })

  // 지금 글을 저장 (바뀐 게 있을 때만)
  async function flush(ed: Editor | null, forDate = dateRef.current) {
    window.clearTimeout(timer.current)
    if (!ed || !ready.current || ed.view.composing) return
    const md = ed.getMarkdown()
    if (md === saved.current) return
    onStatus?.('saving')
    const ok = await saveMemo(forDate, md)
    if (ok) { saved.current = md; onStatus?.('saved', new Date()) } else onStatus?.('error')
  }
  function schedule(ed: Editor) {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => { if (!ed.view.composing) void flush(ed) }, 1000)
  }

  // 날짜가 바뀌면: 이전 날짜 글을 먼저 저장하고 새 날짜 글을 불러온다
  useEffect(() => {
    if (!editor) return
    let alive = true
    const prev = dateRef.current
    ;(async () => {
      if (prev !== date) await flush(editor, prev)
      dateRef.current = date
      ready.current = false
      onStatus?.('loading')
      const md = await loadMemo(date)
      if (!alive) return
      saved.current = md
      editor.commands.setContent(md, { contentType: 'markdown', emitUpdate: false })
      ready.current = true
      onChange?.(md)
      onStatus?.('idle')
    })()
    return () => { alive = false }
  }, [editor, date]) // eslint-disable-line react-hooks/exhaustive-deps

  // 창을 닫을 때(편집기가 사라질 때) 남은 글 저장
  useEffect(() => () => { void flush(editor) }, [editor]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const bar = <MemoToolbar editor={editor} onDone={mobile ? () => editor.commands.blur() : undefined} />
  return (
    <div className={'memo-editor' + (mobile ? ' mobile' : '') + (focused ? ' focused' : '')}>
      {!mobile && bar}
      <EditorContent editor={editor} className="memo-content" />
      {mobile && focused && <div className="memo-kbbar" style={{ bottom: kb }} onMouseDown={(e) => e.preventDefault()}>{bar}</div>}
    </div>
  )
}

/* ───────── 도구 줄 ───────── */
const I = (d: React.ReactNode) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{d}</svg>
)

function MemoToolbar({ editor, onDone }: { editor: Editor; onDone?: () => void }) {
  // 커서 위치의 서식이 바뀔 때마다 버튼 눌림 상태를 다시 그린다
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      h: e.isActive('heading'), b: e.isActive('bold'), i: e.isActive('italic'), st: e.isActive('strike'),
      ul: e.isActive('bulletList'), ol: e.isActive('orderedList'), task: e.isActive('taskList'),
      q: e.isActive('blockquote'), link: e.isActive('link'),
    }),
  })
  const c = () => editor.chain().focus()
  const link = () => {
    if (s.link) { c().extendMarkRange('link').unsetLink().run(); return }
    const url = window.prompt(t('링크 주소를 입력하세요'), 'https://')
    if (!url || url === 'https://') return
    c().extendMarkRange('link').setLink({ href: url }).run()
  }
  const B = ({ on, label, keys, onClick, children, cls }: { on: boolean; label: string; keys?: string; onClick: () => void; children: React.ReactNode; cls?: string }) => (
    <button type="button" className={'mt-btn' + (on ? ' on' : '') + (cls ? ' ' + cls : '')} aria-pressed={on} aria-label={label} title={keys ? `${label} ${keys}` : label}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}>{children}</button>
  )
  return (
    <div className="memo-tools" role="toolbar" aria-label={t('서식')}>
      <B on={s.h} label={t('제목')} onClick={() => c().toggleHeading({ level: 2 }).run()} cls="tx">Aa</B>
      <i className="mt-sep" />
      <B on={s.b} label={t('굵게')} keys="⌘B" onClick={() => c().toggleBold().run()} cls="tx b">B</B>
      <B on={s.i} label={t('기울임')} keys="⌘I" onClick={() => c().toggleItalic().run()} cls="tx i">I</B>
      <B on={s.st} label={t('취소선')} onClick={() => c().toggleStrike().run()} cls="tx s">S</B>
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
      <B on={s.link} label={s.link ? t('링크 지우기') : t('링크')} onClick={link}>
        {I(<><path d="M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1" /><path d="M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1" /></>)}
      </B>
      {onDone && <button type="button" className="mt-done" onMouseDown={(e) => e.preventDefault()} onClick={onDone}>{t('완료')}</button>}
    </div>
  )
}
