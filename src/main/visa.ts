// Thin FFI wrapper around the Keysight/NI VISA library (visa64.dll).
import koffi, { type LibraryHandle } from 'koffi'

const VI_SUCCESS_MAX_CNT = 0x3fff0006
const VI_ERROR_RSRC_NFOUND = 0xbfff0011 | 0
const VI_ATTR_TMO_VALUE = 0x3fff001a
const VI_ATTR_TERMCHAR_EN = 0x3fff0038

type Fn = ReturnType<LibraryHandle['func']>

interface VisaLib {
  openDefaultRM: Fn
  findRsrc: Fn
  findNext: Fn
  open: Fn
  close: Fn
  write: Fn
  read: Fn
  setAttribute: Fn
  clear: Fn
  statusDesc: Fn
}

let lib: VisaLib | null = null
let rm = 0

function load(): VisaLib {
  if (lib) return lib
  let h: LibraryHandle
  try {
    h = koffi.load('visa64.dll')
  } catch {
    throw new Error('VISA library (visa64.dll) not found. Install Keysight IO Libraries Suite.')
  }
  lib = {
    openDefaultRM: h.func('int32 viOpenDefaultRM(_Out_ uint32_t *rm)'),
    findRsrc: h.func(
      'int32 viFindRsrc(uint32_t rm, const char *expr, _Out_ uint32_t *list, _Out_ uint32_t *count, void *desc)'
    ),
    findNext: h.func('int32 viFindNext(uint32_t list, void *desc)'),
    open: h.func('int32 viOpen(uint32_t rm, const char *name, uint32_t mode, uint32_t tmo, _Out_ uint32_t *vi)'),
    close: h.func('int32 viClose(uint32_t vi)'),
    write: h.func('int32 viWrite(uint32_t vi, void *buf, uint32_t cnt, _Out_ uint32_t *ret)'),
    read: h.func('int32 viRead(uint32_t vi, void *buf, uint32_t cnt, _Out_ uint32_t *ret)'),
    setAttribute: h.func('int32 viSetAttribute(uint32_t vi, uint32_t attr, uint64_t value)'),
    clear: h.func('int32 viClear(uint32_t vi)'),
    statusDesc: h.func('int32 viStatusDesc(uint32_t vi, int32 status, void *desc)')
  }
  return lib
}

function resourceManager(): number {
  const l = load()
  if (rm) return rm
  const out = [0]
  check(l.openDefaultRM(out), 0)
  rm = out[0]
  return rm
}

function check(status: number, vi: number): number {
  if (status >= 0) return status
  let msg = `VISA error 0x${(status >>> 0).toString(16).toUpperCase()}`
  try {
    const buf = Buffer.alloc(256)
    lib!.statusDesc(vi || rm, status, buf)
    msg = cstr(buf) || msg
  } catch {
    /* keep generic message */
  }
  throw new Error(msg)
}

function cstr(buf: Buffer): string {
  const i = buf.indexOf(0)
  return buf.toString('latin1', 0, i < 0 ? buf.length : i)
}

// Run a VISA call on koffi's worker thread so the main process stays responsive.
function callAsync(fn: Fn, ...args: unknown[]): Promise<number> {
  return new Promise((resolve, reject) => {
    fn.async(...args, (err: unknown, res: number) => (err ? reject(err) : resolve(res)))
  })
}

export function findResources(expr = '?*INSTR'): string[] {
  const l = load()
  const sesn = resourceManager()
  const list = [0]
  const count = [0]
  const desc = Buffer.alloc(256)
  const st = l.findRsrc(sesn, expr, list, count, desc)
  if (st === VI_ERROR_RSRC_NFOUND) return []
  check(st, sesn)
  const found = [cstr(desc)]
  for (let i = 1; i < count[0]; i++) {
    desc.fill(0)
    if (l.findNext(list[0], desc) >= 0) found.push(cstr(desc))
  }
  l.close(list[0])
  return found
}

export class VisaSession {
  private constructor(private vi: number) {}

  static async open(resource: string, timeoutMs = 5000): Promise<VisaSession> {
    const l = load()
    const out = [0]
    check(await callAsync(l.open, resourceManager(), resource, 0, 3000, out), 0)
    const s = new VisaSession(out[0])
    s.setTimeout(timeoutMs)
    l.setAttribute(out[0], VI_ATTR_TERMCHAR_EN, 0)
    return s
  }

  setTimeout(ms: number): void {
    check(lib!.setAttribute(this.vi, VI_ATTR_TMO_VALUE, ms), this.vi)
  }

  async write(cmd: string): Promise<void> {
    const buf = Buffer.from(cmd.endsWith('\n') ? cmd : cmd + '\n', 'latin1')
    const ret = [0]
    check(await callAsync(lib!.write, this.vi, buf, buf.length, ret), this.vi)
  }

  /** Read until the instrument asserts END. */
  async readRaw(): Promise<Buffer> {
    const parts: Buffer[] = []
    const ret = [0]
    let st: number
    do {
      const chunk = Buffer.alloc(256 * 1024)
      st = check(await callAsync(lib!.read, this.vi, chunk, chunk.length, ret), this.vi)
      parts.push(chunk.subarray(0, ret[0]))
    } while (st === VI_SUCCESS_MAX_CNT)
    return Buffer.concat(parts)
  }

  async query(cmd: string): Promise<string> {
    await this.write(cmd)
    return (await this.readRaw()).toString('latin1').trim()
  }

  /** Query returning an IEEE 488.2 definite-length binary block (#<n><len><data>). */
  async queryBlock(cmd: string): Promise<Buffer> {
    await this.write(cmd)
    const raw = await this.readRaw()
    const start = raw.indexOf(0x23) // '#'
    if (start < 0) throw new Error('Invalid binary block from instrument')
    const n = raw[start + 1] - 0x30
    if (n < 1 || n > 9) throw new Error('Unsupported binary block header')
    const len = parseInt(raw.toString('latin1', start + 2, start + 2 + n), 10)
    const data = raw.subarray(start + 2 + n, start + 2 + n + len)
    if (data.length !== len) throw new Error(`Incomplete transfer (${data.length}/${len} bytes)`)
    return data
  }

  clear(): void {
    lib!.clear(this.vi)
  }

  close(): void {
    lib!.close(this.vi)
  }
}
