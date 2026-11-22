// 메모 공용 도구 (편집기와 따로 둬서 앱 첫 화면 크기를 늘리지 않는다)

/** 마크다운에서 첫 줄 글자만 뽑아 미리보기로 쓴다 */
export function memoPreview(md: string) {
  const line = md
    .split('\n')
    .map((l) => l.replace(/^\s*(#{1,6}\s|[-*+]\s(\[[ xX]\]\s)?|\d+\.\s|>\s?)/, '').replace(/[*_~`]/g, '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim())
    .find(Boolean)
  return line ?? ''
}
