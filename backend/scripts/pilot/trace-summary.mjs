export function createTraceSummary(capacity = 50000) {
  const samples = [];
  let count = 0;
  let totalMs = 0;
  let maxMs = 0;
  return {
    onStart() {},
    onEnd(span) {
      if (span.name !== 'prisma:engine:connection') return;
      const milliseconds = span.duration[0] * 1000 + span.duration[1] / 1000000;
      if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
      count += 1; totalMs += milliseconds; maxMs = Math.max(maxMs, milliseconds);
      if (samples.length < capacity) samples.push(milliseconds);
    },
    forceFlush: () => Promise.resolve(),
    shutdown: () => Promise.resolve(),
    snapshot() {
      const sorted = [...samples].sort((left, right) => left - right);
      const percentile = (fraction) => sorted.length ? sorted[Math.ceil(sorted.length * fraction) - 1] : null;
      return { isAvailable: count > 0, connectionAcquisitions: count, totalMs, maxMs, sampled: samples.length,
        sampling: `first ${capacity} connection spans; counters cover all spans`, p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99) };
    },
  };
}
