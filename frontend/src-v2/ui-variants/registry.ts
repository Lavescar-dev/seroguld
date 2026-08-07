import type {
  UiVariantTransitionGuard,
  UiVariantTransitionDecision,
  UiVariantTransitionIntent,
  UiVariantTransitionSnapshot,
} from './types';

type GuardEvaluation = {
  guard: UiVariantTransitionGuard;
  decision: UiVariantTransitionDecision;
};

function isSettlingEvaluation(
  entry: GuardEvaluation,
): entry is GuardEvaluation & {
  decision: Extract<UiVariantTransitionDecision, { status: 'settling' }>;
} {
  return entry.decision.status === 'settling';
}

function isBlockedEvaluation(
  entry: GuardEvaluation,
): entry is GuardEvaluation & {
  decision: Extract<UiVariantTransitionDecision, { status: 'blocked' }>;
} {
  return entry.decision.status === 'blocked';
}

export class UiVariantTransitionRegistry {
  private readonly guards = new Map<string, UiVariantTransitionGuard>();

  register(guard: UiVariantTransitionGuard) {
    this.guards.set(guard.id, guard);
    return () => {
      this.guards.delete(guard.id);
    };
  }

  list() {
    return [...this.guards.values()];
  }

  async inspect(intent: UiVariantTransitionIntent): Promise<UiVariantTransitionSnapshot> {
    const guards = this.list();
    const evaluations = await Promise.all(
      guards.map(async (guard) => ({
        guard,
        decision: await guard.evaluate(intent),
      })),
    );

    const blocked = evaluations.filter(isBlockedEvaluation);
    if (blocked.length > 0) {
      return {
        status: 'blocked',
        reasons: blocked.map((entry) => {
          const decision = entry.decision;
          return decision.reason;
        }),
        guardIds: blocked.map((entry) => entry.guard.id),
        intent,
      };
    }

    const settling = evaluations.filter(isSettlingEvaluation);
    if (settling.length > 0) {
      return {
        status: 'settling',
        reasons: settling.map((entry) => {
          const decision = entry.decision;
          return decision.reason;
        }),
        guardIds: settling.map((entry) => entry.guard.id),
        intent,
      };
    }

    return {
      status: 'ready',
      reasons: [],
      guardIds: [],
      intent,
    };
  }

  async flush(intent: UiVariantTransitionIntent): Promise<UiVariantTransitionSnapshot> {
    const guards = this.list();
    const evaluations = await Promise.all(
      guards.map(async (guard) => ({
        guard,
        decision: await guard.evaluate(intent),
      })),
    );

    const settling = evaluations.filter(isSettlingEvaluation);
    await Promise.all(
      settling.map(async (entry) => {
        if (entry.guard.flush) {
          await entry.guard.flush(intent);
        }
      }),
    );

    return this.inspect(intent);
  }
}
