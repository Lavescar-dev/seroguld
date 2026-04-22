import { useEffect, useState } from 'react';

type UseDisplayIdleMakeStateArgs = {
  embedded?: boolean;
};

export function useDisplayIdleMakeState({ embedded = false }: UseDisplayIdleMakeStateArgs = {}) {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return {
    embedded,
    now,
  };
}
