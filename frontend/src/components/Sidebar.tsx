import React from 'react'

type Tab = 'drive' | 'shared' | 'starred' | 'trash'

type SidebarProps = {
  activeTab: Tab
  onChangeTab: (tab: Tab) => void
  storageUsedBytes: number
  storageLimitBytes?: number
  theme: 'dark' | 'light'
}

export function Sidebar({
  activeTab,
  onChangeTab,
  storageUsedBytes,
  storageLimitBytes,
  theme,
}: SidebarProps) {
  const items: { label: string; icon: string; key: Tab }[] = [
    { label: 'My Drive', icon: '📁', key: 'drive' },
    { label: 'Shared with me', icon: '👥', key: 'shared' },
    { label: 'Starred', icon: '⭐', key: 'starred' },
    { label: 'Trash', icon: '🗑️', key: 'trash' },
  ]

  const limit = storageLimitBytes ?? 5 * 1024 ** 3
  const used = Math.min(storageUsedBytes, limit)
  const pct = limit > 0 ? Math.round((used / limit) * 100) : 0

  const base =
    theme === 'dark'
      ? 'bg-slate-950 border-slate-800'
      : 'bg-white border-slate-200'

  const activeClasses =
    theme === 'dark'
      ? 'bg-slate-800 text-slate-50'
      : 'bg-slate-100 text-slate-900'

  const inactiveClasses =
    theme === 'dark'
      ? 'text-slate-300 hover:bg-slate-900 hover:text-slate-50'
      : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'

  return (
    <nav className={`h-full w-56 border-r py-4 px-2 flex flex-col ${base}`}>
      <div className="flex flex-col gap-1">
        {items.map(item => (
          <button
            key={item.key}
            className={
              'flex items-center gap-3 rounded-xl px-3 py-2 text-sm w-full ' +
              (item.key === activeTab ? activeClasses : inactiveClasses)
            }
            onClick={() => onChangeTab(item.key)}
          >
            <span className="w-5 text-center">{item.icon}</span>
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>

      {/* Storage bar */}
      <div className="mt-6 px-3">
        <div className="text-[11px] text-slate-400 mb-1">Storage</div>
        <div className="h-1.5 rounded-full bg-slate-900 overflow-hidden border border-slate-800">
          <div
            className="h-full rounded-full bg-sky-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          {formatBytes(used)} of {formatBytes(limit)} used
        </div>
      </div>

      <div className="mt-auto px-3 pt-4 text-xs text-slate-500">
        <div className="mb-1 text-slate-400">Backend</div>
        <div>Mock (local)</div>
      </div>
    </nav>
  )
}

function formatBytes(n: number) {
  if (!n && n !== 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}
