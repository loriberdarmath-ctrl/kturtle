import { useEffect, useState } from 'react';

/**
 * Breakpoints mirror the Tailwind defaults so class-based overrides and
 * JS-driven conditional rendering agree about what "mobile" means.
 *
 *   < 768px   → mobile      (phones, including landscape on small devices)
 *   768–1024  → tablet      (iPad portrait etc.)
 *   ≥ 1024    → desktop     (laptop / desktop)
 *
 * The app collapses into a single-column, tabbed workspace below the
 * mobile breakpoint. Tablets keep the desktop layout — the split-pane
 * shell stays comfortable with min widths of 260/300/260.
 */
export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

const MQ_MOBILE = '(max-width: 767px)';
const MQ_TABLET = '(min-width: 768px) and (max-width: 1023px)';

function detect(): Breakpoint {
  if (typeof window === 'undefined' || !window.matchMedia) return 'desktop';
  if (window.matchMedia(MQ_MOBILE).matches) return 'mobile';
  if (window.matchMedia(MQ_TABLET).matches) return 'tablet';
  return 'desktop';
}

/**
 * Subscribes to viewport size changes via matchMedia. matchMedia is the
 * right primitive here — it only fires when the boundary is crossed, so
 * we don't re-render on every resize pixel like a resize listener would.
 */
export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(detect);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mqlMobile = window.matchMedia(MQ_MOBILE);
    const mqlTablet = window.matchMedia(MQ_TABLET);
    const update = () => setBp(detect());
    // addEventListener is the modern API; older Safari needs addListener.
    const add = (mql: MediaQueryList) =>
      mql.addEventListener ? mql.addEventListener('change', update) : mql.addListener(update);
    const rem = (mql: MediaQueryList) =>
      mql.removeEventListener ? mql.removeEventListener('change', update) : mql.removeListener(update);
    add(mqlMobile);
    add(mqlTablet);
    update();
    return () => {
      rem(mqlMobile);
      rem(mqlTablet);
    };
  }, []);

  return bp;
}

/** Shorthand: `true` when viewport is below the mobile breakpoint. */
export function useIsMobile(): boolean {
  return useBreakpoint() === 'mobile';
}
