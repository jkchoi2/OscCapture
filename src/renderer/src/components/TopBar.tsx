import type { ReactNode } from 'react'
import { Camera, Loader2, RefreshCw, Settings as Gear } from 'lucide-react'
import type { Instrument, Settings } from '@shared/types'

interface Props {
  instruments: Instrument[]
  resource: string
  scanning: boolean
  capturing: boolean
  scanError: string
  settings: Settings
  onSelect: (resource: string) => void
  onScan: () => void
  onCapture: () => void
  onToggle: (key: 'inkSaver' | 'grayscale' | 'freeze' | 'autoCopy') => void
  onOpenSettings: () => void
}

const KIND_LABEL = { scope: 'Scope', dmm: 'DMM', psu: 'PSU', unknown: '?' } as const

const toggles: { key: 'inkSaver' | 'grayscale' | 'freeze' | 'autoCopy'; label: string; title: string }[] = [
  { key: 'inkSaver', label: 'Ink Saver', title: 'Invert background to white (scope Ink Saver)' },
  { key: 'grayscale', label: 'Grayscale', title: 'Capture in grayscale' },
  { key: 'freeze', label: 'Freeze', title: 'Stop acquisition during capture, then resume' },
  { key: 'autoCopy', label: 'Auto-copy', title: 'Copy each new capture to the clipboard' }
]

export default function TopBar(p: Props): ReactNode {
  const current = p.instruments.find((i) => i.resource === p.resource)
  const state = p.capturing ? 'busy' : current ? 'ok' : p.scanning ? 'busy' : 'off'
  const statusText = p.capturing
    ? 'Capturing…'
    : p.scanning
      ? 'Scanning…'
      : current
        ? 'Connected'
        : p.scanError || 'No instrument'

  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 32 32" width="26" height="26" aria-hidden>
          <rect x="1" y="1" width="30" height="30" rx="7" fill="var(--ch1-dim)" stroke="var(--ch1)" strokeWidth="1.5" />
          <path
            d="M5 19 L10 19 L12 9 L15 24 L18 13 L20 19 L27 19"
            fill="none"
            stroke="var(--ch1)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>
        <span>
          Osc<b>Capture</b>
        </span>
      </div>

      <div className="no-drag instrument">
        <span className={`led ${state}`} title={statusText} />
        <select
          value={p.resource}
          onChange={(e) => p.onSelect(e.target.value)}
          disabled={p.scanning || p.capturing || !p.instruments.length}
        >
          {!p.instruments.length && <option value="">{statusText}</option>}
          {p.instruments.map((i) => (
            <option key={i.resource} value={i.resource}>
              {`${KIND_LABEL[i.kind]} · ${i.model || i.resource}  ·  ${i.transport === 'serial' ? i.resource : i.serial}${i.supported ? '' : '  (not supported)'}`}
            </option>
          ))}
        </select>
        <button className="icon-btn" onClick={p.onScan} disabled={p.scanning || p.capturing} title="Rescan instruments">
          <RefreshCw size={15} className={p.scanning ? 'spin' : ''} />
        </button>
      </div>

      <div className="no-drag chips">
        {toggles.map((t) => {
          // Auto-copy applies to every instrument; the rest depend on the driver.
          const na = !!current && t.key !== 'autoCopy' && !current.options.includes(t.key)
          return (
            <button
              key={t.key}
              className={`chip${p.settings[t.key] && !na ? ' on' : ''}`}
              title={na ? `Not available for ${current!.model}` : t.title}
              disabled={na}
              onClick={() => p.onToggle(t.key)}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="spacer" />

      <button className="no-drag icon-btn" onClick={p.onOpenSettings} title="Settings">
        <Gear size={17} />
      </button>
      <button
        className="no-drag capture-btn"
        onClick={p.onCapture}
        disabled={!current?.supported || p.capturing || p.scanning}
        title={
          current && !current.supported
            ? `${current.model} is not supported for screen capture`
            : `Capture ${current?.model ?? 'instrument'} screen (${p.settings.captureHotkey})`
        }
      >
        {p.capturing ? <Loader2 size={18} className="spin" /> : <Camera size={18} />}
        <span>Capture</span>
        {p.settings.captureHotkey && <kbd>{p.settings.captureHotkey}</kbd>}
      </button>
    </header>
  )
}
