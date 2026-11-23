import { expect, it } from 'vitest'
import { connectionEntryHtml, connectionLoadingHtml, spacePickerHtml } from '../src/connection-entry.ts'

it('renders an account-only entry with a fixed service origin and no anonymous or manual-portal bypass', () => {
  const html = connectionEntryHtml('https://company.test', true)
  expect(html).toContain('登录 三云Buddy')
  expect(html).toContain('<span>https://company.test</span>')
  expect(html).not.toContain('个人直接使用')
  expect(html).not.toContain('填写企业地址')
  expect(html).not.toContain('workdsh://')
  expect(html).not.toContain('name="portal"')
  expect(html).toContain('id="account-login"')
  expect(html).toContain('id="account-register"')
  expect(html).toContain('id="request-code"')
  expect(html).toContain('minlength="12"')
  expect(html).toContain('aria-live="polite"')
  expect(html).toContain('prefers-color-scheme:dark')
  expect(html).toContain("default-src 'none'")
})

it('hides registration entirely when the service disables it', () => {
  const html = connectionEntryHtml('https://company.test', false)
  expect(html).not.toContain('id="account-register"')
  expect(html).not.toContain('id="request-code"')
  expect(html).toContain('id="account-login"')
})

it('escapes hostile origin and text values', () => {
  const html = connectionEntryHtml('"><script>attack()</script>')
  expect(html).not.toContain('<script>attack()')
  expect(html).toContain('&quot;&gt;&lt;script&gt;attack()&lt;/script&gt;')
  const picker = spacePickerHtml('<script>x()</script>', [{ id: '" onmouseover="x()', name: '<b>N</b>', kind: 'PERSONAL' }])
  expect(picker).not.toContain('<script>x()')
  expect(picker).not.toContain('<b>N</b>')
  expect(picker).toContain('data-space-id="&quot; onmouseover=&quot;x()"')
})

it('labels enterprise and personal spaces in the picker', () => {
  const html = spacePickerHtml('A', [{ id: 'p', name: '我的空间', kind: 'PERSONAL' }, { id: 'e', name: '公司', kind: 'ENTERPRISE' }])
  expect(html).toContain('选择空间')
  expect(html).toContain('个人空间')
  expect(html).toContain('企业空间')
})

it('shows an accessible loading state with reduced-motion support and escaped text', () => {
  const html = connectionLoadingHtml('<script>unsafe()</script>')
  expect(html).toContain('role="status"')
  expect(html).toContain('aria-busy="true"')
  expect(html).toContain('prefers-reduced-motion')
  expect(html).not.toContain('<script>unsafe()')
  expect(html).not.toContain('<form')
})
