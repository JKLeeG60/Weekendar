/** 화면 어디서든 오른쪽 아래 알림 팝업을 띄우기 위한 작은 이벤트 통로 */
export interface PopupMsg {
  id: string
  title: string
  text: string
  /** 오른쪽 위 작은 꼬리표 (예: 미리 알림) */
  tag?: string
  icon?: 'clock' | 'cal'
}
const EV = 'weekendar:popup'
export const popup = (m: PopupMsg) => window.dispatchEvent(new CustomEvent<PopupMsg>(EV, { detail: m }))
export const onPopup = (fn: (m: PopupMsg) => void) => {
  const h = (e: Event) => fn((e as CustomEvent<PopupMsg>).detail)
  window.addEventListener(EV, h)
  return () => window.removeEventListener(EV, h)
}
