export type InstrumentKind = 'scope' | 'dmm' | 'psu' | 'unknown'
export type CaptureOption = 'inkSaver' | 'grayscale' | 'freeze'

export interface Instrument {
  resource: string
  idn: string
  maker: string
  model: string
  serial: string
  kind: InstrumentKind
  supported: boolean
  options: CaptureOption[]
  /** 'usb' = VISA USB resource, 'serial' = RS-232 port (resource is e.g. "COM1") */
  transport: 'usb' | 'serial'
  /** 'screen' = instrument screen dump, 'render' = reading drawn on a panel illustration */
  method: 'screen' | 'render'
}

/** One measurement read over SCPI, for instruments without a screen dump. */
export interface DmmReading {
  /** SCPI function from CONF?, e.g. "VOLT", "VOLT:AC", "RES", "FREQ" */
  func: string
  range: number
  resolution: number
  autoRange: boolean
  value: number
  time: number
}

/** One output channel of a power supply, read over SCPI. NaN = not available. */
export interface PsuChannel {
  name: string
  /** measured at the output terminals */
  vMeas: number
  iMeas: number
  pMeas: number
  /** programmed values */
  vSet: number
  iSet: number
  ovp: number
  ocp: number
  output: boolean
  /** regulation mode; '' when unknown or the output is off */
  mode: 'CV' | 'CC' | 'UR' | ''
  /** full-scale rating, used for digit layout */
  vMax: number
  iMax: number
}

export interface PsuReading {
  channels: PsuChannel[]
  time: number
}

/** Driver selection for an RS-232 port: 'auto' = by *IDN?, otherwise a PSU profile id. */
export type DriverChoice = 'auto' | string

export interface Settings {
  saveRoot: string
  filenameTemplate: string
  inkSaver: boolean
  grayscale: boolean
  freeze: boolean
  autoCopy: boolean
  lastResource: string
  thumbSize: number
  captureHotkey: string
  globalHotkey: boolean
  listWidth: number
  sidebarWidth: number
  /** false = folder pane auto-hides to a tab at the left edge */
  sidebarPinned: boolean
  modelSubfolder: boolean
  /** RS-232 instruments, one entry per port */
  serialDevices: SerialDevice[]
  /** USB (VISA) instruments with a non-default driver or style */
  usbDevices: UsbDevice[]
}

export type RenderStyle = 'display' | 'panel'

export interface SerialDevice {
  port: string
  baud: number
  /** 'display' = display window only, 'panel' = display with the instrument body */
  style: RenderStyle
  /** 'auto' (default) or a power supply profile id to use whatever *IDN? says */
  driver?: DriverChoice
}

/** Driver/style override for a USB instrument, keyed by its VISA resource string. */
export interface UsbDevice {
  resource: string
  style: RenderStyle
  driver?: DriverChoice
}

export interface PsuProfileInfo {
  profiles: { id: string; label: string; custom: boolean }[]
  /** psuProfiles.json path */
  file: string
  /** problems found in psuProfiles.json */
  errors: string[]
}

export interface FolderNode {
  rel: string
  name: string
  count: number
  children: FolderNode[]
}

export interface ImageItem {
  path: string
  name: string
  folder: string
  size: number
  mtime: number
  width: number
  height: number
  note: string
  idn: string
}

export interface ComPort {
  path: string
  label: string
}

export interface SavedCapture {
  item: ImageItem
  copied: boolean
}

export type CaptureResult =
  | ({ type: 'image'; ms: number } & SavedCapture)
  | { type: 'reading'; ms: number; reading: DmmReading; instrument: Instrument; style: RenderStyle }
  | { type: 'psu'; ms: number; reading: PsuReading; instrument: Instrument; style: RenderStyle }

export interface Api {
  listInstruments(): Promise<Instrument[]>
  capture(resource: string, folderRel: string): Promise<CaptureResult>
  saveRendered(png: Uint8Array, instrument: Instrument, folderRel: string): Promise<SavedCapture>
  listSerialPorts(): Promise<ComPort[]>
  psuProfiles(): Promise<PsuProfileInfo>
  /** Opens psuProfiles.json in the default editor, creating it with an example first. */
  openProfilesFile(): Promise<void>

  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  chooseRoot(): Promise<Settings>

  tree(): Promise<FolderNode>
  list(folderRel: string): Promise<ImageItem[]>
  rename(path: string, newName: string): Promise<ImageItem>
  trash(paths: string[]): Promise<void>
  move(paths: string[], destRel: string): Promise<void>
  setNote(path: string, note: string): Promise<void>
  mkdir(parentRel: string, name: string): Promise<string>
  renameFolder(rel: string, newName: string): Promise<string>
  removeFolder(rel: string): Promise<void>

  copyImage(path: string): Promise<void>
  reveal(path: string): Promise<void>
  openExternal(path: string): Promise<void>
  saveAs(path: string): Promise<boolean>
  openFolder(rel: string): Promise<void>

  imageUrl(path: string, mtime: number): string
  onLibraryChanged(cb: () => void): () => void
  onHotkeyCapture(cb: () => void): () => void
  onHotkeyError(cb: (message: string) => void): () => void
}
