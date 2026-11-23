/** Loopback capability bridge: the Host receives only this URL and key, never the account token. */
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { Readable } from 'node:stream'
import type { ManagedModel } from './account-client.ts'

export type AccountSummary = {
  account: { displayName: string, email: string }
  space: { id: string, name: string, kind: 'PERSONAL' | 'ENTERPRISE' }
  spaces: Array<{ id: string, name: string, kind: 'PERSONAL' | 'ENTERPRISE' }>
  wallet: { availableCredits: string, balanceCredits: string } | null
}

export type ManagedBridge = {
  url: string
  key: string
  models: readonly ManagedModel[]
  close(): Promise<void>
}

type BridgeOptions = {
  origin: string
  token: string
  models: readonly ManagedModel[]
  account: () => Promise<AccountSummary>
  refreshAccount: () => Promise<AccountSummary>
  switchSpace: (spaceId: string) => Promise<void>
  logout: () => void
  request?: typeof fetch
}

const MAX_BODY = 4 * 1024 * 1024

async function body(request: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const part of request) {
    const chunk = Buffer.from(part)
    size += chunk.length
    if (size > MAX_BODY) throw new Error('body-too-large')
    chunks.push(chunk)
  }
  let value: unknown
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('invalid-json') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid-json')
  return value as Record<string, unknown>
}

/** Start a per-space bridge. The key is random per Host process and stays only in main process memory plus the Host URL. */
export async function startManagedBridge(options: BridgeOptions): Promise<ManagedBridge> {
  const key = randomBytes(32).toString('hex')
  const expected = Buffer.from(`Bearer ${key}`)
  const models = new Map(options.models.map(model => [model.id, model]))
  const request = options.request ?? fetch
  let closing = false

  const server: Server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'authorization,content-type')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    const json = (status: number, value: unknown): void => {
      if (res.destroyed) return
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(value))
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    if (closing) { json(401, { error: 'Desktop is signing out' }); return }
    const supplied = Buffer.from(req.headers.authorization ?? '')
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      json(401, { error: 'Desktop capability required' }); return
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')

    try {
      if (url.pathname === '/account' && req.method === 'GET' && !url.search) {
        json(200, await options.account()); return
      }
      if (url.pathname === '/account/refresh' && req.method === 'POST' && !url.search) {
        json(200, await options.refreshAccount()); return
      }
      if (url.pathname === '/account/switch' && req.method === 'POST' && !url.search) {
        const value = await body(req)
        if (typeof value.spaceId !== 'string' || value.spaceId.length === 0 || value.spaceId.length > 200) {
          json(400, { error: 'spaceId required' }); return
        }
        await options.switchSpace(value.spaceId)
        json(200, { ok: true }); return
      }
      if (url.pathname === '/account/logout' && req.method === 'POST' && !url.search) {
        options.logout(); json(200, { ok: true }); return
      }
      if (url.pathname !== '/v1/chat/completions' || req.method !== 'POST' || url.search) {
        json(404, { error: 'Unknown Desktop bridge operation' }); return
      }
      const value = await body(req)
      if (typeof value.model !== 'string' || !models.has(value.model)) {
        json(400, { error: 'model-not-in-catalog' }); return
      }
      const model = models.get(value.model)!
      const payload: Record<string, unknown> = { ...value, request_id: typeof value.request_id === 'string' ? value.request_id : randomUUID() }
      if (model.priceVersion !== undefined) payload.price_version = model.priceVersion
      if (payload.stream === true) {
        const optionsValue = payload.stream_options && typeof payload.stream_options === 'object' && !Array.isArray(payload.stream_options)
          ? payload.stream_options as Record<string, unknown> : {}
        payload.stream_options = { ...optionsValue, include_usage: true }
      }
      const upstream = await request(`${options.origin}/api/managed/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.token}` },
        body: JSON.stringify(payload),
        redirect: 'error',
        signal: AbortSignal.timeout(120_000),
      })
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' })
      if (upstream.body === null) { res.end(); return }
      Readable.fromWeb(upstream.body as unknown as import('node:stream/web').ReadableStream).pipe(res)
    } catch (error) {
      if (error instanceof Error && error.message === 'body-too-large') { json(413, { error: 'Body too large' }); return }
      if (error instanceof Error && error.message === 'invalid-json') { json(400, { error: 'JSON object required' }); return }
      json(502, { error: 'Managed model gateway unavailable' })
    }
  })
  server.requestTimeout = 130_000
  server.headersTimeout = 10_000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Desktop bridge did not start')
  return {
    url: `http://127.0.0.1:${address.port}`,
    key,
    models: [...options.models],
    close: async () => {
      closing = true
      server.closeAllConnections()
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}
