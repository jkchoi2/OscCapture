import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeft,
  Copy,
  Download,
  ExternalLink,
  FolderSearch,
  Maximize2,
  Minimize2,
  Minus,
  Pencil,
  Plus,
  Scan,
  Trash2
} from 'lucide-react'
import type { ImageItem } from '@shared/types'
import { formatBytes, formatDate } from '../util'

interface Props {
  item: ImageItem | null
  selectedCount: number
  full: boolean
  onToggleFull: () => void
  onCopy: () => void
  onExport: () => void
  onReveal: () => void
  onOpenExternal: () => void
  onDelete: () => void
  onRename: () => void
  onNote: (note: string) => void
}

interface View {
  scale: number
  x: number
  y: number
  fit: boolean
}

export default function Viewer(p: Props): ReactNode {
  const stageRef = useRef<HTMLDivElement>(null)
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  const [view, setView] = useState<View>({ scale: 1, x: 0, y: 0, fit: true })
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)

  const fitScale = useCallback((): number => {
    const el = stageRef.current
    if (!el || !natural.w) return 1
    // Keep clear of the back button (top) and the floating toolbar (bottom).
    return Math.min((el.clientWidth - 32) / natural.w, (el.clientHeight - 2 * 60) / natural.h, 4)
  }, [natural])

  const fit = useCallback(() => setView({ scale: fitScale(), x: 0, y: 0, fit: true }), [fitScale])

  useEffect(() => {
    setView((v) => (v.fit ? { scale: fitScale(), x: 0, y: 0, fit: true } : v))
    const el = stageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setView((v) => (v.fit ? { ...v, scale: fitScale() } : v)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [fitScale])

  useEffect(() => setView((v) => ({ ...v, x: 0, y: 0, fit: true })), [p.item?.path])

  const zoomAt = (factor: number, cx = 0, cy = 0): void =>
    setView((v) => {
      const scale = Math.min(Math.max(v.scale * factor, 0.1), 16)
      const k = scale / v.scale
      return { scale, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k, fit: false }
    })

  const onWheel = (e: React.WheelEvent): void => {
    const r = stageRef.current!.getBoundingClientRect()
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2)
  }

  const [note, setNote] = useState('')
  useEffect(() => setNote(p.item?.note ?? ''), [p.item?.path, p.item?.note])

  if (!p.item) {
    return (
      <section className="viewer">
        <div className="stage empty-stage">
          <Scan size={48} strokeWidth={1} />
          <p>Select a capture to preview</p>
        </div>
      </section>
    )
  }

  const it = p.item
  const pct = Math.round(view.scale * 100)

  return (
    <section className={`viewer${p.full ? ' full' : ''}`}>
      <div
        ref={stageRef}
        className={`stage${drag.current ? ' panning' : ''}`}
        onWheel={onWheel}
        onDoubleClick={() => (view.fit ? setView({ scale: 1, x: 0, y: 0, fit: false }) : fit())}
        onMouseDown={(e) => {
          if (e.button !== 0) return
          drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
        }}
        onMouseMove={(e) => {
          const d = drag.current
          if (!d) return
          setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y, fit: false }))
        }}
        onMouseUp={() => (drag.current = null)}
        onMouseLeave={() => (drag.current = null)}
      >
        <img
          src={window.api.imageUrl(it.path, it.mtime)}
          draggable={false}
          alt={it.name}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={{
            transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            imageRendering: view.scale >= 2 ? 'pixelated' : 'auto'
          }}
        />

        {p.full && (
          <button
            className="back-btn"
            onClick={p.onToggleFull}
            onMouseDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            title="Back to list (Esc)"
          >
            <ArrowLeft size={15} /> Back to list
          </button>
        )}

        <div className="stage-toolbar" onMouseDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" onClick={() => zoomAt(1 / 1.25)} title="Zoom out">
            <Minus size={15} />
          </button>
          <span className="zoom-label" onClick={fit} title="Fit to window">
            {view.fit ? 'Fit' : `${pct}%`}
          </span>
          <button className="icon-btn" onClick={() => zoomAt(1.25)} title="Zoom in">
            <Plus size={15} />
          </button>
          <button className="icon-btn" onClick={() => setView({ scale: 1, x: 0, y: 0, fit: false })} title="Actual size (1:1)">
            <span className="one-to-one">1:1</span>
          </button>
          <div className="tb-sep" />
          <button className="icon-btn" onClick={p.onCopy} title="Copy to clipboard (Ctrl+C)">
            <Copy size={15} />
          </button>
          <button className="icon-btn" onClick={p.onExport} title="Export…">
            <Download size={15} />
          </button>
          <button className="icon-btn" onClick={p.onReveal} title="Show in Explorer">
            <FolderSearch size={15} />
          </button>
          <button className="icon-btn" onClick={p.onOpenExternal} title="Open with default app">
            <ExternalLink size={15} />
          </button>
          <button className="icon-btn danger" onClick={p.onDelete} title="Delete (Del)">
            <Trash2 size={15} />
          </button>
          <div className="tb-sep" />
          <button className="icon-btn" onClick={p.onToggleFull} title={p.full ? 'Back to grid (Esc)' : 'Expand viewer (Enter)'}>
            {p.full ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </div>

      <div className="info">
        <button className="info-name" onClick={p.onRename} title="Rename (F2)">
          <span>{it.name}</span>
          <Pencil size={13} />
        </button>
        {p.selectedCount > 1 && <div className="info-multi">{p.selectedCount} images selected</div>}
        <dl>
          <dt>Captured</dt>
          <dd>{formatDate(it.mtime)}</dd>
          <dt>Size</dt>
          <dd>
            {it.width && it.height ? `${it.width} × ${it.height} · ` : ''}
            {formatBytes(it.size)}
          </dd>
          <dt>Folder</dt>
          <dd>{it.folder || '(root)'}</dd>
          {it.idn && (
            <>
              <dt>Instrument</dt>
              <dd title={it.idn}>{it.idn
                  .split(',')
                  .slice(1, 3)
                  .map((s) => s.trim())
                  .filter((s) => s && s !== '0') // the 34401A reports serial "0"
                  .join(' · ')}</dd>
            </>
          )}
        </dl>
        <textarea
          className="note"
          placeholder="Add a note (test condition, probe, DUT…)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== it.note && p.onNote(note)}
          onKeyDown={(e) => e.stopPropagation()}
        />
      </div>
    </section>
  )
}
