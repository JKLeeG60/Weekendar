/** 토·일 접기 상태가 바뀌면 다시 그리게 하는 훅 (값은 date.ts 가 들고 있다) */
import { useSyncExternalStore } from 'react'
import { subscribeWeekendFold, weekendFolded } from './date'

export const useWeekendFold = () => useSyncExternalStore(subscribeWeekendFold, weekendFolded)
