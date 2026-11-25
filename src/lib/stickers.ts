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
]

/** 'weeki/good' → 그림 주소 */
export const stickerUrl = (code: string) => `/stickers/${code}.webp`

/** 'weeki/good' → '좋아요!' (모르는 이모티콘이면 빈 글자) */
export function stickerLabel(code: string): string {
  const [pack, id] = code.split('/')
  return STICKER_PACKS.find((p) => p.id === pack)?.items.find((x) => x.id === id)?.label ?? ''
}
