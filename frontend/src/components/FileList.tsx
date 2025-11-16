import React, { useEffect, useMemo, useRef, useState } from 'react'
import type { StoredEntry } from '../lib.db'

function getFileKind(mime?: string) {
  if (!mime) return 'file'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.includes('zip') || mime.includes('rar')) return 'archive'
  return 'file'
}

function getExt(name: string) {
  const idx = name.lastIndexOf('.')
  if (idx === -1) return ''
  return name.slice(idx + 1).toUpperCase()
}

function gridPreviewClasses(kind: string, theme: 'dark' | 'light') {
  const base =
    'mb-3 rounded-2xl border flex items-center justify-center overflow-hidden ' +
    'transition-colors duration-150'

  if (theme === 'dark') {
    switch (kind) {
      case 'image':
        return base + ' bg-sky-950/70 border-sky-700'
      case 'pdf':
        return base + ' bg-rose-950/70 border-rose-700'
      case 'video':
        return base + ' bg-violet-950/70 border-violet-700'
      case 'audio':
        return base + ' bg-emerald-950/70 border-emerald-700'
      case 'archive':
        return base + ' bg-amber-950/70 border-amber-700'
      default:
        return base + ' bg-slate-900 border-slate-700'
    }
  } else {
    switch (kind) {
      case 'image':
        return base + ' bg-sky-50 border-sky-200'
      case 'pdf':
        return base + ' bg-rose-50 border-rose-200'
      case 'video':
        return base + ' bg-violet-50 border-violet-200'
      case 'audio':
        return base + ' bg-emerald-50 border-emerald-200'
      case 'archive':
        return base + ' bg-amber-50 border-amber-200'
      default:
        return base + ' bg-slate-50 border-slate-200'
    }
  }
}

function gridIcon(kind: string) {
  switch (kind) {
    case 'image':
      return '🖼️'
    case 'pdf':
      return '📕'
    case 'video':
      return '🎬'
    case 'audio':
      return '🎵'
    case 'archive':
      return '🗂️'
    default:
      return '📄'
  }
}


type ViewMode = 'list' | 'grid'

type Props = {
  entries: StoredEntry[]
  selectedId: string | null
  selectedIds: string[]
  viewMode: ViewMode
  onChangeView: (mode: ViewMode) => void
  onSetSelection: (ids: string[]) => void
  onOpen: (id: string) => void
  onRemove: (id: string) => void
  isTrashView: boolean
  showDetails: boolean
  onToggleDetails: () => void
  onRename: (id: string, name: string) => void
  starredIds: string[]
  onToggleStar: (id: string) => void
  theme: 'dark' | 'light'
}

export function FileList({
  entries,
  selectedIds,
  viewMode,
  onChangeView,
  onSetSelection,
  onOpen,
  onRemove,
  isTrashView,
  showDetails,
  onToggleDetails,
  onRename,
  starredIds,
  onToggleStar,
  theme,
}: Props) {
  const [sortBy, setSortBy] = useState<'name' | 'size' | 'date'>('name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const isDark = theme === 'dark'

  const sortedEntries = useMemo(() => {
    const arr = [...entries]
    arr.sort((a, b) => {
      if (sortBy === 'name') {
        const an = (a.name || '').toLowerCase()
        const bn = (b.name || '').toLowerCase()
        if (an < bn) return sortDir === 'asc' ? -1 : 1
        if (an > bn) return sortDir === 'asc' ? 1 : -1
        return 0
      }
      if (sortBy === 'size') {
        const av = a.size || 0
        const bv = b.size || 0
        return sortDir === 'asc' ? av - bv : bv - av
      }
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return sortDir === 'asc' ? at - bt : bt - at
    })
    return arr
  }, [entries, sortBy, sortDir])

  const hasSelection = selectedIds.length > 0
  const allStarred = hasSelection && selectedIds.every(id => starredIds.includes(id))
  const bulkStarLabel = allStarred ? 'Unstar' : 'Star'

  function handleBulkRemove() {
    selectedIds.forEach(onRemove)
    onSetSelection([])
  }

  function handleBulkStar() {
    selectedIds.forEach(onToggleStar)
    onSetSelection([])
  }

  if (!sortedEntries.length) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-slate-500">
        {isTrashView ? 'Trash is empty.' : 'No files yet. Drop something above to get started.'}
      </div>
    )
  }

  const toolbarText = isDark ? 'text-slate-500' : 'text-slate-600'
  const selectClass = isDark
    ? 'bg-slate-900 border border-slate-700 rounded-full px-2 py-1 text-[11px] text-slate-200'
    : 'bg-white border border-slate-300 rounded-full px-2 py-1 text-[11px] text-slate-700'

  const toggleBase = 'px-3 py-1 rounded-full border text-xs'
  const inactiveToggle = isDark
    ? 'border-slate-700 text-slate-400 hover:border-slate-500'
    : 'border-slate-300 text-slate-500 hover:border-slate-500'

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* toolbar */}
      <div className={`flex items-center justify-between px-6 py-2 text-xs ${toolbarText}`}>
        <div className="flex items-center gap-2">
          {hasSelection ? (
            <>
              <span>{selectedIds.length} selected</span>
              <button
                type="button"
                className="rounded-full border border-rose-500/60 text-rose-500 px-3 py-1 hover:bg-rose-500/10"
                onClick={handleBulkRemove}
              >
                {isTrashView ? 'Delete' : 'Trash'}
              </button>
              <button
                type="button"
                className="rounded-full border border-amber-500/60 text-amber-500 px-3 py-1 hover:bg-amber-500/10"
                onClick={handleBulkStar}
              >
                {bulkStarLabel}
              </button>
              <button
                type="button"
                className="rounded-full border border-slate-300 text-slate-500 px-3 py-1 hover:border-slate-500"
                onClick={() => onSetSelection([])}
              >
                Clear
              </button>
            </>
          ) : (
            <>
              <span>{isTrashView ? 'Trash' : 'My Drive'}</span>
              <span className="hidden sm:inline-flex items-center gap-1">
                <span>• Sort by</span>
                <select
                  value={sortBy}
                  onChange={e => setSortBy(e.target.value as 'name' | 'size' | 'date')}
                  className={selectClass}
                >
                  <option value="name">Name</option>
                  <option value="size">Size</option>
                  <option value="date">Date</option>
                </select>
                <button
                  type="button"
                  className={
                    (isDark
                      ? 'ml-1 rounded-full border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-500'
                      : 'ml-1 rounded-full border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:border-slate-500')
                  }
                  onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
                >
                  {sortDir === 'asc' ? '↑' : '↓'}
                </button>
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className={
              toggleBase +
              ' ' +
              (showDetails
                ? 'border-emerald-500 bg-emerald-500/10 text-emerald-600'
                : inactiveToggle)
            }
            onClick={onToggleDetails}
          >
            Details
          </button>
          <button
            className={
              toggleBase +
              ' ' +
              (viewMode === 'list'
                ? 'border-sky-500 bg-sky-500/10 text-sky-600'
                : inactiveToggle)
            }
            onClick={() => onChangeView('list')}
          >
            List
          </button>
          <button
            className={
              toggleBase +
              ' ' +
              (viewMode === 'grid'
                ? 'border-sky-500 bg-sky-500/10 text-sky-600'
                : inactiveToggle)
            }
            onClick={() => onChangeView('grid')}
          >
            Grid
          </button>
        </div>
      </div>

      {viewMode === 'list' ? (
        <ListView
          entries={sortedEntries}
          selectedIds={selectedIds}
          onSetSelection={onSetSelection}
          onOpen={onOpen}
          onRemove={onRemove}
          isTrashView={isTrashView}
          onRename={onRename}
          starredIds={starredIds}
          onToggleStar={onToggleStar}
          theme={theme}
        />
      ) : (
        <GridView
          entries={sortedEntries}
          selectedIds={selectedIds}
          onSetSelection={onSetSelection}
          onOpen={onOpen}
          onRemove={onRemove}
          isTrashView={isTrashView}
          onRename={onRename}
          starredIds={starredIds}
          onToggleStar={onToggleStar}
          theme={theme}
        />
      )}
    </div>
  )
}

/* ---------- shared item-click helper ---------- */

function handleItemClick(
  ev: React.MouseEvent,
  id: string,
  entries: StoredEntry[],
  selectedIds: string[],
  onSetSelection: (ids: string[]) => void
) {
  ev.preventDefault()
  const multiKey = ev.ctrlKey || ev.metaKey
  const shiftKey = ev.shiftKey

  const orderIds = entries.map(e => e.id)

  if (shiftKey && selectedIds.length > 0) {
    const lastSelected =
      [...selectedIds].reverse().find(x => orderIds.includes(x)) || id
    const start = orderIds.indexOf(lastSelected)
    const end = orderIds.indexOf(id)
    if (start === -1 || end === -1) {
      onSetSelection([id])
      return
    }
    const [from, to] = start < end ? [start, end] : [end, start]
    const rangeIds = orderIds.slice(from, to + 1)
    const union = Array.from(new Set([...selectedIds, ...rangeIds]))
    onSetSelection(union)
    return
  }

  if (multiKey) {
    if (selectedIds.includes(id)) {
      onSetSelection(selectedIds.filter(x => x !== id))
    } else {
      onSetSelection([...selectedIds, id])
    }
    return
  }

  onSetSelection([id])
}

/* ---------- LIST VIEW (with marquee + theme) ---------- */

function ListView({
  entries,
  selectedIds,
  onSetSelection,
  onOpen,
  onRemove,
  isTrashView,
  onRename,
  starredIds,
  onToggleStar,
  theme,
}: {
  entries: StoredEntry[]
  selectedIds: string[]
  onSetSelection: (ids: string[]) => void
  onOpen: (id: string) => void
  onRemove: (id: string) => void
  isTrashView: boolean
  onRename: (id: string, name: string) => void
  starredIds: string[]
  onToggleStar: (id: string) => void
  theme: 'dark' | 'light'
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const isDark = theme === 'dark'

  const containerRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!dragging || !dragStart || !dragCurrent || !containerRef.current) return

    const x1 = Math.min(dragStart.x, dragCurrent.x)
    const x2 = Math.max(dragStart.x, dragCurrent.x)
    const y1 = Math.min(dragStart.y, dragCurrent.y)
    const y2 = Math.max(dragStart.y, dragCurrent.y)

    const containerRect = containerRef.current.getBoundingClientRect()
    const selected: string[] = []

    entries.forEach(e => {
      const el = itemRefs.current.get(e.id)
      if (!el) return
      const r = el.getBoundingClientRect()
      const rx1 = r.left - containerRect.left
      const ry1 = r.top - containerRect.top
      const rx2 = rx1 + r.width
      const ry2 = ry1 + r.height

      const intersects = rx2 >= x1 && rx1 <= x2 && ry2 >= y1 && ry1 <= y2
      if (intersects) selected.push(e.id)
    })

    onSetSelection(selected)
  }, [dragging, dragStart, dragCurrent, entries, onSetSelection])

  function onMouseDownContainer(ev: React.MouseEvent<HTMLDivElement>) {
    if (ev.button !== 0) return
    const target = ev.target as HTMLElement
    if (target.closest('[data-file-id]')) return

    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    ev.preventDefault()
    const x = ev.clientX - rect.left
    const y = ev.clientY - rect.top
    setDragging(true)
    setDragStart({ x, y })
    setDragCurrent({ x, y })
    onSetSelection([])
  }

  function onMouseMoveContainer(ev: React.MouseEvent<HTMLDivElement>) {
    if (!dragging) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = ev.clientX - rect.left
    const y = ev.clientY - rect.top
    setDragCurrent({ x, y })
  }

  function onMouseUpContainer() {
    if (!dragging) return
    setDragging(false)
    setDragStart(null)
    setDragCurrent(null)
  }

  const headerRowClass =
    'px-6 py-2 flex items-center ' +
    (isDark
      ? 'border-b border-slate-800 bg-slate-900 text-slate-200'
      : 'border-b border-slate-200 bg-slate-100 text-slate-700')

  return (
    <div
      ref={containerRef}
      className={
        'text-sm flex-1 overflow-auto relative ' +
        (isDark ? 'text-slate-200 bg-slate-950' : 'text-slate-800 bg-slate-50')
      }
      onMouseDown={onMouseDownContainer}
      onMouseMove={onMouseMoveContainer}
      onMouseUp={onMouseUpContainer}
      onMouseLeave={onMouseUpContainer}
    >
      {dragging && dragStart && dragCurrent && (
        <div
          className="absolute border border-sky-400/80 bg-sky-400/10 pointer-events-none z-10"
          style={{
            left: Math.min(dragStart.x, dragCurrent.x),
            top: Math.min(dragStart.y, dragCurrent.y),
            width: Math.abs(dragCurrent.x - dragStart.x),
            height: Math.abs(dragCurrent.y - dragStart.y),
          }}
        />
      )}

      <div className={headerRowClass}>
        <div className="w-6" />
        <div className="flex-1 flex items-center gap-1">
          <span>Name</span>
        </div>
        <div className={isDark ? 'w-32 text-right text-slate-400' : 'w-32 text-right text-slate-600'}>
          Size
        </div>
        <div className={isDark ? 'w-48 text-right text-slate-400' : 'w-48 text-right text-slate-600'}>
          Created
        </div>
        <div className={isDark ? 'w-28 text-right text-slate-400' : 'w-28 text-right text-slate-600'}>
          Actions
        </div>
      </div>

      <div className={isDark ? 'divide-y divide-slate-800' : 'divide-y divide-slate-200'}>
        {entries.map(e => {
          const isSelected = selectedIds.includes(e.id)
          const isEditing = editingId === e.id
          const isStarred = starredIds.includes(e.id)

          const rowClass =
            'px-6 py-2 flex items-center cursor-pointer ' +
            (isSelected
              ? isDark
                ? 'bg-slate-800/80 border-l-2 border-l-sky-400'
                : 'bg-sky-50 border-l-2 border-l-sky-400'
              : isDark
              ? 'hover:bg-slate-900'
              : 'hover:bg-slate-100')

          const nameInputClass =
            'rounded px-2 py-1 text-xs w-full border ' +
            (isDark
              ? 'bg-slate-900 border-slate-700 text-slate-100'
              : 'bg-white border-slate-300 text-slate-800')

          const sizeClass = 'w-32 text-right ' + (isDark ? 'text-slate-300' : 'text-slate-700')
          const dateClass = 'w-48 text-right ' + (isDark ? 'text-slate-400' : 'text-slate-600')

          return (
            <div
              key={e.id}
              data-file-id={e.id}
              ref={el => {
                if (el) itemRefs.current.set(e.id, el)
                else itemRefs.current.delete(e.id)
              }}
              className={rowClass}
              onClick={ev => handleItemClick(ev, e.id, entries, selectedIds, onSetSelection)}
              onDoubleClick={ev => {
                ev.stopPropagation()
                onOpen(e.id)
              }}
            >
              <div className="w-6 text-slate-500">📄</div>
              <div className="flex-1 flex items-center gap-2">
                {isEditing ? (
                  <input
                    autoFocus
                    value={editingName}
                    onChange={ev => setEditingName(ev.target.value)}
                    onBlur={() => {
                      const trimmed = editingName.trim()
                      if (trimmed && trimmed !== e.name) {
                        onRename(e.id, trimmed)
                      }
                      setEditingId(null)
                    }}
                    onKeyDown={ev => {
                      if (ev.key === 'Enter') {
                        ;(ev.target as HTMLInputElement).blur()
                      } else if (ev.key === 'Escape') {
                        setEditingId(null)
                      }
                    }}
                    className={nameInputClass}
                  />
                ) : (
                  <button
                    type="button"
                    className="text-sm text-left truncate hover:underline"
                    onClick={ev => {
                      ev.stopPropagation()
                      setEditingId(e.id)
                      setEditingName(e.name)
                    }}
                  >
                    {e.name}
                  </button>
                )}

                <button
                  type="button"
                  className={
                    'text-[13px]' +
                    (isStarred ? ' text-amber-400' : ' text-slate-500 hover:text-amber-400')
                  }
                  onClick={ev => {
                    ev.stopPropagation()
                    onToggleStar(e.id)
                  }}
                  aria-label={isStarred ? 'Unstar' : 'Star'}
                >
                  {isStarred ? '★' : '☆'}
                </button>

                <span className="ml-1 inline-flex items-center rounded-full bg-emerald-500/15 text-emerald-600 text-[11px] px-2 py-[1px]">
                  encrypted
                </span>
              </div>

              <div className={sizeClass}>{formatBytes(e.size)}</div>
              <div className={dateClass}>
                {e.createdAt ? new Date(e.createdAt).toLocaleString() : ''}
              </div>
              <div className="w-28 text-right space-x-3">
                <button
                  className="text-sky-500 hover:underline"
                  onClick={ev => {
                    ev.stopPropagation()
                    onOpen(e.id)
                  }}
                >
                  Open
                </button>
                <button
                  className="text-rose-500 hover:underline"
                  onClick={ev => {
                    ev.stopPropagation()
                    onRemove(e.id)
                  }}
                >
                  {isTrashView ? 'Delete' : 'Trash'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ---------- GRID VIEW (with marquee + theme) ---------- */

function GridView({
  entries,
  selectedIds,
  onSetSelection,
  onOpen,
  onRemove,
  isTrashView,
  onRename,
  starredIds,
  onToggleStar,
  theme,
}: {
  entries: StoredEntry[]
  selectedIds: string[]
  onSetSelection: (ids: string[]) => void
  onOpen: (id: string) => void
  onRemove: (id: string) => void
  isTrashView: boolean
  onRename: (id: string, name: string) => void
  starredIds: string[]
  onToggleStar: (id: string) => void
  theme: 'dark' | 'light'
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const isDark = theme === 'dark'

  const containerRef = useRef<HTMLDivElement | null>(null)
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const [dragging, setDragging] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    if (!dragging || !dragStart || !dragCurrent || !containerRef.current) return

    const x1 = Math.min(dragStart.x, dragCurrent.x)
    const x2 = Math.max(dragStart.x, dragCurrent.x)
    const y1 = Math.min(dragStart.y, dragCurrent.y)
    const y2 = Math.max(dragStart.y, dragCurrent.y)

    const containerRect = containerRef.current.getBoundingClientRect()
    const selected: string[] = []

    entries.forEach(e => {
      const el = itemRefs.current.get(e.id)
      if (!el) return
      const r = el.getBoundingClientRect()
      const rx1 = r.left - containerRect.left
      const ry1 = r.top - containerRect.top
      const rx2 = rx1 + r.width
      const ry2 = ry1 + r.height

      const intersects = rx2 >= x1 && rx1 <= x2 && ry2 >= y1 && ry1 <= y2
      if (intersects) selected.push(e.id)
    })

    onSetSelection(selected)
  }, [dragging, dragStart, dragCurrent, entries, onSetSelection])

  function onMouseDownContainer(ev: React.MouseEvent<HTMLDivElement>) {
    if (ev.button !== 0) return
    const target = ev.target as HTMLElement
    if (target.closest('[data-file-id]')) return

    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    ev.preventDefault()
    const x = ev.clientX - rect.left
    const y = ev.clientY - rect.top
    setDragging(true)
    setDragStart({ x, y })
    setDragCurrent({ x, y })
    onSetSelection([])
  }

  function onMouseMoveContainer(ev: React.MouseEvent<HTMLDivElement>) {
    if (!dragging) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = ev.clientX - rect.left
    const y = ev.clientY - rect.top
    setDragCurrent({ x, y })
  }

  function onMouseUpContainer() {
    if (!dragging) return
    setDragging(false)
    setDragStart(null)
    setDragCurrent(null)
  }

  const containerBg = isDark ? 'bg-slate-950' : 'bg-slate-50'

  return (
    <div
      ref={containerRef}
      className={`flex-1 px-6 pb-4 overflow-auto relative ${containerBg}`}
      onMouseDown={onMouseDownContainer}
      onMouseMove={onMouseMoveContainer}
      onMouseUp={onMouseUpContainer}
      onMouseLeave={onMouseUpContainer}
    >
      {dragging && dragStart && dragCurrent && (
        <div
          className="absolute border border-sky-400/80 bg-sky-400/10 pointer-events-none z-10"
          style={{
            left: Math.min(dragStart.x, dragCurrent.x),
            top: Math.min(dragStart.y, dragCurrent.y),
            width: Math.abs(dragCurrent.x - dragStart.x),
            height: Math.abs(dragCurrent.y - dragStart.y),
          }}
        />
      )}

      <div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Upload</div>
      <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {entries.map(e => {
          const isSelected = selectedIds.includes(e.id)
          const isEditing = editingId === e.id
          const label = typeLabel(e.mime)
          const badge =
            label === 'PDF'
              ? 'bg-rose-500/20 text-rose-600'
              : label === 'Video'
              ? 'bg-emerald-500/20 text-emerald-600'
              : label === 'Code'
              ? 'bg-sky-500/20 text-sky-600'
              : 'bg-slate-500/10 text-slate-600'
          const isStarred = starredIds.includes(e.id)

          const kind = getFileKind(e.mime)
          const ext = getExt(e.name)

          const cardClassBase = isSelected
            ? isDark
              ? 'bg-slate-900 border-sky-400 shadow-[0_0_0_1px_rgba(56,189,248,0.6)]'
              : 'bg-sky-50 border-sky-400 shadow-[0_0_0_1px_rgba(56,189,248,0.5)]'
            : isDark
            ? 'bg-slate-900/80 border-slate-800 hover:border-slate-600'
            : 'bg-white border-slate-200 hover:border-slate-400'

          const encryptedPill =
            'text-xs font-medium px-2 py-[2px] rounded-full inline-flex items-center gap-1 ' +
            (isDark ? 'bg-slate-800 text-slate-100' : 'bg-slate-100 text-slate-700')

          const nameInputClass =
            'bg-transparent border rounded px-2 py-1 text-xs w-full ' +
            (isDark ? 'border-slate-700 text-slate-100' : 'border-slate-300 text-slate-800')

          return (
            <div
              key={e.id}
              data-file-id={e.id}
              ref={el => {
                if (el) itemRefs.current.set(e.id, el)
                else itemRefs.current.delete(e.id)
              }}
              className={
                'rounded-2xl border px-3 pt-3 pb-2 flex flex-col justify-between cursor-pointer ' +
                cardClassBase
              }
              onClick={ev => handleItemClick(ev, e.id, entries, selectedIds, onSetSelection)}
              onDoubleClick={ev => {
                ev.stopPropagation()
                onOpen(e.id)
              }}
            >
              <div className="mb-3">
                <div className="flex items-center justify-between mb-1">
                  <button
                    type="button"
                    className={
                      'text-sm ' +
                      (isStarred ? 'text-amber-400' : 'text-slate-500 hover:text-amber-400')
                    }
                    onClick={ev => {
                      ev.stopPropagation()
                      onToggleStar(e.id)
                    }}
                  >
                    {isStarred ? '★' : '☆'}
                  </button>
                </div>

                {/* NEW: richer preview panel */}
                <div className={gridPreviewClasses(kind, theme)}>
                  <div className="relative w-full h-28 flex items-center justify-center">
                    <span className="text-4xl select-none">{gridIcon(kind)}</span>

                    {ext && (
                      <div className="absolute top-2 left-2 px-2 py-[2px] rounded-full text-[10px] font-semibold uppercase bg-black/40 text-slate-50 backdrop-blur">
                        {ext}
                      </div>
                    )}

                    <div className="absolute bottom-2 right-2 px-2 py-[2px] rounded-full text-[10px] font-medium bg-black/35 text-slate-50 backdrop-blur">
                      {label}
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between mb-1">
                  <div className={encryptedPill}>
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    <span>encrypted</span>
                  </div>
                  <span className={`text-[11px] px-2 py-[1px] rounded-full ${badge}`}>{label}</span>
                </div>

                <div className="mt-1 flex flex-col gap-1">
                  {isEditing ? (
                    <input
                      autoFocus
                      value={editingName}
                      onChange={ev => setEditingName(ev.target.value)}
                      onBlur={() => {
                        const trimmed = editingName.trim()
                        if (trimmed && trimmed !== e.name) {
                          onRename(e.id, trimmed)
                        }
                        setEditingId(null)
                      }}
                      onKeyDown={ev => {
                        if (ev.key === 'Enter') {
                          ;(ev.target as HTMLInputElement).blur()
                        } else if (ev.key === 'Escape') {
                          setEditingId(null)
                        }
                      }}
                      className={nameInputClass}
                    />
                  ) : (
                    <button
                      type="button"
                      className="text-sm text-left truncate hover:underline"
                      onClick={ev => {
                        ev.stopPropagation()
                        setEditingId(e.id)
                        setEditingName(e.name)
                      }}
                    >
                      {e.name}
                    </button>
                  )}
                  <div className="text-xs text-slate-500">{formatBytes(e.size)}</div>
                  <div className="text-xs text-slate-500">
                    {e.createdAt ? new Date(e.createdAt).toLocaleString() : ''}
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs mt-2">
                <button
                  className="text-sky-600 hover:underline"
                  onClick={ev => {
                    ev.stopPropagation()
                    onOpen(e.id)
                  }}
                >
                  Open
                </button>
                <button
                  className="text-rose-500 hover:underline"
                  onClick={ev => {
                    ev.stopPropagation()
                    onRemove(e.id)
                  }}
                >
                  {isTrashView ? 'Delete' : 'Trash'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}


/* ---------- helpers ---------- */

function typeLabel(mime?: string) {
  if (!mime) return 'File'
  if (mime.startsWith('image/')) return 'Image'
  if (mime.startsWith('video/')) return 'Video'
  if (mime === 'application/pdf') return 'PDF'
  if (mime.includes('javascript') || mime.includes('json') || mime.includes('text/x-')) return 'Code'
  return 'File'
}

function formatBytes(n?: number) {
  if (!n && n !== 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}
