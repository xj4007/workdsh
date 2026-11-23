/** Preload for the carrier's own account pages. It exposes only fixed IPC channels, never a token API. */
import { ipcRenderer } from 'electron'

type Reply = { error?: string, code?: string, expiresAt?: string }

// A preload runs before the page body exists, so every binding waits for the DOM.
function start(): void {
  const status = document.querySelector<HTMLElement>('#status')

  function show(message: string, error = false): void {
    if (!status) return
    status.textContent = message
    status.className = error ? 'error' : ''
  }

  function buttons(): HTMLButtonElement[] {
    return [...document.querySelectorAll<HTMLButtonElement>('button')]
  }

  async function run(action: () => Promise<Reply>): Promise<void> {
    for (const button of buttons()) button.disabled = true
    try {
      const reply = await action()
      if (reply.error) show(reply.error, true)
      else show('正在进入工作区…')
    } catch {
      show('操作失败，请重试', true)
    } finally {
      for (const button of buttons()) button.disabled = false
    }
  }

  const login = document.querySelector<HTMLFormElement>('#account-login')
  const register = document.querySelector<HTMLFormElement>('#account-register')
  const tabLogin = document.querySelector<HTMLButtonElement>('#tab-login')
  const tabRegister = document.querySelector<HTMLButtonElement>('#tab-register')

  function selectTab(loginTab: boolean): void {
    if (login) login.hidden = !loginTab
    if (register) register.hidden = loginTab
    tabLogin?.setAttribute('aria-selected', String(loginTab))
    tabRegister?.setAttribute('aria-selected', String(!loginTab))
    show('')
  }

  tabLogin?.addEventListener('click', () => selectTab(true))
  tabRegister?.addEventListener('click', () => selectTab(false))

  login?.addEventListener('submit', event => {
    event.preventDefault()
    const email = document.querySelector<HTMLInputElement>('#login-email')?.value.trim() ?? ''
    const password = document.querySelector<HTMLInputElement>('#login-password')?.value ?? ''
    if (!email || !password) { show('请填写邮箱和密码', true); return }
    void run(async () => ipcRenderer.invoke('workdsh:account-login', { email, password }) as Promise<Reply>)
  })

  register?.addEventListener('submit', event => {
    event.preventDefault()
    const email = document.querySelector<HTMLInputElement>('#register-email')?.value.trim() ?? ''
    const code = document.querySelector<HTMLInputElement>('#register-code')?.value.trim() ?? ''
    const password = document.querySelector<HTMLInputElement>('#register-password')?.value ?? ''
    const displayName = document.querySelector<HTMLInputElement>('#register-name')?.value.trim()
    if (!email || !code || !password) { show('请填写邮箱、验证码和密码', true); return }
    void run(async () => ipcRenderer.invoke('workdsh:account-register', { email, code, password, ...(displayName ? { displayName } : {}) }) as Promise<Reply>)
  })

  document.querySelector<HTMLButtonElement>('#request-code')?.addEventListener('click', event => {
    event.preventDefault()
    const email = document.querySelector<HTMLInputElement>('#register-email')?.value.trim() ?? ''
    if (!email) { show('请先填写邮箱', true); return }
    const target = event.currentTarget as HTMLButtonElement
    target.disabled = true
    void (async () => {
      try {
        const reply = await ipcRenderer.invoke('workdsh:account-request-code', { email }) as Reply
        if (reply.error) show(reply.error, true)
        else if (reply.code) show(`验证码已生成：${reply.code}（仅开发环境显示）`)
        else show(reply.expiresAt ? `验证码已发送，有效期至 ${new Date(reply.expiresAt).toLocaleTimeString()}` : '验证码已发送')
      } catch { show('验证码发送失败，请重试', true) }
      finally { target.disabled = false }
    })()
  })

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-space-id]')) {
    button.addEventListener('click', () => {
      const spaceId = button.dataset.spaceId
      if (!spaceId) return
      void run(async () => ipcRenderer.invoke('workdsh:account-space', { spaceId }) as Promise<Reply>)
    })
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true })
else start()
