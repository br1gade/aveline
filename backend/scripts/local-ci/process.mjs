import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { open } from 'node:fs/promises';
const execute = promisify(execFile);
const active = new Set();
let wasInterrupted = false;
export function stopProcesses() { wasInterrupted = true; for (const child of active) child.kill('SIGTERM'); }
export function checkInterrupted() { if (wasInterrupted) throw new Error('Local CI interrupted; no success proof was written'); }
export async function output(command, args, options = {}) {
  return (await execute(command, args, { cwd: options.cwd, env: options.env ?? process.env, timeout: 120000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
}
export async function logged(command, args, options) {
  const handle = await open(options.log, 'a', 0o600);
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: options.cwd, env: options.env ?? process.env, stdio: ['ignore', handle.fd, handle.fd], timeout: options.timeout ?? 3600000 });
      active.add(child);
      child.on('error', (error) => { active.delete(child); reject(error); });
      child.on('exit', (code, signal) => { active.delete(child); code === 0 ? resolve() : reject(new Error(`${options.stage} failed (${signal ?? code}); private log: ${options.log}`)); });
    });
  } finally { await handle.close(); }
}
