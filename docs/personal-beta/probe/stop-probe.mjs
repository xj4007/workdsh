// Stops the Host and mock processes recorded by start-probe.mjs.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const here = resolve(new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1'))
const runFile = resolve(process.argv[2] ?? join(here, '..', '..', '..', 'tmp', 'gate', 'logs', 'run.json'))
if (!existsSync(runFile)) {
  console.log('no run.json; nothing to stop')
  process.exit(0)
}
const run = JSON.parse(readFileSync(runFile, 'utf8'))
for (const pid of [run.hostPid, run.mockPid]) {
  if (!pid) continue
  const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' })
  console.log(`taskkill ${pid}: ${result.status} ${result.stdout.trim()}`)
}
rmSync(runFile, { force: true })
