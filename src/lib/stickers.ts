// 대화 이모티콘 (그림 파일은 public/stickers/<묶음>/<이름>.webp)

export interface StickerPack {
  id: string
  /** 묶음 이름 */
  name: string
  /** 탭에 보일 대표 그림 */
  icon: string
  items: { id: string; label: string }[]
}

export const STICKER_PACKS: StickerPack[] = [
  {
    id: 'weeki',
    name: '위키',
    icon: 'hi',
    items: [
      { id: 'hi', label: '안녕하세요' },
      { id: 'good', label: '좋아요!' },
      { id: 'thanks', label: '감사합니다' },
      { id: 'ok', label: '확인했어요' },
      { id: 'great', label: '수고하셨어요' },
      { id: 'fight', label: '화이팅!' },
      { id: 'sorry', label: '죄송해요' },
      { id: 'bye', label: '퇴근!' },
    ],
  },
  {
    id: 'office',
    name: '회사냥',
    icon: 'go-home',
    items: [
      { id: 'monday', label: '월요일 싫어…' },
      { id: 'coffee', label: '커피 수혈 중' },
      { id: 'arrive', label: '출근했습니다' },
      { id: 'endless', label: '끝이 없는 업무…' },
      { id: 'excel', label: '엑셀 지옥' },
      { id: 'meeting', label: '회의 중…' },
      { id: 'final', label: '최종_진짜최종' },
      { id: 'mail', label: '메일 폭탄' },
      { id: 'tomorrow', label: '내일 아침까지요?!' },
      { id: 'what-now', label: '이랬다가 저랬다가 어쩌라는거야…' },
      { id: 'soul', label: '넵…' },
      { id: 'redo', label: '다시요…?' },
      { id: 'yes', label: '넵!' },
      { id: 'checked', label: '확인했습니다' },
      { id: 'thanks', label: '감사합니다' },
      { id: 'greatjob', label: '고생하셨습니다' },
      { id: 'sorry', label: '죄송합니다' },
      { id: 'wait', label: '잠시만요' },
      { id: 'go-home', label: '퇴근이다!!' },
      { id: 'six', label: '칼퇴' },
      { id: 'overtime', label: '야근' },
      { id: 'friday', label: '불금이다!' },
      { id: 'payday', label: '월급 들어왔다' },
      { id: 'sunday', label: '벌써 일요일 밤…' },
    ],
  },
]

/** 'weeki/good' → 그림 주소 */
export const stickerUrl = (code: string) => `/stickers/${code}.webp`

/** 'weeki/good' → '좋아요!' (모르는 이모티콘이면 빈 글자) */
export function stickerLabel(code: string): string {
  const [pack, id] = code.split('/')
  return STICKER_PACKS.find((p) => p.id === pack)?.items.find((x) => x.id === id)?.label ?? ''
}
