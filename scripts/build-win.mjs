// Builds dist/win-unpacked while keeping the user's captures and settings in it.
// electron-builder recreates the output folder, so they are moved aside and restored.
import { execSync } from 'child_process'
import { existsSync, mkdirSync, renameSync, rmSync } from 'fs'
import { join } from 'path'

const appDir = join('dist', 'win-unpacked')
const stash = '.build-keep'
const keep = ['CaptureData', 'configOscCapture.json', 'CapConfig.json', 'psuProfiles.json']

if (existsSync(stash)) {
  console.error(`"${stash}" exists from an interrupted build. Move its contents back to ${appDir} first.`)
  process.exit(1)
}

const moved = []
for (const name of keep) {
  const src = join(appDir, name)
  if (!existsSync(src)) continue
  mkdirSync(stash, { recursive: true })
  try {
    renameSync(src, join(stash, name))
  } catch (e) {
    console.error(`Cannot move ${src} (is OscCapture running?): ${e.message}`)
    restore()
    process.exit(1)
  }
  moved.push(name)
}
if (moved.length) console.log(`Preserving ${moved.join(', ')}`)

function restore() {
  for (const name of moved.splice(0)) {
    mkdirSync(appDir, { recursive: true })
    const dst = join(appDir, name)
    if (existsSync(dst)) rmSync(dst, { recursive: true, force: true })
    renameSync(join(stash, name), dst)
  }
  if (existsSync(stash)) rmSync(stash, { recursive: true, force: true })
}

let failed = false
try {
  execSync('npx electron-vite build', { stdio: 'inherit' })
  execSync('npx electron-builder --win dir', { stdio: 'inherit' })
} catch {
  failed = true
} finally {
  restore()
}
process.exit(failed ? 1 : 0)
