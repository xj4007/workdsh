import * as React from 'react';

/** Presentation-only adapter for the pinned Harness layout. Never changes hit areas. */
export function ShellAppearance() {
  // The product keeps exactly two footer entries: the official "More" launcher above the account
  // row. The pinned slots expose no sibling ordering and skillhub registers its own footer action,
  // so the footer order/visibility is a DOM seam; the account menu has no item filter either.
  React.useEffect(() => {
    const ensurePlazaItem = (menu: HTMLElement): void => {
      if (menu.querySelector('[data-workdsh-plaza-item]')) return;
      const plazaTrigger = document.querySelector<HTMLElement>('.sh-plaza-trigger');
      const plazaIcon = plazaTrigger?.querySelector('svg');
      const viewport = menu.querySelector<HTMLElement>('[role="presentation"]');
      const settings = menu.querySelector<HTMLElement>('[role="menuitem"][aria-keyshortcuts="Control+Alt+,"]');
      const feedback = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')]
        .find((item) => item.textContent?.trim() === '意见反馈');
      const template = feedback?.parentElement ?? settings?.parentElement;
      if (!plazaTrigger || !plazaIcon || !viewport || !template) return;

      const item = template.cloneNode(true) as HTMLElement;
      item.removeAttribute('style');
      item.dataset.workdshPlazaItem = '';
      const button = item.querySelector<HTMLElement>('[role="menuitem"]');
      const icon = button?.querySelector<HTMLElement>('span');
      const label = icon?.nextElementSibling;
      if (!button || !icon || !(label instanceof HTMLElement)) return;

      button.removeAttribute('aria-keyshortcuts');
      button.querySelector('kbd')?.closest('[aria-hidden="true"]')?.remove();
      label.textContent = '插件广场';
      icon.replaceChildren(plazaIcon.cloneNode(true));
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const plaza = document.querySelector<HTMLElement>('.sh-plaza-trigger');
        if (!plaza) return;
        plaza.click();
        (document.querySelector<HTMLElement>('[data-slot="settings.launcher"] button[aria-label="账号菜单"]')
          ?? document.querySelector<HTMLElement>('button[aria-label="账号菜单"]'))?.click();
      });
      viewport.append(item);
    };

    const syncAccountMenu = (): void => {
      for (const menu of document.querySelectorAll<HTMLElement>('[role="menu"]')) {
        // The settings shortcut identifies the official account menu; leave every other menu alone.
        if (!menu.querySelector('[role="menuitem"][aria-keyshortcuts="Control+Alt+,"]')) continue;
        for (const item of menu.querySelectorAll<HTMLElement>('[role="menuitem"]')) {
          const label = item.textContent?.trim();
          if (label === '意见反馈' || label === '登录') {
            const wrap = item.parentElement;
            (wrap && wrap !== menu ? wrap : item).style.setProperty('display', 'none', 'important');
          }
        }
        ensurePlazaItem(menu);
      }
    };
    const observer = new MutationObserver(syncAccountMenu);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return <style>{`
    [class$="_sidebarCol"] { border-right-color: transparent; }
    [data-platform="darwin"] [class$="_centerCol"] { border-left-color: transparent; }
    [data-side="sidebar"]:hover { background: color-mix(in srgb, var(--dsw-alias-label-primary) 5%, transparent); }
    [data-side="sidebar"][data-dragging] { background: color-mix(in srgb, var(--dsw-alias-label-primary) 9%, transparent); }
    /* The official footer renders actions before settings; show the settings area first. */
    div:has(> [data-slot="sidebar.footer.action"]) + div { order: -1; }
    /* skillhub's footer action is not one of the product's two bottom entries. */
    [data-slot="sidebar.footer.action"] .sh-plaza-wrap { display: none !important; }
  `}</style>;
}
