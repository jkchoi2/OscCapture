import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '@shared/types'

const invoke = ipcRenderer.invoke.bind(ipcRenderer)

const api: Api = {
  listInstruments: () => invoke('scope:list'),
  capture: (resource, folderRel) => invoke('scope:capture', resource, folderRel),
  saveRendered: (png, instrument, folderRel) => invoke('scope:saveRendered', png, instrument, folderRel),
  listSerialPorts: () => invoke('scope:serialPorts'),
  psuProfiles: () => invoke('scope:psuProfiles'),
  openProfilesFile: () => invoke('scope:openProfilesFile'),

  getSettings: () => invoke('settings:get'),
  setSettings: (patch) => invoke('settings:set', patch),
  chooseRoot: () => invoke('settings:chooseRoot'),

  tree: () => invoke('lib:tree'),
  list: (rel) => invoke('lib:list', rel),
  rename: (p, name) => invoke('lib:rename', p, name),
  trash: (paths) => invoke('lib:trash', paths),
  move: (paths, dest) => invoke('lib:move', paths, dest),
  setNote: (p, note) => invoke('lib:setNote', p, note),
  mkdir: (parent, name) => invoke('lib:mkdir', parent, name),
  renameFolder: (rel, name) => invoke('lib:renameFolder', rel, name),
  removeFolder: (rel) => invoke('lib:removeFolder', rel),

  copyImage: (p) => invoke('file:copyImage', p),
  reveal: (p) => invoke('file:reveal', p),
  openExternal: (p) => invoke('file:open', p),
  saveAs: (p) => invoke('file:saveAs', p),
  openFolder: (rel) => invoke('file:openFolder', rel),

  imageUrl: (p, mtime) => `osc://img/?p=${encodeURIComponent(p)}&v=${Math.round(mtime)}`,
  onLibraryChanged: (cb) => {
    const h = (): void => cb()
    ipcRenderer.on('library:changed', h)
    return () => ipcRenderer.removeListener('library:changed', h)
  },
  onHotkeyCapture: (cb) => {
    const h = (): void => cb()
    ipcRenderer.on('hotkey:capture', h)
    return () => ipcRenderer.removeListener('hotkey:capture', h)
  },
  onHotkeyError: (cb) => {
    const h = (_e: unknown, msg: string): void => cb(msg)
    ipcRenderer.on('hotkey:error', h)
    return () => ipcRenderer.removeListener('hotkey:error', h)
  }
}

contextBridge.exposeInMainWorld('api', api)
