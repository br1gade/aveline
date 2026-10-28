// A deterministic test fence around computation, before the production runner
// takes its exclusive apply locks. No production job or planner uses this hook.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as pause } from 'node:timers/promises';
const require = createRequire(import.meta.url);
if (!process.env.DATABASE_URL?.includes('aveline_rehearsal_test')) throw new Error('Disposable rehearsal database required');
const { SeatingPlanner } = require('../../dist/modules/seating/jobs/seating-planner.js');
const original = SeatingPlanner.prototype.plan;
const root = process.env.REHEARSAL_STATE_ROOT;
const fence = () => readFile(`${root}/seating-plan-fence.json`, 'utf8').then(JSON.parse).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
  return null;
});
SeatingPlanner.prototype.plan = async function (input) {
  const plan = await original.call(this, input);
  if (!(await fence())?.isHeld) return plan;
  await writeFile(`${root}/seating-plan-held.json`, JSON.stringify({ isHeld: true }), { mode: 0o600 });
  const limit = Date.now() + 15000;
  while ((await fence())?.isHeld) {
    if (Date.now() >= limit) throw new Error('Rehearsal planning fence timed out');
    await pause(50);
  }
  return plan;
};
require('../../dist/seating-worker.js');
