import { createClient } from '@supabase/supabase-js'

// 아래 두 값은 브라우저에 공개되는 값(프로젝트 URL, publishable key)입니다.
// 실제 보안은 DB 의 RLS 규칙이 담당합니다. 필요하면 환경 변수로 덮어쓸 수 있어요.
const URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://lgloslfmoetlojuaqage.supabase.co'
const KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'sb_publishable_O1eG2Jw3q3BKdAtpba8Khw_ayIyJCMj'

export const supabase = createClient(URL, KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

/** ?demo 를 붙이면 서버 없이 체험 모드로 열립니다. */
export const cloudEnabled = () => !new URLSearchParams(location.search).has('demo')
