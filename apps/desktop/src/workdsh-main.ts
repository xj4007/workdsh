import {composeInstalledEnterprisePlugins,installedEnterprisePlugins} from './enterprise-plugins.ts'
/** Minimal Electron carrier for the bundled 三云Buddy release profile. */

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AccountClient, type AccountInfo, type AccountSpace, type LoginResult } from './account-client.ts'
import { connectionEntryHtml, spacePickerHtml, connectionLoadingHtml } from './connection-entry.ts'
import { connectionPartition, type DesktopConnection } from './connection-mode.ts'
import { parseDeploymentConfig, serviceOrigin as resolveServiceOrigin } from './deployment-config.ts'
import { EnterpriseLogin, startEnterpriseAuthority, type Authority } from './enterprise-auth.ts'
import { personalSpace, desktopEnterprisePatch, enterpriseEnvironment, enterpriseSpace, materializeRuntimeProfile, markProfileUpdated, officialLauncher, officialHostLauncher } from './local-runtime.ts'
import { startManagedBridge, type AccountSummary, type ManagedBridge } from './managed-bridge.ts'
import { manageCommand } from './command-management.ts'
import { createRuntimeOutputRedactor, redactRuntimeOutput, runtimeFailureDetail, runtimeFailureLog } from './runtime-diagnostics.ts'
import { cleanOwnedProcessTree, stopOwnedProcess, trackOwnedProcess } from './owned-process.ts'
import { prepareRuntimePort, runtimePortConflict } from './runtime-port.ts'
import { runOfficialCommand } from './official-command.ts'

const PROFILE_NAME = 'workdsh'
const READY_PATTERN = /dsh web:\s+(http:\/\/127\.0\.0\.1:\d+\/?\?token=[^\s]+)/u

type ActiveAccount = {
  client: AccountClient
  token: string
  account: AccountInfo
  space: AccountSpace
  spaces: AccountSpace[]
  root?: string
  home?: string
}

let runtime: ChildProcess | undefined
let runtimeStarting = false
let window: BrowserWindow | undefined
let quitting = false
let switching = false
let quitRequested = false
let returnRequested = false
let installer: ChildProcess | undefined
const enterpriseWindows = new Set<BrowserWindow>()
let accountOrigin = 'https://sanyunbuddy.sycjlht.com'
let accountSession: ActiveAccount | undefined
let accountBridge: ManagedBridge | undefined
let pendingLogin: { client: AccountClient, result: LoginResult } | undefined
let entrySurface = false
let enterprise: { login: EnterpriseLogin, root: string, home: string, deviceId: string, authority?: Authority, authFile?: string } | undefined
let verifyTimer: ReturnType<typeof setInterval> | undefined
let verifying = false

function bundledProfileDirectory(): string {
  const overridden = process.env.WORKDSH_BUNDLED_PROFILE
  if (overridden !== undefined && overridden.length > 0) return overridden
  return join(process.resourcesPath, 'workdsh-runtime', 'profiles', PROFILE_NAME)
}

function runtimeHome(): string {
  const overridden = process.env.WORKDSH_DSH_HOME
  if (overridden !== undefined && overridden.length > 0) return overridden
  return join(app.getPath('userData'), 'dsh-home')
}

function bundledNodeExecutable(): string {
  const overridden = process.env.WORKDSH_NODE_EXECUTABLE
  if (overridden !== undefined && overridden.length > 0) return overridden
  return join(
    bundledPrimaryRuntime(),
    'dependencies',
    'node',
    'bin',
    process.platform === 'win32' ? 'node.exe' : 'node',
  )
}

function bundledPrimaryRuntime(): string {
  const overridden = process.env.WORKDSH_PRIMARY_RUNTIME
  if (overridden !== undefined && overridden.length > 0) return overridden
  return join(process.resourcesPath, 'workdsh-runtime', 'primary-runtime')
}

function browserWorkerRequest(): { port: number, profile: string } | undefined {
  const portArg = process.argv.find(arg => arg.startsWith('--workdsh-browser-worker-port='))
  if (portArg === undefined) return undefined
  const port = Number(portArg.slice('--workdsh-browser-worker-port='.length))
  const profile = process.argv.find(arg => arg.startsWith('--workdsh-browser-worker-profile='))
    ?.slice('--workdsh-browser-worker-profile='.length)
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !profile || !isAbsolute(profile) || !existsSync(profile)) {
    throw new Error('Invalid 三云Buddy browser worker arguments')
  }
  return { port, profile }
}

function startBrowserWorker(request: { port: number, profile: string }): void {
  // Set this before Electron becomes ready: hiding the Dock afterwards briefly
  // registers every task's browser worker as another foreground application.
  // Accessory permits the hidden browser window without a Dock icon or menu bar.
  if (process.platform === 'darwin') app.setActivationPolicy('accessory')
  app.setPath('userData', request.profile)
  app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1')
  app.commandLine.appendSwitch('remote-debugging-port', String(request.port))
  void app.whenReady().then(async () => {
    const page = new BrowserWindow({
      show: false,
      width: 1280,
      height: 800,
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
      },
    })
    page.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    await page.loadURL('about:blank')
    process.stdout.write('WORKDSH_BROWSER_WORKER_READY\n')
  }).catch(error => {
    process.stderr.write(`三云Buddy browser worker failed: ${String(error)}\n`)
    app.exit(1)
  })
}

function accountBridgeUrl(url: string): string {
  if (!accountBridge) return url
  const query = new URLSearchParams({ workdshAccountUrl: accountBridge.url, workdshAccountKey: accountBridge.key })
  return `${url}${url.includes('?') ? '&' : '?'}${query.toString()}`
}

function openWindow(url: string, connection: DesktopConnection = { mode: 'personal' }, carrier = false): void {
  const previous = window
  const previousEntrySurface = entrySurface
  const icon = fileURLToPath(new URL('../build/app-icon.png', import.meta.url))
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    ...(previous && typeof previous.getBounds === 'function' ? previous.getBounds() : {}),
    minWidth: 960,
    minHeight: 640,
    title: '三云Buddy',
    icon,
    backgroundColor: '#111113',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(carrier ? { preload: fileURLToPath(new URL('./connection-preload.cjs', import.meta.url)) } : {}),
      ...(connectionPartition(connection) === undefined ? {} : { partition: connectionPartition(connection)! }),
    },
  })
  const page = window
  entrySurface = carrier
  window.on('page-title-updated', event => {
    event.preventDefault()
    page.setTitle('三云Buddy')
  })
  if (connection.mode === 'enterprise') enterpriseWindows.add(page)
  window.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith('https://') || target.startsWith('http://')) void shell.openExternal(target)
    return { action: 'deny' }
  })
  if (!carrier) {
    const origin = new URL(url).origin
    page.webContents.on('will-navigate', (event, target) => {
      if (target === 'workdsh://entry' && window === page && !switching) {
        event.preventDefault()
        void returnToEntry()
        return
      }
      try { if (new URL(target).origin === origin) return } catch { /* invalid navigation is refused */ }
      event.preventDefault()
    })
  }
  void page.loadURL(accountBridgeUrl(url)).then(() => {
    if (page.isDestroyed()) return
    page.show()
    if (previous && !previous.isDestroyed()) previous.destroy()
  }).catch(() => {
    if (!page.isDestroyed()) page.destroy()
    if (previous && !previous.isDestroyed()) { window = previous; entrySurface = previousEntrySurface }
    dialog.showErrorBox('无法打开工作区', '请检查服务地址、网络或本地运行状态。')
    if (runtime) void returnToEntry()
  })
  page.on('closed', () => { enterpriseWindows.delete(page); if (window === page) window = undefined })
}

/** Personal account spaces and enterprise spaces both receive an isolated home, environment and credential store. */
function isolationRoot(): string | undefined {
  return enterprise?.root ?? accountSession?.root
}

function runtimeEnvironment(home: string): NodeJS.ProcessEnv {
  const root = isolationRoot()
  return {
    ...(root ? enterpriseEnvironment(root, bundledNodeExecutable(), process.env) : process.env),
    DSH_HOME: home,
    DSH_AGENTS_HOME: root ? join(root, 'agents') : join(home, 'agents'),
    DSH_BUNDLED_PRIMARY_RUNTIME: bundledPrimaryRuntime(),
    DSH_ELECTRON_EXECUTABLE: process.execPath,
    WORKDSH_ELECTRON_APP: app.isPackaged ? undefined : app.getAppPath(),
    ELECTRON_RUN_AS_NODE: undefined,
    ...(accountBridge ? {
      WORKDSH_MANAGED_PROVIDER_URL: accountBridge.url,
      WORKDSH_MANAGED_PROVIDER_KEY: accountBridge.key,
      WORKDSH_MANAGED_PROVIDER_MODELS: JSON.stringify(accountBridge.models.map(model => ({
        id: model.id,
        name: model.displayName,
        ...(model.contextTokens === undefined ? {} : { contextWindow: model.contextTokens }),
      }))),
    } : {}),
  }
}

async function officialCommand(home: string, args: string[], timeoutMs = 240_000): Promise<void> {
  const executable = bundledNodeExecutable()
  const launcher = officialLauncher(bundledProfileDirectory(), home, executable, join(bundledPrimaryRuntime(), 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'))
  await runOfficialCommand({ executable, launcher, args, home, env: runtimeEnvironment(home), timeoutMs,
    logDirectory: join(app.getPath('userData'), 'logs'), cancelled: () => quitRequested,
    onProcess: child => { installer = child },
  })
}

async function prepareProfile(home: string): Promise<{ profile: string, existingHome: boolean }> {
  // Capture this before materialization creates the new Home's Profile files.
  const existingHome = [join(home, 'profiles', PROFILE_NAME, 'package.json'), join(home, 'profiles', PROFILE_NAME, 'cordis.yml'), join(home, 'cordis.yml'), join(home, '.workdsh-host.mjs')].some(existsSync)
  const source = bundledProfileDirectory()
  const result = materializeRuntimeProfile(source, home)
  if (result.changed) {
    const entry = window
    if (entry && !entry.isDestroyed()) await entry.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(connectionLoadingHtml('正在更新工作区插件依赖')))
    await officialCommand(home, ['plugin', '--profile', PROFILE_NAME, 'install'])
    markProfileUpdated(source, result.profile)
    if (entry && !entry.isDestroyed()) await entry.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(connectionLoadingHtml(enterprise ? '正在启动企业工作区' : '正在启动个人工作区')))
  }
  officialLauncher(source, home, bundledNodeExecutable(), join(bundledPrimaryRuntime(), 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'))
  return { profile: result.profile, existingHome }
}

function rememberCommandSpace(home?: string): void {
  const label = enterprise ? `${enterprise.login.actor.organizationName ?? '企业'} / ${enterprise.login.actor.displayName}` : accountSession ? `${accountSession.account.displayName} / ${accountSession.space.name}` : '个人工作区'
  const root = enterprise?.root ?? accountSession?.root
  const active = home ? { mode: enterprise ? 'enterprise' : 'personal', home, ...(root ? { root } : {}), label } : undefined
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(join(app.getPath('userData'), 'command-context.json'), JSON.stringify({ personalHome: runtimeHome(), active }), { mode: 0o600 })
}

async function startRuntime(home: string, connection: DesktopConnection, patches: string[] = [], existingHome = false): Promise<void> {
  rememberCommandSpace(home)
  if (quitRequested) throw new Error('启动已取消')
  const executable = bundledNodeExecutable()
  if (!existsSync(executable)) throw new Error(`Bundled Node.js runtime is missing: ${executable}`)
  const basePatch = join(bundledProfileDirectory(), 'cordis.patch.yml')
  const port = await prepareRuntimePort(home, [join(home, 'profiles', PROFILE_NAME, 'cordis.yml'), join(home, 'profiles', PROFILE_NAME, 'cordis.patch.yml'), join(home, 'cordis.yml'), join(home, 'cordis.patch.yml'), ...patches], { existingHome })
  if (quitRequested) throw new Error('启动已取消')
  const layers = [...(existsSync(basePatch) ? [basePatch] : []), ...patches, ...(port.managed ? [port.patch] : [])]
  const launcher = officialHostLauncher(bundledProfileDirectory(), home, executable, join(bundledPrimaryRuntime(), 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'), layers)
  const startedAt = Date.now()
  const child = spawn(executable, [launcher, '--no-open'], {
    env: runtimeEnvironment(home),
    cwd: isolationRoot() ? join(isolationRoot()!, 'workspace') : home,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  trackOwnedProcess(child, startedAt)
  runtime = child
  runtimeStarting = true
  let ready = false
  let output = ''
  let diagnosticOutput = ''
  const recordOutput = (safe: string): void => {
    diagnosticOutput = `${diagnosticOutput}${safe}`.slice(-16_384)
    process.stderr.write(safe)
  }
  const stdoutRedactor = createRuntimeOutputRedactor(recordOutput)
  const stderrRedactor = createRuntimeOutputRedactor(recordOutput)
  const consume = (chunk: Buffer): void => {
    const text = chunk.toString('utf8')
    stdoutRedactor.push(chunk)
    if (ready || switching || runtime !== child) return
    output = `${output}${text}`.slice(-16_384)
    const match = READY_PATTERN.exec(output)
    if (match?.[1] !== undefined) {
      ready = true
      runtimeStarting = false
      openWindow(match[1], connection)
    }
  }
  const failureDetail = (code: number | null, cleanupFailed = false): string => {
    const detail = [!ready ? runtimePortConflict(port, diagnosticOutput) : undefined, runtimeFailureDetail(ready, code, diagnosticOutput, cleanupFailed)].filter(Boolean).join('\n\n')
    try {
      const directory = join(app.getPath('userData'), 'logs')
      mkdirSync(directory, { recursive: true })
      const path = join(directory, 'runtime-failure.log')
      writeFileSync(path, runtimeFailureLog(ready, code, diagnosticOutput, cleanupFailed), { mode: 0o600 })
      return `${detail}\n\n错误记录：${path}`
    } catch { return detail }
  }
  child.stdout.on('data', consume)
  child.stdout.once('end', () => stdoutRedactor.end())
  child.stderr.on('data', chunk => stderrRedactor.push(chunk))
  child.stderr.once('end', () => stderrRedactor.end())
  child.once('error', cause => {
    if (!quitting && runtime === child) { dialog.showErrorBox('启动失败', redactRuntimeOutput(cause.message)); void returnToEntry() }
  })
  child.once('exit', code => {
    if (runtime !== child) return
    void cleanOwnedProcessTree(child).then(() => {
      if (runtime === child) { runtime = undefined; runtimeStarting = false }
      if (!quitting && !switching) {
        dialog.showErrorBox('本机运行已停止', failureDetail(code))
        void returnToEntry()
      }
    }).catch(() => {
      runtimeStarting = false
      dialog.showErrorBox('本机运行失败，进程清理未确认', failureDetail(code, true))
    })
  })
  const readyTimeout = setTimeout(() => { if (!ready && runtime === child) { dialog.showErrorBox('启动超时', '官方 DSH 尚未就绪，已停止本机进程'); void returnToEntry() } }, 90_000)
  child.once('exit', () => clearTimeout(readyTimeout))
}

function stopRuntime(): void {
  quitting = true
  if (runtime !== undefined) void cleanOwnedProcessTree(runtime)
  runtime = undefined
  runtimeStarting = false
}

async function leaveWorkspace(): Promise<void> {
  const page = window
  if (verifyTimer) { clearInterval(verifyTimer); verifyTimer = undefined }
  const session = enterprise
  const account = accountSession
  const bridge = accountBridge
  accountBridge = undefined
  // Stop the Host's capability before waiting for any graceful process exit.
  await bridge?.close()
  await session?.authority?.close()
  session?.login.cancelRequests()
  const child = runtime
  if (child) { await stopOwnedProcess(child); if (runtime === child) { runtime = undefined; runtimeStarting = false } }
  enterprise = undefined
  accountSession = undefined
  pendingLogin = undefined
  rememberCommandSpace()
  if (session) {
    if (session.authFile) rmSync(session.authFile, { force: true })
    const revoked = await session.login.logout()
    if (!revoked) dialog.showErrorBox('本机已退出', '本机企业运行和登录已停止；后台连接失败，远端撤销尚未确认。')
  }
  if (account) {
    const revoked = await account.client.logout(account.token)
    if (!revoked) dialog.showErrorBox('本机已退出', '本机账户登录已停止；后台连接失败，远端撤销尚未确认。')
  }
  const pages = new Set<BrowserWindow>()
  if (page && !page.isDestroyed()) pages.add(page)
  for (const enterprisePage of enterpriseWindows) if (!enterprisePage.isDestroyed()) pages.add(enterprisePage)
  for (const item of pages) {
    await item.webContents.session.closeAllConnections()
    await item.webContents.session.clearStorageData()
    await item.webContents.session.clearCache()
    if (!item.isDestroyed()) item.destroy()
  }
  enterpriseWindows.clear()
  if (page && !page.isDestroyed()) page.destroy()
  entrySurface = false
}

async function returnToEntry(): Promise<void> {
  if (quitting) return
  if (switching) { returnRequested = true; return }
  switching = true
  try { await leaveWorkspace(); showConnectionEntry() }
  catch (error) { dialog.showErrorBox('暂时无法切换', error instanceof Error ? error.message : '请稍后重试') }
  finally { endSwitch() }
}

function endSwitch(): void {
  switching = false
  if (quitRequested) app.quit()
  else if (returnRequested) { returnRequested = false; void returnToEntry() }
}

function showConnectionEntry(): void {
  openWindow('data:text/html;charset=utf-8,' + encodeURIComponent(connectionEntryHtml(accountOrigin)), { mode: 'personal' }, true)
}

function summaryOf(session: ActiveAccount, wallet: AccountSummary['wallet']): AccountSummary {
  return {
    account: { displayName: session.account.displayName, email: session.account.email },
    space: { id: session.space.id, name: session.space.name, kind: session.space.kind },
    spaces: session.spaces.map(space => ({ id: space.id, name: space.name, kind: space.kind })),
    wallet,
  }
}

async function accountSummary(): Promise<AccountSummary> {
  const session = accountSession
  if (!session) throw new Error('尚未登录')
  let value: AccountSummary['wallet'] = null
  try {
    const wallet = await session.client.wallet(session.token)
    value = { availableCredits: wallet.availableCredits, balanceCredits: wallet.balanceCredits }
  } catch { /* the sidebar shows 暂不可用; it never invents a zero balance */ }
  return summaryOf(session, value)
}

async function refreshAccount(): Promise<AccountSummary> {
  const session = accountSession
  if (!session) throw new Error('尚未登录')
  const me = await session.client.me(session.token)
  session.account = me.account
  session.space = me.space
  if (me.spaces.length > 0) session.spaces = me.spaces
  return accountSummary()
}

async function switchAccountSpace(spaceId: string): Promise<void> {
  const session = accountSession
  if (!session) throw new Error('尚未登录')
  if (spaceId === session.space.id) return
  // Issue the target token first so the old session can still authorize the switch.
  const next = await session.client.switchSpace(session.token, spaceId)
  if (switching) throw new Error('正在切换，请稍候')
  switching = true
  try {
    await leaveWorkspace()
    await launchAccount({ client: session.client, result: next })
  } catch (error) {
    await session.client.logout(next.token)
    showConnectionEntry()
    throw error
  } finally { endSwitch() }
}

function makeActive(client: AccountClient, result: LoginResult): ActiveAccount {
  return { client, token: result.token, account: result.account, space: result.space, spaces: result.spaces }
}

async function launchAccount(input: { client: AccountClient, result: LoginResult }): Promise<void> {
  const session = makeActive(input.client, input.result)
  accountSession = session
  if (session.space.kind === 'ENTERPRISE') {
    await launchEnterpriseSpace(session)
    return
  }
  const space = personalSpace(app.getPath('userData'), session.account.id, session.space.id)
  session.root = space.root
  session.home = space.home
  const prepared = await prepareProfile(space.home)
  const models = await session.client.models(session.token).catch(() => [])
  accountBridge = await startManagedBridge({
    origin: accountOrigin, token: session.token, models,
    account: accountSummary, refreshAccount, switchSpace: switchAccountSpace,
    logout: () => { void returnToEntry() },
  })
  await startRuntime(space.home, { mode: 'personal', accountId: session.account.id, spaceId: session.space.id }, [], prepared.existingHome)
}

async function launchEnterpriseSpace(session: ActiveAccount): Promise<void> {
  const login = await EnterpriseLogin.fromSession(accountOrigin, session.token)
  const space = enterpriseSpace(app.getPath('userData'), accountOrigin, login.actor)
  session.root = space.root
  session.home = space.home
  enterprise = { login, ...space }
  const prepared = await prepareProfile(space.home)
  accountBridge = await startManagedBridge({
    origin: accountOrigin, token: session.token, models: [],
    account: accountSummary, refreshAccount, switchSpace: switchAccountSpace,
    logout: () => { void returnToEntry() },
  })
  await activateEnterprise(prepared.existingHome)
}

async function enterAccount(input: { client: AccountClient, result: LoginResult }): Promise<void> {
  pendingLogin = undefined
  await launchAccount(input)
}

async function chooseAccount(result: LoginResult, client: AccountClient): Promise<void> {
  if (result.spaces.length <= 1) { await enterAccount({ client, result }); return }
  openWindow('data:text/html;charset=utf-8,' + encodeURIComponent(spacePickerHtml(result.account.displayName, result.spaces)), { mode: 'personal' }, true)
  pendingLogin = { client, result }
}

async function activateEnterprise(existingHome: boolean): Promise<void> {
  const session = enterprise
  if (!session) throw new Error('请重新登录企业账号')
  await session.login.verify()
  if (quitRequested) throw new Error('启动已取消')
  const pluginNames = await composeInstalledEnterprisePlugins(join(runtimeHome(), 'profiles', PROFILE_NAME), join(session.home, 'profiles', PROFILE_NAME), JSON.parse(readFileSync(join(bundledProfileDirectory(), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version, bundledNodeExecutable(), join(bundledPrimaryRuntime(), 'dependencies', 'pnpm', 'bin', 'pnpm.cjs'))
  if (quitRequested || enterprise !== session) throw new Error('企业启动已取消')
  const manifest = join(session.home, 'profiles', PROFILE_NAME, 'package.json')
  const selected = JSON.parse(readFileSync(manifest, 'utf8')) as { dsh?: { profile?: { bundles?: string[] } } }
  selected.dsh ??= {}; selected.dsh.profile ??= {}; selected.dsh.profile.bundles ??= []
  const bundles = selected.dsh.profile.bundles
  // Disable personal identity at composition, rather than allow an identity fallback.
  selected.dsh.profile.bundles = bundles.filter(name => name !== 'workdsh-provider-identity-local')
  for (const name of pluginNames) {
    if (!selected.dsh.profile.bundles.includes(name)) selected.dsh.profile.bundles.push(name)
  }
  writeFileSync(manifest, JSON.stringify(selected, null, 2) + '\n', { mode: 0o600 })
  session.authority = await startEnterpriseAuthority(session.login, session.deviceId, () => { void returnToEntry() }, () => { void returnToEntry() })
  session.authFile = join(session.home, 'enterprise-auth.json')
  const patch = desktopEnterprisePatch(session.home, session.authority, session.login.actor, session.login.backendUrl, session.deviceId, pluginNames.includes('workdsh-plugin-enterprise-collaboration'))
  session.authFile = patch.authFile
  const connection: DesktopConnection = { mode: 'enterprise', portalOrigin: session.login.backendUrl, organizationId: session.login.actor.organizationId, principalId: session.login.actor.id }
  if (window) await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(connectionLoadingHtml('正在启动企业工作区')))
  entrySurface = false
  await startRuntime(session.home, connection, [patch.patch], existingHome)
  verifyTimer = setInterval(() => {
    if (verifying || switching) return
    verifying = true
    void session.login.verify().then(() => {
      const current = installedEnterprisePlugins(join(runtimeHome(), 'profiles', PROFILE_NAME), JSON.parse(readFileSync(join(bundledProfileDirectory(), 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')).version)
      if (pluginNames.some(name => !current.includes(name))) throw new Error('企业插件已卸载，请重新安装后登录')
    }).catch(() => {
      dialog.showErrorBox('企业认证不可用', '企业账号已过期、被撤销、后台不可达或企业插件已卸载。本机企业运行将停止，请检查后重新登录。')
      void returnToEntry()
    }).finally(() => { verifying = false })
  }, 30_000)
}

function installAccountHandlers(): void {
  const guard = (event: Electron.IpcMainInvokeEvent): { error: string } | undefined => {
    if (!entrySurface || event.sender !== window?.webContents || switching) return { error: '此页面不能发起账户操作' }
    return undefined
  }

  ipcMain.handle('workdsh:account-request-code', async (event, input: unknown) => {
    const denied = guard(event); if (denied) return denied
    const value = input as { email?: unknown }
    if (!value || typeof value.email !== 'string' || value.email.length > 254) return { error: '请输入邮箱' }
    try {
      const result = await new AccountClient(accountOrigin).requestCode(value.email.trim())
      return { ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}), ...(result.code ? { code: result.code } : {}) }
    } catch (error) { return { error: error instanceof Error ? error.message : '验证码发送失败' } }
  })

  ipcMain.handle('workdsh:account-login', async (event, input: unknown) => {
    const denied = guard(event); if (denied) return denied
    switching = true
    try {
      const value = input as { email?: unknown, password?: unknown }
      if (!value || typeof value.email !== 'string' || typeof value.password !== 'string') throw new Error('请输入邮箱和密码')
      const client = new AccountClient(accountOrigin)
      const result = await client.login(value.email.trim(), value.password)
      await chooseAccount(result, client)
      return {}
    } catch (error) {
      showConnectionEntry()
      return { error: error instanceof Error ? error.message : '登录失败' }
    } finally { endSwitch() }
  })

  ipcMain.handle('workdsh:account-register', async (event, input: unknown) => {
    const denied = guard(event); if (denied) return denied
    switching = true
    try {
      const value = input as { email?: unknown, code?: unknown, password?: unknown, displayName?: unknown }
      if (!value || typeof value.email !== 'string' || typeof value.code !== 'string' || typeof value.password !== 'string') throw new Error('请填写邮箱、验证码和密码')
      const client = new AccountClient(accountOrigin)
      const result = await client.register({ email: value.email.trim(), code: value.code.trim(), password: value.password, ...(typeof value.displayName === 'string' && value.displayName.trim() ? { displayName: value.displayName.trim() } : {}) })
      await chooseAccount(result, client)
      return {}
    } catch (error) {
      showConnectionEntry()
      return { error: error instanceof Error ? error.message : '注册失败' }
    } finally { endSwitch() }
  })

  ipcMain.handle('workdsh:account-space', async (event, input: unknown) => {
    const denied = guard(event); if (denied) return denied
    const pending = pendingLogin
    const value = input as { spaceId?: unknown }
    if (!pending || !value || typeof value.spaceId !== 'string') return { error: '空间选择已失效' }
    switching = true
    try {
      const result = await pending.client.switchSpace(pending.result.token, value.spaceId)
      await enterAccount({ client: pending.client, result })
      return {}
    } catch (error) {
      showConnectionEntry()
      return { error: error instanceof Error ? error.message : '无法进入该空间' }
    } finally { endSwitch() }
  })
}

function installConnectionMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: '账户', submenu: [{ label: '切换账户／空间', click: () => { void returnToEntry() } }] },
    { label: '工具', submenu: [{ label: '终端命令 dsh（可选）…', click: () => { void manageCommand(join(process.resourcesPath, 'workdsh-runtime'), enterprise ? `${enterprise.login.actor.organizationName ?? '企业'} / ${enterprise.login.actor.displayName}` : accountSession ? `${accountSession.account.displayName} / ${accountSession.space.name}` : '个人工作区') } }] },
    { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' },
  ]))
}

const worker = browserWorkerRequest()
if (worker !== undefined) {
  startBrowserWorker(worker)
} else {
// The native bundle starts without a Dock icon so spawned browser workers cannot
// flash one before JavaScript runs. Only the primary application becomes foreground.
if (process.platform === 'darwin') app.setActivationPolicy('regular')
const desktopUserData = process.env.WORKDSH_DESKTOP_USER_DATA
if (desktopUserData) {
  if (!isAbsolute(desktopUserData)) throw new Error('Desktop user data override must be absolute')
  app.setPath('userData', desktopUserData)
} else {
  // Keep existing accounts, sessions and runtime data when the display name changes.
  const legacyUserData = join(app.getPath('appData'), 'WorkDSH')
  mkdirSync(legacyUserData, { recursive: true })
  app.setPath('userData', legacyUserData)
}
app.setName('三云Buddy')
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (window === undefined) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })
  app.on('before-quit', event => {
    if (quitting) { stopRuntime(); return }
    event.preventDefault()
    if (switching) {
      quitRequested = true
      if (installer) void stopOwnedProcess(installer).catch(() => dialog.showErrorBox('进程清理失败', '插件安装进程停止尚未确认，请稍后检查。'))
      return
    }
    switching = true
    void leaveWorkspace().then(() => {
      quitting = true
      app.quit()
    }).catch(error => {
      dialog.showErrorBox('暂时无法退出', error instanceof Error ? error.message : '请稍后重试')
    }).finally(() => { switching = false })
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin' && !switching) app.quit()
  })
  app.on('activate', () => {
    // The entry closes before the official Host is ready. Activating the app
    // during that window must not relaunch and cancel the pending workspace.
    if (switching || runtimeStarting || installer || quitting || quitRequested) return
    if (window === undefined) {
      app.relaunch()
      app.quit()
    }
  })
  void app.whenReady().then(() => {
    const deploymentFile = join(process.resourcesPath ?? '', 'workdsh-config.json')
    let deployment = {}
    if (existsSync(deploymentFile)) {
      try { deployment = parseDeploymentConfig(JSON.parse(readFileSync(deploymentFile, 'utf8'))) }
      catch (cause) {
        dialog.showErrorBox('部署配置错误', cause instanceof Error ? cause.message : '无法读取 workdsh-config.json')
        app.quit()
        return
      }
    }
    accountOrigin = resolveServiceOrigin(deployment)
    installConnectionMenu()
    installAccountHandlers()
    showConnectionEntry()
  }).catch(cause => {
    process.stderr.write(`三云Buddy failed to start: ${cause instanceof Error ? cause.stack ?? cause.message : String(cause)}\n`)
    app.quit()
  })
}
}
