/** Main-process account/catalog/wallet client. No token is exposed to the renderer. */
import { enterpriseConnection } from './connection-mode.ts'

export type AccountInfo = {
  id: string
  email: string
  displayName: string
  platformRole: string
  emailVerified: boolean
}

export type AccountSpace = {
  id: string
  accountId: string
  kind: 'PERSONAL' | 'ENTERPRISE'
  name: string
  organizationId?: string
  memberId?: string
  role?: string
  active: boolean
}

export type LoginResult = {
  token: string
  account: AccountInfo
  space: AccountSpace
  spaces: AccountSpace[]
  expiresAt?: string
}

export type ManagedModel = {
  id: string
  displayName: string
  multiplier?: number
  capabilities?: string[]
  contextTokens?: number
  maxOutputTokens?: number
  priceVersion?: number
}

export type Wallet = {
  spaceId: string
  balanceUnits: number
  reservedUnits: number
  availableUnits: number
  balanceCredits: string
  availableCredits: string
  unit: string
  scale: number
  revision?: number
}

const TOKEN = /^[A-Za-z0-9_-]{32,256}$/u

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('账户服务返回了无效数据')
  return value as Record<string, unknown>
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`账户服务缺少 ${field}`)
  return value
}

function account(value: unknown): AccountInfo {
  const row = record(value)
  return {
    id: text(row.id, 'account.id'),
    email: text(row.email, 'account.email'),
    displayName: text(row.displayName, 'account.displayName'),
    platformRole: typeof row.platformRole === 'string' ? row.platformRole : 'USER',
    emailVerified: row.emailVerified === true,
  }
}

function space(value: unknown): AccountSpace {
  const row = record(value)
  const kind = row.kind === 'ENTERPRISE' ? 'ENTERPRISE' : row.kind === 'PERSONAL' ? 'PERSONAL' : undefined
  if (!kind) throw new Error('账户服务返回了无效空间类型')
  return {
    id: text(row.id, 'space.id'),
    accountId: text(row.accountId, 'space.accountId'),
    kind,
    name: text(row.name, 'space.name'),
    ...(typeof row.organizationId === 'string' && row.organizationId ? { organizationId: row.organizationId } : {}),
    ...(typeof row.memberId === 'string' && row.memberId ? { memberId: row.memberId } : {}),
    ...(typeof row.role === 'string' && row.role ? { role: row.role } : {}),
    active: row.active !== false,
  }
}

function loginResult(value: unknown): LoginResult {
  const row = record(value)
  const token = text(row.token, 'token')
  if (!TOKEN.test(token)) throw new Error('账户服务返回了无效令牌')
  if (!Array.isArray(row.spaces)) throw new Error('账户服务缺少空间列表')
  return {
    token,
    account: account(row.account),
    space: space(row.space),
    spaces: row.spaces.map(space),
    ...(typeof row.expiresAt === 'string' ? { expiresAt: row.expiresAt } : {}),
  }
}

function managedModel(value: unknown): ManagedModel {
  const row = record(value)
  return {
    id: text(row.id, 'model.id'),
    displayName: text(row.displayName, 'model.displayName'),
    ...(typeof row.multiplier === 'number' ? { multiplier: row.multiplier } : {}),
    ...(Array.isArray(row.capabilities) ? { capabilities: row.capabilities.filter((item): item is string => typeof item === 'string') } : {}),
    ...(typeof row.contextTokens === 'number' ? { contextTokens: row.contextTokens } : {}),
    ...(typeof row.maxOutputTokens === 'number' ? { maxOutputTokens: row.maxOutputTokens } : {}),
    ...(typeof row.priceVersion === 'number' ? { priceVersion: row.priceVersion } : {}),
  }
}

function wallet(value: unknown): Wallet {
  const row = record(value)
  const fixed = (field: string): string => {
    const item = row[field]
    if (typeof item !== 'string' && typeof item !== 'number') throw new Error(`账户服务缺少 ${field}`)
    return String(item)
  }
  const integer = (field: string): number => {
    const item = row[field]
    if (typeof item !== 'number' || !Number.isSafeInteger(item)) throw new Error(`账户服务缺少 ${field}`)
    return item
  }
  return {
    spaceId: text(row.spaceId, 'wallet.spaceId'),
    balanceUnits: integer('balanceUnits'),
    reservedUnits: integer('reservedUnits'),
    availableUnits: integer('availableUnits'),
    balanceCredits: fixed('balanceCredits'),
    availableCredits: fixed('availableCredits'),
    unit: typeof row.unit === 'string' ? row.unit : 'credit',
    scale: typeof row.scale === 'number' ? row.scale : 1000,
    ...(typeof row.revision === 'number' ? { revision: row.revision } : {}),
  }
}

export class AccountClient {
  readonly origin: string
  readonly #fetch: typeof fetch

  constructor(origin: string, request: typeof fetch = fetch) {
    this.origin = enterpriseConnection(origin).portalOrigin
    this.#fetch = request
  }

  async #call(path: string, init: RequestInit = {}, token?: string): Promise<Response> {
    const headers = new Headers(init.headers)
    if (init.body !== undefined) headers.set('Content-Type', 'application/json')
    if (token) headers.set('Authorization', `Bearer ${token}`)
    try {
      return await this.#fetch(`${this.origin}${path}`, { ...init, headers, redirect: 'error', signal: AbortSignal.timeout(15_000) })
    } catch {
      throw new Error('无法连接账户服务，请检查网络或服务地址')
    }
  }

  async #json(response: Response, action: string): Promise<unknown> {
    let data: unknown
    try { data = await response.json() } catch { data = undefined }
    if (!response.ok) {
      const row = data && typeof data === 'object' ? data as Record<string, unknown> : {}
      const nested = row.error && typeof row.error === 'object' ? row.error as Record<string, unknown> : {}
      const message = typeof nested.message === 'string' ? nested.message : typeof row.message === 'string' ? row.message : undefined
      if (response.status === 401) throw new Error('账号或密码不正确')
      if (response.status === 429) throw new Error(message ?? '操作过于频繁，请稍后重试')
      throw new Error(message ?? `${action}失败 (${response.status})`)
    }
    return data
  }

  async requestCode(email: string): Promise<{ expiresAt?: string, code?: string }> {
    const response = await this.#call('/api/account/request-code', { method: 'POST', body: JSON.stringify({ email }) })
    const row = record(await this.#json(response, '发送验证码'))
    return {
      ...(typeof row.expiresAt === 'string' ? { expiresAt: row.expiresAt } : {}),
      ...(typeof row.code === 'string' ? { code: row.code } : {}),
    }
  }

  async register(input: { email: string, code: string, password: string, displayName?: string }): Promise<LoginResult> {
    const response = await this.#call('/api/account/register', { method: 'POST', body: JSON.stringify(input) })
    return loginResult(await this.#json(response, '注册'))
  }

  async login(email: string, password: string): Promise<LoginResult> {
    const response = await this.#call('/api/account/login', { method: 'POST', body: JSON.stringify({ email, password }) })
    return loginResult(await this.#json(response, '登录'))
  }

  async me(token: string): Promise<{ account: AccountInfo, space: AccountSpace, spaces: AccountSpace[] }> {
    const response = await this.#call('/api/account/me', {}, token)
    const row = record(await this.#json(response, '读取账户'))
    return { account: account(row.account), space: space(row.space), spaces: Array.isArray(row.spaces) ? row.spaces.map(space) : [] }
  }

  async switchSpace(token: string, spaceId: string): Promise<LoginResult> {
    const response = await this.#call(`/api/account/spaces/${encodeURIComponent(spaceId)}/token`, { method: 'POST' }, token)
    return loginResult(await this.#json(response, '切换空间'))
  }

  async models(token: string): Promise<ManagedModel[]> {
    const response = await this.#call('/api/account/models', {}, token)
    const data = await this.#json(response, '读取模型目录')
    if (!Array.isArray(data)) throw new Error('账户服务返回了无效模型目录')
    return data.map(managedModel)
  }

  async wallet(token: string): Promise<Wallet> {
    const response = await this.#call('/api/account/wallet', {}, token)
    return wallet(await this.#json(response, '读取积分'))
  }

  async logout(token: string): Promise<boolean> {
    try {
      const response = await this.#call('/api/account/logout', { method: 'POST' }, token)
      return response.ok || response.status === 401
    } catch { return false }
  }
}
