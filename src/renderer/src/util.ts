export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })
}

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  // Strip Electron's "Error invoking remote method 'x': Error: " prefix.
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

const KEY_NAMES: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Insert: 'Insert',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Pause: 'Pause',
  PrintScreen: 'PrintScreen',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/'
}

/** Main key of a keyboard event in Electron accelerator notation, or '' for a bare modifier. */
function keyName(code: string): string {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  if (/^Numpad\d$/.test(code)) return 'num' + code.slice(6)
  if (/^F\d{1,2}$/.test(code)) return code
  return KEY_NAMES[code] ?? ''
}

/** Convert a keyboard event to an Electron accelerator such as "Ctrl+Shift+S" or "F8". */
export function eventToAccelerator(e: KeyboardEvent | React.KeyboardEvent): string {
  const key = keyName(e.code)
  if (!key) return ''
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean)
  return [...mods, key].join('+')
}

/** A hotkey must be a function/special key, or include Ctrl/Alt/Super, so normal typing isn't hijacked. */
export function isValidHotkey(acc: string): boolean {
  const parts = acc.split('+')
  const key = parts[parts.length - 1]
  const hasMod = parts.some((p) => p === 'Ctrl' || p === 'Alt' || p === 'Super')
  return hasMod || /^F\d{1,2}$/.test(key) || key === 'PrintScreen' || key === 'Pause' || key === 'Insert'
}
