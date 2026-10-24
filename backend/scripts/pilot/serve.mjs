// Only launched by the isolated rehearsal; no public diagnostics endpoint/exporter.
import { createRequire } from 'node:module';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createTraceSummary } from './trace-summary.mjs';
import { createCpuProfiler } from './cpu-profile.mjs';
import { createMethodTimings } from './method-timings.mjs';
const require = createRequire(import.meta.url);
const traces = createTraceSummary();
const cpu = createCpuProfiler();
const isDatabaseTracingEnabled = process.env.REHEARSAL_TRACE_DB === 'true';
let provider;
if (isDatabaseTracingEnabled) {
  const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
  const { PrismaInstrumentation, registerInstrumentations } = require('@prisma/instrumentation');
  provider = new NodeTracerProvider({ spanProcessors: [traces] });
  provider.register();
  registerInstrumentations({ tracerProvider: provider, instrumentations: [new PrismaInstrumentation()] });
}
const { createApplication } = require('../../dist/application.js');
const { CommunicationsService } = require('../../dist/modules/communications/communications.service.js');
const { CacheService } = require('../../dist/infra/cache/cache.service.js');
const root = process.env.REHEARSAL_STATE_ROOT;
if (!root || !process.env.DATABASE_URL?.includes('aveline_rehearsal_test')) throw new Error('Disposable rehearsal state/database required');
const app = await createApplication();
const methods = createMethodTimings();
if (process.env.REHEARSAL_METHOD_TIMINGS === 'true') {
for (const [path, type, names] of [
  ['invitations/invitations.service', 'InvitationsService', ['pageMeta', 'sharedPayload', 'personalPayload', 'servePage']],
  ['rsvp/rsvp.service', 'RsvpService', ['submit', 'loadGuest']],
  ['invitations/sending/rsvp-confirmer.service', 'RsvpConfirmerService', ['confirm', 'queue']],
]) {
  const target = app.get(require(`../../dist/modules/${path}.js`)[type]);
  for (const name of names) methods.wrap(`${type}.${name}`, target, name);
}
}
await app.listen(3000, '0.0.0.0');
const loop = monitorEventLoopDelay({ resolution: 10 }); loop.enable();
let peakRssBytes = 0;
let lastControl = null;
let isSampling = false;
const summary = async () => ({ isDatabaseTracingEnabled, rssBytes: process.memoryUsage().rss, peakRssBytes,
  eventLoop: { p50Ms: loop.percentile(50) / 1e6, p95Ms: loop.percentile(95) / 1e6, p99Ms: loop.percentile(99) / 1e6, maxMs: loop.max / 1e6 },
  poolConnectionAcquisition: traces.snapshot(), at: new Date().toISOString() });
async function sample() {
  if (isSampling) return;
  isSampling = true;
  try {
    peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    await writeFile(`${root}/telemetry.next`, JSON.stringify(await summary()), { mode: 0o600 });
    await rename(`${root}/telemetry.next`, `${root}/telemetry.json`);
    const control = await readFile(`${root}/control.json`, 'utf8').then(JSON.parse).catch(() => null);
    if (!control || control.id === lastControl) return;
    lastControl = control.id;
    const commands = {
      outbox: () => app.get(CommunicationsService).dispatchDue(100),
      'profile-start': () => cpu.start(),
      'profile-stop': () => cpu.stop(),
      'cache-clear': () => { app.get(CacheService).clearVersioned(); return { isCleared: true }; },
      'timings-clear': () => { methods.clear(); return { isCleared: true }; },
      timings: () => methods.snapshot(),
    };
    if (!commands[control.command]) throw new Error('Unknown rehearsal command');
    const result = await commands[control.command]();
    await writeFile(`${root}/control-result.json`, JSON.stringify({ id: control.id, result }), { mode: 0o600 });
  } finally { isSampling = false; }
}
const timer = setInterval(() => { void sample().catch(() => { process.exitCode = 1; }); }, 250);
timer.unref();
process.once('SIGTERM', () => { clearInterval(timer); loop.disable(); void provider?.shutdown(); });
