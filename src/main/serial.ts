// RS-232 transport (serialport) for SCPI instruments such as the 34401A.
import { SerialPort } from 'serialport'
import { ReadlineParser } from '@serialport/parser-readline'
import type { ComPort } from '@shared/types'

export async function listComPorts(): Promise<ComPort[]> {
  const ports = await SerialPort.list().catch(() => [])
  return ports
    .map((p) => {
      const name = (p as { friendlyName?: string }).friendlyName?.replace(/\s*\(COM\d+\)\s*$/i, '') || p.manufacturer || ''
      return { path: p.path, label: name ? `${p.path} – ${name}` : p.path }
    })
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }))
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Line-oriented SCPI session: 8N1, DTR on, commands and replies terminated by LF. */
export class SerialSession {
  private lines: string[] = []
  private waiter: ((line: string) => void) | null = null
  private timeoutMs = 5000

  private constructor(private port: SerialPort) {
    port.pipe(new ReadlineParser({ delimiter: '\n' })).on('data', (raw: string) => {
      const line = raw.replace(/\r$/, '')
      if (this.waiter) this.waiter(line)
      else this.lines.push(line)
    })
  }

  static async open(path: string, baudRate: number, timeoutMs = 5000): Promise<SerialSession> {
    const port = new SerialPort({ path, baudRate, dataBits: 8, parity: 'none', stopBits: 1, autoOpen: false })
    await new Promise<void>((res, rej) => port.open((e) => (e ? rej(new Error(`${path}: ${e.message}`)) : res())))
    try {
      // The 34401A only transmits while DTR is on.
      await new Promise<void>((res, rej) => port.set({ dtr: true }, (e) => (e ? rej(e) : res())))
      await sleep(100)
    } catch (e) {
      port.close()
      throw e
    }
    const s = new SerialSession(port)
    s.timeoutMs = timeoutMs
    return s
  }

  setTimeout(ms: number): void {
    this.timeoutMs = ms
  }

  write(cmd: string): Promise<void> {
    return new Promise((res, rej) => {
      this.port.write(cmd.replace(/\r?\n$/, '') + '\n', (e) => (e ? rej(e) : this.port.drain(() => res())))
    })
  }

  async query(cmd: string): Promise<string> {
    this.lines = [] // drop anything unsolicited before asking
    const reply = new Promise<string>((res, rej) => {
      const timer = setTimeout(() => {
        this.waiter = null
        rej(new Error(`Timeout waiting for reply to "${cmd}"`))
      }, this.timeoutMs)
      this.waiter = (line) => {
        clearTimeout(timer)
        this.waiter = null
        res(line.trim())
      }
    })
    await this.write(cmd)
    return reply
  }

  queryBlock(): Promise<Buffer> {
    return Promise.reject(new Error('Binary transfers are not supported over RS-232'))
  }

  clear(): void {
    this.lines = []
    this.port.flush()
  }

  /** Resolves once the port is released, so it can be reopened right away. */
  close(): Promise<void> {
    if (!this.port.isOpen) return Promise.resolve()
    return new Promise((res) => this.port.close(() => res()))
  }
}
