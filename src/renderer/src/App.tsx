import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Copy,
  Download,
  ExternalLink,
  Folder,
  FolderInput,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  Pencil,
  Trash2
} from 'lucide-react'
import type { FolderNode, ImageItem, Instrument, Settings } from '@shared/types'
import Gallery, { type SortKey } from './components/Gallery'
import { ContextMenu, Dialog, Toasts, type DialogSpec, type MenuItem, type MenuSpec, type Toast } from './components/Overlays'
import SettingsDialog from './components/SettingsDialog'
import Sidebar from './components/Sidebar'
import Splitter from './components/Splitter'
import TopBar from './components/TopBar'
import Viewer from './components/Viewer'
import { renderPanelPng } from './render/dmm34401'
import { renderPsuPng } from './render/psu'
import { errorText, eventToAccelerator, formatDate } from './util'

const api = window.api

const SIDEBAR_DEFAULT = 230
const SIDEBAR_MIN = 150
const SIDEBAR_MAX = 480
const TAB_W = 26
const SPLITTER_W = 6
const LIST_MIN = 260
const VIEWER_MIN = 420
const LIST_DEFAULT = 520

function flatten(node: FolderNode | null): FolderNode[] {
  return node ? [node, ...node.children.flatMap(flatten)] : []
}

export default function App(): ReactNode {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [instruments, setInstruments] = useState<Instrument[]>([])
  const [resource, setResource] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [capturing, setCapturing] = useState(false)

  const [tree, setTree] = useState<FolderNode | null>(null)
  const [folder, setFolder] = useState('')
  const [items, setItems] = useState<ImageItem[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [current, setCurrent] = useState('')
  const [anchor, setAnchor] = useState('')
  const [freshPath, setFreshPath] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SortKey>('new')
  const [full, setFull] = useState(false)
  const [listWidth, setListWidth] = useState(LIST_DEFAULT)
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT)
  const [flyout, setFlyout] = useState(false)
  const flyoutTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const [toasts, setToasts] = useState<Toast[]>([])
  const [dialog, setDialog] = useState<DialogSpec | null>(null)
  const [menu, setMenu] = useState<MenuSpec | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [lastCapture, setLastCapture] = useState<{ at: number; ms: number } | null>(null)

  const toastId = useRef(0)
  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = ++toastId.current
    setToasts((t) => [...t.slice(-3), { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 2800)
  }, [])

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, okText?: string): Promise<T | undefined> => {
      try {
        const r = await fn()
        if (okText) toast('ok', okText)
        return r
      } catch (e) {
        toast('error', errorText(e))
        return undefined
      }
    },
    [toast]
  )

  /* ---------- data loading ---------- */

  const pendingSelect = useRef('')
  const folderRef = useRef(folder)
  folderRef.current = folder

  const reload = useCallback(async () => {
    const [t, list] = await Promise.all([api.tree(), api.list(folderRef.current).catch(() => [])])
    setTree(t)
    if (!flatten(t).some((n) => n.rel === folderRef.current)) {
      setFolder('')
      return
    }
    setItems(list)
    const paths = new Set(list.map((i) => i.path))
    setSelected((s) => new Set([...s].filter((p) => paths.has(p))))
    setCurrent((c) => (paths.has(c) ? c : ''))
  }, [])

  const scan = useCallback(async () => {
    setScanning(true)
    setScanError('')
    try {
      const list = await api.listInstruments()
      setInstruments(list)
      setResource((r) => {
        if (list.some((i) => i.resource === r)) return r
        const last = settingsRef.current?.lastResource
        return list.find((i) => i.resource === last)?.resource ?? list[0]?.resource ?? ''
      })
      if (!list.length) setScanError('No instrument found')
    } catch (e) {
      setInstruments([])
      setResource('')
      setScanError(errorText(e))
    } finally {
      setScanning(false)
    }
  }, [])

  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    api.getSettings().then((s) => {
      settingsRef.current = s
      setSettings(s)
      setListWidth(s.listWidth)
      setSidebarWidth(s.sidebarWidth)
      scan()
    })
    const offs = [
      api.onLibraryChanged(() => reload()),
      api.onHotkeyCapture(() => captureRef.current()),
      api.onHotkeyError((msg) => toast('error', msg))
    ]
    return () => offs.forEach((off) => off())
  }, [reload, scan, toast])

  useEffect(() => {
    // A capture that switched folders hands over the item to select.
    const pending = pendingSelect.current
    pendingSelect.current = ''
    setSelected(new Set(pending ? [pending] : []))
    setCurrent(pending)
    setAnchor(pending)
    reload()
  }, [folder, settings?.saveRoot, reload])

  const updateSettings = async (patch: Partial<Settings>): Promise<void> => {
    const s = await run(() => api.setSettings(patch))
    if (s) setSettings(s)
  }

  /* ---------- derived ---------- */

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = q ? items.filter((i) => i.name.toLowerCase().includes(q) || i.note.toLowerCase().includes(q)) : items
    return [...list].sort((a, b) =>
      sort === 'name' ? a.name.localeCompare(b.name, undefined, { numeric: true }) : sort === 'old' ? a.mtime - b.mtime : b.mtime - a.mtime
    )
  }, [items, query, sort])

  const currentItem = visible.find((i) => i.path === current) ?? null
  const targets = (): string[] => (selected.size ? [...selected] : current ? [current] : [])
  const allFolders = flatten(tree)
  const folderName = (rel: string): string => (rel ? rel.split('/').pop()! : 'All captures')

  /* ---------- actions ---------- */

  const capture = async (): Promise<void> => {
    if (!resource || capturing || !instruments.find((i) => i.resource === resource)?.supported) return
    setCapturing(true)
    try {
      const r = await api.capture(resource, folder)
      // Instruments without a screen dump return a reading that we draw and save here.
      const saved =
        r.type === 'image'
          ? r
          : await api.saveRendered(
              r.type === 'psu'
                ? await renderPsuPng(r.reading, r.instrument, r.style)
                : await renderPanelPng(r.reading, r.instrument, r.style),
              r.instrument,
              folder
            )
      setLastCapture({ at: Date.now(), ms: r.ms })
      // Captures into the root may land in a per-model subfolder: follow them there.
      if (saved.item.folder !== folder) {
        pendingSelect.current = saved.item.path
        setFolder(saved.item.folder)
      } else {
        await reload()
        select(saved.item.path)
      }
      setFreshPath(saved.item.path)
      setTimeout(() => setFreshPath(''), 1500)
      toast('ok', `Saved ${saved.item.name}${saved.copied ? ' · copied to clipboard' : ''}`)
    } catch (e) {
      toast('error', `Capture failed: ${errorText(e)}`)
      scan()
    } finally {
      setCapturing(false)
    }
  }

  const captureRef = useRef(capture)
  captureRef.current = capture

  const select = (path: string): void => {
    setSelected(new Set([path]))
    setCurrent(path)
    setAnchor(path)
  }

  const onItemClick = (e: React.MouseEvent, it: ImageItem): void => {
    if (e.shiftKey && anchor) {
      const a = visible.findIndex((i) => i.path === anchor)
      const b = visible.findIndex((i) => i.path === it.path)
      const [lo, hi] = a < b ? [a, b] : [b, a]
      setSelected(new Set(visible.slice(lo, hi + 1).map((i) => i.path)))
      setCurrent(it.path)
    } else if (e.ctrlKey) {
      const s = new Set(selected)
      if (s.has(it.path)) s.delete(it.path)
      else s.add(it.path)
      setSelected(s)
      setCurrent(it.path)
      setAnchor(it.path)
    } else select(it.path)
  }

  const copy = (path = current): void => {
    if (path) run(() => api.copyImage(path), 'Copied to clipboard')
  }

  const remove = async (paths = targets()): Promise<void> => {
    if (!paths.length) return
    // Move the cursor to the next remaining image so keyboard deletion flows.
    const idx = visible.findIndex((i) => i.path === current)
    const next = visible.slice(idx + 1).find((i) => !paths.includes(i.path)) ?? visible.slice(0, idx).reverse().find((i) => !paths.includes(i.path))
    await run(() => api.trash(paths), `Moved ${paths.length > 1 ? `${paths.length} images` : 'image'} to Recycle Bin`)
    await reload()
    if (next) select(next.path)
  }

  const rename = (it: ImageItem | null = currentItem): void => {
    if (!it) return
    setDialog({
      title: 'Rename image',
      input: it.name,
      okLabel: 'Rename',
      onOk: async (name) => {
        const r = await run(() => api.rename(it.path, name))
        if (r) {
          await reload()
          select(r.path)
        }
      }
    })
  }

  const move = async (paths: string[], dest: string): Promise<void> => {
    await run(() => api.move(paths, dest), `Moved ${paths.length} image${paths.length > 1 ? 's' : ''} to ${folderName(dest)}`)
    reload()
  }

  const newFolder = (parent: string): void =>
    setDialog({
      title: `New folder in ${folderName(parent)}`,
      input: '',
      okLabel: 'Create',
      onOk: async (name) => {
        const rel = await run(() => api.mkdir(parent, name))
        if (rel !== undefined) {
          await reload()
          setFolder(rel)
        }
      }
    })

  const folderMenu = (e: React.MouseEvent, node: FolderNode): void => {
    e.preventDefault()
    const isRoot = node.rel === ''
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'New folder…', icon: <FolderPlus size={14} />, onClick: () => newFolder(node.rel) },
        { label: 'Open in Explorer', icon: <FolderOpen size={14} />, onClick: () => run(() => api.openFolder(node.rel)) },
        { separator: true },
        {
          label: 'Rename…',
          icon: <Pencil size={14} />,
          disabled: isRoot,
          onClick: () =>
            setDialog({
              title: 'Rename folder',
              input: node.name,
              okLabel: 'Rename',
              onOk: async (name) => {
                const rel = await run(() => api.renameFolder(node.rel, name))
                if (rel !== undefined) {
                  await reload()
                  if (folder === node.rel) setFolder(rel)
                }
              }
            })
        },
        {
          label: 'Delete folder',
          icon: <Trash2 size={14} />,
          danger: true,
          disabled: isRoot,
          onClick: () =>
            setDialog({
              title: `Delete "${node.name}"?`,
              message: 'The folder and everything in it will be moved to the Recycle Bin.',
              okLabel: 'Delete',
              danger: true,
              onOk: async () => {
                await run(() => api.removeFolder(node.rel), 'Folder moved to Recycle Bin')
                if (folder === node.rel || folder.startsWith(node.rel + '/')) setFolder('')
                reload()
              }
            })
        }
      ]
    })
  }

  const itemMenu = (e: React.MouseEvent, it: ImageItem): void => {
    e.preventDefault()
    let paths = targets()
    if (!selected.has(it.path)) {
      select(it.path)
      paths = [it.path]
    }
    const multi = paths.length > 1
    const moveTargets: MenuItem[] = allFolders
      .filter((f) => f.rel !== folder)
      .map((f) => ({ label: f.rel || 'All captures (root)', icon: <Folder size={14} />, onClick: () => move(paths, f.rel) }))
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: 'Copy image', icon: <Copy size={14} />, shortcut: 'Ctrl+C', disabled: multi, onClick: () => copy(it.path) },
        { label: 'Rename…', icon: <Pencil size={14} />, shortcut: 'F2', disabled: multi, onClick: () => rename(it) },
        { label: multi ? `Move ${paths.length} images to` : 'Move to', icon: <FolderInput size={14} />, submenu: moveTargets },
        { separator: true },
        { label: 'Show in Explorer', icon: <FolderSearch size={14} />, onClick: () => run(() => api.reveal(it.path)) },
        { label: 'Open with default app', icon: <ExternalLink size={14} />, onClick: () => run(() => api.openExternal(it.path)) },
        { label: 'Export…', icon: <Download size={14} />, disabled: multi, onClick: () => exportItem(it.path) },
        { separator: true },
        { label: multi ? `Delete ${paths.length} images` : 'Delete', icon: <Trash2 size={14} />, shortcut: 'Del', danger: true, onClick: () => remove(paths) }
      ]
    })
  }

  const exportItem = async (path: string): Promise<void> => {
    if (await run(() => api.saveAs(path))) toast('ok', 'Exported')
  }

  /* ---------- keyboard ---------- */

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent) => {
    if (dialog || showSettings || menu) return
    // With a global hotkey, the main process delivers the capture event instead.
    if (settings && !settings.globalHotkey && eventToAccelerator(e) === settings.captureHotkey) {
      e.preventDefault()
      capture()
      return
    }
    const tag = (e.target as HTMLElement).tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    const idx = visible.findIndex((i) => i.path === current)
    const cols = Math.max(1, Math.round((document.querySelector('.grid')?.clientWidth ?? 1) / ((settings?.thumbSize ?? 200) + 12)))
    const go = (n: number): void => {
      const it = visible[Math.min(Math.max(n, 0), visible.length - 1)]
      if (it) select(it.path)
    }
    switch (e.key) {
      case 'Delete':
        remove()
        break
      case 'F2':
        rename()
        break
      case 'Enter':
        if (currentItem) setFull((f) => !f)
        break
      case 'Escape':
        if (full) setFull(false)
        else setSelected(new Set())
        break
      case 'ArrowRight':
        go(idx + 1)
        break
      case 'ArrowLeft':
        go(idx - 1)
        break
      case 'ArrowDown':
        go(full ? idx + 1 : idx + cols)
        break
      case 'ArrowUp':
        go(full ? idx - 1 : idx - cols)
        break
      case 'Home':
        go(0)
        break
      case 'End':
        go(visible.length - 1)
        break
      default:
        if (e.ctrlKey && e.key.toLowerCase() === 'c') copy()
        else if (e.ctrlKey && e.key.toLowerCase() === 'a') setSelected(new Set(visible.map((i) => i.path)))
        else return
    }
    e.preventDefault()
  }

  useEffect(() => {
    const h = (e: KeyboardEvent): void => keyRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  /* ---------- folder pane auto-hide ---------- */

  const overlayOpen = useRef(false)
  overlayOpen.current = !!(menu || dialog)

  const openFlyout = (): void => {
    clearTimeout(flyoutTimer.current)
    setFlyout(true)
  }
  const closeFlyoutSoon = (): void => {
    clearTimeout(flyoutTimer.current)
    // 컨텍스트 메뉴/다이얼로그가 떠 있는 동안은 닫지 않고 다시 확인
    const tick = (): void => {
      if (overlayOpen.current) flyoutTimer.current = setTimeout(tick, 250)
      else setFlyout(false)
    }
    flyoutTimer.current = setTimeout(tick, 250)
  }

  useEffect(() => () => clearTimeout(flyoutTimer.current), [])

  if (!settings) return <div className="boot" />

  const currentInstrument = instruments.find((i) => i.resource === resource)
  const pinned = settings.sidebarPinned
  const leftW = pinned ? sidebarWidth + SPLITTER_W : TAB_W
  const leftCols = pinned ? `${sidebarWidth}px ${SPLITTER_W}px` : `${TAB_W}px`
  const sidebarProps = {
    tree,
    current: folder,
    pinned,
    onTogglePin: () => {
      clearTimeout(flyoutTimer.current)
      setFlyout(false)
      updateSettings({ sidebarPinned: !pinned })
    },
    onSelect: setFolder,
    onNewFolder: newFolder,
    onContextMenu: folderMenu,
    onDropFiles: move
  }

  return (
    <div className="app">
      <TopBar
        instruments={instruments}
        resource={resource}
        scanning={scanning}
        capturing={capturing}
        scanError={scanError}
        settings={settings}
        onSelect={(r) => {
          setResource(r)
          updateSettings({ lastResource: r })
        }}
        onScan={scan}
        onCapture={capture}
        onToggle={(k) => updateSettings({ [k]: !settings[k] })}
        onOpenSettings={() => setShowSettings(true)}
      />

      <main
        className="body"
        style={{
          gridTemplateColumns: full
            ? `${leftCols} minmax(0, 1fr)`
            : `${leftCols} min(${listWidth}px, calc(100% - ${leftW + SPLITTER_W + VIEWER_MIN}px)) ${SPLITTER_W}px minmax(0, 1fr)`
        }}
        onDragEnd={() => flyout && closeFlyoutSoon()}
      >
        {pinned ? (
          <>
            <Sidebar {...sidebarProps} />
            <Splitter
              width={sidebarWidth}
              min={SIDEBAR_MIN}
              max={() => Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, window.innerWidth - 2 * SPLITTER_W - LIST_MIN - VIEWER_MIN))}
              onResize={setSidebarWidth}
              onCommit={(w) => updateSettings({ sidebarWidth: w })}
              onReset={() => {
                setSidebarWidth(SIDEBAR_DEFAULT)
                updateSettings({ sidebarWidth: SIDEBAR_DEFAULT })
              }}
            />
          </>
        ) : (
          <>
            <div
              className={`side-tab${flyout ? ' open' : ''}`}
              title="Folders"
              onMouseEnter={openFlyout}
              onMouseLeave={closeFlyoutSoon}
              onClick={openFlyout}
              onDragEnter={openFlyout}
            >
              <Folder size={15} />
              <span>Folders</span>
            </div>
            {flyout && (
              <Sidebar
                {...sidebarProps}
                className="flyout"
                style={{ left: TAB_W, width: sidebarWidth }}
                onMouseEnter={openFlyout}
                onMouseLeave={closeFlyoutSoon}
              />
            )}
          </>
        )}
        {!full && (
        <Gallery
          title={folderName(folder)}
          items={visible}
          total={items.length}
          selected={selected}
          current={current}
          freshPath={freshPath}
          thumbSize={settings.thumbSize}
          hotkey={settings.captureHotkey}
          query={query}
          sort={sort}
          onQuery={setQuery}
          onSort={setSort}
          onThumbSize={(n) => {
            setSettings({ ...settings, thumbSize: n })
            api.setSettings({ thumbSize: n })
          }}
          onClick={onItemClick}
          onOpen={(it) => {
            select(it.path)
            setFull(true)
          }}
          onContextMenu={itemMenu}
          onClearSelection={() => setSelected(new Set())}
        />
        )}
        {!full && (
          <Splitter
            width={listWidth}
            min={LIST_MIN}
            max={() => window.innerWidth - leftW - SPLITTER_W - VIEWER_MIN}
            onResize={setListWidth}
            onCommit={(w) => updateSettings({ listWidth: w })}
            onReset={() => {
              setListWidth(LIST_DEFAULT)
              updateSettings({ listWidth: LIST_DEFAULT })
            }}
          />
        )}
        <Viewer
          item={currentItem}
          selectedCount={selected.size}
          full={full}
          onToggleFull={() => setFull(!full)}
          onCopy={() => copy()}
          onExport={() => current && exportItem(current)}
          onReveal={() => current && run(() => api.reveal(current))}
          onOpenExternal={() => current && run(() => api.openExternal(current))}
          onDelete={() => remove()}
          onRename={() => rename()}
          onNote={async (note) => {
            if (!currentItem) return
            await run(() => api.setNote(currentItem.path, note))
            reload()
          }}
        />
      </main>

      <footer className="statusbar">
        <button className="link" onClick={() => run(() => api.openFolder(''))} title="Open capture folder">
          <FolderOpen size={13} /> {settings.saveRoot}
        </button>
        <span className="spacer" />
        {selected.size > 1 && <span>{selected.size} selected</span>}
        <span>
          {items.length} {items.length === 1 ? 'image' : 'images'}
        </span>
        {lastCapture && (
          <span>
            Last capture {formatDate(lastCapture.at).split(', ').pop()} · {(lastCapture.ms / 1000).toFixed(1)} s
          </span>
        )}
        <span className="mono">{currentInstrument ? currentInstrument.resource : 'offline'}</span>
      </footer>

      {dialog && <Dialog spec={dialog} onClose={() => setDialog(null)} />}
      {menu && <ContextMenu spec={menu} onClose={() => setMenu(null)} />}
      {showSettings && (
        <SettingsDialog
          settings={settings}
          instrument={currentInstrument}
          instruments={instruments}
          onChooseRoot={async () => {
            const s = await run(() => api.chooseRoot())
            if (s) {
              setSettings(s)
              setFolder('')
            }
          }}
          onSave={async (patch) => {
            // Port or driver changes decide which instruments are found and how: scan again.
            const devicesChanged =
              JSON.stringify(patch.serialDevices) !== JSON.stringify(settings.serialDevices) ||
              JSON.stringify(patch.usbDevices) !== JSON.stringify(settings.usbDevices)
            await updateSettings(patch)
            if (devicesChanged) scan()
          }}
          onClose={() => setShowSettings(false)}
        />
      )}
      <Toasts toasts={toasts} />
    </div>
  )
}
