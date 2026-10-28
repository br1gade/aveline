import assert from 'node:assert/strict';

export function requireLocalTarget(value) {
  const url = new URL(value);
  assert.ok(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Rehearsal requires loopback HTTP');
  assert.ok(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/', 'Rehearsal target must contain only an origin');
  return url;
}

export function summarizeSamples(samples) {
  assert.ok(samples.length > 0, 'A latency profile needs samples');
  const times = samples.map(({ milliseconds }) => milliseconds).sort((left, right) => left - right);
  assert.ok(times.every((value) => Number.isFinite(value) && value >= 0), 'Invalid duration');
  const percentile = (fraction) => Math.round(times[Math.ceil(times.length * fraction) - 1] * 10) / 10;
  const statuses = {};
  let unexpected = 0;
  for (const sample of samples) {
    statuses[sample.status] = (statuses[sample.status] ?? 0) + 1;
    const expected = Array.isArray(sample.expected) ? sample.expected : [sample.expected];
    if (!expected.includes(sample.status)) unexpected += 1;
  }
  return { requests: samples.length, unexpected, p50Ms: percentile(0.5), p95Ms: percentile(0.95), p99Ms: percentile(0.99), statuses };
}

export function evaluateBudgets(profiles, budgets) {
  const checks = Object.entries(budgets).map(([name, budgetMs]) => {
    const result = profiles[name];
    return { name, budgetMs, p95Ms: result?.p95Ms ?? null, isPassed: !!result && result.requests > 0 && result.unexpected === 0 && Number.isFinite(result.p95Ms) && result.p95Ms < budgetMs };
  });
  return { isPassed: checks.every(({ isPassed }) => isPassed), checks };
}

export function readinessState(value) {
  const report = value?.required ? value : value?.message;
  const result = { postgres: report?.required?.postgres?.isUp, mongo: report?.optional?.mongo?.isUp, redis: report?.optional?.redis?.isUp };
  assert.ok(Object.values(result).every((isUp) => typeof isUp === 'boolean'), 'Missing readiness evidence');
  return result;
}
