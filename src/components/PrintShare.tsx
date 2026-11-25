import { useState } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { t } from '../lib/i18n'
import { fmtHead, holidayLabel, holidayName, isoWeek, monthGrid, monthTitle, parse, weekDays, weekPill, weekRangeLabel, mondayOf } from '../lib/date'
import { occurrencesOn } from '../lib/events'
import { monthlyHtml, printPage, sharePage, weeklyHtml } from '../lib/print'
import { Icon } from './ui'

/** 지금 화면에 맞는 출력물: 월간 보기면 그 사람의 그 달, 아니면 이번 주 팀 표 */
export function usePrintJob() {
  const { db, me, team, tableMembers, userOf } = useStore()
  const { selected, monthView } = useUI()
  const now = new Date()
  const printedAt = `${now.getFullYear()}. ${now.getMonth() + 1}. ${now.getDate()}. ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const subOf = (userId: string) => {
    const m = tableMembers.find((x) => x.userId === userId)
    return m?.role === 'leader' ? t('팀장') : m?.title ?? ''
  }
  const printedBy = [me?.name ?? '', me ? subOf(me.id) : ''].filter(Boolean).join(' ')
  const teamName = team?.name ?? ''

  if (monthView) {
    const d = parse(monthView.date ?? selected)
    const ym = monthView.ym ?? { y: d.getFullYear(), m: d.getMonth() }
    const userId = monthView.userId
    const mine = userId === me?.id
    // 다른 사람은 팀에 공유한 일정만, 나는 전부 (월간 화면과 같게)
    const evs = db.events.filter((e) => e.ownerId === userId && (mine || e.shared))
    let days = monthGrid(ym.y, ym.m)
    if (parse(days[35]).getMonth() !== ym.m) days = days.slice(0, 35)
    const name = userOf(userId).name
    const month = monthTitle(ym.y, ym.m)
    const page = monthlyHtml({
      title: t('{name} 월간 일정', { name }),
      sub: [subOf(userId), teamName].filter(Boolean).join(' · '),
      month,
      printedAt, printedBy,
      cells: days.map((x) => ({ day: parse(x).getDate(), out: parse(x).getMonth() !== ym.m, holiday: holidayLabel(x), items: occurrencesOn(evs, x) })),
    })
    return {
      label: t('{name} · {month} 월간 일정', { name, month }),
      page,
      title: t('{name} 월간 일정', { name }) + ' · ' + month,
      file: `Weekendar-${name}-${ym.y}-${String(ym.m + 1).padStart(2, '0')}`,
    }
  }

  const mon = mondayOf(selected)
  const days = weekDays(selected)
  const shared = db.events.filter((e) => e.shared)
  const week = weekPill(isoWeek(mon))
  const page = weeklyHtml({
    title: t('{team} 주간예정사항', { team: teamName }),
    range: `${weekRangeLabel(mon)} · ${week}`,
    printedAt, printedBy,
    days: days.map((d) => ({ label: fmtHead(d), holiday: holidayName(d) ? holidayLabel(d) : undefined })),
    rows: tableMembers.map((m) => ({
      name: userOf(m.userId).name,
      sub: subOf(m.userId),
      cells: days.map((d) => occurrencesOn(shared.filter((e) => e.ownerId === m.userId), d)),
    })),
  })
  return {
    label: t('{team} · {week} 주간 일정', { team: teamName, week }),
    page,
    title: t('{team} 주간예정사항', { team: teamName }) + ' · ' + week,
    file: `Weekendar-${teamName}-${mon}`,
  }
}

/** 계정 메뉴의 '인쇄'·'공유하기' 두 줄 (공유하기를 누르면 세 가지 고르기) */
export function PrintShareItems({ onDone }: { onDone: () => void }) {
  const job = usePrintJob()
  const { showToast } = useUI()
  const [share, setShare] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  async function doShare(kind: 'image' | 'pdf' | 'save') {
    setBusy(kind)
    try {
      const r = await sharePage(job.page, kind, job.file, job.title)
      if (r === 'saved') showToast(kind === 'pdf' ? t('PDF 파일을 저장했어요') : t('이미지를 저장했어요'))
      onDone()
    } catch {
      showToast(t('파일을 만들지 못했어요. 다시 시도해 주세요'))
    } finally {
      setBusy(null)
    }
  }

  if (share) {
    return (
      <div className="share-pick">
        <div className="menu-label">{t('{what} 공유', { what: job.label })}</div>
        {([
          ['image', 'share', t('이미지로 보내기'), t('카카오톡·메시지·메일 등')],
          ['pdf', 'note', t('PDF로 보내기'), t('인쇄용 A4 파일')],
          ['save', 'download', t('이미지 저장'), t('사진첩·다운로드 폴더에')],
        ] as const).map(([k, ic, a, b]) => (
          <button key={k} className="menu-item share-item" disabled={!!busy} onClick={() => doShare(k)}>
            <span className="share-ic"><Icon name={ic} size={16} /></span>
            <span className="share-txt">{busy === k ? t('만드는 중…') : a}<small>{b}</small></span>
          </button>
        ))}
        <button className="menu-item share-back" onClick={() => setShare(false)}><span><Icon name="chevL" size={14} /> {t('뒤로')}</span></button>
      </div>
    )
  }
  return (
    <>
      <button className="menu-item two" onClick={() => { onDone(); printPage(job.page, job.title) }}>
        <span><Icon name="print" size={15} /><span>{t('인쇄')}<small>{job.label}</small></span></span>
      </button>
      <button className="menu-item two" onClick={() => setShare(true)}>
        <span><Icon name="share" size={15} /><span>{t('공유하기')}<small>{t('이미지·PDF로 보내기')}</small></span></span>
      </button>
      <div className="menu-sep" />
    </>
  )
}
