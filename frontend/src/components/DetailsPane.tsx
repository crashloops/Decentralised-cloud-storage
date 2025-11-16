import React, { useEffect, useState } from 'react'
import type { StoredEntry } from '../lib.db'

type Props = {
  entry: StoredEntry | null
  onCopyLink: (entry: StoredEntry) => void
  onRename?: (id: string, name: string) => void
  theme?: 'dark' | 'light'
  selectionCount?: number
}

export function DetailsPane({
  entry,
  onCopyLink,
  onRename,
  theme = 'dark',
  selectionCount = 0,
}: Props) {
  const isDark = theme === 'dark'
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(entry?.name ?? '')

  useEffect(() => {
    setName(entry?.name ?? '')
    setEditing(false)
  }, [entry?.id])

  const containerClass =
    'h-full flex flex-col rounded-2xl border px-4 py-3 ' +
    (isDark
      ? 'border-slate-800 bg-slate-950 text-slate-100'
      : 'border-slate-200 bg-white text-slate-900 shadow-sm')

  const labelMuted = isDark ? 'text-slate-400' : 'text-slate-500'
  const badgeEncrypted =
    'rounded-xl px-3 py-2 text-xs flex items-center gap-2 ' +
    (isDark ? 'bg-sky-600 text-white' : 'bg-sky-50 text-sky-700 border border-sky-200')
  const sectionTitle = 'mt-4 mb-1 text-xs font-semibold ' + labelMuted
  const codeCls =
    'mt-1 text-[11px] break-all font-mono rounded-lg px-2 py-1 ' +
    (isDark ? 'bg-slate-900 text-slate-200' : 'bg-slate-50 text-slate-800')

  // 🔹 CASE 1: Multiple items selected -> summary view
  if (selectionCount > 1) {
    return (
      <div className={containerClass}>
        <div className={'text-[11px] font-semibold tracking-wide mb-2 ' + labelMuted}>
          DETAILS
        </div>
        <div className="flex-1 flex flex-col justify-center">
          <div className="text-sm font-medium mb-1">
            {selectionCount} items selected
          </div>
          <div className={'text-xs ' + labelMuted}>
            Use the toolbar above for bulk actions. All selected files are still
            end-to-end encrypted on your device.
          </div>
        </div>
      </div>
    )
  }

  // 🔹 CASE 2: Nothing selected -> hint text
  if (!entry) {
    return (
      <div className={containerClass}>
        <div className={'text-[11px] font-semibold tracking-wide mb-2 ' + labelMuted}>
          DETAILS
        </div>
        <div className="flex-1 flex items-center justify-center text-sm">
          <span className={labelMuted}>Select a file to see its details.</span>
        </div>
      </div>
    )
  }

  // 🔹 CASE 3: Single file selected -> full details
  const cid = (entry as any).cid ?? entry.id

  return (
    <div className={containerClass}>
      <div className={'text-[11px] font-semibold tracking-wide mb-2 ' + labelMuted}>
        DETAILS
      </div>

      {/* name + rename */}
      <div className="flex items-start justify-between gap-2 mb-2">
        {editing && onRename ? (
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onBlur={() => {
              const trimmed = name.trim()
              if (trimmed && trimmed !== entry.name) {
                onRename(entry.id, trimmed)
              }
              setEditing(false)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                ;(e.target as HTMLInputElement).blur()
              } else if (e.key === 'Escape') {
                setEditing(false)
              }
            }}
            className={
              'flex-1 text-sm rounded-md px-2 py-1 border ' +
              (isDark
                ? 'bg-slate-900 border-slate-700 text-slate-100'
                : 'bg-white border-slate-300 text-slate-900')
            }
          />
        ) : (
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{entry.name}</div>
            <div className={'text-[11px] ' + labelMuted}>
              {entry.mime || 'file'} · {entry.size ? formatBytes(entry.size) : ''}
            </div>
          </div>
        )}

        {onRename && !editing && (
          <button
            type="button"
            className={
              'rounded-full px-3 py-1 text-[11px] border ' +
              (isDark
                ? 'border-slate-700 text-slate-200 hover:border-slate-500'
                : 'border-slate-300 text-slate-700 hover:border-slate-500')
            }
            onClick={() => {
              setEditing(true)
              setName(entry.name)
            }}
          >
            Rename
          </button>
        )}
      </div>

      {/* encrypted banner */}
      <div className={badgeEncrypted}>
        <span>🔒</span>
        <span>Encrypted on your device</span>
      </div>

      {/* preview placeholder */}
      <div
        className={
          'mt-3 rounded-2xl flex-1 min-h-[160px] flex items-center justify-center ' +
          (isDark ? 'bg-slate-900 border border-slate-800' : 'bg-slate-50 border border-slate-200')
        }
      >
        <div className="text-xs text-center">
          <div className="text-4xl mb-2">📄</div>
          <div className={labelMuted}>Preview (coming later)</div>
        </div>
      </div>

      {/* integrity */}
      <div className={sectionTitle}>Integrity</div>
      <div className="text-xs">
        <div className="font-medium">CID</div>
        <div className={codeCls}>{cid}</div>
        <div className={'mt-1 text-[11px] ' + labelMuted}>● Pinned · Mock backend</div>
      </div>

      {/* crypto */}
      <div className={sectionTitle}>Security</div>
      <div className="text-xs">
        <div>Algorithm: AES-256-GCM</div>
        <div className={'mt-1 text-[11px] ' + labelMuted}>
          Encryption keys are not displayed in this UI. Access is granted via the Share / Grant Access flow.
        </div>
      </div>

      {/* share */}
      <div className={sectionTitle}>Share</div>
      <button
        type="button"
        className={
          'w-full mt-1 rounded-xl px-3 py-2 text-xs font-medium ' +
          (isDark
            ? 'bg-slate-800 text-slate-100 hover:bg-slate-700 border border-slate-700'
            : 'bg-slate-900 text-slate-50 hover:bg-black border border-slate-900')
        }
        onClick={() => {
          // Security: Only copy CID-only link, never keys/IVs
          // The onCopyLink callback should handle secure sharing
          // For now, copy only the CID to clipboard
          const cid = (entry as any).cid ?? entry.id;
          const safeUrl = `${window.location.origin}${window.location.pathname}#id=${encodeURIComponent(cid)}`;
          navigator.clipboard.writeText(safeUrl).then(() => {
            // Call the callback for any additional handling
            onCopyLink(entry);
          }).catch(() => {
            // Fallback to callback if clipboard fails
            onCopyLink(entry);
          });
        }}
      >
        Share / Grant Access
      </button>
    </div>
  )
}

function formatBytes(n?: number) {
  if (!n && n !== 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}
