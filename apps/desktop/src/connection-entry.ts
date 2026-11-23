/** Carrier-owned entry pages. They render account controls only; credentials never enter the Host. */
export type EntrySpace = { id: string, name: string, kind: 'PERSONAL' | 'ENTERPRISE' }

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--ink:#16181d;--muted:#5f6673;--line:#dfe3ea;--accent:#2f6fed;--danger:#c0392b}
@media(prefers-color-scheme:dark){:root{--bg:#111318;--card:#191c23;--ink:#eef1f6;--muted:#9aa3b2;--line:#2c313c;--accent:#7aa2ff;--danger:#ff8b80}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:min(420px,calc(100vw - 32px));background:var(--card);border:1px solid var(--line);border-radius:16px;padding:28px;box-shadow:0 18px 48px rgba(0,0,0,.08)}
h1{font-size:22px;margin:0 0 4px}header p{margin:0 0 20px;color:var(--muted);font-size:13px;word-break:break-all}
.tabs{display:flex;gap:8px;margin-bottom:18px}.tabs button{flex:1;border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:10px;padding:8px;font:inherit;cursor:pointer}
.tabs button[aria-selected="true"]{border-color:var(--accent);color:var(--accent);font-weight:600}
form{display:grid;gap:12px}label{display:grid;gap:6px;font-size:13px;color:var(--muted)}
input{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);font:inherit}
input:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.row{display:flex;gap:8px}.row input{flex:1}.row button{white-space:nowrap}
button.primary{width:100%;padding:10px 12px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
button.ghost{border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:10px;padding:8px 10px;font:inherit;cursor:pointer}
button:disabled{opacity:.55;cursor:progress}
#status{min-height:20px;margin:14px 0 0;font-size:13px;color:var(--muted)}#status.error{color:var(--danger)}
.spaces{display:grid;gap:10px}.spaces button{text-align:left;border:1px solid var(--line);background:transparent;color:var(--ink);border-radius:12px;padding:12px;font:inherit;cursor:pointer}
.spaces button:hover{border-color:var(--accent)}.spaces small{display:block;color:var(--muted);font-size:12px}
.loading{display:flex;align-items:center;gap:12px;color:var(--muted)}.spinner{width:20px;height:20px;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.spinner{animation:none}}
`

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
}

function page(body: string, script = false): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; script-src ${script ? "'unsafe-inline'" : "'none'"}">
<title>三云Buddy</title><style>${STYLE}</style></head><body>${body}</body></html>`
}

/** Account entry: service origin is fixed by the package and cannot be edited by the user. */
export function connectionEntryHtml(serviceOrigin: string, registrationEnabled = true): string {
  const origin = escapeHtml(serviceOrigin)
  return page(`<main><header><h1>登录 三云Buddy</h1><p>服务地址：<span>${origin}</span></p></header>
<div class="tabs" role="tablist"><button type="button" id="tab-login" role="tab" aria-selected="true">登录</button>${registrationEnabled ? '<button type="button" id="tab-register" role="tab" aria-selected="false">注册</button>' : ''}</div>
<form id="account-login"><label>邮箱<input id="login-email" type="email" autocomplete="username" required></label><label>密码<input id="login-password" type="password" autocomplete="current-password" minlength="12" required></label><button class="primary" type="submit">登录</button></form>
${registrationEnabled ? `<form id="account-register" hidden><label>邮箱<input id="register-email" type="email" autocomplete="email" required></label><label>验证码<div class="row"><input id="register-code" inputmode="numeric" autocomplete="one-time-code" required><button class="ghost" type="button" id="request-code">获取验证码</button></div></label><label>密码<input id="register-password" type="password" autocomplete="new-password" minlength="12" required></label><label>显示名称（可选）<input id="register-name" maxlength="120"></label><button class="primary" type="submit">注册并登录</button></form>` : ''}
<p id="status" role="status" aria-live="polite"></p></main>`, true)
}

/** Space picker shown after login when the account has more than one space. */
export function spacePickerHtml(displayName: string, spaces: readonly EntrySpace[]): string {
  const rows = spaces.map(space => `<button type="button" data-space-id="${escapeHtml(space.id)}"><strong>${escapeHtml(space.name)}</strong><small>${space.kind === 'ENTERPRISE' ? '企业空间' : '个人空间'}</small></button>`).join('')
  return page(`<main><header><h1>选择空间</h1><p>${escapeHtml(displayName)}</p></header><div class="spaces">${rows}</div><p id="status" role="status" aria-live="polite"></p></main>`)
}

export function connectionLoadingHtml(message: string): string {
  return page(`<main><div class="loading" role="status" aria-busy="true"><span class="spinner" aria-hidden="true"></span><span>${escapeHtml(message)}</span></div></main>`)
}
