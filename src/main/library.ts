// File management for the capture folder tree.
import { shell } from 'electron'
import { existsSync, watch, type FSWatcher } from 'fs'
import { mkdir, open, readFile, readdir, rename, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'path'
import type { FolderNode, ImageItem, Instrument } from '@shared/types'
import { getSettings } from './settings'

const IMAGE_EXT = new Set(['.png', '.bmp', '.jpg', '.jpeg'])
const META_FILE = '.osccapture.json'

type Meta = Record<string, { note?: string; idn?: string }>

const root = (): string => getSettings().saveRoot

export function toAbs(rel: string): string {
  const abs = resolve(root(), rel || '.')
  if (!isInside(abs)) throw new Error('Path is outside the capture folder')
  return abs
}

function isInside(abs: string): boolean {
  const r = relative(root(), abs)
  return r === '' || (!r.startsWith('..') && !isAbsolute(r))
}

export function assertInside(abs: string): string {
  if (!isInside(resolve(abs))) throw new Error('Path is outside the capture folder')
  return resolve(abs)
}

const toRel = (abs: string): string => relative(root(), abs).split(sep).join('/')

async function readMeta(dir: string): Promise<Meta> {
  try {
    return JSON.parse(await readFile(join(dir, META_FILE), 'utf8'))
  } catch {
    return {}
  }
}

async function updateMeta(dir: string, fn: (m: Meta) => void): Promise<void> {
  const m = await readMeta(dir)
  fn(m)
  for (const k of Object.keys(m)) if (!m[k].note && !m[k].idn) delete m[k]
  await writeFile(join(dir, META_FILE), JSON.stringify(m, null, 2))
}

async function imageSize(path: string): Promise<[number, number]> {
  const fh = await open(path, 'r')
  try {
    const b = Buffer.alloc(26)
    await fh.read(b, 0, 26, 0)
    if (b.readUInt32BE(0) === 0x89504e47) return [b.readUInt32BE(16), b.readUInt32BE(20)]
    if (b.toString('latin1', 0, 2) === 'BM') return [b.readInt32LE(18), Math.abs(b.readInt32LE(22))]
  } finally {
    await fh.close()
  }
  return [0, 0]
}

async function itemFor(path: string, meta?: Meta): Promise<ImageItem> {
  const st = await stat(path)
  const [width, height] = await imageSize(path).catch(() => [0, 0])
  const m = (meta ?? (await readMeta(dirname(path))))[basename(path)] ?? {}
  return {
    path,
    name: basename(path),
    folder: toRel(dirname(path)),
    size: st.size,
    mtime: st.mtimeMs,
    width,
    height,
    note: m.note ?? '',
    idn: m.idn ?? ''
  }
}

export async function listImages(folderRel: string): Promise<ImageItem[]> {
  // The root ("All captures") includes every subfolder; other folders list only their own files.
  const items = await listDir(toAbs(folderRel), folderRel === '')
  return items.sort((a, b) => b.mtime - a.mtime)
}

async function listDir(dir: string, recursive: boolean): Promise<ImageItem[]> {
  const meta = await readMeta(dir)
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const files = await Promise.all(
    entries
      .filter((e) => e.isFile() && IMAGE_EXT.has(extname(e.name).toLowerCase()))
      .map((e) => itemFor(join(dir, e.name), meta).catch(() => null))
  )
  const nested = recursive
    ? await Promise.all(
        entries.filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => listDir(join(dir, e.name), true))
      )
    : []
  return [...files.filter((i): i is ImageItem => i !== null), ...nested.flat()]
}

const total = (n: FolderNode): number => n.count + n.children.reduce((s, c) => s + total(c), 0)

export async function folderTree(): Promise<FolderNode> {
  async function walk(abs: string): Promise<FolderNode> {
    const entries = await readdir(abs, { withFileTypes: true }).catch(() => [])
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    const children = await Promise.all(dirs.map((d) => walk(join(abs, d.name))))
    children.sort((a, b) => a.name.localeCompare(b.name))
    const own = entries.filter((e) => e.isFile() && IMAGE_EXT.has(extname(e.name).toLowerCase())).length
    const isRoot = abs === root()
    return {
      rel: toRel(abs),
      name: isRoot ? basename(root()) : basename(abs),
      // Root shows the grand total, matching its recursive "All captures" listing.
      count: isRoot ? own + children.reduce((n, c) => n + total(c), 0) : own,
      children
    }
  }
  return walk(root())
}

function stamp(d: Date): { date: string; time: string } {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return {
    date: `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`,
    time: `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  }
}

const sanitize = (s: string): string => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()

function uniquePath(dir: string, base: string, ext: string): string {
  let p = join(dir, base + ext)
  for (let i = 2; existsSync(p); i++) p = join(dir, `${base}_${i}${ext}`)
  return p
}

const modelName = (inst: Instrument): string => sanitize((inst.model || 'scope').replace(/\s+/g, ''))

export async function saveCapture(png: Buffer, inst: Instrument, folderRel: string): Promise<ImageItem> {
  // Captures into the root are sorted into a subfolder per instrument model.
  const rel = !folderRel && getSettings().modelSubfolder ? modelName(inst) : folderRel
  const dir = toAbs(rel)
  await mkdir(dir, { recursive: true })
  const { date, time } = stamp(new Date())
  const base =
    sanitize(
      getSettings()
        .filenameTemplate.replace('{model}', modelName(inst))
        .replace('{serial}', inst.serial)
        .replace('{date}', date)
        .replace('{time}', time)
    ) || `capture_${date}_${time}`
  const path = uniquePath(dir, base, '.png')
  await writeFile(path, png)
  await updateMeta(dir, (m) => (m[basename(path)] = { idn: inst.idn }))
  return itemFor(path)
}

export async function renameImage(path: string, newName: string): Promise<ImageItem> {
  const src = assertInside(path)
  const ext = extname(src)
  const clean = sanitize(newName.endsWith(ext) ? newName.slice(0, -ext.length) : newName)
  if (!clean) throw new Error('Invalid file name')
  const dst = join(dirname(src), clean + ext)
  if (dst === src) return itemFor(src)
  if (existsSync(dst)) throw new Error(`"${clean + ext}" already exists`)
  await rename(src, dst)
  await updateMeta(dirname(src), (m) => {
    if (m[basename(src)]) m[basename(dst)] = m[basename(src)]
    delete m[basename(src)]
  })
  return itemFor(dst)
}

export async function trashImages(paths: string[]): Promise<void> {
  for (const p of paths) {
    const abs = assertInside(p)
    await shell.trashItem(abs)
    await updateMeta(dirname(abs), (m) => delete m[basename(abs)])
  }
}

export async function moveImages(paths: string[], destRel: string): Promise<void> {
  const destDir = toAbs(destRel)
  const destMeta = await readMeta(destDir)
  for (const p of paths) {
    const src = assertInside(p)
    if (dirname(src) === destDir) continue
    const ext = extname(src)
    const dst = uniquePath(destDir, basename(src, ext), ext)
    await rename(src, dst)
    const srcMeta = await readMeta(dirname(src))
    if (srcMeta[basename(src)]) {
      destMeta[basename(dst)] = srcMeta[basename(src)]
      await updateMeta(dirname(src), (m) => delete m[basename(src)])
    }
  }
  await updateMeta(destDir, (m) => Object.assign(m, destMeta))
}

export async function setNote(path: string, note: string): Promise<void> {
  const abs = assertInside(path)
  await updateMeta(dirname(abs), (m) => (m[basename(abs)] = { ...m[basename(abs)], note }))
}

export async function makeFolder(parentRel: string, name: string): Promise<string> {
  const clean = sanitize(name)
  if (!clean || clean.startsWith('.')) throw new Error('Invalid folder name')
  const abs = join(toAbs(parentRel), clean)
  if (existsSync(abs)) throw new Error(`"${clean}" already exists`)
  await mkdir(abs)
  return toRel(abs)
}

export async function renameFolder(rel: string, newName: string): Promise<string> {
  if (!rel) throw new Error('Cannot rename the root folder')
  const src = toAbs(rel)
  const clean = sanitize(newName)
  if (!clean || clean.startsWith('.')) throw new Error('Invalid folder name')
  const dst = join(dirname(src), clean)
  if (existsSync(dst)) throw new Error(`"${clean}" already exists`)
  await rename(src, dst)
  return toRel(dst)
}

export async function removeFolder(rel: string): Promise<void> {
  if (!rel) throw new Error('Cannot delete the root folder')
  await shell.trashItem(toAbs(rel))
}

let watcher: FSWatcher | null = null
let timer: NodeJS.Timeout | undefined

/** Watch the capture root (recursively) and call onChange, debounced. */
export function watchLibrary(onChange: () => void): void {
  watcher?.close()
  try {
    watcher = watch(root(), { recursive: true }, () => {
      clearTimeout(timer)
      timer = setTimeout(onChange, 250)
    })
  } catch {
    watcher = null
  }
}
