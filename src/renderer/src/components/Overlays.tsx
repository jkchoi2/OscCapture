import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckCircle2, ChevronRight, XCircle } from 'lucide-react'

/* ---------- Prompt / confirm dialog ---------- */

export interface DialogSpec {
  title: string
  message?: string
  input?: string
  okLabel?: string
  danger?: boolean
  onOk: (value: string) => void
}

export function Dialog({ spec, onClose }: { spec: DialogSpec; onClose: () => void }): ReactNode {
  const [value, setValue] = useState(spec.input ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.focus()
    const dot = el.value.lastIndexOf('.')
    el.setSelectionRange(0, dot > 0 ? dot : el.value.length)
  }, [])

  const ok = (): void => {
    if (spec.input !== undefined && !value.trim()) return
    onClose()
    spec.onOk(value.trim())
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') ok()
          if (e.key === 'Escape') onClose()
        }}
        tabIndex={-1}
        ref={(el) => {
          if (el && spec.input === undefined) el.focus()
        }}
      >
        <h3>{spec.title}</h3>
        {spec.message && <p>{spec.message}</p>}
        {spec.input !== undefined && (
          <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} />
        )}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn ${spec.danger ? 'danger' : 'primary'}`} onClick={ok}>
            {spec.okLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------- Context menu ---------- */

export interface MenuItem {
  label?: string
  icon?: ReactNode
  shortcut?: string
  danger?: boolean
  disabled?: boolean
  separator?: boolean
  submenu?: MenuItem[]
  onClick?: () => void
}

export interface MenuSpec {
  x: number
  y: number
  items: MenuItem[]
}

export function ContextMenu({ spec, onClose }: { spec: MenuSpec; onClose: () => void }): ReactNode {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: spec.x, y: spec.y })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      x: Math.min(spec.x, window.innerWidth - r.width - 8),
      y: Math.min(spec.y, window.innerHeight - r.height - 8)
    })
  }, [spec])

  useEffect(() => {
    const close = (): void => onClose()
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('blur', close)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', key, true)
    }
  }, [onClose])

  return (
    <div className="menu-layer" onMouseDown={onClose} onContextMenu={(e) => (e.preventDefault(), onClose())}>
      <div ref={ref} className="menu" style={{ left: pos.x, top: pos.y }} onMouseDown={(e) => e.stopPropagation()}>
        <MenuList items={spec.items} onClose={onClose} />
      </div>
    </div>
  )
}

function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }): ReactNode {
  return items.map((it, i) =>
    it.separator ? (
      <div key={i} className="menu-sep" />
    ) : (
      <div
        key={i}
        className={`menu-item${it.danger ? ' danger' : ''}${it.disabled ? ' disabled' : ''}${it.submenu ? ' has-sub' : ''}`}
        onClick={() => {
          if (it.disabled || it.submenu) return
          onClose()
          it.onClick?.()
        }}
      >
        <span className="menu-icon">{it.icon}</span>
        <span className="menu-label">{it.label}</span>
        {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
        {it.submenu && <ChevronRight size={14} className="menu-shortcut" />}
        {it.submenu && (
          <div className="menu submenu">
            {it.submenu.length ? (
              <MenuList items={it.submenu} onClose={onClose} />
            ) : (
              <div className="menu-item disabled">
                <span className="menu-label">No other folders</span>
              </div>
            )}
          </div>
        )}
      </div>
    )
  )
}

/* ---------- Toasts ---------- */

export interface Toast {
  id: number
  kind: 'ok' | 'error'
  text: string
}

export function Toasts({ toasts }: { toasts: Toast[] }): ReactNode {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'ok' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}
