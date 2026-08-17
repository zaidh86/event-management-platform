import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ThemeProvider } from './contexts/ThemeContext'

// Preconnect to the Supabase origin so the first session/auth request skips
// DNS + TLS setup. The URL only exists at runtime (env), hence not in index.html.
try {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  if (url) {
    const link = document.createElement('link')
    link.rel = 'preconnect'
    link.href = new URL(url).origin
    link.crossOrigin = 'anonymous'
    document.head.appendChild(link)
  }
} catch {
  // malformed URL — the app's setup screen handles unconfigured environments
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </StrictMode>,
)
