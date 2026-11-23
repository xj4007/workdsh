import * as React from 'react';

/** Presentation-only adapter for the pinned Harness layout. Never changes hit areas. */
export function ShellAppearance() {
  // The product keeps exactly two footer entries: the official "More" launcher above the account
  // row. The pinned slots expose no sibling ordering and skillhub registers its own footer action,
  // so the footer order/visibility is a DOM seam; the account menu has no item filter either.
  React.useEffect(() => {
    const trimAccountMenu = (): void => {
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
      }
    };
    const observer = new MutationObserver(trimAccountMenu);
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
