// 캘린더 구독 주소: /cal/<토큰>.ics  →  이 함수가 Supabase 에서 내 일정을 .ics 로 받아 돌려준다.
// 아래 주소와 키는 브라우저에도 공개되는 값(프로젝트 주소, publishable key)이다.
const URL_ = process.env.VITE_SUPABASE_URL || 'https://lgloslfmoetlojuaqage.supabase.co'
const KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_O1eG2Jw3q3BKdAtpba8Khw_ayIyJCMj'

export default async function handler(req: any, res: any) {
  const raw = String((req.query && req.query.token) || '')
  const token = raw.replace(/\.ics$/, '')
  if (!/^[a-f0-9]{32,128}$/.test(token)) {
    res.status(404).send('Not found')
    return
  }
  try {
    const r = await fetch(`${URL_}/rest/v1/rpc/ics_feed`, {
      method: 'POST',
      headers: { apikey: KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token }),
    })
    if (!r.ok) {
      res.status(502).send('Calendar unavailable')
      return
    }
    const text = await r.json()
    if (!text) {
      res.status(404).send('Not found')
      return
    }
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Content-Disposition', 'inline; filename="weekendar.ics"')
    res.setHeader('Cache-Control', 'public, max-age=600')
    res.status(200).send(text)
  } catch {
    res.status(502).send('Calendar unavailable')
  }
}
