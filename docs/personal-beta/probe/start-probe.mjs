// Starts the two mock endpoints and a real WorkDSH Host (profile-boot + patchFiles),
// then records the ready URL and PIDs in tmp/gate/run.json.
import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = Object.fromEntries(process.argv.slice(2).map(item => {
  const split = item.indexOf('=')
  return split < 0 ? [item.replace(/^--/u, ''), true] : [item.slice(2, split), item.slice(split + 1)]
}))
const here = resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1'))
const runtime = resolve(args.runtime ?? join(here, '..', '..', '..', 'apps', 'desktop', 'build', 'workdsh-runtime', 'profiles', 'workdsh'))
const home = resolve(args.home ?? join(here, '..', '..', '..', 'tmp', 'gate', 'home'))
const logDir = resolve(args['log-dir'] ?? join(here, '..', '..', '..', 'tmp', 'gate', 'logs'))
const port = Number(args.port ?? 18990)
const managedPatch = resolve(args['managed-patch'] ?? join(here, '..', '..', '..', 'tmp', 'gate', 'patches', 'managed.patch.yml'))
const portPatch = resolve(args['port-patch'] ?? join(here, '..', '..', '..', 'tmp', 'gate', 'patches', 'port.patch.yml'))
const probeRoot = here

const noManaged = args['no-managed'] === true
const keepLogs = args['keep-logs'] === true
if (!keepLogs) {
  for (const file of [join(logDir, 'user-self-requests.jsonl'), join(logDir, 'sanyun-buddy-requests.jsonl'), join(logDir, 'host.log'), join(logDir, 'mock-server.log')]) rmSync(file, { force: true })
}

writeFileSync(managedPatch, `- insert:
    - id: gate-managed-provider
      name: ${pathToFileURL(join(probeRoot, 'managed-provider-plugin.mjs')).href}
      config:
        baseURL: http://127.0.0.1:18182/v1
        models:
          - id: sanyun-buddy-chat
            name: 模型 A · ×1.5
            contextWindow: 128000
`)

function spawnLogged(command, commandArgs, options, logName) {
  const out = openSync(join(logDir, `${logName}.log`), 'a')
  const child = spawn(command, commandArgs, {
    ...options,
    detached: true,
    stdio: ['ignore', out, out],
  })
  child.unref()
  closeSync(out)
  return child.pid
}

const mockPid = spawnLogged(process.execPath, [join(probeRoot, 'mock-model-server.mjs'), logDir, '18181', '18182'], { cwd: probeRoot }, 'mock-server')
const mockReady = await waitFor(async () => {
  try { return (await fetch('http://127.0.0.1:18181/v1/models')).ok && (await fetch('http://127.0.0.1:18182/v1/models')).ok } catch { return false }
}, 15000)
if (!mockReady) throw new Error('mock servers did not become ready')

const patches = noManaged ? [portPatch] : [managedPatch, portPatch]
const env = {
  ...process.env,
  DSH_HOME: home,
  DSH_BUNDLED_PRIMARY_RUNTIME: join(runtime, '..', '..', 'primary-runtime'),
  GATE_RUNTIME: runtime,
  GATE_PATCHES: JSON.stringify(patches),
  GATE_USER_KEY: 'sk-gate-user',
}
const hostPid = spawnLogged(process.execPath, [join(probeRoot, 'launch-host.mjs')], { cwd: probeRoot, env }, 'host')

const expected = new RegExp(`dsh web:\\s+(http://127\\.0\\.0\\.1:${port}/\\?token=[^\\s]+)`, 'u')
let url
const ready = await waitFor(() => {
  const text = existsSync(join(logDir, 'host.log')) ? readFileSync(join(logDir, 'host.log'), 'utf8') : ''
  const match = text.match(expected)
  if (match) url = match[1]
  return Boolean(match)
}, 90000)
if (!ready) {
  const text = existsSync(join(logDir, 'host.log')) ? readFileSync(join(logDir, 'host.log'), 'utf8') : ''
  throw new Error(`Host did not become ready on port ${port}. Host log tail:\n${text.slice(-8000)}`)
}
writeFileSync(join(logDir, 'run.json'), JSON.stringify({ url, hostPid, mockPid, port, home, runtime, patches }, null, 2) + '\n')
console.log(JSON.stringify({ url, hostPid, mockPid, port }))

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return false
}
