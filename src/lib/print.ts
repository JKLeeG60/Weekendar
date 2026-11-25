/**
 * 인쇄·공유: 주간 팀 일정 / 월간 일정을 A4 가로 한 장으로 만든다.
 * - 인쇄: 숨은 창(iframe)에 그 한 장만 넣고 브라우저 인쇄 창을 연다 (프린터 또는 "PDF로 저장")
 * - 공유: 같은 한 장을 그림(PNG)이나 PDF 파일로 만들어 휴대폰 공유 창을 띄우거나 저장한다
 *   (그림·PDF 만드는 도구는 공유를 누를 때만 불러온다)
 */
import { CATEGORY_LABEL, type Category, type Occurrence } from './types'
import { isMultiDay } from './events'
import { t } from './i18n'
import { dowHeads } from './date'

/** 종류별 색 (styles.css 의 --c-* 와 같은 값) */
const COLOR: Record<Category, string> = {
  meeting: '#007aff', work: '#5e5ce6', personal: '#8e8e93', leave: '#ff3b30',
  halfday: '#ff9500', outside: '#28a745', trip: '#af52de', training: '#30b0c7',
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** 출력물 오른쪽 아래 작은 로고 (앱 아이콘과 같은 모양) */
const LOGO = '<svg viewBox="0 0 1024 1024"><rect width="1024" height="1024" rx="230" fill="#fff"/><polygon points="140.4,263.9 481.4,263.9 481.4,316.3 257.0,760.1 186.8,760.1 410.2,320.2 140.4,320.2" fill="#007AFF"/><rect x="580.2" y="263.9" width="303.4" height="43.5" rx="21.7" fill="#A3A9B9"/><rect x="580.2" y="489.3" width="303.4" height="43.5" rx="21.7" fill="#A3A9B9"/><rect x="580.2" y="715.6" width="303.4" height="43.5" rx="21.7" fill="#A3A9B9"/></svg>'

/** 한 장 공통 모양 (A4 가로 297×210mm). 모든 이름은 .wp- 로 시작해 앱 화면과 섞이지 않게 */
const CSS = `
.wp-page { width: 297mm; height: 210mm; padding: 11mm 12mm 9mm; box-sizing: border-box; display: flex; flex-direction: column; background: #fff; color: #1d1d1f;
  font-family: 'Pretendard Variable', Pretendard, -apple-system, 'Apple SD Gothic Neo', sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.wp-page * { box-sizing: border-box; }
.wp-head { display: flex; align-items: flex-end; justify-content: space-between; margin-bottom: 4.5mm; }
.wp-h1 { margin: 0; font-size: 19pt; font-weight: 800; letter-spacing: -0.03em; }
.wp-h1 small { font-size: 11pt; color: #6e6e73; font-weight: 650; margin-left: 2mm; letter-spacing: 0; }
.wp-sub { margin-top: 1.2mm; font-size: 10.5pt; color: #6e6e73; font-weight: 600; }
.wp-meta { text-align: right; font-size: 8pt; color: #8e8e93; line-height: 1.5; }
.wp-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 3mm; font-size: 7.5pt; color: #8e8e93; }
.wp-lg { display: flex; gap: 3.5mm; }
.wp-lg span { display: flex; align-items: center; gap: 1mm; }
.wp-lg i { width: 2.2mm; height: 2.2mm; border-radius: 50%; display: inline-block; }
.wp-brand { display: flex; align-items: center; gap: 1.5mm; font-weight: 700; color: #6e6e73; }
.wp-brand svg { width: 4.5mm; height: 4.5mm; border-radius: 1mm; box-shadow: 0 0 0 0.2mm #d2d2d7; }
/* 주간 팀 표 */
.wp-body { flex: 1; min-height: 0; }
.wp-tbl { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; border: 0.3mm solid #d2d2d7; border-radius: 2.5mm; overflow: hidden; }
.wp-tbl thead th { background: #f5f5f7; font-size: 9pt; font-weight: 700; padding: 2mm; border-bottom: 0.3mm solid #d2d2d7; border-left: 0.3mm solid #e5e5ea; text-align: left; }
.wp-tbl thead th:first-child { border-left: 0; color: #8e8e93; font-weight: 600; width: 27mm; }
.wp-tbl thead th small { display: block; font-size: 6.5pt; font-weight: 600; }
.wp-hol { color: #ff3b30; }
.wp-tbl tbody th { text-align: left; vertical-align: top; padding: 2mm; background: #fbfbfd; border-top: 0.3mm solid #e5e5ea; }
.wp-nm { font-size: 10pt; font-weight: 700; }
.wp-sb { font-size: 7.5pt; color: #007aff; font-weight: 600; margin-top: 0.6mm; }
.wp-tbl td { vertical-align: top; padding: 1.5mm; border-top: 0.3mm solid #e5e5ea; border-left: 0.3mm solid #e5e5ea; }
.wp-tbl tbody tr:first-child th, .wp-tbl tbody tr:first-child td { border-top: 0; }
.wp-tbl td.wp-hol { background: #fff7f6; }
.wp-ev { border-left: 0.9mm solid var(--c); background: color-mix(in srgb, var(--c) 7%, #fff); border-radius: 0 1.2mm 1.2mm 0; padding: 0.7mm 1.4mm 0.8mm 1.6mm; margin-bottom: 0.9mm; break-inside: avoid; }
.wp-l1 { display: flex; align-items: center; gap: 1mm; font-size: 7pt; color: #3a3a3c; font-weight: 700; }
.wp-cat { margin-left: auto; color: var(--c); font-size: 6.5pt; }
.wp-t { font-size: 8.6pt; font-weight: 650; margin-top: 0.3mm; line-height: 1.25; word-break: keep-all; overflow-wrap: anywhere; }
.wp-p { font-size: 7pt; color: #6e6e73; margin-top: 0.2mm; }
/* 월간 달력 */
.wp-cal { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(7, 1fr); border: 0.3mm solid #d2d2d7; border-radius: 2.5mm; overflow: hidden; }
.wp-dh { background: #f5f5f7; font-size: 8.5pt; font-weight: 700; padding: 1.6mm 2mm; border-bottom: 0.3mm solid #d2d2d7; }
.wp-dh + .wp-dh { border-left: 0.3mm solid #e5e5ea; }
.wp-sun { color: #ff3b30; } .wp-sat { color: #007aff; }
.wp-cl { border-top: 0.3mm solid #e5e5ea; border-left: 0.3mm solid #e5e5ea; padding: 1.2mm 1.4mm; overflow: hidden; min-height: 0; }
.wp-cl.wp-c0 { border-left: 0; }
.wp-cl.wp-r0 { border-top: 0; }
.wp-cl.wp-out { background: #fafafa; }
.wp-cl.wp-out > * { opacity: 0.35; }
.wp-n { font-size: 8.5pt; font-weight: 700; margin-bottom: 0.8mm; display: flex; gap: 1mm; align-items: baseline; }
.wp-n small { font-size: 6.5pt; font-weight: 600; color: #ff3b30; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.wp-it { display: flex; align-items: center; gap: 0.9mm; font-size: 7pt; line-height: 1.35; white-space: nowrap; overflow: hidden; }
.wp-it i { flex: none; width: 1.6mm; height: 1.6mm; border-radius: 50%; background: var(--c); }
.wp-it b { flex: none; font-weight: 650; color: #3a3a3c; }
.wp-it span { overflow: hidden; text-overflow: ellipsis; }
.wp-more { font-size: 6.5pt; color: #8e8e93; }
`

export interface PrintCommon {
  /** 출력한 날짜·사람 (오른쪽 위) */
  printedAt: string
  printedBy: string
}
export interface WeeklyPrint extends PrintCommon {
  title: string
  range: string
  days: { label: string; holiday?: string }[]
  rows: { name: string; sub: string; cells: Occurrence[][] }[]
}
export interface MonthlyPrint extends PrintCommon {
  title: string
  sub: string
  month: string
  /** 7칸씩 (일~토) */
  cells: { day: number; out: boolean; holiday?: string; items: Occurrence[] }[]
}

/** "09:30–10:30" / 여러 날·종일 일정은 "종일" */
const timeOf = (o: Occurrence) => (isMultiDay(o) ? t('종일') : `${o.start}–${o.end}`)

function legend(cats: Set<Category>) {
  return [...cats].map((c) => `<span><i style="background:${COLOR[c]}"></i>${esc(t(CATEGORY_LABEL[c]))}</span>`).join('')
}

function head(title: string, sub: string, p: PrintCommon) {
  return `<div class="wp-head"><div><h1 class="wp-h1">${title}</h1><div class="wp-sub">${esc(sub)}</div></div>
<div class="wp-meta">${esc(t('출력 {at}', { at: p.printedAt }))}<br>${esc(t('출력한 사람 {name}', { name: p.printedBy }))}</div></div>`
}
const foot = (cats: Set<Category>) => `<div class="wp-foot"><div class="wp-lg">${legend(cats)}</div><div class="wp-brand">${LOGO}Weekendar</div></div>`

/** 주간 팀 일정 한 장 */
export function weeklyHtml(w: WeeklyPrint): string {
  const cats = new Set<Category>()
  const ev = (o: Occurrence) => {
    cats.add(o.category)
    return `<div class="wp-ev" style="--c:${COLOR[o.category]}"><div class="wp-l1"><span>${esc(timeOf(o))}</span><span class="wp-cat">${esc(t(CATEGORY_LABEL[o.category]))}</span></div><div class="wp-t">${esc(o.title)}</div>${o.place ? `<div class="wp-p">${esc(o.place)}</div>` : ''}</div>`
  }
  const thead = `<tr><th>${esc(t('구성원'))}</th>${w.days.map((d) => `<th class="${d.holiday ? 'wp-hol' : ''}">${esc(d.label)}${d.holiday ? `<small>${esc(d.holiday)}</small>` : ''}</th>`).join('')}</tr>`
  const tbody = w.rows.map((r) => `<tr><th><div class="wp-nm">${esc(r.name)}</div><div class="wp-sb">${esc(r.sub)}</div></th>${r.cells.map((c, i) => `<td class="${w.days[i].holiday ? 'wp-hol' : ''}">${c.map(ev).join('')}</td>`).join('')}</tr>`).join('')
  return `<div class="wp-page">${head(esc(w.title), w.range, w)}<div class="wp-body"><table class="wp-tbl"><thead>${thead}</thead><tbody>${tbody}</tbody></table></div>${foot(cats)}</div>`
}

/** 월간 일정 한 장 (하루 칸에 4개까지, 넘치면 +n) */
export function monthlyHtml(m: MonthlyPrint): string {
  const cats = new Set<Category>()
  const dows = dowHeads()
  const heads = dows.map((d, i) => `<div class="wp-dh ${i === 0 ? 'wp-sun' : i === 6 ? 'wp-sat' : ''}">${esc(d)}</div>`).join('')
  const cells = m.cells.map((c, i) => {
    const col = i % 7
    const cls = ['wp-cl', `wp-c${col}`, i < 7 ? 'wp-r0' : '', c.out ? 'wp-out' : ''].join(' ')
    const numCls = c.holiday || col === 0 ? 'wp-sun' : col === 6 ? 'wp-sat' : ''
    const items = c.items.slice(0, 4).map((o) => {
      if (!c.out) cats.add(o.category)
      return `<div class="wp-it" style="--c:${COLOR[o.category]}"><i></i><b>${esc(isMultiDay(o) ? t('종일') : o.start)}</b><span>${esc(o.title)}</span></div>`
    }).join('')
    const more = c.items.length > 4 ? `<div class="wp-more">${esc(t('+{n}개', { n: c.items.length - 4 }))}</div>` : ''
    return `<div class="${cls}"><div class="wp-n"><span class="${numCls}">${c.day}</span>${c.holiday && !c.out ? `<small>${esc(c.holiday)}</small>` : ''}</div>${items}${more}</div>`
  }).join('')
  const weeks = m.cells.length / 7
  return `<div class="wp-page">${head(`${esc(m.title)}<small>${esc(m.sub)}</small>`, m.month, m)}<div class="wp-cal" style="grid-template-rows:auto repeat(${weeks},1fr)">${heads}${cells}</div>${foot(cats)}</div>`
}

/** 앱에 들어 있는 글꼴(Pretendard)을 인쇄 창에도 쓰게 */
function fontFaces(): string {
  let out = ''
  for (const sheet of [...document.styleSheets]) {
    try {
      for (const rule of [...sheet.cssRules]) if (rule instanceof CSSFontFaceRule) out += rule.cssText + '\n'
    } catch { /* 다른 주소의 스타일은 읽을 수 없음 */ }
  }
  return out
}

/** 인쇄 창 열기: 숨은 창에 한 장만 넣고 인쇄 → 끝나면 지운다 */
export function printPage(page: string, title: string) {
  const old = document.getElementById('wk-print-frame')
  old?.remove()
  const f = document.createElement('iframe')
  f.id = 'wk-print-frame'
  f.setAttribute('aria-hidden', 'true')
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.append(f)
  const doc = f.contentDocument!
  doc.open()
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${fontFaces()}
@page { size: A4 landscape; margin: 0; } html, body { margin: 0; padding: 0; } ${CSS}</style></head><body>${page}</body></html>`)
  doc.close()
  const go = () => {
    f.contentWindow?.focus()
    f.contentWindow?.print()
    // 인쇄 창을 닫으면 키보드 초점을 앱으로 돌려준다 (안 그러면 단축키가 숨은 창으로 감)
    window.focus()
    if (document.activeElement === f) f.blur()
    // 인쇄 창이 닫힌 뒤 정리 (바로 지우면 일부 브라우저에서 인쇄가 취소됨)
    window.setTimeout(() => f.remove(), 60000)
  }
  // 글꼴을 다 받은 뒤 인쇄 (최대 1.5초 기다림)
  const fonts = (doc as Document & { fonts?: FontFaceSet }).fonts
  Promise.race([fonts?.ready ?? Promise.resolve(), new Promise((r) => setTimeout(r, 1500))]).then(go)
}

/** 같은 한 장을 화면 밖에 그려 그림 데이터로 (PDF 안에 넣을 그림은 용량이 작은 JPEG) */
async function renderPng(page: string, jpeg = false): Promise<string> {
  const { toPng, toJpeg } = await import('html-to-image')
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-10000px;top:0;pointer-events:none'
  host.innerHTML = `<style>${CSS}</style>${page}`
  document.body.append(host)
  try {
    await document.fonts?.ready
    const node = host.querySelector('.wp-page') as HTMLElement
    const opt = { pixelRatio: 2, backgroundColor: '#ffffff', cacheBust: true }
    return jpeg ? await toJpeg(node, { ...opt, quality: 0.92 }) : await toPng(node, opt)
  } finally {
    host.remove()
  }
}

async function toFile(page: string, kind: 'png' | 'pdf', name: string): Promise<File> {
  const png = await renderPng(page, kind === 'pdf')
  if (kind === 'png') {
    const blob = await (await fetch(png)).blob()
    return new File([blob], `${name}.png`, { type: 'image/png' })
  }
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  pdf.addImage(png, 'JPEG', 0, 0, 297, 210)
  return new File([pdf.output('blob')], `${name}.pdf`, { type: 'application/pdf' })
}

function download(file: File) {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30000)
}

/**
 * 공유: 'image' 그림으로 보내기 / 'pdf' PDF로 보내기 / 'save' 그림 저장.
 * 휴대폰 공유 창이 되면 그걸로, 안 되면(일부 데스크탑) 파일로 내려받는다.
 * 돌려주는 값: 'shared' 공유 창을 띄움 / 'saved' 내려받음 / 'canceled' 사용자가 닫음
 */
export async function sharePage(page: string, kind: 'image' | 'pdf' | 'save', name: string, title: string): Promise<'shared' | 'saved' | 'canceled'> {
  const file = await toFile(page, kind === 'pdf' ? 'pdf' : 'png', name)
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
  const touch = matchMedia('(pointer: coarse)').matches
  // 이미지 저장: 데스크탑은 바로 내려받기, 휴대폰은 공유 창의 "이미지 저장"으로
  const wantShare = kind !== 'save' || touch
  if (wantShare && nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title })
      return 'shared'
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'canceled'
    }
  }
  download(file)
  return 'saved'
}
