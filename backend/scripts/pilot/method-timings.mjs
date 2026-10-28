export function createMethodTimings(capacity = 20000) {
  const methods = new Map();
  function record(name, milliseconds) {
    const entry = methods.get(name) ?? { count: 0, totalMs: 0, maxMs: 0, samples: [] };
    entry.count += 1; entry.totalMs += milliseconds; entry.maxMs = Math.max(entry.maxMs, milliseconds);
    if (entry.samples.length < capacity) entry.samples.push(milliseconds);
    methods.set(name, entry);
  }
  return {
    wrap(name, target, method) {
      const original = target[method];
      if (typeof original !== 'function') throw new Error('Unknown diagnostic method');
      target[method] = async function (...args) {
        const started = performance.now();
        try { return await original.apply(this, args); }
        finally { record(name, performance.now() - started); }
      };
    },
    clear() { methods.clear(); },
    snapshot() {
      return Object.fromEntries([...methods].map(([name, entry]) => {
        const sorted = [...entry.samples].sort((left, right) => left - right);
        const percentile = (fraction) => sorted[Math.ceil(sorted.length * fraction) - 1] ?? null;
        return [name, { count: entry.count, totalMs: entry.totalMs, maxMs: entry.maxMs, sampled: sorted.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95) }];
      }));
    },
  };
}
