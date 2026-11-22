import { useEffect, useRef, useState } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { Rich, t } from '../lib/i18n'
import { Modal } from './ui'

/**
 * 처음 사용 안내 (카드 4장)
 * - 팀을 만든 사람(관리자)과 초대받은 팀원에게 서로 다른 안내를 보여준다
 * - 처음 가입한 사람에게만 한 번 자동으로 뜨고, 프로필 메뉴의 "사용법 다시 보기"로 다시 볼 수 있다
 */

interface Step {
  art: string // 그림 대신 쓰는 큰 이모지
  title: string
  body: string
}

/** 월간 일정 사용법 (데스크탑과 휴대폰은 조작이 달라 문구를 나눈다) */
const monthBody = (mobile: boolean) =>
  mobile
    ? t('<b>날짜</b>를 누르면 아래에 그날 일정이 보이고, <b>일정</b>을 누르면 자세히 볼 수 있어요.<br>내 달력에는 <b>나만 보기</b> 일정도 함께 보이고, 팀원 달력에는 팀에 공유한 일정만 보여요.')
    : t('<b>날짜 칸</b>을 누르면 오른쪽에 그날이 보이고, 한 번 더 누르면 일정을 추가해요. <b>날짜 숫자</b>를 누르면 그 주 팀 표로 가요.<br>내 달력에는 <b>나만 보기</b> 일정도 함께 보이고, 팀원 달력에는 팀에 공유한 일정만 보여요.')
const monthStep = (mobile: boolean): Step => ({ art: '📅', title: t('월간 일정도 볼 수 있어요'), body: t('위쪽 <b>달력 아이콘</b>이나 팀원 이름을 누르면 한 달 일정을 볼 수 있어요.') + '<br>' + monthBody(mobile) })

const adminSteps = (): Step[] => [
  { art: '🔗', title: t('초대 링크로 팀원을 불러요'), body: t('프로필 옆 <b>팀 관리</b>에서 초대 링크를 복사해 카톡이나 메일로 보내세요.<br>팀원이 들어오면 <b>승인</b>해 주세요.') },
  { art: '👑', title: t('직급과 팀장을 정해요'), body: t('<b>팀 관리</b>에서 팀원의 직급을 입력하고 팀장을 지정할 수 있어요.<br>팀장의 일정은 팀원이 바로 바꿀 수 없고, 요청하면 팀장이 수락해야 반영돼요.') },
  { art: '🔒', title: t('일정마다 팀 공유를 정해요'), body: t('일정을 만들 때 <b>팀 공유</b> 스위치로 팀 표에 보일지 고를 수 있어요.<br>기본은 켜짐이고, 끄면 나만 볼 수 있어요.') },
  { art: '💬', title: t('대화와 알림도 써 보세요'), body: t('위쪽 말풍선 아이콘으로 팀 대화를 할 수 있고, <b>@이름</b>으로 부를 수 있어요.<br>휴대폰 <b>홈 화면에 추가</b>하고 알림을 켜면 앱처럼 쓸 수 있어요.') },
]

const memberSteps = (): Step[] => [
  { art: '🗓️', title: t('팀 표에서 팀원 일정을 봐요'), body: t('가로는 요일, 세로는 팀원이에요.<br>여러 날 이어진 막대는 출장 같은 <b>여러 날 부재</b>예요.') },
  { art: '🔒', title: t('일정마다 팀 공유를 정해요'), body: t('일정을 만들 때 <b>팀 공유</b> 스위치로 팀 표에 보일지 고를 수 있어요.<br>기본은 켜짐이고, 끄면 나만 볼 수 있어요.') },
  { art: '✋', title: t('팀장 일정은 요청으로 바꿔요'), body: t('팀장의 일정은 직접 바꿀 수 없어요.<br><b>변경 요청</b>을 보내면 팀장이 수락한 뒤 반영돼요. 기다리는 요청은 표에 표시돼요.') },
  { art: '💬', title: t('대화와 알림도 써 보세요'), body: t('위쪽 말풍선 아이콘으로 팀 대화를 할 수 있고, <b>@이름</b>으로 부를 수 있어요.<br>휴대폰 <b>홈 화면에 추가</b>하고 알림을 켜면 앱처럼 쓸 수 있어요.') },
]

export function TutorialModal() {
  const { isAdmin, finishTutorial } = useStore()
  const { closeModal, isMobile } = useUI()
  const [i, setI] = useState(0)
  const steps = [...(isAdmin ? adminSteps() : memberSteps()), monthStep(isMobile)]
  const s = steps[i]
  const last = i === steps.length - 1

  // 한 번이라도 보여준 순간 "봤음"으로 기록한다 (중간에 닫아도 다시 뜨지 않음)
  useEffect(() => { finishTutorial() }, [finishTutorial])

  return (
    <Modal
      title={s.title}
      onClose={closeModal}
      width={460}
      className="tutorial"
      footer={
        <>
          {!last && <button className="btn ghost left" onClick={closeModal}>{t('건너뛰기')}</button>}
          {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>{t('이전')}</button>}
          <button className="btn primary" onClick={() => (last ? closeModal() : setI(i + 1))} data-autofocus>
            {last ? t('시작하기') : t('다음')}
          </button>
        </>
      }
    >
      <div className="tut-art" aria-hidden="true">{s.art}</div>
      <p className="tut-text"><Rich text={s.body} /></p>
      <div className="tut-dots" role="img" aria-label={`${i + 1} / ${steps.length}`}>
        {steps.map((_, k) => <i key={k} className={k === i ? 'on' : ''} />)}
      </div>
    </Modal>
  )
}

/** 처음 가입한 사람이면 안내를 한 번 띄운다. 주소 끝에 ?tutorial 을 붙이면 테스트용으로 강제로 띄운다 */
export function useAutoTutorial() {
  const { me, myMember } = useStore()
  const { modal, openModal } = useUI()
  const done = useRef(false)
  useEffect(() => {
    if (done.current || modal) return
    if (!me || !myMember) return
    // 팀 표에 올라가는 사람(팀장·팀원)만. 승인 대기 중인 사람은 승인된 뒤에 본다
    if (myMember.role !== 'leader' && myMember.role !== 'member') return
    const forced = new URLSearchParams(location.search).has('tutorial')
    if (me.tutorialSeen !== false && !forced) return
    done.current = true
    openModal({ type: 'tutorial' })
  }, [me, myMember, modal, openModal])
}

/** 월간 일정 사용법: 처음 월간 일정을 열 때 한 번 (봤음 기록은 이 브라우저에 저장) */
const monthTipKey = (userId: string) => 'weekendar-tip-month:' + userId
export function shouldShowMonthTip(userId: string) {
  try { return localStorage.getItem(monthTipKey(userId)) !== '1' } catch { return false }
}
export function markMonthTip(userId: string) {
  try { localStorage.setItem(monthTipKey(userId), '1') } catch { /* 무시 */ }
}

export function MonthTipModal() {
  const { closeModal, isMobile } = useUI()
  return (
    <Modal
      title={t('월간 일정 사용법')}
      onClose={closeModal}
      width={420}
      className="tutorial"
      footer={<button className="btn primary" onClick={closeModal} data-autofocus>{t('확인')}</button>}
    >
      <div className="tut-art" aria-hidden="true">📅</div>
      <p className="tut-text"><Rich text={monthBody(isMobile)} /></p>
    </Modal>
  )
}
