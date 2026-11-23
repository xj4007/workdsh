import * as React from 'react';

/** Account summary served by the Desktop carrier's loopback bridge. */
export type AccountSummary = {
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

export async function accountCall(path: string, method = 'GET', body?: unknown): Promise<AccountSummary> {
  const endpoint = accountBridge();
  if (!endpoint) throw new Error('账户桥接未就绪');
  const response = await fetch(`${endpoint.url}${path}`, {
    method,
    headers: { Authorization: `Bearer ${endpoint.key}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(`账户暂不可用（${response.status}）`);
  return await response.json() as AccountSummary;
}

/** Poll the bridge; a failed read reports an error and never invents a zero balance. */
export function useAccountSummary(intervalMs = 5_000) {
  const [summary, setSummary] = React.useState<AccountSummary>();
  const [error, setError] = React.useState<string>();

  const refresh = React.useCallback(async () => {
    try {
      setSummary(await accountCall('/account'));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '账户暂不可用');
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, intervalMs);
    return () => window.clearInterval(timer);
  }, [refresh, intervalMs]);

  return { summary, error, setError, refresh };
}
