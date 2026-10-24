import assert from 'node:assert/strict';
import { writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { createEnvironment } from './environment.mjs';
import { createClient, poll } from './client.mjs';
import { prepareJourney, seatBoth, checkAttendance, transition, importPeople } from './journey.mjs';
import { checkLoad } from './load.mjs';
import { checkContributions } from './contributions.mjs';
import { checkExports } from './exports.mjs';
import { checkRecovery } from './recovery.mjs';
import { checkWorkerLeases } from './worker-recovery.mjs';
import { checkMailAndStorage } from './mail-recovery.mjs';
import { checkMessages } from './messages.mjs';
import { checkTickets } from './ticketing.mjs';

const isFunctionalOnly = process.argv.includes('--functional-only');
assert.ok(process.argv.slice(2).every((argument) => argument === '--functional-only'), 'Unknown rehearsal option');
const environment = await createEnvironment();
const report = { scope: 'disposable-local-backend', mode: isFunctionalOnly ? 'functional-only' : 'full', startedAt: new Date().toISOString(), image: environment.image, isRunning: true, isLocalPerformancePassed: null, isAcceptedForProduction: false, phases: {} };
let stage = 'setup';
let client;
try {
  await startStage('setup');
  report.environment = await environment.describe();
  await environment.setup();
  client = createClient(environment.origin);
  await startStage('400-person journey');
  const context = await prepareJourney(client, environment);
  report.phases.fixture = { people: 400, households: 100, venues: 2, tables: 100, seats: 800, locales: ['en', 'ru', 'fr', 'hy'] };
  await startStage('event-wide seating');
  report.phases.eventWideSeating = await seatBoth(context);
  await startStage('per-venue reconfirmation');
  report.phases.attendanceRevision = await checkAttendance(context, client, environment);
  report.phases.perVenueSeating = await seatBoth(context, 'PER_VENUE');
  await startStage(isFunctionalOnly ? 'load measurement skipped' : '50 readers and 10 writers');
  if (!isFunctionalOnly) {
    report.phases.load = await checkLoad(context, client, environment, report.phases.attendanceRevision);
    report.isLocalPerformancePassed = report.phases.load.budgets.isPassed;
  }
  await startStage('named ticket checkout and listing media');
  report.phases.tickets = await checkTickets(context, client, report.phases.attendanceRevision);
  await startStage('private guest contributions');
  report.phases.contributions = await checkContributions(context, client);
  await startStage('84 worker-produced snapshot exports');
  report.phases.exports = await checkExports(context, environment);
  await startStage('dependency and worker recovery');
  report.phases.recovery = await checkRecovery(context, client, environment);
  await startStage('in-flight worker lease recovery');
  report.phases.workerLeases = await checkWorkerLeases(context, environment);
  await startStage('mail and private storage recovery');
  report.phases.mailAndStorage = await checkMailAndStorage(context, environment, report.phases.exports);
  await startStage('reverse attendance transition');
  report.phases.returnRevision = await transition(context, 'EVENT_WIDE');
  await startStage('2000-person import');
  const bulk = await context.host('POST', '/events', { type: 'WEDDING', title: 'Separate bulk import', templateKey: 'classic', startsAt: new Date(Date.now() + 86400000).toISOString() });
  const started = performance.now();
  await importPeople(context.host, bulk.id, 2000);
  const imported = await context.host('GET', `/events/${bulk.id}/guests`);
  assert.equal(imported.flatMap((household) => household.guests).length, 2000);
  report.phases.bulkImport = { people: 2000, milliseconds: performance.now() - started };
  await startStage('reminder and thank-you journey');
  report.phases.messages = await checkMessages(context, environment);
  await startStage('expiry and erasure');
  await environment.fixture('expire');
  await client.request('GET', context.path(), undefined, { expected: 404 });
  await context.host('GET', `/events/${context.event.id}/dashboard`);
  await environment.fixture('erase');
  await context.host('GET', `/events/${context.event.id}/export-snapshots/${report.phases.exports.firstId}/download`, undefined, { expected: 410 });
  report.phases.erasure = (await environment.read('erasure')).counts;
  assert.ok(report.phases.erasure.privateMediaQueuedForDeletion > 0);
  report.phases.erasureCleanup = await poll(async () => {
    await environment.fixture('erasure-cleanup-report');
    return environment.read('erasure-cleanup-report');
  }, (value) => value.isCleared && value.isBytesRemoved, 'physical private-media erasure', { timeoutMs: 60000 });
  assert.ok(report.phases.erasureCleanup.trackedMedia > 0);
  delete report.phases.exports.firstId;
  assert.equal((await fetch(`${environment.origin}/docs`)).status, 404);
  report.telemetry = await environment.read('telemetry');
  report.isLocalFunctionalPassed = true;
  report.isLocalPerformancePassed = report.phases.load?.budgets.isPassed ?? null;
  if (report.isLocalPerformancePassed === false) { console.error('J: performance budgets missed; inspect the sanitized report'); process.exitCode = 1; }
} catch (error) {
  report.isLocalFunctionalPassed = false;
  report.partialProfiles = client?.profiles();
  report.failure = { stage, message: error instanceof assert.AssertionError ? error.message : `${error?.name ?? 'Error'}: stage failed; command arguments and response bodies withheld` };
  console.error(`J failed: ${stage}. ${report.failure.message}`);
  process.exitCode = 1;
} finally {
  report.isRunning = false;
  report.finishedAt = new Date().toISOString();
  await saveReport();
  await environment.cleanup();
  console.log(`J sanitized report: ${join(environment.outputRoot, 'report.json')}`);
}

async function startStage(name) {
  stage = name; report.activeStage = name;
  console.log(`J: ${name}`);
  await saveReport();
}

async function saveReport() {
  await writeFile(join(environment.outputRoot, 'report.next'), JSON.stringify(report, null, 2), { mode: 0o600 });
  await rename(join(environment.outputRoot, 'report.next'), join(environment.outputRoot, 'report.json'));
}
