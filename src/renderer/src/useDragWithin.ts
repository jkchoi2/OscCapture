import { useEffect, useRef, useState } from 'react'

interface Start {
  x: number
  y: number
  ox: number
  oy: number
  rect: DOMRect
}

/** Drags an element by a handle, keeping it inside the window. Starts at its laid-out position. */
export function useDragWithin<T extends HTMLElement>(): {
  ref: React.RefObject<T | null>
  offset: { x: number; y: number }
  handleProps: React.HTMLAttributes<HTMLElement>
} {
  const ref = useRef<T>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const start = useRef<Start | null>(null)

  // 창 크기가 바뀌면 밖으로 밀려나지 않게 원래 위치로 되돌림
  useEffect(() => {
    const reset = (): void => setOffset({ x: 0, y: 0 })
    window.addEventListener('resize', reset)
    return () => window.removeEventListener('resize', reset)
  }, [])

  const handleProps: React.HTMLAttributes<HTMLElement> = {
    onPointerDown: (e) => {
      if (e.button !== 0 || !ref.current) return
      e.currentTarget.setPointerCapture(e.pointerId)
      start.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y, rect: ref.current.getBoundingClientRect() }
    },
    onPointerMove: (e) => {
      const s = start.current
      if (!s) return
      const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi))
      const dx = clamp(e.clientX - s.x, -s.rect.left, window.innerWidth - s.rect.right)
      const dy = clamp(e.clientY - s.y, -s.rect.top, window.innerHeight - s.rect.bottom)
      setOffset({ x: s.ox + dx, y: s.oy + dy })
    },
    onPointerUp: () => {
      start.current = null
    },
    onPointerCancel: () => {
      start.current = null
    }
  }

  return { ref, offset, handleProps }
}
