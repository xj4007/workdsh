import { contextBridge } from 'electron'

// Host windows receive the loopback account bridge through launch arguments: the
// workbench rewrites its own URL, so a query parameter cannot survive to the client.
const argument = (prefix: string): string | undefined =>
  process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length)

const url = argument('--workdsh-account-url=')
const key = argument('--workdsh-account-key=')

if (url && key) contextBridge.exposeInMainWorld('__workdshAccountBridge', { url, key })
