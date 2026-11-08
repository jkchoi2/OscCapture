import {
  BrowserWindow,
  ClipboardItem,
  Menu,
  app,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  net,
  protocol,
  shell
} from 'electron'
import { copyFile, readFile } from 'fs/promises'
import { join } from 'path'
import { pathToFileURL } from 'url'
import type { CaptureResult, Instrument, SavedCapture, Settings } from '@shared/types'
import * as lib from './library'
import {
  captureInstrument,
  deviceConfig,
  listInstruments,
  listSerialPorts,
  openableProfilesFile,
  psuProfiles
} from './instruments'
import { getSettings, setSettings } from './settings'

protocol.registerSchemesAsPrivileged([
  { scheme: 'osc', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

let win: BrowserWindow | null = null

const copyPng = (png: Buffer): Promise<void> =>
  clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })])

function createWindow(): void {
  win = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 960,
    minHeight: 600,
    title: 'OscCapture',
    backgroundColor: '#0b0d10',
    icon: app.isPackaged ? undefined : join(__dirname, '../../build/icon.png'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0f1216', symbolColor: '#9aa3ae', height: 52 },
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

const notifyChanged = (): void => win?.webContents.send('library:changed')

/** (Re)register the global capture hotkey. Returns false if the key is taken by another app. */
function applyHotkey(): boolean {
  globalShortcut.unregisterAll()
  const { globalHotkey, captureHotkey } = getSettings()
  if (!globalHotkey || !captureHotkey) return true
  try {
    return globalShortcut.register(captureHotkey, () => win?.webContents.send('hotkey:capture'))
  } catch {
    return false
  }
}

function registerIpc(): void {
  ipcMain.handle('scope:list', () => listInstruments())

  const save = async (png: Buffer, instrument: Instrument, folderRel: string): Promise<SavedCapture> => {
    const { autoCopy } = getSettings()
    const item = await lib.saveCapture(png, instrument, folderRel)
    if (autoCopy) await copyPng(png)
    return { item, copied: autoCopy }
  }

  ipcMain.handle('scope:capture', async (_e, resource: string, folderRel: string): Promise<CaptureResult> => {
    const s = getSettings()
    const t0 = Date.now()
    const { data, instrument } = await captureInstrument(resource, s)
    if (s.lastResource !== resource) setSettings({ lastResource: resource })
    // Readings are drawn by the renderer, which then saves the image via scope:saveRendered.
    if (data.type !== 'image') {
      const style = deviceConfig(resource)?.style ?? 'display'
      const ms = Date.now() - t0
      return data.type === 'psu'
        ? { type: 'psu', reading: data.reading, instrument, style, ms }
        : { type: 'reading', reading: data.reading, instrument, style, ms }
    }
    return { type: 'image', ...(await save(data.png, instrument, folderRel)), ms: Date.now() - t0 }
  })
  ipcMain.handle('scope:saveRendered', (_e, png: Uint8Array, instrument: Instrument, folderRel: string) =>
    save(Buffer.from(png), instrument, folderRel)
  )
  ipcMain.handle('scope:serialPorts', () => listSerialPorts())
  ipcMain.handle('scope:psuProfiles', () => psuProfiles())
  ipcMain.handle('scope:openProfilesFile', async () => {
    const err = await shell.openPath(openableProfilesFile())
    if (err) throw new Error(err)
  })

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const before = getSettings()
    const s = setSettings(patch)
    if (s.saveRoot !== before.saveRoot) lib.watchLibrary(notifyChanged)
    if (s.captureHotkey !== before.captureHotkey || s.globalHotkey !== before.globalHotkey) {
      if (!applyHotkey()) {
        setSettings({ captureHotkey: before.captureHotkey, globalHotkey: before.globalHotkey })
        applyHotkey()
        throw new Error(`"${s.captureHotkey}" is already used by another application`)
      }
    }
    return s
  })
  ipcMain.handle('settings:chooseRoot', async () => {
    const r = await dialog.showOpenDialog(win!, {
      title: 'Choose capture folder',
      defaultPath: getSettings().saveRoot,
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return getSettings()
    const s = setSettings({ saveRoot: r.filePaths[0] })
    lib.watchLibrary(notifyChanged)
    return s
  })

  ipcMain.handle('lib:tree', () => lib.folderTree())
  ipcMain.handle('lib:list', (_e, rel: string) => lib.listImages(rel))
  ipcMain.handle('lib:rename', (_e, p: string, name: string) => lib.renameImage(p, name))
  ipcMain.handle('lib:trash', (_e, paths: string[]) => lib.trashImages(paths))
  ipcMain.handle('lib:move', (_e, paths: string[], dest: string) => lib.moveImages(paths, dest))
  ipcMain.handle('lib:setNote', (_e, p: string, note: string) => lib.setNote(p, note))
  ipcMain.handle('lib:mkdir', (_e, parent: string, name: string) => lib.makeFolder(parent, name))
  ipcMain.handle('lib:renameFolder', (_e, rel: string, name: string) => lib.renameFolder(rel, name))
  ipcMain.handle('lib:removeFolder', (_e, rel: string) => lib.removeFolder(rel))

  ipcMain.handle('file:copyImage', async (_e, p: string) => copyPng(await readFile(lib.assertInside(p))))
  ipcMain.handle('file:reveal', (_e, p: string) => shell.showItemInFolder(lib.assertInside(p)))
  ipcMain.handle('file:open', (_e, p: string) => shell.openPath(lib.assertInside(p)))
  ipcMain.handle('file:openFolder', (_e, rel: string) => shell.openPath(lib.toAbs(rel)))
  ipcMain.handle('file:saveAs', async (_e, p: string) => {
    const src = lib.assertInside(p)
    const r = await dialog.showSaveDialog(win!, {
      title: 'Export image',
      defaultPath: join(app.getPath('desktop'), src.split(/[\\/]/).pop()!),
      filters: [{ name: 'Images', extensions: ['png', 'bmp', 'jpg'] }]
    })
    if (r.canceled || !r.filePath) return false
    await copyFile(src, r.filePath)
    return true
  })
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)

  // osc://img/?p=<absolute path> serves images from the capture folder only.
  protocol.handle('osc', (req) => {
    try {
      const p = lib.assertInside(new URL(req.url).searchParams.get('p') ?? '')
      return net.fetch(pathToFileURL(p).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })

  registerIpc()
  lib.watchLibrary(notifyChanged)
  createWindow()
  if (!applyHotkey()) {
    win!.webContents.once('did-finish-load', () =>
      win?.webContents.send('hotkey:error', `Global hotkey "${getSettings().captureHotkey}" is used by another application`)
    )
  }
})

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => app.quit())
