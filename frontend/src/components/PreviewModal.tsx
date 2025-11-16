import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Props = { url: string; mime: string; name: string; onClose: () => void }

export function PreviewModal({ url, mime, name, onClose }: Props) {
  const ref = useRef<HTMLDialogElement | null>(null)
  const [isMounted, setIsMounted] = useState(false)

  // 1) Wait until DOM exists so document.body is defined for the portal
  useEffect(() => { setIsMounted(true) }, [])

  // 2) Open/close the native dialog safely
  useEffect(() => {
    const dlg = ref.current
    if (!dlg) return
    if (!dlg.open) {
      try { dlg.showModal() } catch { /* ignore double opens */ }
    }
    const handleClose = () => onClose()
    dlg.addEventListener('close', handleClose)
    return () => {
      dlg.removeEventListener('close', handleClose)
      try { if (dlg.open) dlg.close() } catch {}
    }
  }, [onClose])

  const body = (() => {
    if (mime?.startsWith('image/')) return <img src={url} alt={name} className="max-h-[80vh] max-w-full rounded-xl border border-slate-700" />
    if (mime?.startsWith('video/')) return <video src={url} controls className="max-h-[80vh] max-w-full rounded-xl border border-slate-700" />
    if (mime === 'application/pdf' || mime?.startsWith('text/')) return <iframe src={url} title={name} className="w-[80vw] h-[80vh] rounded-xl border border-slate-700" />
    return (
      <div className="text-slate-300 text-sm">
        Preview not available for <code>{mime || 'unknown'}</code>.{' '}
        <a href={url} download={name} className="text-indigo-400 underline">Download</a> instead.
      </div>
    )
  })()

  if (!isMounted) return null

  return createPortal(
    <>
      <dialog
        ref={ref}
        aria-label="File preview"
        className="bg-slate-900 text-slate-100 rounded-2xl border border-slate-700 p-0 w-auto"
      >
        <div className="p-4 flex items-center justify-between border-b border-slate-700">
          <div className="text-sm text-slate-300">
            {name} <span className="text-slate-500">({mime || 'file'})</span>
          </div>
          <form method="dialog">
            <button className="rounded-lg bg-slate-800 px-3 py-1 text-sm hover:bg-slate-700">Close</button>
          </form>
        </div>
        <div className="p-4 grid place-items-center">{body}</div>
      </dialog>

      <style>{`dialog::backdrop { background: rgba(0,0,0,0.65); }`}</style>
    </>,
    document.body
  )
}
