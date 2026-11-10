import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css'
import './styles.css'
import App from './App'
import { StoreProvider } from './lib/store'
import { CloudStoreProvider } from './lib/cloud'
import { cloudEnabled } from './lib/supabase'
import { UIProvider } from './lib/ui'
import { captureInvite } from './lib/invite'

// 초대 링크(?join=코드)로 들어왔으면 로그인 전에 코드를 보관
captureInvite()

// 기본은 Supabase 연동. 주소 끝에 ?demo 를 붙이면 서버 없이 체험 모드.
const Provider = cloudEnabled() ? CloudStoreProvider : StoreProvider

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider>
      <UIProvider>
        <App />
      </UIProvider>
    </Provider>
  </StrictMode>,
)
