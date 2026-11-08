import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, CheckCircle2, CircleSlash, FileCog, FolderOpen, Keyboard, Plus, RefreshCw, X } from 'lucide-react'
import type { ComPort, Instrument, PsuProfileInfo, SerialDevice, Settings, UsbDevice } from '@shared/types'
import { useDragWithin } from '../useDragWithin'
import { eventToAccelerator, isValidHotkey } from '../util'

interface Props {
  settings: Settings
  instrument?: Instrument
  /** All detected instruments, to show what answers on each serial port */
  instruments: Instrument[]
  onChooseRoot: () => void
  onSave: (patch: Partial<Settings>) => void
  onClose: () => void
}

function preview(template: string, inst?: Instrument): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return (
    template
      .replace('{model}', (inst?.model || 'DSO-X2012A').replace(/\s+/g, ''))
      .replace('{serial}', inst?.serial || 'MY00000000')
      .replace('{date}', `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`)
      .replace('{time}', `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`) + '.png'
  )
}

export default function SettingsDialog(p: Props): ReactNode {
  const [template, setTemplate] = useState(p.settings.filenameTemplate)
  const [hotkey, setHotkey] = useState(p.settings.captureHotkey)
  const [globalHotkey, setGlobalHotkey] = useState(p.settings.globalHotkey)
  const [modelSubfolder, setModelSubfolder] = useState(p.settings.modelSubfolder)
  const [devices, setDevices] = useState<SerialDevice[]>(p.settings.serialDevices)
  const updateDevice = (i: number, patch: Partial<SerialDevice>): void =>
    setDevices((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  const [ports, setPorts] = useState<ComPort[]>([])
  const [scanningPorts, setScanningPorts] = useState(false)
  const scanPorts = (): void => {
    setScanningPorts(true)
    window.api
      .listSerialPorts()
      .then(setPorts)
      .finally(() => setScanningPorts(false))
  }
  useEffect(scanPorts, [])
  const [profileInfo, setProfileInfo] = useState<PsuProfileInfo | null>(null)
  const loadProfiles = (): void => {
    window.api.psuProfiles().then(setProfileInfo)
  }
  useEffect(loadProfiles, [])
  const profiles = profileInfo?.profiles ?? []
  const customCount = profiles.filter((x) => x.custom).length
  const openProfiles = (): void => {
    window.api.openProfilesFile().then(loadProfiles, loadProfiles)
  }

  // USB instruments: detected power supplies / unrecognized units, plus saved entries not connected now.
  const [usb, setUsb] = useState<UsbDevice[]>(p.settings.usbDevices ?? [])
  const usbConf = (resource: string): UsbDevice =>
    usb.find((u) => u.resource === resource) ?? { resource, style: 'display', driver: 'auto' }
  const updateUsb = (resource: string, patch: Partial<UsbDevice>): void =>
    setUsb((us) => [...us.filter((u) => u.resource !== resource), { ...usbConf(resource), ...patch }])
  const usbRows = [
    ...p.instruments
      .filter((i) => i.transport === 'usb' && (i.kind === 'psu' || i.kind === 'unknown'))
      .map((i) => i.resource),
    ...usb.map((u) => u.resource)
  ].filter((r, i, all) => all.indexOf(r) === i)

  const driverOptions = (
    <>
      <option value="auto">Driver: Auto (by *IDN?, unknown power supplies → Generic)</option>
      {profiles.map((pr) => (
        <option key={pr.id} value={pr.id}>
          Power supply: {pr.label}
          {pr.custom ? ' (psuProfiles.json)' : ''}
        </option>
      ))}
    </>
  )
  const styleOptions = (
    <>
      <option value="display">Display only</option>
      <option value="panel">Display + body</option>
    </>
  )
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState('')
  const drag = useDragWithin<HTMLDivElement>()

  const record = (e: React.KeyboardEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') return setRecording(false)
    if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.shiftKey) {
      setHotkey('F8')
      setHint('')
      return setRecording(false)
    }
    const acc = eventToAccelerator(e)
    if (!acc) return // only a modifier so far
    if (!isValidHotkey(acc)) {
      setHint('Use a function key (F1–F24) or a combination with Ctrl / Alt.')
      return
    }
    setHotkey(acc)
    setHint('')
    setRecording(false)
  }

  return (
    <div className="modal-backdrop" onMouseDown={p.onClose}>
      <div
        ref={drag.ref}
        className="modal wide"
        style={{ transform: `translate(${drag.offset.x}px, ${drag.offset.y}px)` }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') p.onClose()
        }}
      >
        <h3 className="drag-handle" {...drag.handleProps}>
          Settings
        </h3>

        <label className="field">
          <span>Capture folder</span>
          <div className="row">
            <input value={p.settings.saveRoot} readOnly />
            <button className="btn ghost" onClick={p.onChooseRoot}>
              <FolderOpen size={15} /> Change…
            </button>
          </div>
          <label className="check">
            <input type="checkbox" checked={modelSubfolder} onChange={(e) => setModelSubfolder(e.target.checked)} />
            Save into a subfolder per model when capturing to All captures
          </label>
        </label>

        <label className="field">
          <span>File name template</span>
          <input value={template} onChange={(e) => setTemplate(e.target.value)} spellCheck={false} />
          <small>
            Tokens: <code>{'{model}'}</code> <code>{'{serial}'}</code> <code>{'{date}'}</code>{' '}
            <code>{'{time}'}</code> — preview: <code>{preview(template, p.instrument)}</code>
          </small>
        </label>

        <div className="field">
          <span>Capture shortcut</span>
          <div className="row">
            <button
              className={`hotkey${recording ? ' recording' : ''}`}
              onClick={() => setRecording(true)}
              onKeyDown={recording ? record : undefined}
              onKeyUp={(e) => recording && e.code === 'PrintScreen' && record(e)}
              onBlur={() => setRecording(false)}
            >
              <Keyboard size={15} />
              {recording ? <span className="muted">Press a key combination…</span> : <kbd>{hotkey}</kbd>}
            </button>
            <label className="check">
              <input type="checkbox" checked={globalHotkey} onChange={(e) => setGlobalHotkey(e.target.checked)} />
              Global (works when OscCapture is not focused)
            </label>
          </div>
          <small>{hint || 'Click the box and press keys. Esc cancels, Backspace resets to F8.'}</small>
        </div>

        <div className="field">
          <span>Serial instruments (RS-232)</span>
          <div className="group-box">
            {devices.map((d, i) => {
              const found = p.instruments.find((x) => x.resource.toUpperCase() === d.port.toUpperCase())
              const saved = p.settings.serialDevices.some((x) => x.port === d.port && x.baud === d.baud)
              const usedTwice = devices.some((x, j) => j !== i && x.port === d.port)
              return (
                <div key={i} className="serial-dev">
                  <div className="row">
                    <select className="grow" value={d.port} onChange={(e) => updateDevice(i, { port: e.target.value })}>
                      {!d.port && <option value="">Select port…</option>}
                      {ports.map((c) => (
                        <option key={c.path} value={c.path}>
                          {c.label}
                        </option>
                      ))}
                      {d.port && !ports.some((c) => c.path === d.port) && (
                        <option value={d.port}>{d.port} (not found)</option>
                      )}
                    </select>
                    <select value={d.baud} onChange={(e) => updateDevice(i, { baud: +e.target.value })}>
                      {[300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map((b) => (
                        <option key={b} value={b}>
                          {b} baud
                        </option>
                      ))}
                    </select>
                    <select
                      value={d.style}
                      onChange={(e) => updateDevice(i, { style: e.target.value as SerialDevice['style'] })}
                      title="What the saved image shows"
                    >
                      {styleOptions}
                    </select>
                    <button className="icon-btn" title="Remove" onClick={() => setDevices((ds) => ds.filter((_, j) => j !== i))}>
                      <X size={15} />
                    </button>
                  </div>
                  <div className="row">
                    <select
                      className="grow"
                      value={d.driver ?? 'auto'}
                      onChange={(e) => updateDevice(i, { driver: e.target.value })}
                      title="How the instrument is read. Auto picks by its *IDN? reply; choose a power supply family for rebadged or unlisted models."
                    >
                      {driverOptions}
                    </select>
                  </div>
                  <div className={`dev-status${found && !usedTwice ? ' ok' : ''}`}>
                    {usedTwice ? (
                      <>
                        <CircleSlash size={13} /> This port is used by another entry
                      </>
                    ) : found ? (
                      <>
                        <CheckCircle2 size={13} /> <span className="mono">{found.idn}</span>
                      </>
                    ) : (
                      <>
                        <CircleSlash size={13} /> {saved ? 'Not responding' : 'Will be checked after Save'}
                      </>
                    )}
                  </div>
                </div>
              )
            })}
            <div className="row group-actions">
              <button
                className="btn ghost"
                onClick={() =>
                  setDevices((ds) => [
                    ...ds,
                    { port: ports.find((c) => !ds.some((d) => d.port === c.path))?.path ?? '', baud: 9600, style: 'display', driver: 'auto' }
                  ])
                }
              >
                <Plus size={15} /> Add serial instrument
              </button>
              <button className="btn ghost" onClick={scanPorts} disabled={scanningPorts}>
                <RefreshCw size={15} className={scanningPorts ? 'spin' : ''} /> Rescan COM ports
              </button>
            </div>
            <small>
              8 data bits, no parity, 1 stop bit, DTR on. For the 34401A, set its I/O menu to RS-232. Power supplies have
              no screen dump: their outputs are read over SCPI and drawn as the front-panel display.
            </small>
          </div>
        </div>

        <div className="field">
          <span>USB instruments (power supplies and unrecognized models)</span>
          <div className="group-box">
            {usbRows.length === 0 && <small>No USB power supply or unrecognized USB instrument is connected.</small>}
            {usbRows.map((resource) => {
              const found = p.instruments.find((x) => x.resource === resource)
              const conf = usbConf(resource)
              return (
                <div key={resource} className="serial-dev">
                  <div className="row">
                    <select
                      className="grow"
                      value={conf.driver ?? 'auto'}
                      onChange={(e) => updateUsb(resource, { driver: e.target.value })}
                      title="How the instrument is read. Choose a power supply family for rebadged or unlisted models."
                    >
                      {driverOptions}
                    </select>
                    <select
                      value={conf.style}
                      onChange={(e) => updateUsb(resource, { style: e.target.value as UsbDevice['style'] })}
                      title="What the saved image shows"
                    >
                      {styleOptions}
                    </select>
                    {!found && (
                      <button
                        className="icon-btn"
                        title="Forget this instrument"
                        onClick={() => setUsb((us) => us.filter((u) => u.resource !== resource))}
                      >
                        <X size={15} />
                      </button>
                    )}
                  </div>
                  <div className={`dev-status${found?.supported ? ' ok' : ''}`}>
                    {found ? (
                      <>
                        {found.supported ? <CheckCircle2 size={13} /> : <CircleSlash size={13} />}{' '}
                        <span className="mono">{found.idn}</span>
                      </>
                    ) : (
                      <>
                        <CircleSlash size={13} /> Not connected · <span className="mono">{resource}</span>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="field">
          <span>Power supply profiles</span>
          <div className="group-box">
            <div className={`dev-status${profileInfo && !profileInfo.errors.length ? ' ok' : ''}`}>
              {profileInfo?.errors.length ? (
                <>
                  <AlertTriangle size={13} /> psuProfiles.json has problems:
                </>
              ) : (
                <>
                  <CheckCircle2 size={13} /> {profiles.length - customCount} built-in,{' '}
                  {customCount ? `${customCount} from psuProfiles.json` : 'none from psuProfiles.json'}
                </>
              )}
            </div>
            {profileInfo?.errors.map((e) => (
              <small key={e} className="mono">
                {e}
              </small>
            ))}
            <div className="row group-actions">
              <button className="btn ghost" onClick={openProfiles}>
                <FileCog size={15} /> Edit psuProfiles.json
              </button>
              <button className="btn ghost" onClick={loadProfiles}>
                <RefreshCw size={15} /> Reload
              </button>
            </div>
            <small>
              Add power supplies by listing their SCPI queries; the file opens with an example. Unrecognized instruments
              that answer MEAS:VOLT?, MEAS:CURR?, VOLT? and CURR? with numbers are read with the Generic driver.
            </small>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={p.onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            onClick={() => {
              p.onSave({
                filenameTemplate: template.trim() || '{model}_{date}_{time}',
                captureHotkey: hotkey,
                globalHotkey,
                modelSubfolder,
                // Drop empty and duplicate ports.
                serialDevices: devices.filter((d, i) => d.port && devices.findIndex((x) => x.port === d.port) === i),
                // Only keep USB entries that differ from the defaults.
                usbDevices: usb.filter((u) => (u.driver && u.driver !== 'auto') || u.style !== 'display')
              })
              p.onClose()
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
