import { useRef } from 'react'
import { t } from '../lib/i18n'

/**
 * 끌어서 칸 크기를 바꾸는 손잡이 (데스크탑)
 * - dir 'col': 좌우로 끄는 세로선, 'row': 위아래로 끄는 가로선
 * - onMove 에는 화면 좌표(x 또는 y)를 넘기고, 받는 쪽이 비율로 바꿔 쓴다
 * - 더블클릭하면 기본 크기, 키보드 화살표로도 조절
 */
interface Props {
  dir: 'col' | 'row'
  label: string
  value: number
  min: number
  max: number
  onMove: (pos: number, done: boolean) => void
  onStep: (delta: number) => void
  onReset: () => void
}

export function Resizer({ dir, label, value, min, max, onMove, onStep, onReset }: Props) {
  const drag = useRef<{ start: number; moved: boolean } | null>(null)
  const lastUp = useRef(0)
  const pos = (e: React.PointerEvent) => (dir === 'col' ? e.clientX : e.clientY)
  return (
    <div
      className={'rz rz-' + dir}
      role="separator"
      aria-orientation={dir === 'col' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={dir === 'col' ? t('끌어서 폭 조절 · 더블클릭하면 기본 크기') : t('끌어서 높이 조절 · 더블클릭하면 반반')}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        drag.current = { start: pos(e), moved: false }
        e.currentTarget.setPointerCapture(e.pointerId)
        document.body.classList.add('rz-dragging', 'rz-dragging-' + dir)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        // 살짝 누른 것만으로는 크기가 바뀌지 않게, 3px 넘게 움직였을 때부터 따라간다
        if (!d.moved && Math.abs(pos(e) - d.start) < 3) return
        d.moved = true
        onMove(pos(e), false)
      }}
      onPointerUp={(e) => {
        const d = drag.current
        if (!d) return
        drag.current = null
        document.body.classList.remove('rz-dragging', 'rz-dragging-' + dir)
        if (d.moved) { onMove(pos(e), true); return }
        // 끌지 않고 두 번 빠르게 누르면 기본 크기 (손잡이를 누르는 동안 브라우저 더블클릭이 안 생길 수 있어 직접 잰다)
        const now = Date.now()
        if (now - lastUp.current < 400) { lastUp.current = 0; onReset() } else lastUp.current = now
      }}
      onPointerCancel={() => { drag.current = null; document.body.classList.remove('rz-dragging', 'rz-dragging-' + dir) }}
      onClick={(e) => { if (e.detail === 2) onReset() }}
      onKeyDown={(e) => {
        const back = dir === 'col' ? 'ArrowLeft' : 'ArrowUp'
        const fwd = dir === 'col' ? 'ArrowRight' : 'ArrowDown'
        if (e.key === back) { e.preventDefault(); onStep(-2) }
        else if (e.key === fwd) { e.preventDefault(); onStep(2) }
        else if (e.key === 'Enter') { e.preventDefault(); onReset() }
      }}
    >
      <i aria-hidden />
    </div>
  )
}
