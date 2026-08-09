import { useEffect, useState, type RefObject } from 'react';

export type AlisLayoutMode = 'compact' | 'medium' | 'wide' | 'ultrawide';

export function getAlisLayoutMode(width: number): AlisLayoutMode {
  if (width < 720) return 'compact';
  if (width < 1120) return 'medium';
  if (width < 1600) return 'wide';
  return 'ultrawide';
}

export function useAlisLayoutMode(ref: RefObject<HTMLElement | null>): AlisLayoutMode {
  const [mode, setMode] = useState<AlisLayoutMode>('medium');

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const update = () => setMode(getAlisLayoutMode(element.getBoundingClientRect().width || element.clientWidth));
    update();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return mode;
}
