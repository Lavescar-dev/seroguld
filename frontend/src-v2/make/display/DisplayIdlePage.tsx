import { CustomerDisplayIdleView } from '@/components/CustomerDisplayCanvas';

type DisplayIdlePageProps = {
  embedded?: boolean;
  now: Date;
};

export function MakeDisplayIdlePage({ embedded = false, now }: DisplayIdlePageProps) {
  if (embedded) {
    return <CustomerDisplayIdleView embedded now={now} />;
  }

  return <CustomerDisplayIdleView now={now} />;
}
