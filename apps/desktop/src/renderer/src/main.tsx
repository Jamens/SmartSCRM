import './assets/main.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { applyThemeClass, loadThemeState, watchThemeState } from './lib/theme'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1 }
  }
})

// 档位定下来再画第一帧；loadThemeState 不会 reject，这个 then 一定会跑到。
void loadThemeState().then((theme) => {
  applyThemeClass(theme.effective)
  watchThemeState((next) => applyThemeClass(next.effective))

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>
  )
})
