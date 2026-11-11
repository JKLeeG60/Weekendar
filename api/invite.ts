// 초대 링크 /join/코드 : 앱 첫 화면(index.html)에 팀 이름이 들어간 미리보기 정보를 넣어 돌려준다.
// 카카오톡·슬랙 등이 링크를 읽을 때 "'팀이름'에서 초대했어요" 카드가 뜨게 하려는 것.
const SB = process.env.VITE_SUPABASE_URL || 'https://lgloslfmoetlojuaqage.supabase.co'
const SR = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

async function teamName(code: string): Promise<string | null> {
  if (!SR) return null
  const headers: Record<string, string> = { apikey: SR }
  if (SR.startsWith('eyJ')) headers.Authorization = `Bearer ${SR}`
  const r = await fetch(`${SB}/rest/v1/teams?invite_code=eq.${encodeURIComponent(code)}&select=name`, { headers })
  if (!r.ok) return null
  const rows = await r.json()
  return rows && rows[0] && rows[0].name ? String(rows[0].name) : null
}

function setMeta(html: string, attr: 'property' | 'name', key: string, value: string) {
  const re = new RegExp(`(<meta ${attr}="${key}" content=")[^"]*(")`)
  return html.replace(re, (_m, a: string, b: string) => a + esc(value) + b)
}

export default async function handler(req: any, res: any) {
  const code = String(req.query.code || '').trim().toUpperCase()
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const origin = `https://${host}`
  let html: string
  try {
    html = await fetch(`${origin}/index.html`).then((r) => r.text())
  } catch {
    res.redirect(302, `/?join=${encodeURIComponent(code)}`)
    return
  }
  if (/^[A-Z0-9-]{4,24}$/.test(code)) {
    const name = await teamName(code).catch(() => null)
    const title = name ? `'${name}'에서 Weekendar로 초대했어요` : 'Weekendar 팀 초대'
    const desc = `링크를 눌러 팀에 참여하세요 · 초대 코드 ${code}`
    html = setMeta(html, 'property', 'og:title', title)
    html = setMeta(html, 'property', 'og:description', desc)
    html = setMeta(html, 'name', 'description', desc)
    html = setMeta(html, 'property', 'og:url', `${origin}/join/${code}`)
    html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(title)}</title>`)
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=300')
  res.status(200).send(html)
}
