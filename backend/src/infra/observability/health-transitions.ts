export type DependencyName = 'postgres' | 'redis' | 'mongo' | 'storage';

export interface DependencyTransition {
  dependency: DependencyName;
  isUp: boolean;
  /** How long it stayed in the state it just left, in milliseconds. */
  heldForMs: number;
}

interface KnownState {
  isUp: boolean;
  since: number;
}

/**
 * Reports only *changes* in dependency health.
 *
 * Edge-triggered, deliberately. A level-triggered check that reported "Redis
 * is down" on every probe would send one alert a minute for the whole
 * outage, and the first thing anyone does with an alert that repeats is mute
 * it — which is also how the next, different alert gets missed.
 *
 * Kept as a pure class so the decision of *when* to alert is testable without
 * a Sentry account or a broken database.
 */
export class HealthTransitionTracker {
  private readonly known = new Map<DependencyName, KnownState>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  /**
   * Records the current state of each dependency and returns only those that
   * changed. The first observation of a dependency is not a transition — a
   * freshly started process has not learned anything yet.
   */
  observe(readings: Record<DependencyName, boolean>): DependencyTransition[] {
    const at = this.now();
    const transitions: DependencyTransition[] = [];

    for (const [name, isUp] of Object.entries(readings) as [DependencyName, boolean][]) {
      const previous = this.known.get(name);
      this.known.set(name, previous?.isUp === isUp ? previous : { isUp, since: at });

      if (previous && previous.isUp !== isUp) {
        transitions.push({ dependency: name, isUp, heldForMs: at - previous.since });
      }
    }

    return transitions;
  }
}
