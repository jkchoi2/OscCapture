// Draws a power supply's LCD (and optionally its front panel) from SCPI readings.
// Single-output units get the MP710086/87-style screen: actual V/A/W on the left,
// set values and OVP/OCP on the right. Multi-output units get one column per channel.
import type { Instrument, PsuChannel, PsuReading, RenderStyle } from '@shared/types'
import { svgToPng } from './svgPng'

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const C = {
  actual: '#ffd91a',
  set: '#f4f6f8',
  cv: '#2fe06a',
  cc: '#ff5a3c',
  ur: '#ffb020',
  on: '#2fe06a',
  off: '#8a9099',
  setBox: '#8cc8ef',
  dim: '#7d848c',
  rule: '#3a3f46'
}
/** Channel colors on multi-output units (Rigol/Siglent style). */
const CH_COLORS = ['#ffd91a', '#33c8ff', '#ff5ad2', '#7cff6b']

/* ---------- number layout ---------- */

const digitsOf = (max: number): number => (isFinite(max) && max >= 1 ? Math.floor(Math.log10(max) + 1e-9) + 1 : 1)

/**
 * Fixed-width text like the instrument's LCD: integer part zero-padded to the rating's
 * digits, `total` digits overall, e.g. 60 V → "05.00", 3 A → "0.120".
 */
export function fmtFixed(v: number, max: number, total = 4): string {
  const intDigits = Math.min(digitsOf(max), total)
  const decimals = Math.max(total - intDigits, 0)
  if (!isFinite(v)) return '-'.repeat(intDigits) + (decimals ? '.' + '-'.repeat(decimals) : '')
  const [int, frac] = Math.abs(v).toFixed(decimals).split('.')
  return `${v < 0 ? '-' : ''}${int.padStart(intDigits, '0')}${frac !== undefined ? '.' + frac : ''}`
}

/** Plain engineering text for footers. */
const plain = (v: number, unit: string): string => (isFinite(v) ? `${parseFloat(v.toPrecision(5))} ${unit}` : `— ${unit}`)

/* ---------- 7-segment digits ---------- */

type Seg = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g'
const GLYPHS: Record<string, Seg[]> = {
  '0': ['a', 'b', 'c', 'd', 'e', 'f'],
  '1': ['b', 'c'],
  '2': ['a', 'b', 'g', 'e', 'd'],
  '3': ['a', 'b', 'g', 'c', 'd'],
  '4': ['f', 'g', 'b', 'c'],
  '5': ['a', 'f', 'g', 'c', 'd'],
  '6': ['a', 'f', 'g', 'e', 'c', 'd'],
  '7': ['a', 'b', 'c'],
  '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g'],
  '-': ['g'],
  ' ': []
}

/** Hexagonal segment between two points. */
function seg(x1: number, y1: number, x2: number, y2: number, t: number): string {
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
  return `<polygon points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}"/>`
}

const cellW = (h: number): number => h * 0.52
const gapW = (h: number): number => h * 0.16
const segT = (h: number): number => h * 0.13
const dotW = (h: number): number => h * 0.2
/** A "1" is drawn narrow, as on the instrument's LCD font. */
const advance = (ch: string, h: number): number =>
  ch === '.' ? dotW(h) : (ch === '1' ? segT(h) : cellW(h)) + gapW(h)

/** Width `seven()` will use for `text` at height h. */
function sevenWidth(text: string, h: number): number {
  let w = 0
  for (const ch of text) w += advance(ch, h)
  return w - (text.endsWith('.') ? 0 : gapW(h))
}

/** 7-segment text (digits, '-', '.', ' ') with its top-left at (x, y). */
function seven(text: string, x: number, y: number, h: number, color: string): string {
  const w = cellW(h)
  const t = segT(h)
  const g = t * 0.32
  const m = h / 2
  const S: Record<Seg, [number, number, number, number]> = {
    a: [g, 0, w - g, 0],
    b: [w, g, w, m - g],
    c: [w, m + g, w, h - g],
    d: [g, h, w - g, h],
    e: [0, m + g, 0, h - g],
    f: [0, g, 0, m - g],
    g: [g, m, w - g, m]
  }
  let out = ''
  // cx = left edge of the current cell; segments are inset by half their thickness.
  let cx = x
  for (const ch of text) {
    if (ch === '.') {
      const s = t * 1.05
      // Sits in the gap after the previous cell, on the baseline.
      out += `<rect x="${(cx - gapW(h) + (dotW(h) + gapW(h) - s) / 2).toFixed(1)}" y="${(y + h - s).toFixed(1)}" width="${s.toFixed(1)}" height="${s.toFixed(1)}"/>`
      cx += dotW(h)
      continue
    }
    // A narrow "1": its right-hand segments drawn at the left of a thin cell.
    const ox = cx + t / 2 - (ch === '1' ? w : 0)
    for (const sname of GLYPHS[ch] ?? []) {
      const [a, b, c, d] = S[sname]
      out += seg(ox + a, y + t / 2 + b * ((h - t) / h), ox + c, y + t / 2 + d * ((h - t) / h), t)
    }
    cx += advance(ch, h)
  }
  return `<g fill="${color}">${out}</g>`
}

/** Number followed by its unit letter; returns markup and total width. */
function value(text: string, unit: string, x: number, y: number, h: number, color: string, unitScale = 0.62): [string, number] {
  const w = sevenWidth(text, h)
  const us = h * unitScale
  const unitX = x + w + h * 0.12
  return [
    seven(text, x, y, h, color) +
      `<text x="${unitX.toFixed(1)}" y="${(y + h).toFixed(1)}" class="unit" font-size="${us.toFixed(1)}" fill="${color}">${esc(unit)}</text>`,
    w + h * 0.12 + us * 0.62
  ]
}

/** Right-aligned version of `value` ending at xRight. */
function valueRight(text: string, unit: string, xRight: number, y: number, h: number, color: string, unitScale = 0.62): string {
  const [, w] = value(text, unit, 0, y, h, color, unitScale)
  return value(text, unit, xRight - w, y, h, color, unitScale)[0]
}

/* ---------- display ---------- */

function stamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const modeColor = (m: PsuChannel['mode']): string => (m === 'CC' ? C.cc : m === 'UR' ? C.ur : C.cv)

function footerText(r: PsuReading, inst: Instrument): string {
  const parts = r.channels.map((c) =>
    r.channels.length > 1
      ? `${c.name} ${c.output ? 'ON' : 'OFF'}`
      : `Output ${c.output ? 'ON' : 'OFF'}${c.mode ? ' ' + c.mode : ''}  ·  Set ${plain(c.vSet, 'V')} / ${plain(c.iSet, 'A')}`
  )
  return [...parts, stamp(r.time), inst.transport === 'serial' ? inst.resource : ''].filter(Boolean).join('  ·  ')
}

const DH = 360
const SINGLE_W = 640
const MULTI_COL = 330
const displayWidth = (n: number): number => (n <= 1 ? SINGLE_W : 20 + n * MULTI_COL)

const STYLE = `
    .unit { font-family: Bahnschrift, 'Segoe UI', Arial, sans-serif; font-weight: 600; }
    .lbl { font-family: Bahnschrift, 'Segoe UI', Arial, sans-serif; font-weight: 600; }
    .foot { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; fill: ${C.dim}; }`

/** Header: model at the left, footer line at the bottom (shared by both layouts). */
function frame(w: number, r: PsuReading, inst: Instrument, body: string): string {
  return `<rect width="${w}" height="${DH}" fill="#050607"/>
<rect x="0" y="0" width="${w}" height="44" fill="#14171b"/>
<text x="16" y="29" class="lbl" font-size="17" fill="${C.dim}">${esc(inst.maker ? `${inst.maker.split(/\s+/)[0]} ${inst.model}` : inst.model)}</text>
${body}
<line x1="0" y1="${DH - 34}" x2="${w}" y2="${DH - 34}" stroke="${C.rule}"/>
<text x="14" y="${DH - 12}" class="foot">${esc(footerText(r, inst))}</text>`
}

function outputBadge(on: boolean, xRight: number, y: number, size: number): string {
  return `<text x="${xRight}" y="${y}" text-anchor="end" class="lbl" font-size="${size}" font-weight="700" fill="${on ? C.on : C.off}">${on ? 'ON' : 'OFF'}</text>`
}

/** MP710086/87-style screen for one output. */
function singleBody(c: PsuChannel): string {
  const W = SINGLE_W
  const vMax = c.vMax
  const iMax = c.iMax
  const pMax = vMax * iMax
  const H1 = 70
  const x = 84
  const rows = [
    value(fmtFixed(c.vMeas, vMax), 'V', x, 70, H1, C.actual)[0],
    value(fmtFixed(c.iMeas, iMax), 'A', x, 156, H1, C.actual)[0],
    value(fmtFixed(c.pMeas, pMax), 'W', x, 242, H1, C.actual)[0]
  ].join('')
  const mode = c.mode ? `<text x="16" y="96" class="lbl" font-size="30" fill="${modeColor(c.mode)}">${c.mode}</text>` : ''

  const R0 = 404
  const R1 = W - 14
  const prot = (label: string, v: number, max: number, unit: string, y: number): string =>
    `<text x="${R0 + 6}" y="${y + 24}" class="lbl" font-size="22" fill="${C.set}">${label}</text>` +
    valueRight(fmtFixed(v, max), unit, R1, y, 26, C.set, 0.75)
  return `${outputBadge(c.output, W - 16, 32, 26)}
${mode}${rows}
<line x1="392" y1="50" x2="392" y2="${DH - 40}" stroke="${C.rule}" stroke-width="2"/>
<rect x="${R0}" y="58" width="${R1 - R0}" height="32" fill="${C.setBox}"/>
<text x="${(R0 + R1) / 2}" y="82" text-anchor="middle" class="lbl" font-size="22" font-weight="700" fill="#ffffff">Set</text>
${valueRight(fmtFixed(c.vSet, vMax), 'V', R1, 108, 44, C.set)}
${valueRight(fmtFixed(c.iSet, iMax), 'A', R1, 168, 44, C.set)}
${prot('OVP:', c.ovp, vMax, 'V', 238)}
${prot('OCP:', c.ocp, iMax, 'A', 278)}`
}

/** One column per output for multi-channel units. */
function multiBody(channels: PsuChannel[]): string {
  return channels
    .map((c, i) => {
      const x0 = 10 + i * MULTI_COL
      const xr = x0 + MULTI_COL - 14
      const color = CH_COLORS[i % CH_COLORS.length]
      /** Label, then a V value and an A value, right-aligned in two columns. */
      const pair = (label: string, v: number, a: number, y: number): string =>
        `<text x="${x0 + 10}" y="${y + 19}" class="lbl" font-size="17" fill="${C.dim}">${label}</text>` +
        valueRight(fmtFixed(v, c.vMax), 'V', xr - 112, y, 22, C.set, 0.75) +
        valueRight(fmtFixed(a, c.iMax), 'A', xr, y, 22, C.set, 0.75)
      return `${i ? `<line x1="${x0 - 5}" y1="50" x2="${x0 - 5}" y2="${DH - 40}" stroke="${C.rule}" stroke-width="2"/>` : ''}
<rect x="${x0 + 4}" y="52" width="${MULTI_COL - 18}" height="30" fill="${color}" fill-opacity="0.16"/>
<text x="${x0 + 12}" y="75" class="lbl" font-size="21" font-weight="700" fill="${color}">${esc(c.name)}</text>
${c.mode ? `<text x="${x0 + 90}" y="75" class="lbl" font-size="21" fill="${modeColor(c.mode)}">${c.mode}</text>` : ''}
${outputBadge(c.output, xr, 75, 21)}
${value(fmtFixed(c.vMeas, c.vMax, 5), 'V', x0 + 30, 96, 50, color)[0]}
${value(fmtFixed(c.iMeas, c.iMax, 5), 'A', x0 + 30, 158, 50, color)[0]}
${value(fmtFixed(c.pMeas, c.vMax * c.iMax, 5), 'W', x0 + 30, 220, 34, color)[0]}
${pair('Set', c.vSet, c.iSet, 266)}
${isFinite(c.ovp) || isFinite(c.ocp) ? pair('OVP/OCP', c.ovp, c.ocp, 294) : ''}`
    })
    .join('\n')
}

interface At {
  x?: number
  y?: number
  width?: number
}

function displaySvg(r: PsuReading, inst: Instrument, at: At = {}): string {
  const W = displayWidth(r.channels.length)
  const body = r.channels.length <= 1 ? singleBody(r.channels[0]) : multiBody(r.channels)
  const w = at.width ?? W
  return `<svg xmlns="http://www.w3.org/2000/svg" x="${at.x ?? 0}" y="${at.y ?? 0}" width="${w}" height="${(w / W) * DH}" viewBox="0 0 ${W} ${DH}">
<style>${STYLE}</style>
${frame(W, r, inst, body)}
</svg>`
}

/* ---------- front panel ---------- */

const PANEL_STYLE = `
    text { font-family: 'Segoe UI', Arial, sans-serif; }
    .key { filter: url(#keysh); }
    .key .edge { fill: #b9bcc0; stroke: #8d9196; }
    .key .top { fill: url(#keyg); stroke: #ffffff; stroke-opacity: 0.7; stroke-width: 0.8; }
    .klabel { font-size: 12px; font-weight: 700; fill: #3c4046; text-anchor: middle; }
    .plabel { font-size: 12px; font-weight: 600; fill: #50555c; text-anchor: middle; }
    .info { font-size: 14px; fill: #b9c0c6; }`

const PANEL_DEFS = `
  <linearGradient id="body" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#d9dbde"/><stop offset="0.12" stop-color="#eff0f2"/><stop offset="0.88" stop-color="#eff0f2"/><stop offset="1" stop-color="#d3d5d8"/></linearGradient>
  <linearGradient id="keyg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e3e5e8"/></linearGradient>
  <radialGradient id="knob" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#ffffff"/><stop offset="0.7" stop-color="#dcdfe3"/><stop offset="1" stop-color="#aeb3b9"/></radialGradient>
  <filter id="shadow" x="-10%" y="-5%" width="120%" height="115%"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-opacity="0.5"/></filter>
  <filter id="keysh" x="-15%" y="-15%" width="130%" height="140%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.2" flood-opacity="0.35"/></filter>
  <filter id="glow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`

function key(x: number, y: number, w: number, h: number, label = '', lit = ''): string {
  return (
    `<g class="key"><rect class="edge" x="${x}" y="${y}" width="${w}" height="${h}" rx="5"/>` +
    `<rect class="top" x="${x + 2}" y="${y + 2}" width="${w - 4}" height="${h - 6}" rx="4" ${lit ? `style="fill:${lit}"` : ''}/>` +
    (label ? `<text x="${x + w / 2}" y="${y + h / 2 + 3}" class="klabel" font-size="10.5">${esc(label)}</text>` : '') +
    '</g>' +
    (lit ? `<rect x="${x - 2}" y="${y - 2}" width="${w + 4}" height="${h + 4}" rx="6" fill="none" stroke="${lit}" stroke-width="2.5" filter="url(#glow)"/>` : '')
  )
}

function jack(x: number, y: number, color: string, ring: string, glow = ''): string {
  return (
    (glow ? `<circle cx="${x}" cy="${y}" r="24" fill="none" stroke="${glow}" stroke-width="3.5" filter="url(#glow)"/>` : '') +
    `<circle cx="${x}" cy="${y}" r="19" fill="${color}" stroke="${ring}" stroke-width="2"/>` +
    `<circle cx="${x}" cy="${y}" r="11" fill="#2a2a2a"/><circle cx="${x}" cy="${y}" r="5.5" fill="#c9ad6a"/><circle cx="${x}" cy="${y}" r="2.6" fill="#1c1a16"/>`
  )
}

function knob(cx: number, cy: number, r: number): string {
  let ridges = ''
  for (let i = 0; i < 36; i++) {
    const a = (i * Math.PI) / 18
    ridges += `<line x1="${(cx + (r - 6) * Math.cos(a)).toFixed(1)}" y1="${(cy + (r - 6) * Math.sin(a)).toFixed(1)}" x2="${(cx + r * Math.cos(a)).toFixed(1)}" y2="${(cy + r * Math.sin(a)).toFixed(1)}"/>`
  }
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r + 4}" fill="#c7cacf"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#knob)" stroke="#9aa0a7"/>` +
    `<g stroke="#a7acb2" stroke-width="1.2">${ridges}</g>` +
    `<circle cx="${cx}" cy="${cy}" r="${r * 0.62}" fill="#f2f3f5" stroke="#c4c8cd"/>` +
    `<circle cx="${cx - r - 14}" cy="${cy + r * 0.3}" r="3" fill="#f08a1c"/><circle cx="${cx + r + 14}" cy="${cy - r * 0.3}" r="3" fill="#f08a1c"/>`
  )
}

function powerSwitch(x: number, y: number): string {
  return (
    `<rect x="${x}" y="${y}" width="58" height="80" rx="4" fill="#26282b" stroke="#111"/>` +
    `<rect x="${x + 9}" y="${y + 8}" width="40" height="64" rx="3" fill="#151618"/>` +
    `<rect x="${x + 11}" y="${y + 10}" width="36" height="30" rx="2" fill="#3a3d41"/>` +
    `<text x="${x + 29}" y="${y + 31}" font-size="15" font-weight="700" fill="#e6e6e6" text-anchor="middle">I</text>` +
    `<circle cx="${x + 29}" cy="${y + 56}" r="7" fill="none" stroke="#c8c8c8" stroke-width="2"/>` +
    `<text x="${x + 29}" y="${y + 98}" class="plabel">Power</text>`
  )
}

const warning = (x: number, y: number, s: number): string =>
  `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="3" fill="#f6d21a"/>` +
  `<path d="M${x + s / 2} ${y + s * 0.2} l${s * 0.32} ${s * 0.56} h${-s * 0.64} z" fill="none" stroke="#1a1a1a" stroke-width="2"/>` +
  `<text x="${x + s / 2}" y="${y + s * 0.7}" font-size="${s * 0.3}" font-weight="800" text-anchor="middle" fill="#1a1a1a">!</text>`

/** Portrait bench supply (MP710086/87 layout) for single-output units. */
const SP_W = 560
const SP_H = 880

function singlePanel(r: PsuReading, inst: Instrument): string {
  const c = r.channels[0]
  const glow = c.output ? modeColor(c.mode) : ''
  const pad = (cx: number, cy: number): string => {
    const arrow = (dx: number, dy: number): string => {
      const x = cx + dx * 46
      const y = cy + dy * 42
      const rot = dx ? (dx > 0 ? 90 : -90) : dy > 0 ? 180 : 0
      return (
        `<g transform="translate(${x} ${y}) rotate(${rot})"><ellipse rx="22" ry="13" fill="#3b3e43"/>` +
        `<path d="M-6 3 L0 -4 L6 3" fill="none" stroke="#f1f1f1" stroke-width="2.4" stroke-linecap="round"/></g>`
      )
    }
    return (
      `<rect x="${cx - 80}" y="${cy - 70}" width="160" height="140" rx="16" fill="#e2e4e7" stroke="#c6c9ce"/>` +
      arrow(0, -1) + arrow(0, 1) + arrow(-1, 0) + arrow(1, 0) +
      `<circle cx="${cx}" cy="${cy}" r="22" fill="#f08a1c" stroke="#c46c10"/>` +
      `<text x="${cx}" y="${cy + 5}" font-size="14" font-weight="800" text-anchor="middle" fill="#fff">OK</text>`
    )
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SP_W}" height="${SP_H}" viewBox="0 0 ${SP_W} ${SP_H}">
<defs>${PANEL_DEFS}<style>${PANEL_STYLE}</style></defs>
<rect width="${SP_W}" height="${SP_H}" fill="#15181b"/>
<g filter="url(#shadow)"><rect x="40" y="24" width="${SP_W - 80}" height="800" rx="26" fill="url(#body)" stroke="#b5b9be"/></g>
<rect x="64" y="40" width="${SP_W - 128}" height="770" rx="14" fill="none" stroke="#d0d3d7" stroke-width="2"/>

<rect x="86" y="62" width="${SP_W - 172}" height="246" rx="8" fill="#1d1f22"/>
${displaySvg(r, inst, { x: 96, y: 72, width: SP_W - 192 })}

<path d="M150 336 h260 l-24 30 h-212 z" fill="#e3e5e8" stroke="#cbced3"/>

${key(92, 392, 62, 30, 'System')}
${key(92, 446, 62, 30, 'Memory')}
${key(92, 500, 62, 30, 'Keylock')}
${pad(264, 460)}
${knob(412, 446, 46)}
${key(388, 518, 50, 26, '', c.output ? '#2fe06a' : '')}
<text x="413" y="562" class="plabel">On/Off</text>

<rect x="186" y="588" width="230" height="84" rx="12" fill="#e2e4e7" stroke="#c6c9ce"/>
<text x="222" y="604" font-size="16" font-weight="800" fill="#333" text-anchor="middle">−</text>
<text x="301" y="604" font-size="13" font-weight="700" fill="#1f9d4c" text-anchor="middle">⏚</text>
<text x="380" y="604" font-size="15" font-weight="800" fill="#c42a20" text-anchor="middle">+</text>
${jack(222, 640, '#2b2b2b', '#111', glow)}${jack(301, 640, '#1f9d4c', '#14693a')}${jack(380, 640, '#c42a20', '#7d1712', glow)}
${powerSwitch(92, 600)}
${warning(436, 640, 50)}

${[0, 1, 2].map((i) => `<rect x="190" y="${728 + i * 14}" width="180" height="6" rx="3" fill="#d4d7db"/>`).join('')}
<text x="${SP_W / 2}" y="800" class="plabel" style="fill:#7a8088">${esc(inst.model)}</text>

<text x="24" y="${SP_H - 26}" class="info">${esc(stamp(r.time))}${inst.transport === 'serial' ? '  ·  ' + esc(inst.resource) : ''}</text>
<text x="${SP_W - 24}" y="${SP_H - 26}" class="info" text-anchor="end">${esc(inst.model)}</text>
</svg>`
}

/** Landscape bench supply for multi-output units: display left, outputs right. */
const MP_W = 1080
const MP_H = 540

function multiPanel(r: PsuReading, inst: Instrument): string {
  const n = r.channels.length
  const dispW = 600
  const dispH = (dispW / displayWidth(n)) * DH
  const colW = Math.min(110, 300 / n)
  const outs = r.channels
    .map((c, i) => {
      const x = 690 + i * colW + colW / 2
      const color = CH_COLORS[i % CH_COLORS.length]
      const glow = c.output ? modeColor(c.mode) : ''
      return (
        `<text x="${x}" y="226" class="plabel" style="font-weight:800;fill:${color === '#ffd91a' ? '#b08d00' : color}">${esc(c.name)}</text>` +
        key(x - 26, 238, 52, 26, '', c.output ? '#2fe06a' : '') +
        `<text x="${x}" y="282" class="plabel" font-size="10.5">On/Off</text>` +
        jack(x, 330, '#c42a20', '#7d1712', glow) +
        `<text x="${x + 30}" y="314" font-size="14" font-weight="800" fill="#c42a20">+</text>` +
        jack(x, 396, '#2b2b2b', '#111', glow) +
        `<text x="${x + 30}" y="380" font-size="16" font-weight="800" fill="#333">−</text>`
      )
    })
    .join('')
  const keys = ['Display', 'Preset', 'Utility', 'Store', 'Lock']
    .map((t, i) => key(170 + i * 96, 112 + dispH + 24, 76, 30, t))
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${MP_W}" height="${MP_H}" viewBox="0 0 ${MP_W} ${MP_H}">
<defs>${PANEL_DEFS}<style>${PANEL_STYLE}</style></defs>
<rect width="${MP_W}" height="${MP_H}" fill="#15181b"/>
<g filter="url(#shadow)"><rect x="28" y="22" width="${MP_W - 56}" height="460" rx="24" fill="url(#body)" stroke="#b5b9be"/></g>
<rect x="74" y="56" width="${dispW + 24}" height="${dispH + 24}" rx="8" fill="#1d1f22"/>
${displaySvg(r, inst, { x: 86, y: 68, width: dispW })}
${keys}
${knob(860, 128, 52)}
${outs}
${powerSwitch(80, 370)}
<text x="${MP_W - 60}" y="460" class="plabel" style="text-anchor:end;fill:#7a8088">${esc(inst.model)}</text>
<text x="24" y="${MP_H - 22}" class="info">${esc(footerText(r, inst))}</text>
<text x="${MP_W - 24}" y="${MP_H - 22}" class="info" text-anchor="end">${esc(inst.model)}</text>
</svg>`
}

export function buildPsuSvg(r: PsuReading, inst: Instrument, style: RenderStyle = 'display'): string {
  if (style === 'panel') return r.channels.length <= 1 ? singlePanel(r, inst) : multiPanel(r, inst)
  return displaySvg(r, inst)
}

/** PNG of the LCD alone, or of the whole front panel. */
export function renderPsuPng(r: PsuReading, inst: Instrument, style: RenderStyle = 'display'): Promise<Uint8Array> {
  if (!r.channels.length) return Promise.reject(new Error('The power supply returned no outputs'))
  if (style === 'panel') {
    return r.channels.length <= 1 ? svgToPng(singlePanel(r, inst), SP_W, SP_H, 1.6) : svgToPng(multiPanel(r, inst), MP_W, MP_H, 1.6)
  }
  return svgToPng(displaySvg(r, inst), displayWidth(r.channels.length), DH, 2)
}
