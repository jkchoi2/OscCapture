import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, HardDrive, Pin, PinOff } from 'lucide-react'
import type { FolderNode } from '@shared/types'

export const DRAG_TYPE = 'application/x-osc-paths'

interface Props {
  tree: FolderNode | null
  current: string
  onSelect: (rel: string) => void
  onNewFolder: (parentRel: string) => void
  onContextMenu: (e: React.MouseEvent, node: FolderNode) => void
  onDropFiles: (paths: string[], destRel: string) => void
}

interface SidebarProps extends Props {
  pinned: boolean
  onTogglePin: () => void
  /** Auto-hide flyout: overlay placement and hover handlers */
  className?: string
  style?: React.CSSProperties
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

export default function Sidebar({ pinned, onTogglePin, className, style, onMouseEnter, onMouseLeave, ...p }: SidebarProps): ReactNode {
  return (
    <aside className={`sidebar${className ? ` ${className}` : ''}`} style={style} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      <div className="pane-head">
        <span>Folders</span>
        <span className="head-actions">
          <button className="icon-btn sm" title="New folder" onClick={() => p.onNewFolder(p.current)}>
            <FolderPlus size={15} />
          </button>
          <button className="icon-btn sm" title={pinned ? 'Auto-hide' : 'Keep open'} onClick={onTogglePin}>
            {pinned ? <Pin size={15} /> : <PinOff size={15} />}
          </button>
        </span>
      </div>
      <div className="tree">{p.tree && <TreeNode node={p.tree} depth={0} {...p} />}</div>
    </aside>
  )
}

function TreeNode({ node, depth, ...p }: Props & { node: FolderNode; depth: number }): ReactNode {
  const [open, setOpen] = useState(true)
  const [over, setOver] = useState(false)
  const active = node.rel === p.current
  const isRoot = depth === 0
  const Icon = isRoot ? HardDrive : active ? FolderOpen : Folder

  return (
    <>
      <div
        className={`tree-row${active ? ' active' : ''}${over ? ' drop' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => p.onSelect(node.rel)}
        onContextMenu={(e) => p.onContextMenu(e, node)}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          setOver(false)
          const raw = e.dataTransfer.getData(DRAG_TYPE)
          if (raw) p.onDropFiles(JSON.parse(raw), node.rel)
        }}
        title={isRoot ? 'Capture folder root' : node.rel}
      >
        <span
          className="twisty"
          onClick={(e) => {
            e.stopPropagation()
            setOpen(!open)
          }}
        >
          {node.children.length ? open ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
        </span>
        <Icon size={15} className="tree-icon" />
        <span className="tree-name">{isRoot ? 'All captures' : node.name}</span>
        {node.count > 0 && <span className="badge">{node.count}</span>}
      </div>
      {open && node.children.map((c) => <TreeNode key={c.rel} node={c} depth={depth + 1} {...p} />)}
    </>
  )
}
