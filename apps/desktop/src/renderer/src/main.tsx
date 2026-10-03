import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { applyThemeClass, loadThemeState, watchThemeState } from './lib/theme'
import { initI18n } from './i18n'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 }
  }
})

// 档位与语言都定下来再画第一帧；两者都不会 reject，这个 then 一定会跑到。
void loadThemeState().then(async (theme) => {
  applyThemeClass(theme.effective)
  watchThemeState((next) => applyThemeClass(next.effective))
  // 语言要在首帧前初始化：i18n 资源是打包进来的，init 之后 t() 立刻可用，不会闪错语种。
  await initI18n()

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>
  )
})
