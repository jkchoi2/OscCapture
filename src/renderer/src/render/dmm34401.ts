// Draws the 34401A's vacuum-fluorescent display with a reading and returns it as PNG bytes.
import type { DmmReading, Instrument, RenderStyle } from '@shared/types'
import { svgToPng } from './svgPng'

interface FuncInfo {
  label: string
  unit: string // unit for range/resolution text
  suffix: string // unit as the meter spells it on the display
  rangeBased: boolean // display digits follow the range (vs. the value itself)
}

const FUNCS: Record<string, FuncInfo> = {
  VOLT: { label: 'DC Voltage', unit: 'V', suffix: 'VDC', rangeBased: true },
  'VOLT:AC': { label: 'AC Voltage', unit: 'V', suffix: 'VAC', rangeBased: true },
  CURR: { label: 'DC Current', unit: 'A', suffix: 'ADC', rangeBased: true },
  'CURR:AC': { label: 'AC Current', unit: 'A', suffix: 'AAC', rangeBased: true },
  RES: { label: '2-Wire Resistance', unit: 'Ω', suffix: 'OHM', rangeBased: true },
  FRES: { label: '4-Wire Resistance', unit: 'Ω', suffix: 'OHM', rangeBased: true },
  FREQ: { label: 'Frequency', unit: 'Hz', suffix: 'HZ', rangeBased: false },
  PER: { label: 'Period', unit: 's', suffix: 'SEC', rangeBased: false },
  CONT: { label: 'Continuity', unit: 'Ω', suffix: 'OHM', rangeBased: false },
  DIOD: { label: 'Diode', unit: 'V', suffix: 'VDC', rangeBased: false }
}

// [factor, prefix for text, prefix as drawn on the 14-segment display]
const PREFIXES: [number, string, string][] = [
  [1e6, 'M', 'M'],
  [1e3, 'k', 'K'],
  [1, '', ''],
  [1e-3, 'm', 'm'],
  [1e-6, 'µ', 'u'],
  [1e-9, 'n', 'N']
]

/** Largest prefix not exceeding `base`; volts and amps never go above the base unit. */
function prefixFor(base: number, unit: string): [number, string, string] {
  const allowed = unit === 'V' || unit === 'A' ? PREFIXES.filter(([f]) => f <= 1) : PREFIXES
  if (!isFinite(base) || base === 0) return [1, '', '']
  return allowed.find(([f]) => Math.abs(base) >= f * 0.9999) ?? allowed[allowed.length - 1]
}

function eng(v: number, unit: string): string {
  if (!isFinite(v)) return '—'
  const [f, p] = prefixFor(v, unit)
  return `${parseFloat((v / f).toPrecision(6))} ${p}${unit}`
}

export interface DisplayText {
  /** Number as shown: no "+" sign, comma every 3 fractional digits, e.g. "1.001,065" */
  main: string
  /** Unit as shown, e.g. "mVDC", "KOHM" */
  unit: string
  info: FuncInfo
}

export function formatReading(r: DmmReading): DisplayText {
  const func = r.func.toUpperCase().replace(/:DC$/, '')
  const info = FUNCS[func] ?? { label: func, unit: '', suffix: '', rangeBased: false }
  if (Math.abs(r.value) >= 9e37 || !isFinite(r.value)) {
    const open = func === 'CONT' || func === 'DIOD'
    return { main: open ? 'OPEN' : 'OVLD', unit: open ? '' : info.suffix, info }
  }

  const useRange = info.rangeBased && isFinite(r.range) && r.range > 0
  const [f, , drawn] = prefixFor(useRange ? r.range : r.value, info.unit)
  const scaled = Math.abs(r.value) / f
  let decimals: number
  let intDigits = 1
  if (useRange) {
    intDigits = Math.floor(Math.log10(r.range / f) + 1e-9) + 1
    decimals = isFinite(r.resolution) && r.resolution > 0 ? Math.round(-Math.log10(r.resolution / f)) : 6 - intDigits
  } else {
    decimals = 5 - Math.floor(Math.log10(Math.max(scaled, 1e-12)))
  }
  decimals = Math.min(Math.max(decimals, 0), 7)
  const [int, frac = ''] = scaled.toFixed(decimals).split('.')
  const grouped = frac.replace(/(\d{3})(?=\d)/g, '$1,')
  const main = `${r.value < 0 ? '-' : ''}${int.padStart(intDigits, '0')}${frac ? '.' + grouped : ''}`
  return { main, unit: `${drawn}${info.suffix}`, info }
}

/* ---------- 14-segment glyphs ---------- */

const CW = 26 // cell width
const CH = 50 // cell height
const PITCH = 37

type Seg = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G1' | 'G2' | 'H' | 'I' | 'J' | 'K' | 'L' | 'M'

const g = 1.8 // gap between segments
const SEGMENTS: Record<Seg, [number, number, number, number]> = {
  A: [g, 0, CW - g, 0],
  D: [g, CH, CW - g, CH],
  F: [0, g, 0, CH / 2 - g],
  E: [0, CH / 2 + g, 0, CH - g],
  B: [CW, g, CW, CH / 2 - g],
  C: [CW, CH / 2 + g, CW, CH - g],
  G1: [g, CH / 2, CW / 2 - g, CH / 2],
  G2: [CW / 2 + g, CH / 2, CW - g, CH / 2],
  I: [CW / 2, g, CW / 2, CH / 2 - g],
  L: [CW / 2, CH / 2 + g, CW / 2, CH - g],
  H: [g + 1, g + 2, CW / 2 - g + 1, CH / 2 - g],
  J: [CW - g - 1, g + 2, CW / 2 + g - 1, CH / 2 - g],
  K: [CW / 2 - g + 1, CH / 2 + g, g + 1, CH - g - 2],
  M: [CW / 2 + g - 1, CH / 2 + g, CW - g - 1, CH - g - 2]
}

const GLYPHS: Record<string, Seg[]> = {
  '0': ['A', 'B', 'C', 'D', 'E', 'F'],
  '1': ['B', 'C'],
  '2': ['A', 'B', 'G1', 'G2', 'E', 'D'],
  '3': ['A', 'B', 'G2', 'C', 'D'],
  '4': ['F', 'G1', 'G2', 'B', 'C'],
  '5': ['A', 'F', 'G1', 'G2', 'C', 'D'],
  '6': ['A', 'F', 'E', 'D', 'C', 'G1', 'G2'],
  '7': ['A', 'B', 'C'],
  '8': ['A', 'B', 'C', 'D', 'E', 'F', 'G1', 'G2'],
  '9': ['A', 'B', 'C', 'D', 'F', 'G1', 'G2'],
  '-': ['G1', 'G2'],
  A: ['A', 'B', 'C', 'E', 'F', 'G1', 'G2'],
  C: ['A', 'F', 'E', 'D'],
  D: ['A', 'B', 'C', 'D', 'I', 'L'],
  E: ['A', 'F', 'E', 'D', 'G1', 'G2'],
  H: ['F', 'E', 'B', 'C', 'G1', 'G2'],
  K: ['F', 'E', 'G1', 'J', 'M'],
  L: ['F', 'E', 'D'],
  M: ['F', 'E', 'B', 'C', 'H', 'J'],
  N: ['F', 'E', 'B', 'C', 'H', 'M'],
  O: ['A', 'B', 'C', 'D', 'E', 'F'],
  P: ['A', 'B', 'F', 'E', 'G1', 'G2'],
  S: ['A', 'F', 'G1', 'G2', 'C', 'D'],
  V: ['F', 'E', 'K', 'J'],
  Z: ['A', 'J', 'K', 'D'],
  m: ['E', 'G1', 'G2', 'C', 'L'],
  u: ['E', 'D', 'C']
}

interface Cell {
  ch: string
  dot: boolean
  comma: boolean
}

function toCells(text: string): Cell[] {
  const cells: Cell[] = []
  for (const ch of text) {
    const last = cells[cells.length - 1]
    if ((ch === '.' || ch === ',') && last) {
      if (ch === '.') last.dot = true
      else last.comma = true
    } else cells.push({ ch, dot: false, comma: false })
  }
  return cells
}

/** Hexagonal (pointed-end) segment between two points, like real VFD segments. */
function segPolygon(x1: number, y1: number, x2: number, y2: number, t: number): string {
  const len = Math.hypot(x2 - x1, y2 - y1)
  const dx = (x2 - x1) / len
  const dy = (y2 - y1) / len
  const nx = -dy * (t / 2)
  const ny = dx * (t / 2)
  const ex = dx * (t / 2)
  const ey = dy * (t / 2)
  const pts = [
    [x1, y1],
    [x1 + ex + nx, y1 + ey + ny],
    [x2 - ex + nx, y2 - ey + ny],
    [x2, y2],
    [x2 - ex - nx, y2 - ey - ny],
    [x1 + ex - nx, y1 + ey - ny]
  ]
  return pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')
}

const SEG_T = 4.8 // segment thickness

function drawCells(cells: Cell[], x0: number, y0: number): { lit: string; ghost: string } {
  let lit = ''
  let ghost = ''
  cells.forEach((c, i) => {
    const x = x0 + i * PITCH
    const on = new Set(GLYPHS[c.ch] ?? [])
    let l = ''
    let gh = ''
    for (const s of Object.keys(SEGMENTS) as Seg[]) {
      const [a, b, cc, d] = SEGMENTS[s]
      const diag = a !== cc && b !== d
      const poly = `<polygon points="${segPolygon(a, b, cc, d, diag ? SEG_T * 0.8 : SEG_T)}"/>`
      if (on.has(s)) l += poly
      else gh += poly
    }
    const dpOn = c.dot || c.comma
    const dp = `<circle cx="${CW + 5.5}" cy="${CH}" r="2.5"/>`
    const comma = `<polygon points="${segPolygon(CW + 5.5, CH + 1.5, CW + 2.2, CH + 8, 2.6)}"/>`
    // A slight italic slant, like the meter's display.
    const tf = `translate(${x} ${y0}) skewX(-6)`
    lit += `<g transform="${tf}">${l}${dpOn ? dp : ''}${c.comma ? comma : ''}</g>`
    ghost += `<g transform="${tf}">${gh}${dpOn ? '' : dp}</g>`
  })
  return { lit, ghost }
}

/* ---------- display ---------- */

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function stamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Small starburst mark printed on the display glass. */
function starburst(cx: number, cy: number): string {
  let rays = ''
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8
    const r1 = 2.2
    const r2 = i % 2 ? 4.6 : 6.6
    rays += `<line x1="${(cx + r1 * Math.cos(a)).toFixed(2)}" y1="${(cy + r1 * Math.sin(a)).toFixed(2)}" x2="${(cx + r2 * Math.cos(a)).toFixed(2)}" y2="${(cy + r2 * Math.sin(a)).toFixed(2)}"/>`
  }
  return `<g stroke="#d9dcdc" stroke-width="0.9" stroke-linecap="round">${rays}</g><circle cx="${cx}" cy="${cy}" r="1.1" fill="#d9dcdc"/>`
}

function footerText(r: DmmReading, inst: Instrument): string {
  const { info } = formatReading(r)
  const rangeText =
    info.rangeBased && isFinite(r.range) ? `Range ${eng(r.range, info.unit)} ${r.autoRange ? 'Auto' : 'Manual'}` : ''
  return [info.label, rangeText, stamp(r.time), inst.transport === 'serial' ? inst.resource : '']
    .filter(Boolean)
    .join('  ·  ')
}

const DW = 600
const DH = 165

interface DisplayOpts {
  footer: boolean
  x?: number
  y?: number
  width?: number
}

/** The VFD display window as an <svg> element (nestable inside the panel drawing). */
function displaySvg(r: DmmReading, inst: Instrument, opts: DisplayOpts): string {
  const { main, unit, info } = formatReading(r)
  const func = r.func.toUpperCase()

  // Sign cell is always present (blank when positive), then the number, a space, the unit.
  const text = (main.startsWith('-') ? '' : ' ') + main + (unit ? ' ' + unit : '')
  const cells = toCells(text)
  const width = cells.length * PITCH - (PITCH - CW)
  const x0 = Math.round((DW - width) / 2) + 8
  const { lit, ghost } = drawCells(cells, x0, 54)

  // Annunciator positions across the display; only lit ones are drawn, like a real VFD.
  const annunciators: [string, boolean][] = [
    ['Rmt', false],
    ['Man', !r.autoRange && info.rangeBased],
    ['Trig', false],
    ['Hold', false],
    ['Mem', false],
    ['Ratio', false],
    ['Math', false],
    ['ERROR', false],
    ['Rear', false],
    ['Shift', false],
    ['4W', func === 'FRES'],
    [')))', func === 'CONT']
  ]
  const ann = annunciators
    .map(([t, on], i) => (on ? `<text x="${70 + i * 42}" y="126" class="ann">${esc(t)}</text>` : ''))
    .join('')

  const w = opts.width ?? DW
  const h = (w / DW) * DH
  const footer = opts.footer
    ? `<text x="${DW - 14}" y="${DH - 11}" class="print" font-size="7.5" fill-opacity="0.38" text-anchor="end">${esc(footerText(r, inst))}</text>`
    : ''
  return `<svg x="${opts.x ?? 0}" y="${opts.y ?? 0}" width="${w}" height="${h}" viewBox="0 0 ${DW} ${DH}">
<defs>
  <radialGradient id="glass" cx="50%" cy="48%" r="80%"><stop offset="0" stop-color="#0a1914"/><stop offset="0.65" stop-color="#050d0a"/><stop offset="1" stop-color="#020403"/></radialGradient>
  <linearGradient id="seg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c4fbee"/><stop offset="0.5" stop-color="#9af7dc"/><stop offset="1" stop-color="#7ff0d2"/></linearGradient>
  <linearGradient id="shine" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity="0.07"/><stop offset="0.5" stop-color="#ffffff" stop-opacity="0.015"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/></linearGradient>
  <pattern id="mesh" width="3" height="3" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r="0.45" fill="#9af7dc" fill-opacity="0.045"/></pattern>
  <filter id="vfdglow" x="-30%" y="-40%" width="160%" height="180%">
    <feGaussianBlur in="SourceAlpha" stdDeviation="1.3" result="a"/>
    <feFlood flood-color="#7df5d8" flood-opacity="0.9"/><feComposite in2="a" operator="in" result="g1"/>
    <feGaussianBlur in="SourceAlpha" stdDeviation="6" result="b"/>
    <feFlood flood-color="#4fdcc2" flood-opacity="0.4"/><feComposite in2="b" operator="in" result="g2"/>
    <feMerge><feMergeNode in="g2"/><feMergeNode in="g1"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <style>
    .lit polygon, .lit circle { fill: url(#seg); }
    .ghost polygon, .ghost circle { fill: #15363a; fill-opacity: 0.09; }
    .ann { font: 700 10.5px 'Segoe UI', Arial, sans-serif; fill: #9af7dc; text-anchor: middle; }
    .print { font-family: 'Segoe UI', Arial, sans-serif; fill: #dfe3e2; }
  </style>
</defs>
<rect width="${DW}" height="${DH}" rx="6" fill="#121615"/>
<rect x="4" y="4" width="${DW - 8}" height="${DH - 8}" rx="4" fill="url(#glass)"/>
<rect x="4" y="4" width="${DW - 8}" height="${DH - 8}" rx="4" fill="url(#mesh)"/>

${starburst(26, 24)}
<text x="37" y="29" class="print" font-size="13" font-weight="700">Agilent</text>
<text x="118" y="23" class="print" font-size="10.5" font-weight="700">34401A</text>
<text x="118" y="33" class="print" font-size="7">6½ Digit Multimeter</text>

<g class="ghost">${ghost}</g>
<g class="lit" filter="url(#vfdglow)">${lit}${ann}</g>

<polygon points="4,4 ${DW * 0.62},4 ${DW * 0.45},${DH - 4} 4,${DH - 4}" fill="url(#shine)"/>
${footer}
</svg>`
}

/* ---------- front panel ---------- */

/** Function key (row 1 column) and whether it is the shifted function. */
const FUNC_KEY: Record<string, [number, boolean]> = {
  VOLT: [0, false],
  CURR: [0, true],
  'VOLT:AC': [1, false],
  'CURR:AC': [1, true],
  RES: [2, false],
  FRES: [2, true],
  FREQ: [3, false],
  PER: [3, true],
  CONT: [4, false],
  DIOD: [4, true]
}

type Mode = 'volt' | 'curr' | 'other'

/** Voltage and current readings get their own key/terminal highlight colors. */
function modeOf(func: string): Mode {
  if (func === 'VOLT' || func === 'VOLT:AC') return 'volt'
  if (func === 'CURR' || func === 'CURR:AC') return 'curr'
  return 'other'
}

const PW = 1000
const PH = 504
const VOLT_COLOR = '#22c47a'
const CURR_COLOR = '#f08a1c'

function panelSvg(r: DmmReading, inst: Instrument): string {
  const func = r.func.toUpperCase().replace(/:DC$/, '')
  const [activeKey, shifted] = FUNC_KEY[func] ?? [-1, false]
  const mode = modeOf(func)
  // The Math keys sit a little apart from the Function keys, as on the meter.
  const col = (i: number): number => 160 + i * 78 + (i >= 5 ? 14 : 0)
  const KW = 62
  const KH = 40
  const ROW1 = 285
  const ROW2 = 376

  /** Square key with a raised bevel; label lines sit top-left like the HP/Agilent keys. */
  const key = (x: number, y: number, label: string, cls = ''): string => {
    const pressed = cls.includes('active')
    const dy = pressed ? 1.5 : 0
    const lines = label
      .split('\n')
      .map((t, i) => `<text x="${x + 7}" y="${y + dy + 16 + i * 13}">${esc(t)}</text>`)
      .join('')
    return (
      `<g class="key ${cls}"><rect class="edge" x="${x}" y="${y}" width="${KW}" height="${KH}" rx="3"/>` +
      `<rect class="top" x="${x + 2}" y="${y + 2 + dy}" width="${KW - 4}" height="${KH - 7 + (pressed ? 1 : 0)}" rx="2"/>` +
      lines +
      '</g>'
    )
  }
  /** Blue shifted-function label above a key; `tag` marks the shifted function in use. */
  const blue = (x: number, y: number, t: string, tag = false): string =>
    tag
      ? `<rect x="${x + 3}" y="${y - 11}" width="${t.length * 7 + 8}" height="15" rx="3" class="tag"/>` +
        `<text x="${x + 7}" y="${y}" class="blue on">${esc(t)}</text>`
      : `<text x="${x + 7}" y="${y}" class="blue">${esc(t)}</text>`
  /** Recessed gray plate behind a key group; `title` is trusted markup (may hold a tspan). */
  const pocket = (i1: number, i2: number, y: number, h: number, title: string): string => {
    const x1 = col(i1) - 6
    const x2 = col(i2) + KW + 6
    return (
      `<rect x="${x1}" y="${y}" width="${x2 - x1}" height="${h}" rx="6" class="pocket"/>` +
      `<text x="${(x1 + x2) / 2}" y="${y + 13}" class="grpl">${title}</text>`
    )
  }
  /** Caption printed under a key or key pair. */
  const below = (i1: number, i2: number, t: string): string =>
    `<text x="${(col(i1) + col(i2) + KW) / 2}" y="${ROW2 + KH + 15}" class="grpl">${t}</text>`
  /** Square push button (Power, Front/Rear). */
  const button = (x: number, y: number, s: number): string =>
    `<g class="key"><rect class="edge" x="${x}" y="${y}" width="${s}" height="${s}" rx="5"/>` +
    `<rect class="top" x="${x + 3}" y="${y + 3}" width="${s - 6}" height="${s - 9}" rx="4"/></g>`

  const activeCls =
    mode === 'volt' ? 'active-volt' : mode === 'curr' ? 'active-curr' : shifted ? 'active-shift' : 'active'
  const row1 = ['DC V', 'AC V', 'Ω 2W', 'Freq', 'Cont )))', 'Null', 'Min\nMax']
  const row1Blue = ['DC I', 'AC I', 'Ω 4W', 'Period', '→|', 'dB', 'dBm']
  const keys1 = row1
    .map((l, i) => {
      const on = i === activeKey
      return blue(col(i), ROW1 - 5, row1Blue[i], on && shifted) + key(col(i), ROW1, l, on ? activeCls : '')
    })
    .join('')
  const row2 = ['<', '>', '∨', '∧', 'Auto/\nMan', 'Single']
  const row2Blue = ['On/Off', 'Recall', '4', '5', '6', 'Auto/Hold']
  const keys2 = row2.map((l, i) => blue(col(i), ROW2 - 5, row2Blue[i]) + key(col(i), ROW2, l)).join('')

  const jack = (x: number, y: number): string =>
    `<circle cx="${x}" cy="${y}" r="19" fill="#c42a20" stroke="#7d1712" stroke-width="2"/>` +
    `<circle cx="${x}" cy="${y}" r="12.5" fill="#0d0d0d"/>` +
    `<circle cx="${x}" cy="${y}" r="6" fill="#b99d5f"/><circle cx="${x}" cy="${y}" r="3" fill="#1c1a16"/>`
  const jackGlow = (x: number, y: number, color: string): string =>
    `<circle cx="${x}" cy="${y}" r="23.5" fill="none" stroke="${color}" stroke-width="3.5" filter="url(#jackglow)"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PW}" height="${PH}" viewBox="0 0 ${PW} ${PH}">
<defs>
  <linearGradient id="bumper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c3c6c9"/><stop offset="0.5" stop-color="#a5a9ad"/><stop offset="1" stop-color="#83878b"/></linearGradient>
  <linearGradient id="face" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f4f4f1"/><stop offset="1" stop-color="#dcdcd7"/></linearGradient>
  <linearGradient id="keyg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fdfdfb"/><stop offset="1" stop-color="#e4e4df"/></linearGradient>
  <linearGradient id="keyp" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e2e2dd"/><stop offset="1" stop-color="#cfcfca"/></linearGradient>
  <linearGradient id="shiftg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c3d3ec"/><stop offset="1" stop-color="#9fb6da"/></linearGradient>
  <filter id="shadow" x="-5%" y="-5%" width="110%" height="125%"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-opacity="0.5"/></filter>
  <filter id="keysh" x="-10%" y="-10%" width="120%" height="130%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.2" flood-opacity="0.35"/></filter>
  <filter id="keyglow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="${VOLT_COLOR}" flood-opacity="0.9"/></filter>
  <filter id="keyglowCurr" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="${CURR_COLOR}" flood-opacity="0.95"/></filter>
  <filter id="keyglowShift" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#4f7fe0" flood-opacity="0.9"/></filter>
  <filter id="jackglow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <style>
    text { font-family: 'Segoe UI', Arial, sans-serif; }
    .key { filter: url(#keysh); }
    .key .edge { fill: #b4b4af; stroke: #8a8a85; stroke-width: 1; }
    .key .top { fill: url(#keyg); stroke: #ffffff; stroke-opacity: 0.7; stroke-width: 0.8; }
    .key text { font-size: 12.5px; font-weight: 700; fill: #262626; }
    .key.active .top, .key.active-volt .top, .key.active-curr .top, .key.active-shift .top { fill: url(#keyp); }
    .key.active .edge, .key.active-volt .edge { stroke: ${VOLT_COLOR}; stroke-width: 2.4; }
    .key.active-curr .edge { stroke: ${CURR_COLOR}; stroke-width: 2.4; }
    .key.active-shift .edge { stroke: #3a62b8; stroke-width: 2.4; }
    .key.active, .key.active-volt { filter: url(#keyglow); }
    .key.active-curr { filter: url(#keyglowCurr); }
    .key.active-shift { filter: url(#keyglowShift); }
    .key.shift .top { fill: url(#shiftg); }
    .key.shift.lit .edge { stroke: #3a62b8; stroke-width: 2.2; }
    .key.shift.lit { filter: url(#keyglowShift); }
    .blue { font-size: 11.5px; fill: #3a62b8; font-weight: 600; }
    .blue.on { fill: #ffffff; font-weight: 700; }
    .tag { fill: #3a62b8; }
    .pocket { fill: #e4e4e0; stroke: #c4c4bf; stroke-width: 1; }
    .grpl { font-size: 12px; fill: #2c2c2a; text-anchor: middle; font-weight: 700; letter-spacing: 0.6px; }
    .grpl .bl { fill: #3a62b8; }
    .term { font-size: 11.5px; fill: #2c2c2c; text-anchor: middle; font-weight: 600; }
    .small { font-size: 9.5px; fill: #3a3a3a; text-anchor: middle; font-weight: 600; }
    .hi { fill: #c0281f; font-weight: 800; font-size: 12px; }
    .info { font-size: 14px; fill: #b9c0c6; }
  </style>
</defs>
<rect width="${PW}" height="${PH}" fill="#15181b"/>

<g filter="url(#shadow)">
  <rect x="8" y="136" width="40" height="176" rx="14" fill="#6d7175"/>
  <rect x="${PW - 48}" y="136" width="40" height="176" rx="14" fill="#6d7175"/>
  <rect x="26" y="20" width="${PW - 52}" height="440" rx="36" fill="url(#bumper)"/>
</g>
<rect x="44" y="36" width="${PW - 88}" height="408" rx="22" fill="url(#face)" stroke="#8d9195"/>

<rect x="62" y="50" width="666" height="190" rx="5" fill="#0b0d0d"/>
${displaySvg(r, inst, { footer: false, x: 70, y: 57, width: 650 })}

<text x="105" y="292" class="term">Power</text>
${button(85, 300, 40)}
<text x="105" y="362" class="small">▬ Off</text><text x="105" y="375" class="small">▬ On</text>

${pocket(0, 4, ROW1 - 35, 82, 'FUNCTION')}
${pocket(5, 6, ROW1 - 35, 82, 'MATH')}
${keys1}
${pocket(0, 1, ROW2 - 34, 94, 'MENU')}
${pocket(2, 4, ROW2 - 34, 94, 'RANGE / <tspan class="bl">DIGITS</tspan>')}
${keys2}
${key(col(6), ROW2, 'Shift', shifted ? 'shift lit' : 'shift')}
${below(0, 1, 'CHOICES')}${below(2, 3, 'LEVEL')}${below(4, 4, 'ENTER')}${below(5, 5, 'TRIG')}${below(6, 6, 'LOCAL')}

<text x="808" y="70" class="term">Ω 4W Sense/</text><text x="808" y="86" class="term">Ratio Ref</text>
<text x="896" y="70" class="term">Input</text><text x="896" y="86" class="term">V Ω →|</text>
<path d="M947 92 l-9 13 h6 l-5 11 l12 -15 h-6 l5 -9 z" fill="#d42a1f"/>
<text x="768" y="128" class="hi">HI</text><text x="934" y="128" class="hi">HI</text>
${mode === 'volt' ? jackGlow(896, 124, VOLT_COLOR) : ''}
${jack(808, 124)}${jack(896, 124)}
<path d="M808 144 v12 h88 v-12" fill="none" stroke="#6b6b68"/>
<text x="852" y="172" class="small">200V</text><text x="852" y="183" class="small">Max</text>
<text x="925" y="172" class="small">1000V</text><text x="925" y="183" class="small">Max</text>
<text x="768" y="214" font-size="12" font-weight="800" fill="#222">LO</text>
<text x="934" y="214" font-size="12" font-weight="800" fill="#222">LO</text>
${jack(808, 210)}${jack(896, 210)}
<path d="M808 230 v12 h88 v-12" fill="none" stroke="#6b6b68"/>
<text x="852" y="258" class="small">500Vpk</text><text x="852" y="269" class="small">Max</text>
<text x="925" y="258" class="small">3 A</text><text x="925" y="269" class="small">RMS</text>
<text x="812" y="304" class="term">Terminals</text>
${button(792, 312, 40)}
<text x="812" y="368" class="small">▬ Front</text><text x="812" y="381" class="small">▬ Rear</text>
${mode === 'curr' ? jackGlow(896, 328, CURR_COLOR) : ''}
${jack(896, 328)}
<text x="922" y="332" class="hi">I</text>
<text x="905" y="368" class="small">Fused on</text><text x="905" y="381" class="small">Rear Panel</text>
<path d="M886 394 l10 17 h-20 z" fill="none" stroke="#2c2c2c" stroke-width="1.4"/>
<text x="886" y="408" font-size="10" font-weight="800" fill="#2c2c2c" text-anchor="middle">!</text>

<text x="30" y="${PH - 18}" class="info">${esc(footerText(r, inst))}</text>
<text x="${PW - 30}" y="${PH - 18}" class="info" text-anchor="end">${esc(inst.model)}</text>
</svg>`
}

export function buildSvg(r: DmmReading, inst: Instrument, style: RenderStyle = 'display'): string {
  if (style === 'panel') return panelSvg(r, inst)
  return displaySvg(r, inst, { footer: true }).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ')
}

/** Render to PNG bytes: the display alone (1200×330) or the whole front panel (1600×806). */
export function renderPanelPng(r: DmmReading, inst: Instrument, style: RenderStyle = 'display'): Promise<Uint8Array> {
  const [w, h, scale] = style === 'panel' ? [PW, PH, 1.6] : [DW, DH, 2]
  return svgToPng(buildSvg(r, inst, style), w, h, scale)
}
