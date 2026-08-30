import { type ReactNode, type RefObject, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

import { cn } from './cn';
import { ModernButton } from './primitives';

const FOCUSABLE_SELECTOR =
  'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useBodyScrollLock(active: boolean) {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [active]);
}

function useFocusTrap(active: boolean, containerRef: RefObject<HTMLElement>, onClose?: () => void) {
  useEffect(() => {
    if (!active || typeof document === 'undefined') return undefined;
    const previousActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const container = containerRef.current;
    if (!container) return undefined;

    const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const target = focusables[0] ?? container;
    window.requestAnimationFrame(() => {
      target.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const currentFocusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (currentFocusables.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = currentFocusables[0];
      const last = currentFocusables[currentFocusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previousActive?.focus();
    };
  }, [active, containerRef, onClose]);
}

function OverlayPortal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

function OverlayFrame({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  panelClassName,
}: {
  open: boolean;
  onClose?: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  panelClassName?: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useBodyScrollLock(open);
  useFocusTrap(open, panelRef, onClose);

  if (!open) return null;

  return (
    <OverlayPortal>
      <div className="fixed inset-0 z-modal flex items-center justify-center bg-sg-text/35 p-4 backdrop-blur-sm">
        <div
          className="absolute inset-0"
          onClick={() => onClose?.()}
          aria-hidden="true"
        />
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className={cn(
            'relative z-modal max-h-[calc(100vh-2rem)] w-full overflow-hidden rounded-sg-xl border border-sg-border bg-sg-surface shadow-sg-lg',
            panelClassName,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-sg-border-soft px-5 py-4">
            <div>
              <h3 id={titleId} className="text-base font-semibold tracking-[-0.01em] text-sg-text">{title}</h3>
              {description ? <p id={descriptionId} className="mt-1 text-sm text-sg-text-soft">{description}</p> : null}
            </div>
            {onClose ? (
              <ModernButton aria-label="Kapat" tone="ghost" size="sm" onClick={onClose} icon={X}>
                Kapat
              </ModernButton>
            ) : null}
          </div>
          <div className="max-h-[calc(100vh-11rem)] overflow-auto px-5 py-5">{children}</div>
          {footer ? <div className="border-t border-sg-border-soft px-5 py-4">{footer}</div> : null}
        </div>
      </div>
    </OverlayPortal>
  );
}

export function ModernDialog(props: {
  open: boolean;
  onClose?: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return <OverlayFrame panelClassName="max-w-2xl" {...props} />;
}

export function ModernDrawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose?: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  useBodyScrollLock(open);
  useFocusTrap(open, panelRef, onClose);

  if (!open) return null;

  return (
    <OverlayPortal>
      <div className="fixed inset-0 z-drawer">
        <div className="absolute inset-0 bg-sg-text/35 backdrop-blur-sm" aria-hidden="true" onClick={() => onClose?.()} />
        <aside
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descriptionId : undefined}
          tabIndex={-1}
          className="absolute inset-y-0 right-0 z-drawer flex w-full max-w-[720px] flex-col overflow-hidden border-l border-sg-border bg-sg-surface shadow-sg-lg"
        >
          <div className="flex items-start justify-between gap-4 border-b border-sg-border-soft px-5 py-4">
            <div>
              <h3 id={titleId} className="text-base font-semibold tracking-[-0.01em] text-sg-text">{title}</h3>
              {description ? <p id={descriptionId} className="mt-1 text-sm text-sg-text-soft">{description}</p> : null}
            </div>
            {onClose ? (
              <ModernButton aria-label="Kapat" tone="ghost" size="sm" onClick={onClose} icon={X}>
                Kapat
              </ModernButton>
            ) : null}
          </div>
          <div className="flex-1 overflow-auto px-5 py-5">{children}</div>
          {footer ? <div className="border-t border-sg-border-soft px-5 py-4">{footer}</div> : null}
        </aside>
      </div>
    </OverlayPortal>
  );
}
