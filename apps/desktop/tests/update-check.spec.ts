import { expect, it } from 'vitest'
import { isNewerVersion, parseUpdateManifest } from '../src/update-check.ts'

it('orders release versions and rejects an unusable update manifest', () => {
  expect(isNewerVersion('3.0.0-alpha.5', '3.0.0-alpha.4')).toBe(true)
  expect(isNewerVersion('3.0.0-alpha.4', '3.0.0-alpha.5')).toBe(false)
  expect(isNewerVersion('3.0.0', '3.0.0-alpha.9')).toBe(true)
  expect(isNewerVersion('3.0.0-alpha.4', '3.0.0-alpha.4')).toBe(false)
  expect(isNewerVersion('3.0.0-alpha.4', '3.0.0')).toBe(false)
  expect(isNewerVersion('3.1.0-alpha.1', '3.0.9')).toBe(true)
  const manifest = parseUpdateManifest({ version: '3.0.0-alpha.5', url: 'https://sanyunbuddy.sycjlht.com/desktop/SanyunBuddy-3.0.0-alpha.5-x64-Setup.exe', sha256: 'x', size: 1, notes: '' })
  expect(manifest.version).toBe('3.0.0-alpha.5')
  expect(manifest.url).toBe('https://sanyunbuddy.sycjlht.com/desktop/SanyunBuddy-3.0.0-alpha.5-x64-Setup.exe')
  expect(() => parseUpdateManifest({ version: '3.0.0-alpha.5', url: 'http://sanyunbuddy.sycjlht.com/desktop/latest.json' })).toThrow('更新清单无效')
})
