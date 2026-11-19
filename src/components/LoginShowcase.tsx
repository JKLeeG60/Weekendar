import { useEffect, useState, type CSSProperties } from 'react'
import { getLang, t } from '../lib/i18n'

/**
 * 로그인 화면(데스크탑) 왼쪽 소개 슬라이드 — 4장이 5초마다 자동으로 넘어간다.
 * 1·2번은 사진, 3번은 팀 일정 샘플 화면, 4번은 모바일 화면 샘플이다.
 * (3·4번의 일정·이름은 모두 소개용 가짜 예시)
 */

const SLIDE_MS = 5000
const COUNT = 4

/** 이번 주 월~금 날짜 (오늘이 평일이면 오늘 위치도 함께) */
function thisWeek() {
  const now = new Date()
  const mon = new Date(now)
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  const today = now.getDay() >= 1 && now.getDay() <= 5 ? now.getDay() - 1 : -1
  const days = ['월', '화', '수', '목', '금'].map((d, i) => {
    const x = new Date(mon)
    x.setDate(mon.getDate() + i)
    return { name: t(d), date: x.getDate() }
  })
  return { days, today, now }
}

/* ───────── 1·2번: 사진 슬라이드 ───────── */
function PhotoSlide({ src, alt, title, desc, first }: { src: string; alt: string; title: string; desc: string; first?: boolean }) {
  return (
    <>
      <img className="sc-photo" src={src} alt={alt} loading={first ? 'eager' : 'lazy'} draggable={false} />
      <div className="sc-shade" />
      <div className="sc-copy bottom">
        <small>WEEKENDAR</small>
        <h2>{title}</h2>
        <p>{desc}</p>
      </div>
    </>
  )
}

/* ───────── 3번: 팀 일정 샘플 ───────── */
const MEMBERS = [
  { name: '민수', color: '#007aff' },
  { name: '지연', color: '#34c759' },
  { name: '하준', color: '#ff9500' },
  { name: '서윤', color: '#af52de' },
]
// [요일(0=월), 시작 행(0=09시), 칸 수, 담당 색 번호, 제목]
const SAMPLE_EVENTS: [number, number, number, number, string][] = [
  [0, 0, 2, 0, '팀 주간회의'], [0, 3, 1, 1, '점심 스터디'], [0, 6, 1, 0, '주간 보고'],
  [1, 2, 1, 1, '디자인 리뷰'], [1, 5, 1, 3, 'UX 인터뷰'],
  [2, 1, 2, 2, '고객 미팅'], [2, 4, 1, 1, 'QA 점검'], [2, 7, 1, 3, '회고 정리'],
  [3, 0, 1, 3, '1:1 면담'], [3, 3, 1, 2, '기획 워크숍'], [3, 6, 1, 1, '릴리즈 리뷰'],
  [4, 0, 1, 2, '배포 준비'], [4, 3, 2, 0, '스프린트 회고'],
]
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17]
const ROW = 3.55 // 한 시간 칸 높이(rem)

function TeamSlide() {
  const { days, today } = thisWeek()
  return (
    <>
      <div className="sc-copy top">
        <small>TEAM SCHEDULE</small>
        <h2>{t('팀원 모두의 일정, 색으로 한눈에.')}</h2>
      </div>
      <div className="sc-win" aria-hidden>
        <div className="sc-bar">
          <i style={{ background: '#ff5f57' }} /><i style={{ background: '#febc2e' }} /><i style={{ background: '#28c840' }} />
          <b>{t('이번 주 · 디자인팀')}</b>
          <span className="sc-chip">{t('4명 공유 중')}</span>
        </div>
        <div className="sc-body">
          <div className="sc-side">
            <h4>{t('팀원 목록')}</h4>
            {MEMBERS.map((m) => (
              <div className="sc-mem" key={m.name}>
                <i style={{ background: m.color }}>{t(m.name).charAt(0)}</i>
                {t(m.name)}
              </div>
            ))}
            <h4 className="gap">{t('보기')}</h4>
            <div className="sc-mem on">{t('주간')}</div>
            <div className="sc-mem dim">{t('월간')}</div>
          </div>
          <div className="sc-grid">
            <div className="sc-h" />
            {days.map((d, i) => (
              <div key={i} className={`sc-h${i === today ? ' today' : ''}`}>{d.name} {d.date}</div>
            ))}
            {HOURS.map((h) => (
              <div className="sc-row" key={h} style={{ gridColumn: '1 / -1' }}>
                <div className="sc-t">{String(h).padStart(2, '0')}:00</div>
                {days.map((_, i) => <div className="sc-c" key={i} />)}
              </div>
            ))}
            {SAMPLE_EVENTS.map(([d, r, n, m, title]) => (
              <div
                key={title}
                className="sc-ev"
                style={{
                  '--ec': MEMBERS[m].color,
                  left: `calc(4rem + (100% - 4rem) * ${d} / 5 + 0.3rem)`,
                  width: `calc((100% - 4rem) / 5 - 0.6rem)`,
                  top: `calc(var(--head) + ${r * ROW}rem + 0.25rem)`,
                  height: `${n * ROW - 0.5}rem`,
                } as CSSProperties}
              >
                {t(title)}
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

/* ───────── 4번: 모바일 샘플 ───────── */
function MobileSlide() {
  const { days, today, now } = thisWeek()
  const dateLine = now.toLocaleDateString(getLang() === 'ko' ? 'ko-KR' : 'en-US', { month: 'long', day: 'numeric', weekday: 'long' })
  const cards: { color: string; title: string; meta: string }[] = [
    { color: '#007aff', title: '팀 주간회의', meta: `10:00 – 11:00 · ${t('회의실 A')}` },
    { color: '#ff9500', title: '고객 미팅', meta: `11:00 – 12:30 · ${t('지연')}` },
    { color: '#34c759', title: 'QA 점검', meta: `14:00 – 15:00 · ${t('하준')}` },
    { color: '#af52de', title: '회고 정리', meta: `16:00 – 17:00 · ${t('서윤')}` },
  ]
  return (
    <>
      <div className="sc-copy top">
        <small>MOBILE</small>
        <h2>{t('주머니 속에서도, 팀의 일정 그대로.')}</h2>
      </div>
      <div className="sc-noti" style={{ left: '4.3rem', top: '25.5rem' }}>
        <i /><div><b>{t('팀 주간회의 · 10분 후')}</b><span>{t('회의실 A')}</span></div>
      </div>
      <div className="sc-noti" style={{ right: '4.3rem', top: '35.5rem' }}>
        <i /><div><b>{t('민수님이 일정을 추가했어요')}</b><span>{t('디자인 리뷰 · 화 11:00')}</span></div>
      </div>
      <div className="sc-noti" style={{ left: '6rem', top: '47.5rem' }}>
        <i /><div><b>{t('이번 주 남은 일정 3개')}</b><span>{t('금요일 스프린트 회고')}</span></div>
      </div>
      <div className="sc-phone" aria-hidden>
        <div className="sc-screen">
          <div className="sc-island" />
          <div className="sc-status"><span>9:41</span><span>●●●</span></div>
          <h3>{t('오늘')}</h3>
          <div className="sc-date">{dateLine}</div>
          <div className="sc-days">
            {days.map((d, i) => (
              <div key={i} className={i === today ? 'on' : ''}>{d.name}<b>{d.date}</b></div>
            ))}
          </div>
          {cards.map((c) => (
            <div className="sc-card" key={c.title} style={{ borderColor: c.color }}>
              <b>{t(c.title)}</b><span>{c.meta}</span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

/* ───────── 슬라이드 묶음 ───────── */
export function LoginShowcase() {
  const [i, setI] = useState(0)
  const [hold, setHold] = useState(false) // 마우스를 올려 두면 멈춤
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (hold || reduce) return
    const id = window.setTimeout(() => setI((v) => (v + 1) % COUNT), SLIDE_MS)
    return () => window.clearTimeout(id) // i 가 바뀔 때마다 다시 5초를 센다 (점을 눌러도 5초 뒤 이어서 넘어감)
  }, [i, hold, reduce])

  const slides = [
    <PhotoSlide key="a" first src="/landing/meeting.webp" alt={t('회의실에서 Weekendar 화면을 함께 보는 팀')} title={t('팀의 한 주를, 한 화면에.')} desc={t('일정은 간단하게 적고, 팀과 함께 바로 공유하세요.')} />,
    <PhotoSlide key="b" src="/landing/office.webp" alt={t('노트북과 폰으로 같은 일정을 확인하는 두 동료')} title={t('내 일정은, 어디서든 같게.')} desc={t('노트북에서도 폰에서도 똑같이 편하게.')} />,
    <TeamSlide key="c" />,
    <MobileSlide key="d" />,
  ]

  return (
    <section className="showcase" aria-roledescription="carousel" onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)}>
      {slides.map((s, n) => (
        <div className={`sc-slide${n === i ? ' on' : ''}`} key={n} aria-hidden={n !== i}>{s}</div>
      ))}
      <div className="sc-dots">
        {slides.map((_, n) => (
          <button key={n} className={n === i ? 'on' : ''} onClick={() => setI(n)} aria-label={t('슬라이드 {n}', { n: n + 1 })} aria-current={n === i} />
        ))}
      </div>
    </section>
  )
}
