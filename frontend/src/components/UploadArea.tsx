import React, { useRef, useState } from 'react'

type Props = {
  onFiles: (files: FileList) => void
  theme: 'dark' | 'light'
}

export function UploadArea({ onFiles, theme }: Props) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const isDark = theme === 'dark'

  const base =
    'w-full rounded-2xl border-2 border-dashed transition-colors duration-150 cursor-pointer ' +
    'px-4 py-8 flex flex-col items-center justify-center text-sm text-center'

  const cls =
    base +
    ' ' +
    (isDragging
      ? isDark
        ? 'bg-slate-900/90 border-sky-400 text-sky-100'
        : 'bg-sky-50 border-sky-400 text-sky-700'
      : isDark
      ? 'bg-slate-900/80 border-slate-700 text-slate-200'
      : 'bg-slate-100 border-slate-300 text-slate-700')

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    onFiles(files)
    setIsDragging(false)
  }

  return (
    <div
      className={cls}
      onDragOver={e => {
        e.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={e => {
        e.preventDefault()
        setIsDragging(false)
      }}
      onDrop={e => {
        e.preventDefault()
        handleFiles(e.dataTransfer.files)
      }}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />
      <div className="font-medium text-sm">
        Drag &amp; Drop files here or click to select
      </div>
      <div className={isDark ? 'mt-1 text-xs text-slate-400' : 'mt-1 text-xs text-slate-500'}>
        Files are encrypted on your device before being stored.
      </div>
    </div>
  )
}
