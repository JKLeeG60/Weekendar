// Weekendar 서비스워커
// 1) 화면 파일을 저장해 두어 인터넷이 잠깐 끊겨도 앱이 바로 열리게 함
// 2) 앱이 닫혀 있어도 서버가 보낸 푸쉬 알림을 받아 휴대폰 알림으로 띄움
const CACHE = 'weekendar-v3' // 아이콘 교체 때 버전을 올린다 (v2→v3: '7' 아이콘). 옛 저장본(옛 로고)을 지우고 새로 받게 함

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/manifest.webmanifest', '/icons/icon-192.png'])))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== 'wk-badge').map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return // Supabase 등 바깥 요청은 건드리지 않음
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/cal/')) return
  if (url.pathname === '/privacy.html' || url.pathname === '/terms.html') return // 약관 페이지는 앱 첫 화면 저장본으로 쓰지 않음

  // 페이지: 항상 최신을 먼저 시도하고, 실패하면 저장본
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('/', copy)); return res })
        .catch(() => caches.match('/')),
    )
    return
  }
  // 빌드 파일(이름에 해시가 붙어 바뀌지 않음)과 아이콘: 저장본 우선
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/')) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)) }
        return res
      })),
    )
  }
})

self.addEventListener('push', (e) => {
  let data = {}
  try { data = e.data ? e.data.json() : {} } catch { data = { body: e.data && e.data.text() } }
  const title = data.title || 'Weekendar'
  e.waitUntil(Promise.all([
    self.registration.showNotification(title, {
      body: data.body || '',
      tag: data.tag || undefined,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { url: data.url || '/' },
    }),
    bumpBadge(),
  ]))
})

// 앱 아이콘 숫자 배지: 앱이 꺼져 있을 때 푸쉬가 오면 1 올린다 (앱을 열면 앱이 정확한 숫자로 다시 맞춤)
async function bumpBadge() {
  if (!self.navigator.setAppBadge) return
  try {
    const c = await caches.open('wk-badge')
    const r = await c.match('/__badge')
    const n = (r ? Number(await r.text()) || 0 : 0) + 1
    await c.put('/__badge', new Response(String(n)))
    await self.navigator.setAppBadge(n)
  } catch { /* 지원 안 함 */ }
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const target = (e.notification.data && e.notification.data.url) || '/'
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) { c.navigate && target !== '/' && c.navigate(target); return c.focus() }
      return self.clients.openWindow(target)
    }),
  )
})
