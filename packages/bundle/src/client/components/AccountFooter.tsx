import * as React from 'react';

type Summary = {
  account: { displayName: string, email: string };
  space: { id: string, name: string, kind: 'PERSONAL' | 'ENTERPRISE' };
  spaces: Array<{ id: string, name: string, kind: 'PERSONAL' | 'ENTERPRISE' }>;
  wallet: { availableCredits: string, balanceCredits: string } | null;
};

declare global {
  interface Window { __workdshAccountBridge?: { url: string, key: string } }
}

/** The Desktop carrier injects the loopback bridge; the query fallback serves older carriers. */
export function accountBridge(): { url: string, key: string } | undefined {
  const injected = window.__workdshAccountBridge;
  if (injected?.url && injected.key) return injected;
  const search = new URL(window.location.href).searchParams;
  const url = search.get('workdshAccountUrl');
  const key = search.get('workdshAccountKey');
  return url && key ? { url, key } : undefined;
}

async function call(path: string, method = 'GET', body?: unknown): Promise<Summary> {
  const endpoint = accountBridge();
  if (!endpoint) throw new Error('账户桥接未就绪');
  const response = await fetch(`${endpoint.url}${path}`, {
    method,
    headers: { Authorization: `Bearer ${endpoint.key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`账户暂不可用（${response.status}）`);
  return await response.json() as Summary;
}

/** Footer action beside Settings: account, current space and available credits. */
export function AccountFooter({ wide }: { wide: boolean }) {
  const [summary, setSummary] = React.useState<Summary>();
  const [error, setError] = React.useState<string>();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const root = React.useRef<HTMLDivElement | null>(null);

  // The official footer row is a single non-wrapping flex row shared by every footer action; wrap it
  // so this entry and the plugin market stack instead of competing for the same 256px.
  React.useEffect(() => {
    const row = root.current?.closest('[data-slot="sidebar.footer.action"]')?.parentElement;
    if (!row) return;
    row.style.flexWrap = 'wrap';
    return () => { row.style.flexWrap = ''; };
  }, []);

  const refresh = React.useCallback(async () => {
    try {
      setSummary(await call('/account'));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账户暂不可用');
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const wallet = summary?.wallet;
  // The footer row also hosts the plugin-market action, so only the space and the credits stay inline.
  const text = summary
    ? `${summary.space.name} · ${wallet ? `${wallet.availableCredits} 积分` : '积分暂不可用'}`
    : error ? '账户暂不可用' : '账户加载中';
  const title = summary
    ? `${summary.account.displayName} · ${summary.space.name} · ${wallet ? `${wallet.availableCredits} 积分` : '积分暂不可用'}`
    : text;

  const act = async (path: string, body?: unknown): Promise<void> => {
    setBusy(true);
    try { await call(path, 'POST', body); await refresh(); setError(undefined); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '操作失败'); }
    finally { setBusy(false); }
  };

  return (
    // The account entry and the plugin-market action are two separate menus, so ours claims a whole
    // row and the shared footer row is allowed to wrap (restored on unmount).
    <div ref={root} style={{ position: 'relative', flex: '1 0 100%', minWidth: 0, maxWidth: '100%' }}>
      <button
        type="button"
        data-testid="workdsh-account-footer"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen(value => !value)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%', minWidth: 0, minHeight: 30,
          padding: wide ? '5px 8px' : '5px 4px', border: 0, borderRadius: 6,
          background: 'transparent', color: 'inherit', font: 'inherit', fontSize: 12,
          textAlign: 'left', cursor: 'pointer', opacity: busy ? 0.7 : 1,
        }}
      >
        <span aria-hidden style={{ width: 18, height: 18, borderRadius: 9, background: '#4b6bfb', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, flex: '0 0 auto' }}>{summary ? [...summary.account.displayName][0] ?? '云' : '云'}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{text}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', left: 0, bottom: 36, zIndex: 30, width: 236,
          padding: 10, borderRadius: 10, border: '1px solid rgba(128,128,128,.28)',
          background: 'var(--dsw-color-bg-elevated, #26262a)', color: 'var(--dsw-color-text, #f2f2f4)',
          boxShadow: '0 10px 28px rgba(0,0,0,.35)', fontSize: 12,
        }}>
          {summary ? (
            <>
              <div style={{ fontWeight: 600, marginBottom: 2 }}>{summary.account.displayName}</div>
              <div style={{ opacity: .65, marginBottom: 8 }}>{summary.account.email}</div>
              <div style={{ opacity: .8, marginBottom: 4 }}>当前空间：{summary.space.name}</div>
              <div style={{ opacity: .8, marginBottom: 8 }}>可用积分：{wallet ? wallet.availableCredits : '暂不可用'}</div>
              {summary.spaces.length > 1 && (
                <div style={{ display: 'grid', gap: 4, marginBottom: 8 }}>
                  {summary.spaces.filter(space => space.id !== summary.space.id).map(space => (
                    <button key={space.id} type="button" disabled={busy} onClick={() => { void act('/account/switch', { spaceId: space.id }); }}
                      style={{ padding: '5px 7px', borderRadius: 6, border: '1px solid rgba(128,128,128,.3)', background: 'transparent', color: 'inherit', cursor: 'pointer', textAlign: 'left' }}>
                      切换到 {space.name}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', gap: 4 }}>
                <button type="button" disabled={busy} onClick={() => { void act('/account/refresh'); }}
                  style={{ flex: 1, padding: '5px 7px', borderRadius: 6, border: '1px solid rgba(128,128,128,.3)', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>刷新</button>
                <button type="button" disabled={busy} onClick={() => { void act('/account/logout'); }}
                  style={{ flex: 1, padding: '5px 7px', borderRadius: 6, border: '1px solid rgba(128,128,128,.3)', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>退出登录</button>
              </div>
            </>
          ) : <div style={{ opacity: .75 }}>{error ?? '账户暂不可用'}</div>}
          {error && summary && <div style={{ marginTop: 6, color: '#ff8a8a' }}>{error}</div>}
        </div>
      )}
    </div>
  );
}
