import type { ReactNode } from 'react'
import { useStore } from '../lib/store'
import { useUI } from '../lib/ui'
import { t, useLang, type LangPref } from '../lib/i18n'
import { Icon, Modal, Switch } from './ui'
import { startInstall, useInstallable } from './People'

/**
 * 설정: 흩어져 있던 설정을 아이폰 "설정" 앱처럼 묶음 목록으로 모은 창
 * - 화면(화면 모드·언어·폰 화면 미리보기), 할 일(넘기기), 알림과 앱, 도움말, 팀 나가기
 * - 휴대폰 알림·캘린더 등은 설정 위에 겹쳐 열어서, 닫으면 설정으로 돌아온다
 */
export function SettingsModal() {
  const { me, myMember, team, setTodoCarry } = useStore()
  const { closeModal, openModal, openLayer, showToast, themePref, setThemePref, narrow, preview, setPreview } = useUI()
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
        {!narrow && (
          <Row icon="phone" color="#8e8e93" label={t('폰 화면 미리보기')}>
            <Switch on={preview} onChange={(v) => { setPreview(v); closeModal() }} label={t('폰 화면 미리보기')} />
          </Row>
        )}
      </Group>

      <Group label={t('할 일')}>
        <Row icon="carry" color="#ff9f0a" label={t('못 끝낸 할 일을 다음 날로 넘기기')} sub={carry ? t('체크하지 않은 할 일이 다음 날 목록에도 계속 보여요') : t('할 일은 만든 날 목록에만 보여요')}>
          <Switch on={carry} onChange={setTodoCarry} label={t('못 끝낸 할 일을 다음 날로 넘기기')} />
        </Row>
      </Group>

      <Group label={t('알림과 앱')}>
        <Row icon="bell" color="#ff3b30" label={t('휴대폰 알림')} onClick={() => openLayer({ type: 'push' })} />
        {installable && (
          <Row icon="addBox" color="#34c759" label={t('홈 화면에 추가')} sub={t('앱처럼 쓰기')} onClick={() => startInstall(() => openLayer({ type: 'install' }), showToast)} />
        )}
        <Row icon="cal" color="#ff2d55" label={t('캘린더 앱에서 보기')} onClick={() => openLayer({ type: 'calendar' })} />
      </Group>

      {member && (
        <Group label={t('도움말')}>
          <Row icon="help" color="#8e8e93" label={t('사용법 다시 보기')} onClick={() => openLayer({ type: 'tutorial' })} />
        </Group>
      )}

      {member && (
        <div className="set-group set-danger">
          {/* 팀 나가기는 설정을 닫고 확인 창을 연다 */}
          <button className="set-row" onClick={() => openModal({ type: 'leave' })}>{t('팀 나가기')}</button>
        </div>
      )}
      <p className="set-foot">Weekendar{team ? ` · ${team.name}` : ''}</p>
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
