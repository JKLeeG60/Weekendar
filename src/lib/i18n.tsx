import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from 'react'
import { EN } from '../locales/en'

/**
 * 화면 언어 (다국어)
 * - 문구는 한국어 원문을 그대로 열쇠로 쓴다: t('팀 나가기') → 영어면 "Leave team"
 * - 영어 사전(src/locales/en.ts)에 없는 문구는 한국어 그대로 보인다
 * - 언어 설정: 자동(기기 언어) / 한국어 / English. 이 기기(브라우저)에 저장
 */
export type Lang = 'ko' | 'en'
export type LangPref = 'auto' | Lang
export const LANGS: Lang[] = ['ko', 'en']

const KEY = 'weekendar-lang'

/** 기기(브라우저) 언어 목록에서 지원하는 첫 언어. 없으면 영어 */
export function deviceLang(): Lang {
  const list = navigator.languages?.length ? navigator.languages : [navigator.language || '']
  for (const l of list) {
    const code = l.toLowerCase().slice(0, 2)
    if ((LANGS as string[]).includes(code)) return code as Lang
  }
  return 'en'
}

function loadPref(): LangPref {
  // 주소 끝에 ?lang=en 처럼 붙이면 그 언어로 강제 (테스트용)
  const q = new URLSearchParams(location.search).get('lang')
  if (q === 'ko' || q === 'en') return q
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'ko' || v === 'en' || v === 'auto') return v
  } catch {
    /* 저장소를 못 쓰는 환경 */
  }
  return 'auto'
}

const resolve = (p: LangPref): Lang => (p === 'auto' ? deviceLang() : p)

// React 밖(날짜 함수 등)에서도 쓰도록 현재 언어를 모듈에 둔다
let cur: Lang = resolve(loadPref())
export const getLang = () => cur

type Vars = Record<string, string | number>

/** 문구 번역. {name} 같은 자리는 vars 로 채운다. 영어 사전 값이 [단수, 복수] 이면 vars.n 으로 고른다 */
export function t(ko: string, vars?: Vars): string {
  let s = ko
  if (cur === 'en') {
    const v = EN[ko]
    if (v === undefined) {
      if (import.meta.env.DEV) console.warn('[i18n] 영어 번역 없음:', ko)
    } else s = Array.isArray(v) ? (Number(vars?.n) === 1 ? v[0] : v[1]) : v
  }
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
  return s
}

/** 문장 안의 <b>굵게</b>, <br>, <mbr>(휴대폰에서만 줄바꿈) 를 화면 요소로 바꿔 보여준다 */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(<b>[\s\S]*?<\/b>|<br>|<mbr>)/g)
  return (
    <>
      {parts.map((p, i) =>
        p === '<br>' ? <br key={i} /> : p === '<mbr>' ? <br key={i} className="m-br" /> : p.startsWith('<b>') ? <b key={i}>{p.slice(3, -4)}</b> : <Fragment key={i}>{p}</Fragment>,
      )}
    </>
  )
}

/**
 * 서버(DB 함수)나 체험 모드가 한국어 문장으로 만든 알림·오류를 화면 언어로 바꾼다.
 * 알려진 문장 모양만 바꾸고, 모르는 문장은 그대로 둔다.
 */
const VERB: Record<string, string> = { 추가: 'add', 수정: 'change', 삭제: 'delete' }
export function localize(s: string): string {
  if (cur === 'ko' || !s) return s
  if (EN[s] !== undefined) return t(s)
  let m: RegExpMatchArray | null
  // 그룹 대화방 안내 (서버 migration_020 · 체험 모드가 만드는 문장)
  if ((m = s.match(/^(.+?)님이 (.+)님을 초대했어요$/)))
    return t('{name}님이 {names}님을 초대했어요', { name: m[1], names: m[2].split('님, ').join(', ') })
  if ((m = s.match(/^(.+)님이 나갔어요$/))) return t('{name}님이 나갔어요', { name: m[1] })
  if ((m = s.match(/^(.+)님이 팀 참여를 요청했(?:어요|습니다)\.?$/))) return t('{name}님이 팀 참여를 요청했어요', { name: m[1] })
  if ((m = s.match(/^(.+)님이 일정 (추가|수정|삭제)을(?:\(를\))? 요청했(?:어요|습니다)\.?$/)))
    return t('{name}님이 일정 {verb}을 요청했어요', { name: m[1], verb: VERB[m[2]] })
  if ((m = s.match(/^(.+) 팀장이 요청을 (수락|거절)했어요$/)))
    return t(m[2] === '수락' ? '{name} 팀장이 요청을 수락했어요' : '{name} 팀장이 요청을 거절했어요', { name: m[1] })
  // 팀장이 공유 일정을 바꿨을 때 (서버 migration_023 · 체험 모드가 만드는 문장)
  if ((m = s.match(/^(.+) 팀장이 일정을 변경했어요: ([\s\S]+?)(?: \(([^()]+ → [^()]+)\))?$/)))
    return m[3]
      ? t('{name} 팀장이 일정을 변경했어요: {title} ({change})', { name: m[1], title: m[2], change: m[3] })
      : t('{name} 팀장이 일정을 변경했어요: {title}', { name: m[1], title: m[2] })
  if ((m = s.match(/^팀장이 일정 (추가|수정|삭제) 요청에 동의했습니다\. \(([\s\S]*)\)$/)))
    return t('팀장이 일정 {verb} 요청에 동의했어요. ({title})', { verb: VERB[m[1]], title: m[2] })
  if ((m = s.match(/^팀장이 일정 (추가|수정|삭제) 요청을 거절했습니다\. \(([\s\S]*?)\)(?: 사유: ([\s\S]*))?$/)))
    return t('팀장이 일정 {verb} 요청을 거절했어요. ({title})', { verb: VERB[m[1]], title: m[2] }) + (m[3] ? t(' 사유: {reason}', { reason: m[3] }) : '')
  return s
}

interface LangCtx {
  lang: Lang
  pref: LangPref
  setPref: (p: LangPref) => void
}
const Ctx = createContext<LangCtx | null>(null)
export const useLang = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('LangProvider 필요')
  return c
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<LangPref>(loadPref)
  const [device, setDevice] = useState<Lang>(deviceLang)
  const lang: Lang = pref === 'auto' ? device : pref
  cur = lang

  // 자동일 때 기기 언어가 바뀌면 따라간다
  useEffect(() => {
    const h = () => setDevice(deviceLang())
    window.addEventListener('languagechange', h)
    return () => window.removeEventListener('languagechange', h)
  }, [])
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  const setPref = (p: LangPref) => {
    try {
      localStorage.setItem(KEY, p)
    } catch {
      /* 무시 */
    }
    setPrefState(p)
  }
  return <Ctx.Provider value={{ lang, pref, setPref }}>{children}</Ctx.Provider>
}

/** 언어가 바뀌면 화면 전체를 새로 그린다 (데이터·화면 상태는 그대로) */
export function LangKey({ children }: { children: ReactNode }) {
  const { lang } = useLang()
  return <Fragment key={lang}>{children}</Fragment>
}
