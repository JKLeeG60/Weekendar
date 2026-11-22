/**
 * 단축키 (PC 전용)
 * - 키는 글자가 아니라 "키보드 자리"(KeyboardEvent.code)로 기억한다 → 한글 입력 상태에서도 작동
 * - Shift 와 함께 누르는 키는 "Shift+Slash"(= ?) 처럼 적는다
 * - 사람마다 바꿀 수 있고(설정 → 단축키), 계정에 저장한다 (profiles.shortcuts)
 */
export type ShortcutId =
  | 'quickAdd' | 'newEvent' | 'newTodo'
  | 'prevWeek' | 'nextWeek' | 'today' | 'prevDay' | 'nextDay'
  | 'chat' | 'month' | 'notices' | 'panel' | 'settings' | 'help' | 'search'

export const SHORTCUT_GROUPS: { label: string; items: { id: ShortcutId; label: string }[] }[] = [
  { label: '만들기', items: [
    { id: 'quickAdd', label: '빠른 입력 (일정·할 일)' },
    { id: 'newEvent', label: '새 일정 창' },
    { id: 'newTodo', label: '새 할 일' },
  ] },
  { label: '이동', items: [
    { id: 'prevWeek', label: '이전 주' },
    { id: 'nextWeek', label: '다음 주' },
    { id: 'today', label: '오늘' },
    { id: 'prevDay', label: '전날' },
    { id: 'nextDay', label: '다음날' },
  ] },
  { label: '열기', items: [
    { id: 'search', label: '검색' },
    { id: 'chat', label: '대화' },
    { id: 'month', label: '월간 일정' },
    { id: 'notices', label: '알림' },
    { id: 'panel', label: '패널 접기 · 펴기' },
    { id: 'settings', label: '설정' },
    { id: 'help', label: '단축키 보기' },
  ] },
]

export const DEFAULT_SHORTCUTS: Record<ShortcutId, string> = {
  quickAdd: 'Space', newEvent: 'KeyN', newTodo: 'KeyD',
  prevWeek: 'ArrowLeft', nextWeek: 'ArrowRight', today: 'KeyT', prevDay: 'BracketLeft', nextDay: 'BracketRight',
  chat: 'KeyC', month: 'KeyM', notices: 'KeyA', panel: 'KeyP', settings: 'Comma', help: 'Shift+Slash', search: 'Slash',
}

/** 저장된 내 단축키 + 기본값 */
export function resolveShortcuts(saved?: Partial<Record<string, string>> | null): Record<ShortcutId, string> {
  const out = { ...DEFAULT_SHORTCUTS }
  for (const k of Object.keys(out) as ShortcutId[]) if (saved?.[k]) out[k] = saved[k]!
  return out
}

/** 눌린 키 → 저장 형식 ("KeyN", "Shift+Slash"). Ctrl·⌘·Alt 와 함께면 단축키로 쓰지 않음(브라우저 기능과 겹침) */
export function comboOf(e: KeyboardEvent | React.KeyboardEvent): string | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  const code = e.code
  if (!code || /^(Shift|Control|Alt|Meta|CapsLock|Tab|Escape|Enter|Backspace|Fn)/.test(code)) return null
  return (e.shiftKey ? 'Shift+' : '') + code
}

/** 저장 형식 → 화면에 보이는 키 이름 */
export function keyLabel(combo: string): string {
  const shift = combo.startsWith('Shift+')
  const code = shift ? combo.slice(6) : combo
  const NAMES: Record<string, string> = {
    Space: 'Space', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    BracketLeft: '[', BracketRight: ']', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'",
    Backquote: '`', Minus: '-', Equal: '=', Backslash: '\\',
  }
  const SHIFTED: Record<string, string> = { Slash: '?', Comma: '<', Period: '>', Digit1: '!', Semicolon: ':', Quote: '"', Minus: '_', Equal: '+' }
  if (shift && SHIFTED[code]) return SHIFTED[code]
  const base = NAMES[code] ?? (code.startsWith('Key') ? code.slice(3) : code.startsWith('Digit') ? code.slice(5) : code.replace(/^Numpad/, 'Num '))
  return (shift ? '⇧ ' : '') + base
}
