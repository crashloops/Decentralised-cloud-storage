import React from 'react'

type HeaderProps = {
  address: string | null
  onConnect: () => void
  theme: 'dark' | 'light'
  onToggleTheme: () => void
}

export function Header({ address, onConnect, theme, onToggleTheme }: HeaderProps) {
  const isDark = theme === 'dark'

  // Show the *current* theme, not what you're switching to
  const themeIcon = isDark ? '🌙' : '☀️'
  const themeLabel = isDark ? 'Dark' : 'Light'

  const walletLabel = address
    ? `${address.slice(0, 6)}…${address.slice(-4)}`
    : 'Connect Wallet'

  const headerClasses = isDark
    ? 'bg-slate-950/95 border-slate-800 text-slate-100'
    : 'bg-white/90 border-slate-200 text-slate-900'

  return (
    <header
      className={
        'border-b px-4 py-3 flex items-center justify-between backdrop-blur ' +
        headerClasses
      }
    >
      {/* Left: App name */}
      <div className="flex items-center gap-2">
        <div className="h-7 w-7 rounded-xl bg-gradient-to-tr from-indigo-500 via-sky-500 to-emerald-400" />
        <div>
          {/* 🔁 rename here to whatever you want */}
          <div className="text-sm font-semibold">MetaMask Drive</div>
          <div className="text-[11px] text-slate-500">
            Decentralized storage prototype
          </div>
        </div>
      </div>

      {/* Right: theme toggle + wallet */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToggleTheme}
          className={
            'rounded-full border px-3 py-1 text-xs flex items-center gap-1 ' +
            (isDark
              ? 'border-slate-700 text-slate-200 hover:border-slate-500'
              : 'border-slate-300 text-slate-700 hover:border-slate-500')
          }
        >
          <span>{themeIcon}</span>
          <span>{themeLabel}</span>
        </button>

        <button
          type="button"
          onClick={onConnect}
          className="rounded-full bg-indigo-500/90 hover:bg-indigo-500 text-xs text-white px-3 py-1 flex items-center gap-2"
        >
          <span>🦊</span>
          <span>{walletLabel}</span>
        </button>
      </div>
    </header>
  )
}
