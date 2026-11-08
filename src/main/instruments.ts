import { join } from 'path'
import type {
  CaptureOption,
  ComPort,
  DmmReading,
  Instrument,
  InstrumentKind,
  PsuProfileInfo,
  PsuReading,
  SerialDevice,
  UsbDevice
} from '@shared/types'
import {
  PSU_TIMEOUT_MS,
  type PsuProfile,
  allProfiles,
  customProfileErrors,
  ensureProfilesFile,
  genericProfile,
  loadCustomProfiles,
  probeGenericPsu,
  psuProfile,
  psuProfileFor
} from './psu'
import { SerialSession, listComPorts } from './serial'
import { appDir, getSettings } from './settings'
import { VisaSession, findResources } from './visa'

/** What drivers need from a connection, whether VISA (USB) or RS-232. */
type Session = Pick<VisaSession, 'write' | 'query' | 'queryBlock' | 'setTimeout' | 'clear' | 'close'>

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export type CaptureOptions = Record<CaptureOption, boolean>

export type CaptureData =
  | { type: 'image'; png: Buffer }
  | { type: 'reading'; reading: DmmReading }
  | { type: 'psu'; reading: PsuReading }

interface Driver {
  kind: Exclude<InstrumentKind, 'unknown'>
  match: RegExp
  method: Instrument['method']
  options: CaptureOption[]
  timeoutMs: number
  /** RS-232 only: switch to Remote for the capture and back to Local after (default true). */
  serialRemote?: boolean
  capture(s: Session, opts: CaptureOptions, resource: string, model: string): Promise<CaptureData>
}

/** Power supplies: read every output over SCPI, the renderer draws the display. */
const psuDriver = (p: PsuProfile): Driver => ({
  kind: 'psu',
  match: p.match ?? /(?!)/,
  method: 'render',
  options: [],
  timeoutMs: PSU_TIMEOUT_MS,
  serialRemote: p.serialRemote,
  async capture(s, _opts, _resource, model) {
    return { type: 'psu', reading: { channels: await p.read(s, model), time: Date.now() } }
  }
})

const drivers: Driver[] = [
  {
    // InfiniiVision 2000/3000/4000 X-Series oscilloscopes
    kind: 'scope',
    match: /^(DSO|MSO)-?X\s?[234]\d{3}/i,
    method: 'screen',
    options: ['inkSaver', 'grayscale', 'freeze'],
    timeoutMs: 15000,
    async capture(s, opts) {
      let wasRunning = false
      if (opts.freeze) {
        // Bit 3 of the operation condition register = Run.
        wasRunning = (parseInt(await s.query(':OPERegister:CONDition?'), 10) & 8) !== 0
        if (wasRunning) await s.write(':STOP')
      }
      try {
        await s.write(`:HARDcopy:INKSaver ${opts.inkSaver ? 'ON' : 'OFF'}`)
        const png = await s.queryBlock(`:DISPlay:DATA? PNG,${opts.grayscale ? 'GRAYscale' : 'COLor'}`)
        return { type: 'image', png }
      } finally {
        if (wasRunning) await s.write(':RUN')
      }
    }
  },
  {
    // Truevolt digital multimeters
    kind: 'dmm',
    match: /^344(60|61|65|70)A$/i,
    method: 'screen',
    options: [],
    timeoutMs: 15000,
    async capture(s) {
      await s.write('HCOPy:SDUMp:DATA:FORMat PNG')
      try {
        return { type: 'image', png: await s.queryBlock('HCOPy:SDUMp:DATA?') }
      } finally {
        // Give the front panel back to the user (otherwise the DMM stays in Remote).
        await s.write('SYSTem:LOCal')
      }
    }
  },
  {
    // 34401A: no screen dump (VFD), so read the measurement and draw it.
    kind: 'dmm',
    match: /^34401A$/i,
    method: 'render',
    options: [],
    timeoutMs: 10000,
    async capture(s, _opts, resource) {
      return { type: 'reading', reading: await readDmm(s, resource) }
    }
  }
]

/** The 34401A needs at least 380 ms between READ? requests. */
const READ_INTERVAL_MS = 380
const lastRead = new Map<string, number>()

/** Read function, range and one reading from a 34401A-style SCPI multimeter (in Remote). */
async function readDmm(s: Session, resource: string): Promise<DmmReading> {
  // e.g. "VOLT +1.000000E-01,+1.000000E-07"  or  "CONT"
  const conf = (await s.query('CONF?')).replace(/"/g, '').trim()
  const [func, args = ''] = conf.split(/\s+/, 2)
  const [range = NaN, resolution = NaN] = args.split(',').map(Number)
  let autoRange = false
  const rangeCmd: Record<string, string> = { FREQ: 'FREQ:VOLT', PER: 'PER:VOLT' }
  if (!['CONT', 'DIOD'].includes(func)) {
    autoRange = (await s.query(`${rangeCmd[func] ?? func}:RANG:AUTO?`)).trim() === '1'
  }
  const wait = (lastRead.get(resource) ?? 0) + READ_INTERVAL_MS - Date.now()
  if (wait > 0) await sleep(wait)
  try {
    const value = parseFloat(await s.query('READ?'))
    return { func, range, resolution, autoRange, value, time: Date.now() }
  } finally {
    lastRead.set(resource, Date.now())
  }
}

// All instrument I/O goes through one queue so commands never interleave.
let queue: Promise<unknown> = Promise.resolve()
function serial<T>(job: () => Promise<T>): Promise<T> {
  const next = queue.then(job, job)
  queue = next.catch(() => undefined)
  return next
}

const isSerial = (resource: string): boolean => /^COM\d+$/i.test(resource)

/** Resources whose unrecognized instrument answered like a power supply → model it reported. */
const genericModel = new Map<string, string>()
/** Probe results per resource + *IDN?, so a rescan does not probe the same device again. */
const probed = new Map<string, boolean>()

/**
 * Driver for an instrument, in order: forced in settings, scope/DMM by model,
 * power supply profile by model (user profiles first), then auto-detected generic PSU.
 */
function driverFor(model: string, resource: string): Driver | undefined {
  const forced = deviceConfig(resource)?.driver
  const forcedProfile = forced && forced !== 'auto' ? psuProfile(forced) : undefined
  if (forcedProfile) return psuDriver(forcedProfile)
  const fixed = drivers.find((d) => d.match.test(model))
  if (fixed) return fixed
  const p = psuProfileFor(model)
  if (p) return psuDriver(p)
  if (model && genericModel.get(resource) === model) return psuDriver(genericProfile())
  return undefined
}

/** Model last seen on each resource, to know before *IDN? whether a port wants Remote. */
const lastModel = new Map<string, string>()

const profilesFile = (): string => join(appDir(), 'psuProfiles.json')

export function psuProfiles(): PsuProfileInfo {
  loadCustomProfiles(profilesFile())
  return {
    profiles: allProfiles().map(({ id, label, custom }) => ({ id, label, custom: !!custom })),
    file: profilesFile(),
    errors: customProfileErrors()
  }
}

/** Path of psuProfiles.json, created with an example entry if missing. */
export function openableProfilesFile(): string {
  ensureProfilesFile(profilesFile())
  return profilesFile()
}

export function parseIdn(resource: string, idn: string): Instrument {
  const [maker = '', model = '', serial = ''] = idn.split(',').map((s) => s.trim())
  const d = driverFor(model, resource)
  lastModel.set(resource, model)
  return {
    resource,
    idn,
    maker,
    model,
    serial,
    kind: d?.kind ?? 'unknown',
    supported: !!d,
    options: d?.options ?? [],
    transport: isSerial(resource) ? 'serial' : 'usb',
    method: d?.method ?? 'screen'
  }
}

/** Configuration of the RS-232 instrument on `port`, if any. */
export const serialDevice = (port: string): SerialDevice | undefined =>
  getSettings().serialDevices.find((d) => d.port.toUpperCase() === port.toUpperCase())

/** Driver/style settings of a serial or USB instrument, if any. */
export const deviceConfig = (resource: string): SerialDevice | UsbDevice | undefined =>
  isSerial(resource) ? serialDevice(resource) : getSettings().usbDevices.find((d) => d.resource === resource)

async function connect(resource: string, timeoutMs: number): Promise<Session> {
  return isSerial(resource)
    ? SerialSession.open(resource, serialDevice(resource)?.baud ?? 9600, timeoutMs)
    : VisaSession.open(resource, timeoutMs)
}

export function listSerialPorts(): Promise<ComPort[]> {
  return listComPorts()
}

export function listInstruments(): Promise<Instrument[]> {
  return serial(async () => {
    // Pick up edits to psuProfiles.json on every scan.
    loadCustomProfiles(profilesFile())
    const out: Instrument[] = []
    let resources: string[] = []
    try {
      resources = findResources('USB?*INSTR')
    } catch {
      // No VISA installed: RS-232 instruments still work.
    }
    for (const d of getSettings().serialDevices) {
      if (d.port && !resources.includes(d.port)) resources.push(d.port)
    }
    for (const resource of resources) {
      // An RS-232 instrument occasionally misses the first exchange after the port opens.
      const attempts = isSerial(resource) ? 2 : 1
      for (let n = 0; n < attempts; n++) {
        try {
          const s = await connect(resource, 2000)
          try {
            const idn = await s.query('*IDN?')
            let inst = parseIdn(resource, idn)
            if (!inst.supported) {
              // Not a known model: if it answers like a power supply, read it as a generic one.
              const key = `${resource}|${idn}`
              if (!probed.has(key)) probed.set(key, await probeGenericPsu(s))
              if (probed.get(key)) {
                genericModel.set(resource, inst.model)
                inst = parseIdn(resource, idn)
              }
            }
            // One USB device can show up under several IDs; keep the first that answers.
            // Serial instruments are told apart by port (two 34401As both report serial "0").
            const dup =
              inst.transport === 'usb' &&
              out.some((i) => i.transport === 'usb' && i.serial && i.serial === inst.serial && i.model === inst.model)
            if (!dup) out.push(inst)
            break
          } finally {
            await s.close()
          }
        } catch {
          // Stale entry, nothing on the serial port, or a second interface of the same device.
        }
      }
    }
    return out
  })
}

export function captureInstrument(
  resource: string,
  opts: CaptureOptions
): Promise<{ data: CaptureData; instrument: Instrument }> {
  return serial(async () => {
    // An RS-232 meter occasionally ignores the first exchange (e.g. right after a previous
    // capture handed it back to Local), so serial captures get one more attempt.
    const attempts = isSerial(resource) ? 2 : 1
    for (let n = 1; ; n++) {
      try {
        return await captureOnce(resource, opts)
      } catch (e) {
        if (n >= attempts) throw e
        await sleep(500)
      }
    }
  })
}

async function captureOnce(resource: string, opts: CaptureOptions): Promise<{ data: CaptureData; instrument: Instrument }> {
  const s = await connect(resource, 5000)
  const wantsRemote = (d: Driver | undefined): boolean => isSerial(resource) && d?.serialRemote !== false
  let remote = false
  const goRemote = async (): Promise<void> => {
    // READ? needs Remote. Switch first thing after opening: in Local the meter handles
    // commands only between readings, and a READ? sent before REMote took effect is
    // never answered. An empty line clears its input parser.
    await s.write('')
    await s.write('SYSTem:REMote')
    remote = true
    await sleep(300)
  }
  try {
    // Units that have no Remote command (most power supplies) are not sent one.
    if (wantsRemote(driverFor(lastModel.get(resource) ?? '', resource))) await goRemote()
    const instrument = parseIdn(resource, await s.query('*IDN?'))
    const driver = driverFor(instrument.model, resource)
    if (!driver) throw new Error(`${instrument.model || resource} is not supported for capture`)
    if (!remote && wantsRemote(driver)) await goRemote()
    s.setTimeout(driver.timeoutMs)
    return { data: await driver.capture(s, opts, resource, instrument.model), instrument }
  } catch (e) {
    s.clear()
    throw e
  } finally {
    if (remote) await s.write('SYSTem:LOCal').catch(() => undefined)
    await s.close()
  }
}
