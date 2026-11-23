import { afterAll, describe, expect, it } from 'vitest'
import { startManagedBridge, type AccountSummary } from '../src/managed-bridge.ts'
import type { ManagedModel } from '../src/account-client.ts'

const spaceToken = 'S'.repeat(43)
const models: ManagedModel[] = [{ id: 'sanyun-buddy-chat', displayName: '三云 Buddy · ×1', priceVersion: 3, contextTokens: 128000 }]
const summary = (): AccountSummary => ({ account: { displayName: 'A', email: 'a@test' }, space: { id: 's1', name: '个人空间', kind: 'PERSONAL' }, spaces: [{ id: 's1', name: '个人空间', kind: 'PERSONAL' }], wallet: { availableCredits: '5.000', balanceCredits: '5.000' } })
const sse = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: {"usage":{"prompt_tokens":10,"completion_tokens":3}}\n\ndata: [DONE]\n\n'

type UpstreamCall = { url: string, init?: RequestInit }
function stubUpstream(respond: () => Response | Promise<Response>): { request: typeof fetch, calls: UpstreamCall[] } {
  const calls: UpstreamCall[] = []
  return {
    calls,
    request: (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init === undefined ? { url: String(url) } : { url: String(url), init })
      return await respond()
    }) as unknown as typeof fetch,
  }
}

const get = (url: string, key?: string) => fetch(url, { headers: key ? { Authorization: `Bearer ${key}` } : {} })
const post = (url: string, key: string | undefined, payload?: string) => fetch(url, payload === undefined
  ? { method: 'POST', headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' } }
  : { method: 'POST', headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' }, body: payload })

describe('managed bridge', () => {
  const stub = stubUpstream(() => new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
  const switchCalls: string[] = []
  let logoutCount = 0
  let refreshCount = 0
  let bridge: Awaited<ReturnType<typeof startManagedBridge>> | undefined

  afterAll(async () => { if (bridge) await bridge.close() })

  it('guards every route with a random capability key and keeps the account token out of responses', async () => {
    bridge = await startManagedBridge({ origin: 'https://admin.test', token: spaceToken, models, account: async () => summary(), refreshAccount: async () => { refreshCount += 1; return summary() }, switchSpace: async spaceId => { switchCalls.push(spaceId) }, logout: () => { logoutCount += 1 }, request: stub.request })
    const b = bridge!
    expect(b.key).toMatch(/^[0-9a-f]{64}$/)
    expect(b.models).toEqual(models)

    const denied = await get(`${b.url}/account`)
    expect(denied.status).toBe(401)
    expect(await denied.json()).toEqual({ error: 'Desktop capability required' })
    const wrong = await get(`${b.url}/account`, 'k'.repeat(64))
    expect(wrong.status).toBe(401)
    const preflight = await fetch(`${b.url}/account`, { method: 'OPTIONS' })
    expect(preflight.status).toBe(204)

    const account = await get(`${b.url}/account`, b.key)
    const raw = await account.text()
    expect(account.status).toBe(200)
    expect(JSON.parse(raw)).toEqual(summary())
    expect(raw).not.toContain(spaceToken)
    expect(account.headers.get('cache-control')).toBe('no-store')
  })

  it('serves account display operations without exposing the upstream token', async () => {
    const b = bridge!
    const refreshed = await post(`${b.url}/account/refresh`, b.key)
    expect(refreshed.status).toBe(200)
    expect(refreshCount).toBe(1)
    const switched = await post(`${b.url}/account/switch`, b.key, JSON.stringify({ spaceId: 's2' }))
    expect(await switched.json()).toEqual({ ok: true })
    expect(switchCalls).toEqual(['s2'])
    const badSwitch = await post(`${b.url}/account/switch`, b.key, JSON.stringify({ spaceId: '' }))
    expect(badSwitch.status).toBe(400)
    expect(await badSwitch.json()).toEqual({ error: 'spaceId required' })
    const loggedOut = await post(`${b.url}/account/logout`, b.key)
    expect(await loggedOut.json()).toEqual({ ok: true })
    expect(logoutCount).toBe(1)
    const unknown = await get(`${b.url}/account/other`, b.key)
    expect(unknown.status).toBe(404)
    const query = await get(`${b.url}/account?x=1`, b.key)
    expect(query.status).toBe(404)
    expect(await query.text()).not.toContain(spaceToken)
  })

  it('forwards only catalog models with the space token and injected price/request identity', async () => {
    const b = bridge!
    const notInCatalog = await post(`${b.url}/v1/chat/completions`, b.key, JSON.stringify({ model: 'user-model', messages: [] }))
    expect(notInCatalog.status).toBe(400)
    expect(await notInCatalog.json()).toEqual({ error: 'model-not-in-catalog' })
    const wrongMethod = await get(`${b.url}/v1/chat/completions`, b.key)
    expect(wrongMethod.status).toBe(404)
    const invalid = await post(`${b.url}/v1/chat/completions`, b.key, 'not json')
    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({ error: 'JSON object required' })

    const streamed = await post(`${b.url}/v1/chat/completions`, b.key, JSON.stringify({ model: 'sanyun-buddy-chat', messages: [{ role: 'user', content: 'hi' }], stream: true, stream_options: { custom: 1 } }))
    expect(streamed.status).toBe(200)
    expect(streamed.headers.get('content-type')).toBe('text/event-stream')
    expect(await streamed.text()).toBe(sse)
    expect(stub.calls).toHaveLength(1)
    expect(stub.calls[0]!.url).toBe('https://admin.test/api/managed/v1/chat/completions')
    const forwarded = JSON.parse(String(stub.calls[0]!.init!.body))
    expect(typeof forwarded.request_id).toBe('string')
    expect(forwarded.price_version).toBe(3)
    expect(forwarded.stream_options).toEqual({ custom: 1, include_usage: true })
    expect(headersAuthorization(stub.calls[0]!.init)).toBe(`Bearer ${spaceToken}`)
    expect(JSON.stringify(forwarded)).not.toContain(spaceToken)

    const identity = await post(`${b.url}/v1/chat/completions`, b.key, JSON.stringify({ model: 'sanyun-buddy-chat', request_id: 'req-1' }))
    await identity.text()
    const second = JSON.parse(String(stub.calls[1]!.init!.body))
    expect(second.request_id).toBe('req-1')
    expect(second.price_version).toBe(3)
    expect(headersAuthorization(stub.calls[1]!.init)).toBe(`Bearer ${spaceToken}`)
    expect(identity.headers.get('content-type')).toBe('text/event-stream')
  })

  it('maps upstream failures to 502 and rejects further traffic after close', async () => {
    const failingBridge = await startManagedBridge({ origin: 'https://admin.test', token: spaceToken, models, account: async () => summary(), refreshAccount: async () => summary(), switchSpace: async () => {}, logout: () => {}, request: (async () => { throw new Error('down') }) as unknown as typeof fetch })
    try {
      const response = await post(`${failingBridge.url}/v1/chat/completions`, failingBridge.key, JSON.stringify({ model: 'sanyun-buddy-chat' }))
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ error: 'Managed model gateway unavailable' })
    } finally { await failingBridge.close() }
    await expect(get(`${failingBridge.url}/account`, failingBridge.key)).rejects.toThrow()
    const b = bridge!
    await b.close()
    await expect(get(`${b.url}/account`, b.key)).rejects.toThrow()
  })
})

function headersAuthorization(init?: RequestInit): string | null {
  return new Headers(init?.headers).get('Authorization')
}
