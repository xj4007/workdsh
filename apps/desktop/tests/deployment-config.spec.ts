import { expect, it } from 'vitest'
import { parseDeploymentConfig, serviceOrigin } from '../src/deployment-config.ts'
import { connectionEntryHtml } from '../src/connection-entry.ts'

it('accepts only an administrator service origin and normalizes it', () => {
  expect(parseDeploymentConfig({})).toEqual({})
  expect(parseDeploymentConfig({ enterprise: { backendUrl: 'https://company.test/' } })).toEqual({ enterprise: { backendUrl: 'https://company.test' } })
  expect(parseDeploymentConfig({ service: { origin: 'https://sanyun.test/' } })).toEqual({ service: { origin: 'https://sanyun.test' } })
  expect(parseDeploymentConfig({ service: { origin: 'http://127.0.0.1:19490' } })).toEqual({ service: { origin: 'http://127.0.0.1:19490' } })
  for (const config of [null, [], { apiKey: 'secret' }, { service: { origin: 'https://company.test', apiKey: 'secret' } }, { enterprise: { backendUrl: 'https://company.test', backendUrlExtra: 1 } }, { service: { origin: 'http://company.test' } }, { service: { origin: 'https://company.test/login?token=secret' } }]) {
    expect(() => parseDeploymentConfig(config)).toThrow()
  }
})

it('resolves the packaged service origin with explicit precedence and a production default', () => {
  const config = { service: { origin: 'https://beta.test' } }
  expect(serviceOrigin(config, { WORKDSH_SERVICE_ORIGIN: 'http://127.0.0.1:19500' })).toBe('http://127.0.0.1:19500')
  expect(serviceOrigin(config, {})).toBe('https://beta.test')
  expect(serviceOrigin({ enterprise: { backendUrl: 'https://legacy.test' } }, {})).toBe('https://legacy.test')
  expect(serviceOrigin({}, {})).toBe('https://sanyunbuddy.sycjlht.com')
})

it('shows a fixed service origin in the entry and no manual portal field', () => {
  const entry = connectionEntryHtml('https://company.test', true)
  expect(entry).toContain('<span>https://company.test</span>')
  expect(entry).not.toContain('name="portal"')
  expect(entry).not.toContain('填写企业地址')
})
