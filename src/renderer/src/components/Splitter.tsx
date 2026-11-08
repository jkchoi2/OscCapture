import { useRef, type ReactNode } from 'react'

interface Props {
  width: number
  min: number
  max: () => number
  onResize: (width: number) => void
  onCommit: (width: number) => void
  onReset: () => void
}

/** Vertical drag handle that resizes the pane to its left. */
export default function Splitter(p: Props): ReactNode {
  const start = useRef<{ x: number; w: number } | null>(null)
  const last = useRef(p.width)

  return (
    <div
      className="splitter"
      title="Drag to resize · double-click to reset"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, w: p.width }
        last.current = p.width
        e.currentTarget.classList.add('dragging')
      }}
      onPointerMove={(e) => {
        const s = start.current
        if (!s) return
        last.current = Math.round(Math.min(Math.max(s.w + e.clientX - s.x, p.min), p.max()))
        p.onResize(last.current)
      }}
      onPointerUp={(e) => {
        if (!start.current) return
        start.current = null
        e.currentTarget.classList.remove('dragging')
        p.onCommit(last.current)
      }}
      onDoubleClick={p.onReset}
    />
  )
}
