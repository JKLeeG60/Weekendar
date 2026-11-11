import { useEffect, useRef } from 'react'
import { useStore } from '../lib/store'
import { occurrencesOn } from '../lib/events'
import { addDays, todayStr } from '../lib/date'
import { popup } from '../lib/bus'
import { pushOnHere } from '../lib/push'

const KEY = 'weekendar-reminded'
const load = (): Record<string, number> => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}
const save = (v: Record<string, number>) => {
  try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* 무시 */ }
}

/**
 * 미리 알림: Weekendar 창이 열려 있는 동안 30초마다 확인해서
 * 알림 시각이 되면 오른쪽 아래 팝업 + 브라우저 알림(허용한 경우)을 띄운다.
 * 한 번 띄운 알림은 기억해 두어 다시 띄우지 않는다.
 */
export function Reminders() {
  const { db, me } = useStore()
  const ref = useRef({ db, me })
  ref.current = { db, me }

  useEffect(() => {
    const check = () => {
      const { db, me } = ref.current
      if (!me) return
      const today = todayStr()
      const now = new Date()
      const nowMin = now.getHours() * 60 + now.getMinutes()
      const done = load()
      let changed = false
      const mine = db.events.filter((e) => e.ownerId === me.id && e.remind !== undefined && e.remind !== null)
      // 하루 전 알림까지 있으므로 오늘·내일 일정을 함께 확인 (분은 오늘 0시 기준)
      const days: [string, number][] = [[today, 0], [addDays(today, 1), 1440]]
      for (const [day, offset] of days) for (const o of occurrencesOn(mine, day)) {
        const start = offset + Number(o.start.slice(0, 2)) * 60 + Number(o.start.slice(3))
        const at = start - (o.remind ?? 0)
        const key = `${o.baseId}:${day}:${o.start}:${o.remind}`
        // 알림 시각이 지났고, 시작 후 5분이 넘지 않았을 때만
        if (nowMin >= at && nowMin <= start + 5 && !done[key]) {
          done[key] = Date.now()
          changed = true
          const left = start - nowMin
          const when = o.remind === 0 || left <= 0 ? '지금 시작해요'
            : offset > 0 ? `내일 ${o.start} 시작`
            : left < 60 ? `${left}분 뒤 시작`
            : `${Math.floor(left / 60)}시간${left % 60 ? ` ${left % 60}분` : ''} 뒤 시작`
          const text = `${o.start}–${o.end}${o.place ? ' · ' + o.place : ''} · ${when}`
          popup({ id: 'r_' + key, title: o.title, text, tag: '미리 알림', icon: 'clock' })
          try {
            // 이 기기에서 휴대폰 알림이 켜져 있으면 서버가 보내므로 창 알림은 생략 (중복 방지)
            if (!pushOnHere() && 'Notification' in window && Notification.permission === 'granted') new Notification(o.title, { body: text, tag: key })
          } catch { /* 일부 브라우저는 창 알림을 막음 */ }
        }
      }
      if (changed) {
        // 이틀 지난 기록은 정리
        const cut = Date.now() - 2 * 86400000
        for (const k of Object.keys(done)) if (done[k] < cut) delete done[k]
        save(done)
      }
    }
    check()
    const id = window.setInterval(check, 30000)
    return () => window.clearInterval(id)
  }, [])

  return null
}
