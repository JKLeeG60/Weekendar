import { useEffect, useState } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { comboOf, DEFAULT_SHORTCUTS, keyLabel, resolveShortcuts, SHORTCUT_GROUPS, type ShortcutId } from '../lib/shortcuts'
import { t } from '../lib/i18n'
import { Modal } from './ui'

/**
 * 단축키 목록 (? 키 · 설정 → 단축키)
 * 키를 누르고 새 키를 누르면 바뀐다. 이미 쓰는 키면 두 단축키를 서로 바꾼다.
 */
export function ShortcutsModal() {
  const { me, setShortcuts } = useStore()
  const { closeModal, showToast } = useUI()
  const keys = resolveShortcuts(me?.shortcuts)
  const [wait, setWait] = useState<ShortcutId | null>(null)

  /** 기본값과 다른 것만 저장 */
  const save = (next: Record<ShortcutId, string>) => {
    const diff: Record<string, string> = {}
    for (const k of Object.keys(next) as ShortcutId[]) if (next[k] !== DEFAULT_SHORTCUTS[k]) diff[k] = next[k]
    setShortcuts(diff)
  }

  // 새 키 기다리기: 아무 키나 누르면 그 키로 (Esc 는 취소)
  useEffect(() => {
    if (!wait) return
    const h = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') { setWait(null); return }
      const combo = comboOf(e)
      if (!combo) return
      const next = { ...keys }
      const other = (Object.keys(next) as ShortcutId[]).find((k) => k !== wait && next[k] === combo)
      if (other) {
        next[other] = next[wait] // 이미 쓰던 키면 서로 맞바꿈
        showToast(t('"{a}"와 키를 서로 바꿨어요', { a: t(labelOf(other)) }))
      }
      next[wait] = combo
      save(next)
      setWait(null)
    }
    window.addEventListener('keydown', h, true)
    return () => window.removeEventListener('keydown', h, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wait, keys])

  const changed = Object.keys(me?.shortcuts ?? {}).length > 0

  return (
    <Modal title={t('단축키')} onClose={() => (wait ? setWait(null) : closeModal())} width={560} className="keys-modal">
      <p className="keys-note">{t('키를 누른 뒤 새 키를 누르면 바뀌어요. 한글 입력 상태에서도 작동하고, 글을 쓰는 중에는 작동하지 않아요.')}</p>
      {SHORTCUT_GROUPS.map((g) => (
        <section key={g.label}>
          <h4 className="set-label">{t(g.label)}</h4>
          <div className="keys-grid">
            {g.items.map((it) => (
              <div key={it.id} className="keys-row">
                <span>{t(it.label)}</span>
                <button
                  className={'kbd-btn' + (wait === it.id ? ' wait' : '') + (keys[it.id] !== DEFAULT_SHORTCUTS[it.id] ? ' changed' : '')}
                  onClick={() => setWait(wait === it.id ? null : it.id)}
                  aria-label={t('{name} 단축키 바꾸기', { name: t(it.label) })}
                >
                  {wait === it.id ? t('새 키를 누르세요') : <kbd>{keyLabel(keys[it.id])}</kbd>}
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
      <div className="keys-foot">
        <button className="btn ghost" disabled={!changed} onClick={() => { setShortcuts({}); showToast(t('기본 단축키로 되돌렸어요')) }}>{t('기본값으로')}</button>
      </div>
    </Modal>
  )
}

const labelOf = (id: ShortcutId) => SHORTCUT_GROUPS.flatMap((g) => g.items).find((x) => x.id === id)?.label ?? id
