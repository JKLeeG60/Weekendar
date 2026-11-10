import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'
import { StoreProvider } from './lib/store'
import { CloudStoreProvider } from './lib/cloud'
import { cloudEnabled } from './lib/supabase'
import { UIProvider } from './lib/ui'

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
