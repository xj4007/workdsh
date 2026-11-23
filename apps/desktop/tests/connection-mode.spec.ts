import { describe, expect, it } from 'vitest'
import { connectionPartition, enterpriseConnection } from '../src/connection-mode.ts'

describe('Desktop connection boundary', () => {
  it('keeps personal browser storage unchanged and separates enterprise origins', () => {
    expect(connectionPartition({ mode: 'personal' })).toBeUndefined()
    const a = connectionPartition(enterpriseConnection('https://example.test/'))
    expect(a).not.toMatch(/^persist:/)
    expect(a).not.toBe(connectionPartition(enterpriseConnection('https://other.test/')))
    expect(a).toBe(connectionPartition(enterpriseConnection('https://example.test:443/')))
  })
  it('allows loopback development but refuses insecure remote portals', () => {
    expect(enterpriseConnection('http://127.0.0.1:19104/').portalOrigin).toBe('http://127.0.0.1:19104')
    expect(() => enterpriseConnection('http://example.test/')).toThrow()
    expect(() => enterpriseConnection('file:///etc/passwd')).toThrow()
    expect(() => enterpriseConnection('javascript:alert(1)')).toThrow()
  })
  it('refuses credentials, bootstrap tokens and deep links as portal configuration', () => {
    for (const value of ['https://user:password@example.test/', 'https://example.test/?token=secret', 'https://example.test/#token', 'https://example.test/conversation']) {
      expect(() => enterpriseConnection(value)).toThrow()
    }
  })
  it('isolates browser storage per account space and refuses a half-bound account', () => {
    const personal = { mode: 'personal' as const, accountId: 'acc-1', spaceId: 'space-1' }
    expect(connectionPartition(personal)).toMatch(/^workdsh-account-[0-9a-f]{64}$/)
    expect(connectionPartition(personal)).toBe(connectionPartition({ mode: 'personal', accountId: 'acc-1', spaceId: 'space-1' }))
    expect(connectionPartition(personal)).not.toBe(connectionPartition({ mode: 'personal', accountId: 'acc-2', spaceId: 'space-1' }))
    expect(connectionPartition(personal)).not.toBe(connectionPartition({ mode: 'personal', accountId: 'acc-1', spaceId: 'space-2' }))
    expect(connectionPartition({ mode: 'personal' })).toBeUndefined()
    expect(() => connectionPartition({ mode: 'personal', accountId: 'acc-1' })).toThrow('账户空间不完整')
    expect(() => connectionPartition({ mode: 'personal', spaceId: 'space-1' })).toThrow('账户空间不完整')
  })
  it('separates enterprise spaces by principal and organization', () => {
    const base = { mode: 'enterprise' as const, portalOrigin: 'https://company.test' }
    expect(connectionPartition(base)).toMatch(/^workdsh-enterprise-[0-9a-f]{64}$/)
    expect(connectionPartition(base)).toBe(connectionPartition({ mode: 'enterprise', portalOrigin: 'https://company.test/', organizationId: '', principalId: '' }))
    expect(connectionPartition(base)).not.toBe(connectionPartition({ mode: 'enterprise', portalOrigin: 'https://company.test', principalId: 'm2' }))
    expect(connectionPartition(base)).not.toBe(connectionPartition({ mode: 'enterprise', portalOrigin: 'https://company.test', organizationId: 'org2' }))
  })
})
