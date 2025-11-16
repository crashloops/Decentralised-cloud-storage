import React from 'react'

export type ToastType = 'info' | 'success' | 'error'

type ToastProps = {
  message: string
  type?: ToastType
}

export function Toast({ message, type = 'info' }: ToastProps) {
  const colors =
    type === 'success'
      ? 'bg-emerald-500 text-white'
      : type === 'error'
      ? 'bg-rose-500 text-white'
      : 'bg-slate-800 text-slate-100'

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 transform">
      <div
        className={`${colors} px-4 py-2 rounded-full shadow-lg text-xs sm:text-sm flex items-center gap-2`}
      >
        <span>{message}</span>
      </div>
    </div>
  )
}
