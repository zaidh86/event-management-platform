import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import { CircleCheck, TriangleAlert } from 'lucide-react'

interface ToastItem {
  id: number
  kind: 'success' | 'error'
  message: string
}

const ToastContext = createContext<(kind: ToastItem['kind'], message: string) => void>(() => {})

// useToast()('success', 'Saved') — auto-dismisses; replaces persistent notices.
// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const push = useCallback((kind: ToastItem['kind'], message: string) => {
    const id = nextId.current++
    setToasts((prev) => [...prev, { id, kind, message }])
    // errors linger a little longer than confirmations
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, kind === 'error' ? 6000 : 3500)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            {t.kind === 'success'
              ? <CircleCheck size={16} aria-hidden />
              : <TriangleAlert size={16} aria-hidden />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
