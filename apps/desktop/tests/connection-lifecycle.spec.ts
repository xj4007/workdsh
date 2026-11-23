import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  loadGate: undefined as Promise<void> | undefined,
  windows: [] as any[],
  menu: [] as any[],
  handlers: {} as Record<string, (...args: any[]) => Promise<any>>,
  userData: '',
  clients: [] as string[],
  codeRequests: [] as string[],
  code: undefined as Record<string, unknown> | undefined,
  registers: [] as Record<string, unknown>[],
  logins: [] as { email: string, password: string }[],
  loginResult: undefined as unknown,
  loginError: undefined as Error | undefined,
  me: undefined as unknown,
  meCalls: 0,
  switchCalls: [] as { token: string, spaceId: string }[],
  switchResult: undefined as unknown,
  modelCalls: 0,
  models: [] as Array<{ id: string, displayName: string, priceVersion?: number, contextTokens?: number }>,
  wallet: undefined as Record<string, unknown> | undefined,
  walletError: false,
  logoutOk: true,
  logouts: 0,
  bridges: [] as any[],
  bridgeClose: vi.fn(async () => {}),
  fromSession: [] as Array<[string, string]>,
  verify: vi.fn(async () => {}),
  enterpriseLogout: vi.fn(async () => true),
  closed: vi.fn(async () => {}),
  stop: vi.fn(async () => {}),
}))

const account = { id: 'acc-1', email: 'a@test', displayName: 'A', platformRole: 'USER', emailVerified: true }
const personal = { id: 'space-1', accountId: 'acc-1', kind: 'PERSONAL', name: '个人空间', active: true }
const personalOnly = { token: 't'.repeat(43), account, space: personal, spaces: [personal] }
const enterpriseSpaceRow = { id: 'space-2', accountId: 'acc-1', kind: 'ENTERPRISE', name: '公司', organizationId: 'org-a', memberId: 'member-a', role: 'MEMBER', active: true }
const enterpriseOnly = { token: 'u'.repeat(43), account, space: enterpriseSpaceRow, spaces: [personal, enterpriseSpaceRow] }
const twoSpaces = { token: 't'.repeat(43), account, space: personal, spaces: [personal, enterpriseSpaceRow] }
const personalRestart = { token: 'v'.repeat(43), account, space: personal, spaces: [personal] }
const token = personalOnly.token
const actor = { id: 'member-a', organizationId: 'org-a', organizationName: 'Company', displayName: 'A', email: 'a@test', role: 'MEMBER' as const, mustChangePassword: false }
const catalogModel = { id: 'sanyun-buddy-chat', displayName: '三云 Buddy · ×1', priceVersion: 3, contextTokens: 128000 }
const zeroWallet = { spaceId: 'space-1', balanceUnits: 0, reservedUnits: 0, availableUnits: 0, balanceCredits: '0.000', availableCredits: '0.000', unit: 'credit', scale: 1000 }

vi.mock('../src/account-client.ts', () => ({
  AccountClient: class {
    constructor(origin: string) { state.clients.push(origin) }
    async requestCode(email: string) { state.codeRequests.push(email); return state.code ?? {} }
    async register(input: Record<string, unknown>) { state.registers.push(input); if (state.loginError) throw state.loginError; return state.loginResult }
    async login(email: string, password: string) { state.logins.push({ email, password }); if (state.loginError) throw state.loginError; return state.loginResult }
    async me() { state.meCalls += 1; return state.me ?? { account, space: personal, spaces: [personal] } }
    async switchSpace(token: string, spaceId: string) { state.switchCalls.push({ token, spaceId }); return state.switchResult ?? state.loginResult }
    async models() { state.modelCalls += 1; return state.models ?? [] }
    async wallet() { if (state.walletError) throw new Error('wallet unavailable'); return state.wallet ?? zeroWallet }
    async logout() { state.logouts += 1; return state.logoutOk }
  },
}))
vi.mock('../src/managed-bridge.ts', () => ({
  startManagedBridge: async (options: unknown) => {
    state.bridges.push(options)
    return { url: 'http://127.0.0.1:19887', key: 'k'.repeat(64), models: (options as any).models, close: state.bridgeClose }
  },
}))
vi.mock('../src/enterprise-auth.ts', () => ({
  EnterpriseLogin: { fromSession: async (origin: string, sessionToken: string) => { state.fromSession.push([origin, sessionToken]); return { backendUrl: origin, actor, verify: state.verify, logout: state.enterpriseLogout, cancelRequests() {} } } },
  startEnterpriseAuthority: async () => ({ url: 'http://127.0.0.1:19898', key: 'a'.repeat(64), close: state.closed }),
}))
vi.mock('../src/enterprise-plugins.ts', () => ({
  installedEnterprisePlugins: vi.fn(() => ['workdsh-provider-identity-enterprise', 'workdsh-plugin-enterprise-collaboration']),
  composeInstalledEnterprisePlugins: vi.fn(async () => ['workdsh-provider-identity-enterprise', 'workdsh-plugin-enterprise-collaboration']),
}))
vi.mock('../src/owned-process.ts', () => ({ trackOwnedProcess: vi.fn(), stopOwnedProcess: state.stop, cleanOwnedProcessTree: vi.fn(async () => {}) }))
vi.mock('node:child_process', () => ({ spawn: vi.fn() }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  class Window extends EventEmitter {
    destroyed = false; url = ''
    webContents = Object.assign(new EventEmitter(), {
      getURL: () => this.url, setWindowOpenHandler: vi.fn(),
      session: { closeAllConnections: vi.fn(async () => {}), clearStorageData: vi.fn(async () => {}), clearCache: vi.fn(async () => {}) },
    })
    constructor(readonly options: any) { super(); state.windows.push(this) }
    async loadURL(url: string) { this.url = url; if (url.startsWith('http://127.0.0.1:19999')) await state.loadGate }
    show() {} setTitle() {} isDestroyed() { return this.destroyed }
    destroy() { this.destroyed = true; this.emit('closed') }
  }
  return {
    BrowserWindow: Window,
    ipcMain: { handle: (name: string, fn: any) => { state.handlers[name] = fn } },
    app: Object.assign(new EventEmitter(), { setActivationPolicy: vi.fn(), setName: vi.fn(), setPath: vi.fn(), requestSingleInstanceLock: () => true, whenReady: async () => {}, quit: vi.fn(), relaunch: vi.fn(), exit: vi.fn(), getPath: (name: string) => name === 'appData' ? join(state.userData, '..') : state.userData, getAppPath: () => '/tmp/三云Buddy development/app', isPackaged: false, commandLine: { appendSwitch: vi.fn() } }),
    shell: { openExternal: vi.fn() }, dialog: { showErrorBox: vi.fn(), showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) },
    Menu: { buildFromTemplate: (menu: any[]) => { state.menu = menu; return menu }, setApplicationMenu: vi.fn() },
  }
})

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'workdsh-lifecycle-'))
  state.userData = join(root, 'WorkDSH')
  mkdirSync(join(root, 'resources')); mkdirSync(state.userData)
  writeFileSync(join(root, 'resources/workdsh-config.json'), JSON.stringify({ service: { origin: 'https://sanyun.test' } }))
  const source = join(root, 'bundle/profiles/workdsh'), legacyHome = join(root, 'legacy-home')
  for (const path of ['@deepseek-ai/dsh/lib', '@deepseek-ai/dsh-app-boot/lib', 'pnpm/bin']) mkdirSync(join(source, 'node_modules', path), { recursive: true })
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh/package.json'), JSON.stringify({ version: '0.2.0-rc.2' }))
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), '')
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh/lib/profile-boot.js'), '')
  writeFileSync(join(source, 'node_modules/@deepseek-ai/dsh-app-boot/lib/index.js'), '')
  writeFileSync(join(source, 'node_modules/pnpm/bin/pnpm.cjs'), '')
  writeFileSync(join(source, 'node_modules/pnpm/package.json'), JSON.stringify({ name: 'pnpm', version: '11.28.5' }))
  mkdirSync(join(root, 'dependencies/pnpm/bin'), { recursive: true })
  writeFileSync(join(root, 'dependencies/pnpm/bin/pnpm.cjs'), '')
  writeFileSync(join(root, 'dependencies/pnpm/package.json'), JSON.stringify({ name: 'pnpm', version: '11.28.5' }))
  writeFileSync(join(source, 'package.json'), JSON.stringify({ dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'workdsh-provider-identity-local'] } } }))
  writeFileSync(join(source, 'profile-installation.json'), readFileSync(join(source, 'package.json')))
  mkdirSync(legacyHome); writeFileSync(join(legacyHome, 'retained'), 'personal data')
  vi.stubEnv('WORKDSH_BUNDLED_PROFILE', source); vi.stubEnv('WORKDSH_DSH_HOME', legacyHome)
  vi.stubEnv('WORKDSH_NODE_EXECUTABLE', process.execPath); vi.stubEnv('WORKDSH_PRIMARY_RUNTIME', root)
  return root
}

function resetState(): void {
  state.windows.length = 0
  state.handlers = {}
  state.menu = []
  state.clients.length = 0
  state.codeRequests.length = 0
  state.code = undefined
  state.registers.length = 0
  state.logins.length = 0
  state.loginResult = undefined
  state.loginError = undefined
  state.me = undefined
  state.meCalls = 0
  state.switchCalls.length = 0
  state.switchResult = undefined
  state.modelCalls = 0
  state.models = []
  state.wallet = undefined
  state.walletError = false
  state.logoutOk = true
  state.logouts = 0
  state.bridges.length = 0
  state.bridgeClose = vi.fn(async () => {})
  state.fromSession.length = 0
  state.verify = vi.fn(async () => {})
  state.enterpriseLogout = vi.fn(async () => true)
  state.closed = vi.fn(async () => {})
  state.stop = vi.fn(async () => {})
}

const ready = (child: any): void => child.stdout.emit('data', Buffer.from('dsh web: http://127.0.0.1:19999/?token=local-token'))
const finish = async (): Promise<void> => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)) }

it('starts a personal account workspace, wires the managed bridge in Main, switches to the enterprise space and back to the entry', async () => {
  const root = fixture()
  const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  Object.defineProperty(process, 'resourcesPath', { value: join(root, 'resources'), configurable: true })
  resetState()
  const children: any[] = []
  try {
    vi.resetModules()
    await import('../src/workdsh-main.ts')
    const { app: startupApp } = await import('electron')
    expect(startupApp.setPath).toHaveBeenCalledWith('userData', state.userData)
    expect(startupApp.setName).toHaveBeenCalledWith('三云Buddy')
    if (process.platform === 'darwin') expect(startupApp.setActivationPolicy).toHaveBeenCalledWith('regular')
    else expect(startupApp.setActivationPolicy).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(state.windows).toHaveLength(1))
    const { spawn } = await import('node:child_process')
    vi.mocked(spawn).mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, signalCode: null, kill: vi.fn(() => { queueMicrotask(() => child.emit('exit', 0)); return true }) })
      children.push(child); return child as any
    })
    const entry = state.windows[0]
    expect(decodeURIComponent(entry.url)).toContain('<span>https://sanyun.test</span>')
    expect(entry.options.webPreferences.preload).toContain('connection-preload.cjs')
    expect(entry.options.webPreferences.partition).toBeUndefined()
    expect(await state.handlers['workdsh:account-login']!({ sender: {} }, { email: 'a@test', password: 'p'.repeat(12) })).toEqual({ error: '此页面不能发起账户操作' })
    state.loginResult = personalOnly
    state.models = [catalogModel]
    expect(await state.handlers['workdsh:account-login']!({ sender: entry.webContents }, { email: ' a@test ', password: 'p'.repeat(12) })).toEqual({})
    expect(state.logins).toEqual([{ email: 'a@test', password: 'p'.repeat(12) }])
    expect(state.clients).toEqual(['https://sanyun.test'])
    expect(state.modelCalls).toBe(1)
    const bridge = state.bridges[0]
    expect(bridge.origin).toBe('https://sanyun.test')
    expect(bridge.token).toBe(token)
    expect(bridge.models).toEqual([catalogModel])
    expect((await bridge.account()).wallet).toEqual({ availableCredits: '0.000', balanceCredits: '0.000' })
    state.wallet = { spaceId: 'space-1', balanceUnits: 5000, reservedUnits: 0, availableUnits: 5000, balanceCredits: '5.000', availableCredits: '5.000', unit: 'credit', scale: 1000 }
    expect((await bridge.refreshAccount()).wallet).toEqual({ availableCredits: '5.000', balanceCredits: '5.000' })
    state.walletError = true
    expect((await bridge.account()).wallet).toBeNull()
    state.walletError = false
    expect(spawn).toHaveBeenCalledOnce()
    const launch = vi.mocked(spawn).mock.calls[0]!
    const personalHome = launch[2]?.env?.DSH_HOME as string
    expect(personalHome).toContain(join(state.userData, 'accounts'))
    expect(launch[2]?.env?.DSH_AGENTS_HOME).toBe(join(personalHome, '..', 'agents'))
    expect(launch[2]?.env?.HOME).toBe(join(personalHome, '..', 'home'))
    expect(launch[2]?.env?.WORKDSH_MANAGED_PROVIDER_URL).toBe('http://127.0.0.1:19887')
    expect(launch[2]?.env?.WORKDSH_MANAGED_PROVIDER_KEY).toBe('k'.repeat(64))
    expect(JSON.parse(launch[2]?.env?.WORKDSH_MANAGED_PROVIDER_MODELS as string)).toEqual([{ id: 'sanyun-buddy-chat', name: '三云 Buddy · ×1', contextWindow: 128000 }])
    expect(JSON.stringify(launch[2]?.env)).not.toContain(token)
    expect(launch[1]).toEqual([join(personalHome, '.workdsh-host.mjs'), '--no-open'])
    expect(launch[2]?.cwd).toBe(join(personalHome, '..', 'workspace'))
    const commandContext = JSON.parse(readFileSync(join(state.userData, 'command-context.json'), 'utf8'))
    expect(commandContext.active).toMatchObject({ mode: 'personal', home: personalHome, label: 'A / 个人空间' })
    expect(commandContext.personalHome).toBe(join(root, 'legacy-home'))
    ready(children[0])
    await vi.waitFor(() => expect(state.windows).toHaveLength(2))
    const workspace = state.windows[1]
    expect(workspace.url).toContain('127.0.0.1:19999')
    expect(workspace.url).toContain('workdshAccountUrl=http%3A%2F%2F127.0.0.1%3A19887')
    expect(workspace.url).toContain(`workdshAccountKey=${'k'.repeat(64)}`)
    expect(workspace.url).not.toContain(token)
    expect(workspace.options.webPreferences.partition).toMatch(/^workdsh-account-[0-9a-f]{64}$/)
    expect(workspace.options.webPreferences.preload).toBeUndefined()
    expect(workspace.options.webPreferences.sandbox).toBe(true)
    expect(await state.handlers['workdsh:account-login']!({ sender: workspace.webContents }, { email: 'a@test', password: 'p'.repeat(12) })).toEqual({ error: '此页面不能发起账户操作' })
    state.switchResult = enterpriseOnly
    await bridge.switchSpace('space-2')
    expect(state.switchCalls).toEqual([{ token, spaceId: 'space-2' }])
    expect(state.fromSession).toEqual([['https://sanyun.test', 'u'.repeat(43)]])
    expect(state.stop).toHaveBeenCalledWith(children[0])
    expect(state.bridgeClose).toHaveBeenCalledTimes(1)
    expect(state.logouts).toBe(1)
    expect(spawn).toHaveBeenCalledTimes(2)
    const enterpriseLaunch = vi.mocked(spawn).mock.calls[1]!
    const enterpriseHome = enterpriseLaunch[2]?.env?.DSH_HOME as string
    expect(enterpriseHome).toContain(join(state.userData, 'enterprise'))
    expect(enterpriseLaunch[2]?.env?.HOME).toBe(join(enterpriseHome, '..', 'home'))
    expect(JSON.parse(enterpriseLaunch[2]?.env?.WORKDSH_MANAGED_PROVIDER_MODELS as string)).toEqual([])
    expect(JSON.stringify(enterpriseLaunch[2]?.env)).not.toContain(token)
    expect(enterpriseLaunch[2]?.cwd).toBe(join(enterpriseHome, '..', 'workspace'))
    expect(existsSync(join(enterpriseHome, 'enterprise-auth.json'))).toBe(true)
    const authFile = JSON.parse(readFileSync(join(enterpriseHome, 'enterprise-auth.json'), 'utf8'))
    expect(authFile).toMatchObject({ backendUrl: 'https://sanyun.test', principalId: 'member-a', authorityUrl: 'http://127.0.0.1:19898' })
    expect(readFileSync(join(enterpriseHome, '.workdsh-host.mjs'), 'utf8')).toContain('.enterprise-desktop.patch.yml')
    const manifest = JSON.parse(readFileSync(join(enterpriseHome, 'profiles/workdsh/package.json'), 'utf8'))
    expect(manifest.dsh.profile.bundles).toContain('workdsh-provider-identity-enterprise')
    expect(manifest.dsh.profile.bundles).toContain('workdsh-plugin-enterprise-collaboration')
    expect(manifest.dsh.profile.bundles).not.toContain('workdsh-provider-identity-local')
    ready(children[1])
    await vi.waitFor(() => expect(state.windows).toHaveLength(3))
    const enterpriseWorkspace = state.windows[2]
    expect(enterpriseWorkspace.options.webPreferences.partition).toMatch(/^workdsh-enterprise-[0-9a-f]{64}$/)
    expect(await state.handlers['workdsh:account-login']!({ sender: enterpriseWorkspace.webContents }, { email: 'a@test', password: 'p'.repeat(12) })).toEqual({ error: '此页面不能发起账户操作' })
    state.logoutOk = false
    const { dialog } = await import('electron')
    state.menu.find(item => item.label === '账户')!.submenu[0].click()
    await vi.waitFor(() => expect(state.windows).toHaveLength(4))
    expect(state.stop).toHaveBeenCalledWith(children[1])
    expect(state.bridgeClose).toHaveBeenCalledTimes(2)
    expect(state.closed).toHaveBeenCalledTimes(1)
    expect(state.enterpriseLogout).toHaveBeenCalledTimes(1)
    expect(state.logouts).toBe(2)
    expect(dialog.showErrorBox).toHaveBeenCalledWith('本机已退出', expect.stringContaining('远端撤销尚未确认'))
    expect(existsSync(join(enterpriseHome, 'enterprise-auth.json'))).toBe(false)
    const entryAgain = state.windows[3]
    expect(entryAgain.url).toMatch(/^data:text\/html/)
    expect(decodeURIComponent(entryAgain.url)).toContain('登录 三云Buddy')
    expect(existsSync(join(root, 'legacy-home', 'profiles'))).toBe(false)
    expect(readFileSync(join(root, 'legacy-home', 'retained'), 'utf8')).toBe('personal data')
    expect(JSON.parse(readFileSync(join(state.userData, 'command-context.json'), 'utf8')).personalHome).toBe(join(root, 'legacy-home'))
  } finally {
    try {
      state.menu.find(item => item.label === '账户')?.submenu[0].click()
      for (const child of children) child.emit('exit', 0)
      await finish()
    } catch { /* cleanup best effort */ }
    if (resourcesDescriptor) Object.defineProperty(process, 'resourcesPath', resourcesDescriptor)
    else Reflect.deleteProperty(process, 'resourcesPath')
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  }
})

it('registers through an email code, picks one of several spaces and reports a failed login', async () => {
  const root = fixture()
  const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
  Object.defineProperty(process, 'resourcesPath', { value: join(root, 'resources'), configurable: true })
  resetState()
  const children: any[] = []
  try {
    vi.resetModules()
    await import('../src/workdsh-main.ts')
    await vi.waitFor(() => expect(state.windows).toHaveLength(1))
    const { spawn } = await import('node:child_process')
    vi.mocked(spawn).mockImplementation(() => {
      const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), exitCode: null, signalCode: null, kill: vi.fn(() => { queueMicrotask(() => child.emit('exit', 0)); return true }) })
      children.push(child); return child as any
    })
    vi.mocked(spawn).mockClear()
    const entry = state.windows[0]
    state.code = { expiresAt: '2026-01-01T00:00:00.000Z', code: '123456' }
    expect(await state.handlers['workdsh:account-request-code']!({ sender: entry.webContents }, { email: ' a@test ' })).toEqual({ expiresAt: '2026-01-01T00:00:00.000Z', code: '123456' })
    expect(state.codeRequests).toEqual(['a@test'])
    state.loginResult = twoSpaces
    expect(await state.handlers['workdsh:account-register']!({ sender: entry.webContents }, { email: 'a@test', code: ' 123456 ', password: 'p'.repeat(12), displayName: '  ' })).toEqual({})
    expect(state.registers[0]).toEqual({ email: 'a@test', code: '123456', password: 'p'.repeat(12) })
    await vi.waitFor(() => expect(state.windows).toHaveLength(2))
    const picker = state.windows[1]
    expect(decodeURIComponent(picker.url)).toContain('选择空间')
    expect(decodeURIComponent(picker.url)).toContain('个人空间')
    expect(decodeURIComponent(picker.url)).toContain('企业空间')
    state.loginError = new Error('账号或密码不正确')
    expect(await state.handlers['workdsh:account-login']!({ sender: picker.webContents }, { email: 'a@test', password: 'bad' })).toEqual({ error: '账号或密码不正确' })
    state.loginError = undefined
    await vi.waitFor(() => expect(state.windows).toHaveLength(3))
    const entryAgain = state.windows[2]
    state.switchResult = personalRestart
    expect(await state.handlers['workdsh:account-space']!({ sender: entryAgain.webContents }, { spaceId: 'space-1' })).toEqual({})
    expect(state.switchCalls).toEqual([{ token, spaceId: 'space-1' }])
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce())
    const launch = vi.mocked(spawn).mock.calls[0]!
    const home = launch[2]?.env?.DSH_HOME as string
    expect(home).toContain(join(state.userData, 'accounts'))
    expect(launch[2]?.env?.WORKDSH_MANAGED_PROVIDER_URL).toBe('http://127.0.0.1:19887')
    expect(JSON.stringify(launch[2]?.env)).not.toContain('v'.repeat(43))
    ready(children[0])
    await vi.waitFor(() => expect(state.windows).toHaveLength(4))
    expect(state.windows[3].options.webPreferences.partition).toMatch(/^workdsh-account-[0-9a-f]{64}$/)
  } finally {
    try {
      for (const child of children) child.emit('exit', 0)
      await finish()
    } catch { /* cleanup best effort */ }
    if (resourcesDescriptor) Object.defineProperty(process, 'resourcesPath', resourcesDescriptor)
    else Reflect.deleteProperty(process, 'resourcesPath')
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  }
})
