// the undo toast, bottom centre

import type { ToastState } from '../use-toast'

interface ToastProps {
  toast: ToastState | null
  onUndo: () => void
  onDismiss: () => void
}

/** single toast; the undo button appears only when the write has an inverse */
export function Toast({ toast, onUndo, onDismiss }: ToastProps) {
  if (!toast) return null
  return (
    <div className="toast" role="status">
      <span className={toast.tone === 'error' ? 'err' : ''}>{toast.message}</span>
      {toast.undo ? <button onClick={onUndo}>undo</button> : <button onClick={onDismiss}>ok</button>}
    </div>
  )
}
