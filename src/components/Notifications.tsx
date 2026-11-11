import { useState } from 'react'
import { spanLabel } from '../lib/events'
import { CATEGORY_LABEL } from '../lib/types'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { fmtHead } from '../lib/date'
import type { ChangeRequest } from '../lib/types'

const TYPE_LABEL = { add: '추가', edit: '수정', delete: '삭제' } as const

function ago(t: number): string {
  const m = Math.max(1, Math.round((Date.now() - t) / 60000))
  if (m < 60) return `${m}분 전`
  const h = Math.round(m / 60)
  return h < 24 ? `${h}시간 전` : `${Math.round(h / 24)}일 전`
}

export function Notifications({ onClose }: { onClose: () => void }) {
  const { db, me, isLeader, userOf, decideRequest, markAllRead } = useStore()
  const { openModal, showToast } = useUI()
  const pending = isLeader
    ? db.requests.filter((r) => r.leaderId === me?.id && r.status === 'pending')
    : []
  const pendingIds = new Set(pending.map((r) => r.id))
  const notices = db.notices.filter((n) => n.userId === me?.id && !(n.kind === 'request' && pendingIds.has(n.refId ?? '')))

  return (
    <>
      <div className="popover-scrim" onMouseDown={onClose} />
      <div className="notif" role="dialog" aria-label="알림">
        <div className="notif-head">
          <strong>알림</strong>
          <button className="link-btn" onClick={markAllRead}>모두 읽음</button>
        </div>
        <div className="notif-scroll">
          {pending.length > 0 && (
            <>
              <div className="menu-label">처리할 일정 요청 {pending.length}건</div>
              {pending.map((r) => (
                <RequestCard
                  key={r.id}
                  r={r}
                  who={userOf(r.requesterId).name}
                  onDecide={(ok, reason) => {
                    decideRequest(r.id, ok, reason)
                    showToast(ok ? '요청에 동의했어요. 팀 일정에 반영됩니다.' : '요청을 거절했어요.')
                  }}
                />
              ))}
            </>
          )}
          {notices.length > 0 && <div className="menu-label">최근 알림</div>}
          {notices.slice(0, 12).map((n) => (
            <div key={n.id} className={'notice' + (n.read ? '' : ' unread')}>
              <span className="unread-dot" />
              <div>
                <p>{n.text}</p>
                <small>{ago(n.createdAt)}</small>
                {n.kind === 'join' && (
                  <button className="link-btn" onClick={() => { onClose(); openModal({ type: 'admin' }) }}>팀 관리에서 승인하기</button>
                )}
              </div>
            </div>
          ))}
          {pending.length === 0 && notices.length === 0 && <div className="empty">새로운 알림이 없어요.</div>}
        </div>
      </div>
    </>
  )
}

function RequestCard({ r, who, onDecide }: { r: ChangeRequest; who: string; onDecide: (ok: boolean, reason?: string) => void }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const p = r.payload
  return (
    <div className="req-card">
      <div className="req-top">
        <strong>{who}</strong>
        <span className={'type-tag ' + r.type}>일정 {TYPE_LABEL[r.type]} 요청</span>
        <small>{ago(r.createdAt)}</small>
      </div>
      <dl className="req-dl">
        <div><dt>일정</dt><dd>{p.title} <span className="cat-tag" data-cat={p.category ?? 'meeting'}>{CATEGORY_LABEL[p.category ?? 'meeting']}</span></dd></div>
        <div><dt>시간</dt><dd>{p.endDate && p.endDate > p.date ? `${spanLabel({ date: p.date, endDate: p.endDate })} · 종일` : `${fmtHead(p.date)} ${p.start}–${p.end}`}</dd></div>
        <div><dt>장소</dt><dd>{p.place || '–'}</dd></div>
      </dl>
      {rejecting ? (
        <div className="req-reject">
          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="거절 사유 (선택)" />
          <div className="row-end">
            <button className="btn small ghost" onClick={() => setRejecting(false)}>취소</button>
            <button className="btn small danger" onClick={() => onDecide(false, reason.trim() || undefined)}>거절 확정</button>
          </div>
        </div>
      ) : (
        <div className="row-end">
          <button className="btn small ghost" onClick={() => setRejecting(true)}>거절</button>
          <button className="btn small primary" onClick={() => onDecide(true)}>동의</button>
        </div>
      )}
    </div>
  )
}
