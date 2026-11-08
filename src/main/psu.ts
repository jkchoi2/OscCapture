// Power supplies have no screen dump, so their outputs are read over SCPI and drawn by the
// renderer. Each profile knows one family's command set; 'generic' covers plain SCPI units.
// Users can add families without code changes in psuProfiles.json next to the exe.
import { existsSync, readFileSync, writeFileSync } from 'fs'
import type { PsuChannel } from '@shared/types'

/** What a profile needs from a VISA or RS-232 session. */
export interface PsuSession {
  write(cmd: string): Promise<void>
  query(cmd: string): Promise<string>
  setTimeout(ms: number): void
  clear(): void
}

export interface PsuProfile {
  id: string
  label: string
  /** Matched against the *IDN? model field for automatic selection. */
  match?: RegExp
  /** Over RS-232 the unit ignores settings queries until SYSTem:REMote (Keysight/Agilent). */
  serialRemote: boolean
  /** Plain SCPI fallback used for unrecognized units; never matched by model. */
  generic?: boolean
  /** Loaded from psuProfiles.json */
  custom?: boolean
  read(s: PsuSession, model: string): Promise<PsuChannel[]>
}

export const PSU_TIMEOUT_MS = 3000
/** Queries some units in a family lack (OVP/OCP, power) give up quickly. */
const OPTIONAL_TIMEOUT_MS = 700

const num = async (s: PsuSession, cmd: string): Promise<number> => parseFloat(await s.query(cmd))

async function opt(s: PsuSession, cmd: string): Promise<string> {
  s.setTimeout(OPTIONAL_TIMEOUT_MS)
  try {
    return await s.query(cmd)
  } catch {
    s.clear()
    return ''
  } finally {
    s.setTimeout(PSU_TIMEOUT_MS)
  }
}
const optNum = async (s: PsuSession, cmd: string): Promise<number> => {
  const r = await opt(s, cmd)
  return r ? parseFloat(r) : NaN
}

const isOn = (reply: string): boolean => /^\s*(1|ON)\b/i.test(reply)

/** CV/CC from the readings, for units without a status query. */
function inferMode(c: Omit<PsuChannel, 'mode'>): PsuChannel['mode'] {
  if (!c.output) return ''
  const limiting = c.iSet > 0 && c.iMeas >= c.iSet * 0.98 - 0.002
  const sagging = !isFinite(c.vSet) || c.vMeas < c.vSet * 0.98 - 0.01
  return limiting && sagging ? 'CC' : 'CV'
}

/** Rounded-up full scale when the model is not in the ratings table. */
function niceCeil(...vals: number[]): number {
  const m = Math.max(...vals.filter((v) => isFinite(v)), 1)
  const steps = [1, 1.5, 2, 3, 5, 6, 8, 10]
  const p = 10 ** Math.floor(Math.log10(m))
  return (steps.find((k) => k * p >= m * 0.999) ?? 10) * p
}

/** [max V, max A] by model number. */
const RATINGS: [RegExp, number, number][] = [
  [/^MP710086/i, 30, 5],
  [/^MP710087/i, 60, 3],
  [/^P4305/i, 30, 5],
  [/^P4603/i, 60, 3],
  [/^SPE3051/i, 30, 5],
  [/^SPE3102/i, 30, 10],
  [/^SPE6053/i, 60, 5],
  [/^SPE6103/i, 60, 10],
  [/^E3632A/i, 30, 7],
  [/^E3633A/i, 20, 10],
  [/^E3634A/i, 50, 7],
  [/^E3640A/i, 8, 3],
  [/^E3642A/i, 8, 5],
  [/^E3644A/i, 8, 8],
  [/^E3641A/i, 35, 0.8],
  [/^E3643A/i, 35, 1.4],
  [/^E3645A/i, 35, 2.2],
  [/^E36102/i, 6, 5],
  [/^E36103/i, 20, 2],
  [/^E36104/i, 35, 1],
  [/^E36105/i, 60, 0.6],
  [/^E36106/i, 100, 0.4],
  [/^SPD1168X/i, 16, 8],
  [/^SPD1305X/i, 30, 5],
  [/^SPD3303/i, 32, 3.2]
]

function ratings(model: string, ...seen: number[][]): [number, number] {
  const hit = RATINGS.find(([re]) => re.test(model))
  if (hit) return [hit[1], hit[2]]
  return [niceCeil(...seen[0]), niceCeil(...seen[1])]
}

/* ---------- command-driven reader ---------- */

/** SCPI queries for one family; `{ch}` = channel name, `{n}` = channel number. */
export interface CommandSpec {
  channels: string[]
  /** written before each channel's queries, e.g. "INST:NSEL {n}" */
  select?: string
  ratings?: { v: number; i: number }
  commands: {
    vMeas: string
    iMeas: string
    vSet: string
    iSet: string
    pMeas?: string
    ovp?: string
    ocp?: string
    output?: string
    mode?: string
  }
}

const fill = (cmd: string, name: string, n: number): string => cmd.replace(/\{ch\}/g, name).replace(/\{n\}/g, String(n))

/** A required value: a reply that is not a number fails the capture, quoting the reply. */
async function req(s: PsuSession, cmd: string): Promise<number> {
  const r = await s.query(cmd)
  const v = parseFloat(r)
  if (!isFinite(v)) throw new Error(`${cmd} returned "${r}"`)
  return v
}

function parseMode(reply: string): PsuChannel['mode'] | undefined {
  const r = reply.trim().toUpperCase()
  if (/\bCC\b/.test(r) || r === '1') return 'CC'
  if (/\bCV\b/.test(r) || r === '0') return 'CV'
  if (/\bUR\b/.test(r)) return 'UR'
  return undefined
}

/** Reads every channel of a unit described by plain query commands. */
export async function readByCommands(s: PsuSession, model: string, spec: CommandSpec): Promise<PsuChannel[]> {
  const c = spec.commands
  const out: PsuChannel[] = []
  for (const [i, name] of spec.channels.entries()) {
    const f = (cmd: string): string => fill(cmd, name, i + 1)
    if (spec.select) await s.write(f(spec.select))
    const vMeas = await req(s, f(c.vMeas))
    const iMeas = await req(s, f(c.iMeas))
    let pMeas = c.pMeas ? await optNum(s, f(c.pMeas)) : NaN
    if (!isFinite(pMeas)) pMeas = vMeas * iMeas
    const vSet = await req(s, f(c.vSet))
    const iSet = await req(s, f(c.iSet))
    const ovp = c.ovp ? await optNum(s, f(c.ovp)) : NaN
    const ocp = c.ocp ? await optNum(s, f(c.ocp)) : NaN
    const outReply = c.output ? await opt(s, f(c.output)) : ''
    // No output query (old units): assume on, the readings tell the rest.
    const output = outReply ? isOn(outReply) : true
    const modeReply = c.mode ? await opt(s, f(c.mode)) : ''
    const [vMax, iMax] = spec.ratings
      ? [spec.ratings.v, spec.ratings.i]
      : ratings(model, [vSet, ovp, vMeas], [iSet, ocp, iMeas])
    const ch = { name, vMeas, iMeas, pMeas, vSet, iSet, ovp, ocp, output, vMax, iMax }
    out.push({ ...ch, mode: output ? (parseMode(modeReply) ?? inferMode(ch)) : '' })
  }
  return out
}

/** Plain single-output SCPI with the given protection queries. */
const single = (ovp: string, ocp: string): CommandSpec => ({
  channels: ['CH1'],
  commands: {
    vMeas: 'MEAS:VOLT?',
    iMeas: 'MEAS:CURR?',
    pMeas: 'MEAS:POW?',
    vSet: 'VOLT?',
    iSet: 'CURR?',
    ovp,
    ocp,
    output: 'OUTP?'
  }
})

/* ---------- built-in families ---------- */

const RIGOL_CHANNELS: Record<string, number> = { DP811: 1, DP821: 2, DP831: 3, DP832: 3 }

const BUILTIN: PsuProfile[] = [
  {
    id: 'mp7100',
    label: 'Multicomp Pro MP710086/87 · OWON P4000/SPE',
    match: /^(MP71008[67]|P4\d{3}|SPE\d{4})/i,
    serialRemote: false,
    read: (s, model) => readByCommands(s, model, single('VOLT:LIM?', 'CURR:LIM?'))
  },
  {
    id: 'rigol-dp800',
    label: 'Rigol DP800 (DP811/821/831/832)',
    match: /^DP8\d{2}/i,
    serialRemote: false,
    async read(s, model) {
      const n = RIGOL_CHANNELS[model.toUpperCase().replace(/A$/, '')] ?? 3
      const out: PsuChannel[] = []
      for (let ch = 1; ch <= n; ch++) {
        const [vMeas, iMeas, pMeas] = (await s.query(`:MEAS:ALL? CH${ch}`)).split(',').map(parseFloat)
        // "CH1:30V/3A,5.000,1.0000"
        const appl = await s.query(`:APPL? CH${ch}`)
        const [, rv = 'NaN', ri = 'NaN'] = /:(\d+(?:\.\d+)?)V\/(\d+(?:\.\d+)?)A/i.exec(appl) ?? []
        const [, vSet = NaN, iSet = NaN] = appl.split(',').map(parseFloat)
        const output = isOn(await s.query(`:OUTP? CH${ch}`))
        const mode = (await s.query(`:OUTP:MODE? CH${ch}`)).trim().toUpperCase()
        const ovp = await optNum(s, `:OUTP:OVP:VAL? CH${ch}`)
        const ocp = await optNum(s, `:OUTP:OCP:VAL? CH${ch}`)
        out.push({
          name: `CH${ch}`,
          vMeas,
          iMeas,
          pMeas,
          vSet,
          iSet,
          ovp,
          ocp,
          output,
          mode: output && (mode === 'CV' || mode === 'CC' || mode === 'UR') ? mode : '',
          vMax: parseFloat(rv) || niceCeil(vSet),
          iMax: parseFloat(ri) || niceCeil(iSet)
        })
      }
      return out
    }
  },
  {
    id: 'siglent-spd',
    label: 'Siglent SPD3303X / SPD1000X',
    match: /^SPD(3303|1168|1305)/i,
    serialRemote: false,
    async read(s, model) {
      const n = /^SPD3303/i.test(model) ? 2 : 1
      // SYST:STAT? → hex; bit0/1 = CH1/CH2 CC, bit4/5 = CH1/CH2 output on.
      const stat = parseInt(await s.query('SYST:STAT?'), 16) || 0
      const [vMax, iMax] = ratings(model, [30], [3])
      const out: PsuChannel[] = []
      for (let ch = 1; ch <= n; ch++) {
        const vMeas = await num(s, `MEAS:VOLT? CH${ch}`)
        const iMeas = await num(s, `MEAS:CURR? CH${ch}`)
        let pMeas = await optNum(s, `MEAS:POWE? CH${ch}`)
        if (!isFinite(pMeas)) pMeas = vMeas * iMeas
        const vSet = await num(s, `CH${ch}:VOLT?`)
        const iSet = await num(s, `CH${ch}:CURR?`)
        const output = (stat & (1 << (3 + ch))) !== 0
        const cc = (stat & (1 << (ch - 1))) !== 0
        out.push({
          name: `CH${ch}`,
          vMeas,
          iMeas,
          pMeas,
          vSet,
          iSet,
          ovp: NaN,
          ocp: NaN,
          output,
          mode: output ? (cc ? 'CC' : 'CV') : '',
          vMax,
          iMax
        })
      }
      return out
    }
  },
  {
    id: 'keysight-e36',
    label: 'Keysight/Agilent E36xx (single output)',
    match: /^E36(3[234]|4[0-5]|10[2-6])/i,
    serialRemote: true,
    read: (s, model) => readByCommands(s, model, single('VOLT:PROT?', 'CURR:PROT?'))
  },
  {
    id: 'generic',
    label: 'Generic SCPI power supply',
    generic: true,
    serialRemote: false,
    read: (s, model) => readByCommands(s, model, single('VOLT:PROT?', 'CURR:PROT?'))
  }
]

/* ---------- user profiles (psuProfiles.json) ---------- */

let custom: PsuProfile[] = []
let customErrors: string[] = []

const EXAMPLE = {
  _example:
    'Copy this entry, delete the "_example" line, then edit it. {ch} = channel name, {n} = channel number. ' +
    'Required: id, label, commands.vMeas/iMeas/vSet/iSet; empty strings are skipped. ' +
    'Rescan instruments to reload this file.',
  id: 'my-psu',
  label: 'ACME PS-3005',
  match: '^PS-30\\d\\d',
  serialRemote: false,
  channels: ['CH1'],
  ratings: { v: 30, i: 5 },
  select: '',
  commands: {
    vMeas: 'MEAS:VOLT?',
    iMeas: 'MEAS:CURR?',
    pMeas: 'MEAS:POW?',
    vSet: 'VOLT?',
    iSet: 'CURR?',
    ovp: 'VOLT:PROT?',
    ocp: 'CURR:PROT?',
    output: 'OUTP?',
    mode: ''
  }
}

/** Creates the profiles file with an example entry if it does not exist. */
export function ensureProfilesFile(file: string): void {
  if (!existsSync(file)) writeFileSync(file, JSON.stringify([EXAMPLE], null, 2) + '\n')
}

const str = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''
const posNum = (v: unknown): v is number => typeof v === 'number' && v > 0

function toProfile(e: Record<string, unknown>): PsuProfile {
  if (!str(e.id)) throw new Error('"id" is missing')
  if (!str(e.label)) throw new Error('"label" is missing')
  const cmds = (e.commands ?? {}) as Record<string, unknown>
  for (const k of ['vMeas', 'iMeas', 'vSet', 'iSet']) {
    if (!str(cmds[k])) throw new Error(`"commands.${k}" is missing`)
  }
  const optCmd = (k: string): string | undefined => (str(cmds[k]) ? (cmds[k] as string) : undefined)
  const r = e.ratings as { v?: unknown; i?: unknown } | undefined
  const spec: CommandSpec = {
    channels: Array.isArray(e.channels) && e.channels.length ? e.channels.map(String) : ['CH1'],
    select: str(e.select) ? e.select : undefined,
    ratings: r && posNum(r.v) && posNum(r.i) ? { v: r.v, i: r.i } : undefined,
    commands: {
      vMeas: cmds.vMeas as string,
      iMeas: cmds.iMeas as string,
      vSet: cmds.vSet as string,
      iSet: cmds.iSet as string,
      pMeas: optCmd('pMeas'),
      ovp: optCmd('ovp'),
      ocp: optCmd('ocp'),
      output: optCmd('output'),
      mode: optCmd('mode')
    }
  }
  let match: RegExp | undefined
  if (str(e.match)) {
    try {
      match = new RegExp(e.match, 'i')
    } catch (err) {
      throw new Error(`"match" is not a valid pattern: ${(err as Error).message}`)
    }
  }
  return {
    id: e.id,
    label: e.label,
    match,
    serialRemote: e.serialRemote === true,
    custom: true,
    read: (s, model) => readByCommands(s, model, spec)
  }
}

/** (Re)reads psuProfiles.json; bad entries are skipped and reported. */
export function loadCustomProfiles(file: string): void {
  custom = []
  customErrors = []
  if (!existsSync(file)) return
  let list: unknown
  try {
    list = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))
  } catch (e) {
    customErrors.push(`psuProfiles.json: ${(e as Error).message}`)
    return
  }
  if (!Array.isArray(list)) {
    customErrors.push('psuProfiles.json: expected a list [ ... ] of profiles')
    return
  }
  list.forEach((e, i) => {
    if (!e || typeof e !== 'object' || '_example' in e) return
    const id = str((e as { id?: unknown }).id) ? ` (${(e as { id: string }).id})` : ''
    try {
      const p = toProfile(e as Record<string, unknown>)
      if (custom.some((x) => x.id === p.id)) throw new Error(`id "${p.id}" is used twice`)
      custom.push(p)
    } catch (err) {
      customErrors.push(`Entry ${i + 1}${id}: ${(err as Error).message}`)
    }
  })
}

export const customProfileErrors = (): string[] => customErrors

/** User profiles first (they win on id and on model match), then the built-in ones. */
export const allProfiles = (): PsuProfile[] => [...custom, ...BUILTIN.filter((b) => !custom.some((c) => c.id === b.id))]

export const psuProfile = (id: string): PsuProfile | undefined => allProfiles().find((p) => p.id === id)
export const psuProfileFor = (model: string): PsuProfile | undefined =>
  allProfiles().find((p) => !p.generic && p.match?.test(model))
export const genericProfile = (): PsuProfile => psuProfile('generic') ?? BUILTIN.find((p) => p.generic)!

/* ---------- auto-detection ---------- */

/** A bare number, optionally followed by a unit ("1.000", "+1.2E+01", "12.00V"). */
const NUMERIC = /^\s*[-+]?(\d+\.?\d*|\.\d+)(E[-+]?\d+)?\s*[A-Z]{0,2}\s*$/i

/**
 * True if an unrecognized instrument answers the basic power supply queries with numbers.
 * Queries only: nothing on the instrument changes.
 */
export async function probeGenericPsu(s: PsuSession): Promise<boolean> {
  for (const cmd of ['MEAS:VOLT?', 'MEAS:CURR?', 'VOLT?', 'CURR?']) {
    if (!NUMERIC.test(await opt(s, cmd))) return false
  }
  return true
}
