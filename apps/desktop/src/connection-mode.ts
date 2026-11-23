import { createHash } from 'node:crypto'

export type DesktopConnection =
  | { mode: 'personal', accountId?: string, spaceId?: string }
  | { mode: 'enterprise', portalOrigin: string, organizationId?: string, principalId?: string }

/** Backend configuration is independent of the local official Host address. */
export function enterpriseConnection(value: string): DesktopConnection & { mode: 'enterprise' } {
  const url = new URL(value)
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('企业地址必须使用 HTTPS；仅本机测试允许 HTTP')
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('请输入企业后台地址，不包含账号、令牌或页面路径')
  }
  return { mode: 'enterprise', portalOrigin: url.origin }
}

/** Account browser state is separate for every account and space; the legacy personal profile stays unbound. */
export function connectionPartition(connection: DesktopConnection): string | undefined {
  if (connection.mode === 'enterprise') {
    const origin = enterpriseConnection(connection.portalOrigin).portalOrigin
    return `workdsh-enterprise-${enterpriseNamespace(origin, connection.organizationId ?? '', connection.principalId ?? '')}`
  }
  if (!connection.accountId && !connection.spaceId) return undefined
  if (!connection.accountId || !connection.spaceId) throw new Error('账户空间不完整')
  return `workdsh-account-${accountNamespace(connection.accountId, connection.spaceId)}`
}

export function enterpriseNamespace(origin: string, organizationId: string, principalId: string): string {
  return createHash('sha256').update(JSON.stringify([enterpriseConnection(origin).portalOrigin, organizationId, principalId])).digest('hex')
}

/** Stable directory/partition name for one account space; no service origin or token is persisted in it. */
export function accountNamespace(accountId: string, spaceId: string): string {
  return createHash('sha256').update(JSON.stringify([accountId, spaceId])).digest('hex')
}
