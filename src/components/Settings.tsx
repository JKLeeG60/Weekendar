import { useEffect, useState, type ReactNode } from 'react'
import { disconnectGcal, gcalStatus, type GcalStatus } from '../lib/gcal'
import { GcalIcon } from './Modals'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { t, useLang, type LangPref } from '../lib/i18n'
import { Icon, Modal, Switch } from './ui'
import { AUTO_OPTIONS } from './Absence'
import { startInstall, useInstallable } from './People'
import { makeBrief } from '../lib/brief'
import { todayStr } from '../lib/date'
import { sendBriefPush } from '../lib/push'

/**
 * 설정: 흩어져 있던 설정을 아이폰 "설정" 앱처럼 묶음 목록으로 모은 창
 * - 화면(화면 모드·언어), 할 일(넘기기), 알림과 앱, 도움말, 팀 나가기
 * - 휴대폰 알림·캘린더 등은 설정 위에 겹쳐 열어서, 닫으면 설정으로 돌아온다
 */
export function SettingsModal() {
  const { me, myMember, team, setTodoCarry, solo, deleteAccount, setAutoApprove } = useStore()
  // 팀장·관리자: 휴가·출장 자동 승인
  const approver = !!myMember && (myMember.role === 'leader' || myMember.isAdmin) && !solo
  const auto = team?.autoApprove ?? 'none'
  const { closeModal, openModal, openLayer, showToast, themePref, setThemePref, narrow } = useUI()
  const { pref, setPref } = useLang()
  const installable = useInstallable()
  const member = myMember && myMember.role !== 'pending'
  const carry = me?.todoCarry !== false

  return (
    <Modal title={t('설정')} onClose={closeModal} width={540} className="settings">
      <Group label={t('화면')}>
        <Row icon="contrast" color="#5e5ce6" label={t('화면 모드')}>
          <div className="theme-seg" role="radiogroup" aria-label={t('화면 모드')}>
            {([['system', '자동'], ['light', '라이트'], ['dark', '다크']] as const).map(([v, l]) => (
              <button key={v} role="radio" aria-checked={themePref === v} className={themePref === v ? 'on' : ''} onClick={() => setThemePref(v)}>{t(l)}</button>
            ))}
          </div>
        </Row>
        {/* 언어 이름은 늘 그 언어로 */}
        <Row icon="globe" color="#0a84ff" label={t('언어')}>
          <div className="theme-seg" role="radiogroup" aria-label={t('언어')}>
            {([['auto', t('자동')], ['ko', '한국어'], ['en', 'English']] as [LangPref, string][]).map(([v, l]) => (
              <button key={v} role="radio" aria-checked={pref === v} className={pref === v ? 'on' : ''} onClick={() => setPref(v)}>{l}</button>
            ))}
          </div>
        </Row>
      </Group>

      {!narrow && (
        <Group label={t('키보드')}>
          <Row icon="keyboard" color="#636366" label={t('단축키')} sub={t('Space 빠른 입력 · ? 단축키 보기')} onClick={() => openLayer({ type: 'shortcuts' })} />
        </Group>
      )}

      <Group label={t('할 일')}>
        <Row icon="carry" color="#ff9f0a" label={t('못 끝낸 할 일을 다음 날로 넘기기')} sub={carry ? t('체크하지 않은 할 일이 다음 날 목록에도 계속 보여요') : t('할 일은 만든 날 목록에만 보여요')}>
          <Switch on={carry} onChange={setTodoCarry} label={t('못 끝낸 할 일을 다음 날로 넘기기')} />
        </Row>
      </Group>

      {approver && (
        <Group label={t('휴가·출장 신청')}>
          <Row icon="suitcase" color="#ff9500" label={t('자동 승인')} sub={auto === 'none' ? t('팀원 신청을 직접 승인해요') : t('신청하면 바로 승인되고, 알림만 와요')}>
            <Switch on={auto !== 'none'} onChange={(v) => setAutoApprove(v ? 'all' : 'none')} label={t('자동 승인')} />
          </Row>
          {auto !== 'none' && (
            <Row icon="check" color="#34c759" label={t('적용')}>
              <div className="theme-seg" role="radiogroup" aria-label={t('적용')}>
                {AUTO_OPTIONS.map(([v, l]) => (
                  <button key={v} role="radio" aria-checked={auto === v} className={auto === v ? 'on' : ''} onClick={() => setAutoApprove(v)}>{t(l)}</button>
                ))}
              </div>
            </Row>
          )}
        </Group>
      )}

      <Group label={t('알림과 앱')}>
        <Row icon="bell" color="#ff3b30" label={t('휴대폰 알림')} onClick={() => openLayer({ type: 'push' })} />
        <BriefRows />
        {installable && (
          <Row icon="addBox" color="#34c759" label={t('홈 화면에 추가')} sub={t('앱처럼 쓰기')} onClick={() => startInstall(() => openLayer({ type: 'install' }), showToast)} />
        )}
        <GcalRow />
      </Group>

      {member && (
        <Group label={t('도움말')}>
          <Row icon="help" color="#8e8e93" label={t('사용법 다시 보기')} onClick={() => openLayer({ type: 'tutorial' })} />
        </Group>
      )}

      {member && !solo && (
        <div className="set-group set-danger">
          {/* 팀 나가기는 설정을 닫고 확인 창을 연다 */}
          <button className="set-row" onClick={() => openModal({ type: 'leave' })}>{t('팀 나가기')}</button>
        </div>
      )}
      {/* 혼자 쓰는 중: 나갈 팀이 없으니 바로 탈퇴 */}
      {solo && (
        <div className="set-group set-danger">
          <button className="set-row" onClick={async () => {
            if (!window.confirm(t('Weekendar에서 탈퇴할까요?') + '\n' + t('내 일정·할 일·메모와 알림·구글 캘린더 연결 정보가 모두 지워지고 되돌릴 수 없어요.'))) return
            const e = await deleteAccount()
            if (e) showToast(e); else closeModal()
          }}>{t('Weekendar 탈퇴')}</button>
        </div>
      )}
      <p className="set-foot">Weekendar{team && !solo ? ` · ${team.name}` : ''}</p>
    </Modal>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <h4 className="set-label">{label}</h4>
      <div className="set-group">{children}</div>
    </section>
  )
}

/** 한 줄: 색 아이콘 + 이름(+ 설명) + 오른쪽 조절 (onClick 이 있으면 다른 창으로 가는 줄) */
function Row({ icon, color, label, sub, children, onClick }: {
  icon: string; color: string; label: string; sub?: string; children?: ReactNode; onClick?: () => void
}) {
  const inner = (
    <>
      <span className="set-ic" style={{ background: color }}><Icon name={icon} size={16} /></span>
      <span className="set-text">{label}{sub && <small>{sub}</small>}</span>
      {children}
      {onClick && <Icon name="chevR" size={16} />}
    </>
  )
  return onClick ? <button className="set-row link" onClick={onClick}>{inner}</button> : <div className="set-row">{inner}</div>
}

/** 구글 캘린더: 연결했을 때만 보이는 줄 (연결은 일정 창의 [연결] 버튼에서) */
function GcalRow() {
  const { mode } = useStore()
  const { showToast } = useUI()
  const [st, setSt] = useState<GcalStatus | null>(null)
  useEffect(() => { if (mode === 'cloud') gcalStatus().then(setSt) }, [mode])
  if (mode !== 'cloud' || !st?.connected) return null
  return (
    <div className="set-row">
      <span className="set-ic gcal-set-ic"><GcalIcon size={20} /></span>
      <span className="set-text">{t('구글 캘린더')}</span>
      <button className="btn small ghost danger-text" onClick={async () => { await disconnectGcal(); setSt({ connected: false, broken: false }); showToast(t('구글 캘린더 연결을 끊었어요')) }}>{t('연결 끊기')}</button>
    </div>
  )
}

/** 아침 브리핑: 켜기 · 보내는 시간 · 요일 · 미리 보기 */
function BriefRows() {
  const { me, db, myMember, absences, setBriefing, mode } = useStore()
  const { showToast } = useUI()
  const [preview, setPreview] = useState(false)
  const on = me?.briefOn !== false
  const time = me?.briefTime ?? '08:30'
  const days = me?.briefDays ?? 'weekdays'
  const [h, mm] = time.split(':').map(Number)
  const when = t(days === 'daily' ? '매일 {time}' : '평일 {time}', { time: fmtClock(h, mm) })
  const brief = preview && me ? makeBrief(db, me.id, myMember?.teamId, absences, todayStr(), me.todoCarry !== false) : null
  return (
    <>
      <Row icon="sun" color="#ff9f0a" label={t('아침 브리핑')} sub={on ? when + ' · ' + t('오늘 일정·할 일·마감·부재') : t('꺼져 있어요')}>
        <Switch on={on} onChange={(v) => setBriefing({ on: v })} label={t('아침 브리핑')} />
      </Row>
      {on && (
        <>
          <Row icon="clock" color="#5e5ce6" label={t('보내는 시간')}>
            <input
              type="time" className="brief-time" value={time} step={300} aria-label={t('보내는 시간')}
              onChange={(e) => { if (/^\d{2}:\d{2}$/.test(e.target.value)) setBriefing({ time: e.target.value }) }}
            />
          </Row>
          <Row icon="cal" color="#007aff" label={t('요일')} sub={days === 'weekdays' ? t('주말·공휴일·휴가인 날은 쉬어요') : t('휴가인 날은 쉬어요')}>
            <div className="theme-seg" role="radiogroup" aria-label={t('요일')}>
              <button role="radio" aria-checked={days === 'weekdays'} className={days === 'weekdays' ? 'on' : ''} onClick={() => setBriefing({ days: 'weekdays' })}>{t('평일만')}</button>
              <button role="radio" aria-checked={days === 'daily'} className={days === 'daily' ? 'on' : ''} onClick={() => setBriefing({ days: 'daily' })}>{t('매일')}</button>
            </div>
          </Row>
          <div className="brief-actions">
            <button className="link-btn" onClick={() => setPreview((v) => !v)}>{preview ? t('미리 보기 닫기') : t('오늘 브리핑 미리 보기')}</button>
            {mode === 'cloud' && (
              <button className="link-btn" onClick={async () => { const e = await sendBriefPush(); showToast(e ?? t('휴대폰으로 보냈어요.')) }}>{t('휴대폰으로 받아 보기')}</button>
            )}
          </div>
          {brief && (
            <div className="brief-card" aria-live="polite">
              <div className="brief-top"><img src="/icons/icon-192.png" alt="" /><span>WEEKENDAR</span><span className="brief-now">{t('지금')}</span></div>
              <b>{brief.title}</b>
              {brief.off ? <p className="brief-off">{t('오늘은 휴가라 브리핑을 보내지 않아요.')}</p> : brief.lines.map((l, i) => <p key={i}>{l}</p>)}
            </div>
          )}
        </>
      )}
    </>
  )
}

/** "오전 8:30" · "8:30 AM" */
function fmtClock(h: number, m: number) {
  const mm = String(m).padStart(2, '0')
  return t(h < 12 ? '오전 {h}:{m}' : '오후 {h}:{m}', { h: h % 12 === 0 ? 12 : h % 12, m: mm })
}
