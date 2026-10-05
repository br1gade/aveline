import { HealthTransitionTracker } from './health-transitions';

/**
 * The property under test is that an alert fires on a change and never while
 * nothing is changing. An alert that repeats every minute gets muted, and a
 * muted channel is how the next outage goes unnoticed.
 */
describe('HealthTransitionTracker', () => {
  let clock: number;
  const tracker = () => new HealthTransitionTracker(() => clock);
  const allUp = { postgres: true, redis: true, mongo: true, storage: true };

  beforeEach(() => {
    clock = 1_000_000;
  });

  it('says nothing on the first observation — a fresh process has learned nothing', () => {
    expect(tracker().observe(allUp)).toEqual([]);
  });

  it('says nothing while everything stays up', () => {
    const t = tracker();
    t.observe(allUp);

    expect(t.observe(allUp)).toEqual([]);
    expect(t.observe(allUp)).toEqual([]);
  });

  it('reports the dependency that went down, and only that one', () => {
    const t = tracker();
    t.observe(allUp);
    clock += 60_000;

    const transitions = t.observe({ ...allUp, redis: false });

    expect(transitions).toEqual([{ dependency: 'redis', isUp: false, heldForMs: 60_000 }]);
  });

  // The whole point: an outage alerts once, not once per probe.
  it('does not repeat while a dependency stays down', () => {
    const t = tracker();
    t.observe(allUp);
    t.observe({ ...allUp, redis: false });

    expect(t.observe({ ...allUp, redis: false })).toEqual([]);
    expect(t.observe({ ...allUp, redis: false })).toEqual([]);
  });

  it('reports recovery, with how long the outage lasted', () => {
    const t = tracker();
    t.observe(allUp);
    t.observe({ ...allUp, mongo: false });
    clock += 300_000;

    expect(t.observe(allUp)).toEqual([{ dependency: 'mongo', isUp: true, heldForMs: 300_000 }]);
  });

  it('reports several dependencies failing together', () => {
    const t = tracker();
    t.observe(allUp);

    const transitions = t.observe({ ...allUp, redis: false, mongo: false });

    expect(transitions.map((t) => t.dependency).sort()).toEqual(['mongo', 'redis']);
    expect(transitions.every((t) => !t.isUp)).toBe(true);
  });

  it('handles a flap — down then up then down — as three separate events', () => {
    const t = tracker();
    t.observe(allUp);

    expect(t.observe({ ...allUp, storage: false })).toHaveLength(1);
    expect(t.observe(allUp)).toHaveLength(1);
    expect(t.observe({ ...allUp, storage: false })).toHaveLength(1);
  });

  it('measures how long the previous state held, not time since start', () => {
    const t = tracker();
    t.observe(allUp);
    clock += 10_000;
    t.observe(allUp); // unchanged — must not reset the clock
    clock += 10_000;

    expect(t.observe({ ...allUp, postgres: false })[0].heldForMs).toBe(20_000);
  });
});
