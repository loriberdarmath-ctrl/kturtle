import {
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * Portal-rendered popover that anchors itself to a trigger element via
 * `getBoundingClientRect()`, then flips / shifts so it NEVER goes off
 * screen — regardless of how deep or how clipped its parent tree is.
 *
 * This is the right primitive for toolbar dropdowns: they must escape
 * every `overflow-hidden`, `backdrop-blur`, and stacking-context trap in
 * the app (the toolbar area sits on a blurred header; the surrounding
 * shell has `overflow: hidden` to lock the layout).
 *
 * Features:
 *   - Renders into `document.body` via a React portal
 *   - Auto-flips vertically (top ↔ bottom) and horizontally (left ↔ right)
 *   - Respects a configurable viewport margin
 *   - Closes on: outside click, Escape, window resize, page scroll, blur
 *   - Focus returns to the trigger on close (accessibility)
 */
export type PopoverAlign = 'start' | 'end';
export type PopoverSide = 'bottom' | 'top';

interface PopoverProps {
  /** Ref to the trigger element the popover anchors to. */
  triggerRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  /** Horizontal alignment relative to the trigger. */
  align?: PopoverAlign;
  /** Preferred side; will flip if it would overflow. */
  side?: PopoverSide;
  /** Px gap between trigger and popover. */
  gap?: number;
  /** Margin kept between popover edge and viewport edge. */
  viewportMargin?: number;
  /** Fixed min width; if the menu is narrower than the trigger, matches it. */
  minWidth?: number;
  /** className for the popover container. */
  className?: string;
  children: ReactNode;
}

export function Popover({
  triggerRef,
  open,
  onClose,
  align = 'start',
  side = 'bottom',
  gap = 6,
  viewportMargin = 8,
  minWidth,
  className = '',
  children,
}: PopoverProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width?: number }>({
    top: -9999,
    left: -9999,
  });

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    const content = contentRef.current;
    if (!trigger || !content) return;

    const tRect = trigger.getBoundingClientRect();
    // Measure content at its natural size; we'll clamp after.
    const cRect = content.getBoundingClientRect();
    const cw = Math.max(cRect.width, minWidth ?? 0);
    const ch = cRect.height;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const M = viewportMargin;

    // ── Vertical side: prefer `side`, flip if not enough space.
    let top: number;
    const spaceBelow = vh - tRect.bottom - gap - M;
    const spaceAbove = tRect.top - gap - M;
    if (side === 'bottom') {
      top = ch <= spaceBelow || spaceBelow >= spaceAbove
        ? tRect.bottom + gap
        : tRect.top - gap - ch;
    } else {
      top = ch <= spaceAbove || spaceAbove >= spaceBelow
        ? tRect.top - gap - ch
        : tRect.bottom + gap;
    }
    // Clamp vertically — never let the menu disappear off-screen.
    top = Math.max(M, Math.min(top, vh - ch - M));

    // ── Horizontal alignment: start-aligns with trigger left, end with right.
    let left = align === 'start' ? tRect.left : tRect.right - cw;
    // Shift into viewport if overflowing either side.
    if (left + cw > vw - M) left = vw - cw - M;
    if (left < M) left = M;

    setPos({ top, left, width: minWidth ? Math.max(minWidth, tRect.width) : undefined });
  }, [align, gap, minWidth, side, triggerRef, viewportMargin]);

  // Re-measure on every open, and whenever the window changes size.
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    // Run one more frame later to account for fonts loading / content
    // settling (inputs, icons) that can change the content size.
    const id = requestAnimationFrame(reposition);
    return () => cancelAnimationFrame(id);
  }, [open, reposition, children]);

  useEffect(() => {
    if (!open) return;
    const handler = () => reposition();
    const close = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (contentRef.current?.contains(target)) return;
      if (triggerRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        triggerRef.current?.focus?.();
      }
    };
    window.addEventListener('resize', handler);
    window.addEventListener('scroll', handler, true);
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('scroll', handler, true);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, reposition, triggerRef]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={contentRef}
      role="menu"
      className={`fixed z-[1000] anim-pop ${className}`}
      style={{
        top: pos.top,
        left: pos.left,
        minWidth: pos.width,
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
