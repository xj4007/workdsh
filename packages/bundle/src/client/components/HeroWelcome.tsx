import * as React from 'react';
import { LogoMark } from 'workdsh-ui';

import { useAccountSummary } from '../account.js';

/**
 * The shipped hero prints "探索未至之境" plus a 预览版 badge in a sibling span and offers no slot for
 * that text, so our welcome replaces it: the brand mark slot carries the cloud logo and the greeting,
 * and the sibling spans are hidden. Structural selectors only, so if the official hero moves the
 * headline we degrade to "both visible" instead of a broken layout.
 */
const STYLE = [
  'div:has([data-slot="conversation.hero.brand.mark"]) > span:not(:has([data-slot="conversation.hero.brand.mark"])) { display: none; }',
  '@keyframes workdsh-hero-cloud { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-5px); } }',
  '[data-testid="workdsh-hero-logo"] { animation: workdsh-hero-cloud 3.2s ease-in-out infinite; }',
  '@media (prefers-reduced-motion: reduce) { [data-testid="workdsh-hero-logo"] { animation: none; } }',
].join('\n');

function greeting(hour: number): string {
  if (hour < 11) return '早上好';
  if (hour < 13) return '中午好';
  if (hour < 18) return '下午好';
  return '晚上好';
}

/** Hero welcome shown before the first message: floating cloud mark, greeting and the account name. */
export function HeroWelcome({ size = 34 }: { size?: number }) {
  const { summary } = useAccountSummary();
  const [hour, setHour] = React.useState(() => new Date().getHours());
  // The official hero asks for a 34px mark beside a single-line headline; our welcome stacks it, so it
  // gets a larger glyph while staying inside the same flex row.
  const logo = Math.max(size, 72);

  React.useEffect(() => {
    const timer = window.setInterval(() => setHour(new Date().getHours()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  React.useEffect(() => {
    const style = document.createElement('style');
    style.dataset.workdsh = 'hero-welcome';
    style.textContent = STYLE;
    document.head.append(style);
    return () => style.remove();
  }, []);

  const name = summary?.account.displayName;
  return (
    <span data-testid="workdsh-hero-welcome" style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <span data-testid="workdsh-hero-logo" style={{ display: 'inline-flex' }}><LogoMark size={logo} /></span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 26, fontWeight: 600 }}>{greeting(hour)}{name ? `，${name}` : ''}</span>
        <span style={{ fontSize: 14, opacity: 0.6 }}>今天有什么可以帮助你的？</span>
      </span>
    </span>
  );
}
