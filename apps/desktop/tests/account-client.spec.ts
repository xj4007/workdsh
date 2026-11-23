import { describe, expect, it } from 'vitest'
import { AccountClient, type LoginResult } from '../src/account-client.ts'

const token = 't'.repeat(43)
const account = { id: 'a1', email: 'a@test', displayName: 'A', platformRole: 'USER', emailVerified: true }
const personal = { id: 's1', accountId: 'a1', kind: 'PERSONAL' as const, name: '个人空间', active: true }
const enterprise = { id: 's2', accountId: 'a1', kind: 'ENTERPRISE' as const, name: '公司', organizationId: 'org1', memberId: 'm1', role: 'MEMBER', active: true }
const loginPayload = { token, account, space: personal, spaces: [personal, enterprise], expiresAt: '2030-01-01T00:00:00Z' }

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })

type Call = { url: string, init?: RequestInit }
const stub = (respond: () => Response): typeof fetch => (async () => respond()) as unknown as typeof fetch
function recording(respond: (call: Call) => Response): { client: AccountClient, calls: Call[] } {
  const calls: Call[] = []
  const client = new AccountClient('https://company.test/', (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push(init === undefined ? { url: String(url) } : { url: String(url), init })
    return respond(calls[calls.length - 1]!)
  }) as unknown as typeof fetch)
  return { client, calls }
}

const headersOf = (init?: RequestInit): Headers => new Headers(init?.headers)

describe('AccountClient', () => {
  it('logs in against the fixed origin without sending credentials anywhere else', async () => {
    const { client, calls } = recording(() => json(loginPayload))
    const result = await client.login('A@Test ', 'p'.repeat(12))
    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe('https://company.test/api/account/login')
    expect(calls[0]!.init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ email: 'A@Test ', password: 'p'.repeat(12) })
    expect(headersOf(calls[0]!.init).get('Content-Type')).toBe('application/json')
    expect(headersOf(calls[0]!.init).get('Authorization')).toBeNull()
    const expected: LoginResult = {
      token,
      account: { ...account, emailVerified: true },
      space: { ...personal },
      spaces: [personal, enterprise],
      expiresAt: '2030-01-01T00:00:00Z',
    }
    expect(result).toEqual(expected)
  })

  it('registers with the verification code and omits an empty display name from the payload', async () => {
    const { client, calls } = recording(() => json(loginPayload))
    await client.register({ email: 'a@test', code: '123456', password: 'p'.repeat(12) })
    expect(calls[0]!.url).toBe('https://company.test/api/account/register')
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ email: 'a@test', code: '123456', password: 'p'.repeat(12) })
  })

  it('requests a code and keeps only the fields the service returned', async () => {
    const { client, calls } = recording(() => json({ expiresAt: '2030-01-01T00:00:00Z', code: '123456', extra: true }))
    const reply = await client.requestCode('a@test')
    expect(calls[0]!.url).toBe('https://company.test/api/account/request-code')
    expect(reply).toEqual({ expiresAt: '2030-01-01T00:00:00Z', code: '123456' })
  })

  it('reads the public registration switch and fails closed on malformed replies', async () => {
    const { client, calls } = recording(() => json({ registrationEnabled: true }))
    await expect(client.config()).resolves.toEqual({ registrationEnabled: true })
    expect(calls[0]!.url).toBe('https://company.test/api/account/config')
    expect(headersOf(calls[0]!.init).get('Authorization')).toBeNull()
    const missing = new AccountClient('https://company.test/', stub(() => json({})))
    await expect(missing.config()).resolves.toEqual({ registrationEnabled: false })
    const off = new AccountClient('https://company.test/', stub(() => json({ registrationEnabled: false })))
    await expect(off.config()).resolves.toEqual({ registrationEnabled: false })
  })

  it('attaches the bearer token to authenticated reads and encodes the space id on switch', async () => {
    const { client, calls } = recording(call => {
      const path = new URL(call.url).pathname
      if (path === '/api/account/me') return json({ account, space: personal, spaces: [personal, enterprise] })
      if (path === '/api/account/models') return json([{ id: 'sanyun-buddy-chat', displayName: '三云 Buddy · ×1', multiplier: 1, priceVersion: 3, capabilities: ['tools', 42], contextTokens: 128000, maxOutputTokens: 8192 }])
      if (path === '/api/account/wallet') return json({ spaceId: 's1', balanceUnits: 500000, reservedUnits: 1000, availableUnits: 499000, balanceCredits: '500.000', availableCredits: '499.000', unit: 'credit', scale: 1000 })
      return json(loginPayload)
    })
    await client.me(token)
    await client.models(token)
    const wallet = await client.wallet(token)
    const switched = await client.switchSpace(token, 'space/with space')
    for (const call of calls) expect(headersOf(call.init).get('Authorization')).toBe(`Bearer ${token}`)
    expect(calls[3]!.url).toBe('https://company.test/api/account/spaces/space%2Fwith%20space/token')
    expect(calls[3]!.init!.method).toBe('POST')
    expect(calls).toHaveLength(4)
    expect(calls[1]!.url).toBe('https://company.test/api/account/models')
    expect(wallet).toEqual({ spaceId: 's1', balanceUnits: 500000, reservedUnits: 1000, availableUnits: 499000, balanceCredits: '500.000', availableCredits: '499.000', unit: 'credit', scale: 1000 })
    expect(switched.spaces[1]).toEqual({ ...enterprise })
  })

  it('maps the model catalog and rejects non-array catalogs', async () => {
    const { client } = recording(() => json([{ id: 'm', displayName: 'M', multiplier: 2, priceVersion: 1, capabilities: ['tools', 7] }]))
    const models = await client.models(token)
    expect(models).toEqual([{ id: 'm', displayName: 'M', multiplier: 2, priceVersion: 1, capabilities: ['tools'] }])
    const bad = new AccountClient('https://company.test/', stub(() => json({})))
    await expect(bad.models(token)).rejects.toThrow('账户服务返回了无效模型目录')
  })

  it('rejects malformed service payloads', async () => {
    const badToken = new AccountClient('https://company.test/', stub(() => json({ ...loginPayload, token: 'short' })))
    await expect(badToken.login('a@test', 'p'.repeat(12))).rejects.toThrow('账户服务返回了无效令牌')
    const badSpaces = new AccountClient('https://company.test/', stub(() => json({ ...loginPayload, spaces: 'nope' })))
    await expect(badSpaces.login('a@test', 'p'.repeat(12))).rejects.toThrow('账户服务缺少空间列表')
    const badKind = new AccountClient('https://company.test/', stub(() => json({ ...loginPayload, space: { ...personal, kind: 'OTHER' } })))
    await expect(badKind.login('a@test', 'p'.repeat(12))).rejects.toThrow('账户服务返回了无效空间类型')
    const badUnits = new AccountClient('https://company.test/', stub(() => json({ spaceId: 's1', balanceUnits: 1.5, reservedUnits: 0, availableUnits: 0, balanceCredits: '0.001', availableCredits: '0.001' })))
    await expect(badUnits.wallet(token)).rejects.toThrow('账户服务缺少 balanceUnits')
  })

  it('translates service failures into stable account errors', async () => {
    const unauthorized = new AccountClient('https://company.test/', stub(() => json({ message: 'x' }, 401)))
    await expect(unauthorized.login('a@test', 'wrong-password-x')).rejects.toThrow('账号或密码不正确')
    const limited = new AccountClient('https://company.test/', stub(() => json({ message: '发送过于频繁' }, 429)))
    await expect(limited.requestCode('a@test')).rejects.toThrow('发送过于频繁')
    const failed = new AccountClient('https://company.test/', stub(() => json({ error: { message: '邮箱已被使用' } }, 409)))
    await expect(failed.register({ email: 'a@test', code: '123456', password: 'p'.repeat(12) })).rejects.toThrow('邮箱已被使用')
    const plain = new AccountClient('https://company.test/', stub(() => new Response('nope', { status: 500 })))
    await expect(plain.login('a@test', 'p'.repeat(12))).rejects.toThrow('登录失败 (500)')
    const offline = new AccountClient('https://company.test/', (async () => { throw new Error('boom') }) as unknown as typeof fetch)
    await expect(offline.login('a@test', 'p'.repeat(12))).rejects.toThrow('无法连接账户服务，请检查网络或服务地址')
  })

  it('treats logout as best effort and tolerates an already invalid session', async () => {
    const ok = recording(() => new Response(null, { status: 204 }))
    await expect(ok.client.logout(token)).resolves.toBe(true)
    const gone = recording(() => json({}, 401))
    await expect(gone.client.logout(token)).resolves.toBe(true)
    const offline = new AccountClient('https://company.test/', (async () => { throw new Error('down') }) as unknown as typeof fetch)
    await expect(offline.logout(token)).resolves.toBe(false)
  })

  it('normalizes the origin and refuses insecure remote account services', () => {
    expect(new AccountClient('https://company.test/').origin).toBe('https://company.test')
    expect(() => new AccountClient('http://example.test/')).toThrow()
    expect(() => new AccountClient('https://company.test/?token=secret')).toThrow()
    expect(new AccountClient('http://127.0.0.1:19490/').origin).toBe('http://127.0.0.1:19490')
  })
})
