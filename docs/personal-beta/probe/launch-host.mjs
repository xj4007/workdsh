// Minimal Host launcher for the gate. It mirrors apps/desktop/src/local-runtime.ts
// officialHostLauncher so the proof exercises the real profile-boot + patchFiles
// seam instead of a hand-rolled Cordis composition.
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const runtime = resolve(process.env.GATE_RUNTIME ?? '')
const home = resolve(process.env.DSH_HOME ?? '')
const patches = JSON.parse(process.env.GATE_PATCHES ?? '[]')
if (!existsSync(join(runtime, 'profile-installation.json'))) throw new Error(`missing runtime profile installation: ${runtime}`)
if (!existsSync(join(home, 'profiles', 'workdsh'))) throw new Error(`missing gate profile: ${home}`)

const boot = join(runtime, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'profile-boot.js')
const appBoot = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')
const { runProfile } = await import(pathToFileURL(boot).href)
const { loadProfileDirectory, loadLayeredEnv, reportSkippedBundles } = await import(pathToFileURL(appBoot).href)

const installAnchor = join(runtime, 'profile-installation.json')
const profile = loadProfileDirectory('dsh', join(home, 'profiles', 'workdsh'), installAnchor)
reportSkippedBundles('dsh', profile)
await runProfile({
  environment: loadLayeredEnv('dsh'),
  profile: 'workdsh',
  resolvedProfile: { profile, installAnchor },
  patchFiles: patches,
  args: ['--no-open'],
  packageManager: { command: process.execPath, args: [join(runtime, '..', '..', 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.cjs')] },
})
