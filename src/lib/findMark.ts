/**
 * 검색 결과로 이동한 뒤 "여기예요" 표시
 * - flashTarget: 화면이 바뀐 뒤 요소가 생길 때까지 잠깐 기다렸다가, 가운데로 스크롤하고 깜빡인다
 * - highlightText: 메모 편집기 안에서 찾은 글자를 노랗게 칠한다 (CSS Custom Highlight, 글 내용은 건드리지 않음)
 */

/** selector 에 맞는 요소들을 찾을 때까지(최대 약 2.5초) 기다렸다가 깜빡인다. 못 찾으면 false */
export function flashTarget(selector: string): Promise<boolean> {
  return new Promise((done) => {
    let tries = 0
    const tick = () => {
      // 보이는 것만 (숨은 칸·접힌 칸 제외)
      const els = [...document.querySelectorAll<HTMLElement>(selector)].filter((x) => x.offsetParent !== null)
      if (!els.length) {
        if (++tries > 25) { done(false); return }
        window.setTimeout(tick, 100)
        return
      }
      els[0].scrollIntoView({ block: 'center', behavior: 'smooth' })
      for (const el of els) {
        el.classList.remove('find-flash')
        void el.offsetWidth // 애니메이션을 처음부터 다시
        el.classList.add('find-flash')
        window.setTimeout(() => el.classList.remove('find-flash'), 2200)
      }
      done(true)
    }
    tick()
  })
}

type HL = { set: (k: string, v: unknown) => void; delete: (k: string) => void }
type HLCtor = new (...r: Range[]) => unknown

/** root(메모 편집기)가 생길 때까지 기다렸다가 q 와 같은 글자를 모두 칠하고 첫 번째로 스크롤 (3초 뒤 지움) */
export function highlightText(rootSelector: string, q: string) {
  const k = q.trim().toLowerCase()
  if (!k) return
  let tries = 0
  const tick = () => {
    const root = [...document.querySelectorAll<HTMLElement>(rootSelector)].find((x) => x.offsetParent !== null && (x.textContent ?? '').toLowerCase().includes(k))
    if (!root) {
      if (++tries > 30) return
      window.setTimeout(tick, 100)
      return
    }
    const ranges: Range[] = []
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const text = (n.textContent ?? '').toLowerCase()
      for (let i = text.indexOf(k); i >= 0; i = text.indexOf(k, i + k.length)) {
        const r = document.createRange()
        r.setStart(n, i)
        r.setEnd(n, i + k.length)
        ranges.push(r)
      }
    }
    if (!ranges.length) return
    ;(ranges[0].startContainer.parentElement as HTMLElement | null)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const hl = (CSS as unknown as { highlights?: HL }).highlights
    const Ctor = (window as unknown as { Highlight?: HLCtor }).Highlight
    if (!hl || !Ctor) return
    hl.set('wk-find', new Ctor(...ranges))
    window.setTimeout(() => hl.delete('wk-find'), 3000)
  }
  tick()
}
