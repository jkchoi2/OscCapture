import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import type { SerialDevice, Settings } from '@shared/types'

/** Folder of OscCapture.exe (project root in dev). Config and captures live here. */
export const appDir = (): string => (app.isPackaged ? dirname(app.getPath('exe')) : process.cwd())

const file = (): string => join(appDir(), 'configOscCapture.json')
/** Name used before the rename; moved to the new name on first load. */
const legacyFile = (): string => join(appDir(), 'CapConfig.json')

const defaults = (): Settings => ({
  saveRoot: join(appDir(), 'CaptureData'),
  filenameTemplate: '{model}_{date}_{time}',
  inkSaver: false,
  grayscale: false,
  freeze: false,
  autoCopy: true,
  lastResource: '',
  thumbSize: 200,
  captureHotkey: 'F8',
  globalHotkey: false,
  listWidth: 520,
  sidebarWidth: 230,
  sidebarPinned: true,
  modelSubfolder: true,
  serialDevices: [{ port: 'COM1', baud: 9600, style: 'display' }],
  usbDevices: []
})

/** Configs from before per-device serial settings had a single serialPort/serialBaud. */
function migrate(stored: Record<string, unknown>): Partial<Settings> {
  const { serialPort, serialBaud, ...rest } = stored
  if (!rest.serialDevices && typeof serialPort === 'string') {
    const devices: SerialDevice[] = serialPort
      ? [{ port: serialPort, baud: typeof serialBaud === 'number' ? serialBaud : 9600, style: 'display' }]
      : []
    rest.serialDevices = devices
  }
  return rest as Partial<Settings>
}

let current: Settings | null = null

export function getSettings(): Settings {
  if (!current) {
    let stored: Record<string, unknown> = {}
    try {
      if (!existsSync(file()) && existsSync(legacyFile())) renameSync(legacyFile(), file())
    } catch {
      /* keep defaults if the old file cannot be moved */
    }
    try {
      stored = JSON.parse(readFileSync(file(), 'utf8'))
    } catch {
      /* first run */
    }
    current = { ...defaults(), ...migrate(stored) }
  }
  if (!existsSync(current.saveRoot)) mkdirSync(current.saveRoot, { recursive: true })
  return current
}

export function setSettings(patch: Partial<Settings>): Settings {
  current = { ...getSettings(), ...patch }
  writeFileSync(file(), JSON.stringify(current, null, 2))
  return getSettings()
}
