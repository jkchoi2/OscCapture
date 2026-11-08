import { useEffect, useRef, type ReactNode } from 'react'
import { ImageOff, Search } from 'lucide-react'
import type { ImageItem } from '@shared/types'
import { DRAG_TYPE } from './Sidebar'

export type SortKey = 'new' | 'old' | 'name'

interface Props {
  title: string
  items: ImageItem[]
  total: number
  selected: Set<string>
  current: string
  freshPath: string
  thumbSize: number
  hotkey: string
  query: string
  sort: SortKey
  onQuery: (q: string) => void
  onSort: (s: SortKey) => void
  onThumbSize: (n: number) => void
  onClick: (e: React.MouseEvent, item: ImageItem) => void
  onOpen: (item: ImageItem) => void
  onContextMenu: (e: React.MouseEvent, item: ImageItem) => void
  onClearSelection: () => void
}

export default function Gallery(p: Props): ReactNode {
  const gridRef = useRef<HTMLDivElement>(null)

  // Keep the keyboard-current item visible.
  useEffect(() => {
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-path="${CSS.escape(p.current)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [p.current])

  return (
    <section className="gallery">
      <div className="pane-head">
        <span className="gallery-title">
          {p.title}
          <span className="muted">
            {p.items.length !== p.total ? `${p.items.length} of ${p.total}` : p.total} {p.total === 1 ? 'image' : 'images'}
          </span>
        </span>
        <div className="gallery-tools">
          <label className="search">
            <Search size={14} />
            <input placeholder="Filter by name or note" value={p.query} onChange={(e) => p.onQuery(e.target.value)} />
          </label>
          <select value={p.sort} onChange={(e) => p.onSort(e.target.value as SortKey)}>
            <option value="new">Newest first</option>
            <option value="old">Oldest first</option>
            <option value="name">Name</option>
          </select>
          <input
            type="range"
            min={120}
            max={360}
            step={20}
            value={p.thumbSize}
            onChange={(e) => p.onThumbSize(+e.target.value)}
            title="Thumbnail size"
          />
        </div>
      </div>

      <div
        ref={gridRef}
        className="grid"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${p.thumbSize}px, 1fr))` }}
        onClick={(e) => e.target === e.currentTarget && p.onClearSelection()}
      >
        {p.items.map((it) => (
          <figure
            key={it.path}
            data-path={it.path}
            className={`thumb${p.selected.has(it.path) ? ' selected' : ''}${it.path === p.current ? ' current' : ''}${it.path === p.freshPath ? ' fresh' : ''}`}
            onClick={(e) => p.onClick(e, it)}
            onDoubleClick={() => p.onOpen(it)}
            onContextMenu={(e) => p.onContextMenu(e, it)}
            draggable
            onDragStart={(e) => {
              const paths = p.selected.has(it.path) ? [...p.selected] : [it.path]
              e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(paths))
              e.dataTransfer.effectAllowed = 'move'
            }}
          >
            <div className="thumb-img">
              <img src={window.api.imageUrl(it.path, it.mtime)} loading="lazy" draggable={false} alt="" />
              {it.note && <span className="note-dot" title={it.note} />}
            </div>
            <figcaption>{it.name}</figcaption>
          </figure>
        ))}
        {!p.items.length && (
          <div className="empty">
            <ImageOff size={40} strokeWidth={1.2} />
            <p>{p.total ? 'No images match the filter.' : 'No captures here yet.'}</p>
            {!p.total && (
              <p className="muted">
                Press <kbd>{p.hotkey}</kbd> or the Capture button to grab the scope screen.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
