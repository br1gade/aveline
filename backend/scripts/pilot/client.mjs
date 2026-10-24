import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';
import { requireLocalTarget, summarizeSamples } from './rehearsal-policy.mjs';

export function createClient(origin) {
  const base = requireLocalTarget(origin);
  const samples = {};
  let sequence = 0;
  async function request(method, path, payload, options = {}) {
    const requestNumber = ++sequence;
    const started = performance.now();
    const isForm = payload instanceof FormData;
    const headers = { ...(options.authorization ? { authorization: options.authorization } : {}), ...(!isForm && payload ? { 'content-type': 'application/json' } : {}) };
    const response = await fetch(new URL(`/api/v1${path}`, base), { method, headers, body: isForm ? payload : payload ? JSON.stringify(payload) : undefined, signal: AbortSignal.timeout(options.timeoutMs ?? 20000) });
    const expected = options.expected ?? (method === 'POST' ? 201 : 200);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (options.profile) (samples[options.profile] ??= []).push({ milliseconds: performance.now() - started, status: response.status, expected });
    const accepted = Array.isArray(expected) ? expected : [expected];
    const hints = response.status === 400 ? validationFields(buffer) : '';
    assert.ok(accepted.includes(response.status), `Rehearsal ${options.stage ?? method} request ${requestNumber} returned ${response.status}; expected ${accepted.join('/')} ${hints}`);
    if (options.bytes) return { buffer: buffer, headers: response.headers };
    if (response.status === 204) return null;
    return JSON.parse(buffer.toString());
  }
  return { request, profiles: () => Object.fromEntries(Object.entries(samples).map(([key, values]) => [key, summarizeSamples(values)])) };
}

export async function poll(load, isDone, label, { timeoutMs = 120000, intervalMs = 1000 } = {}) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await load();
    if (isDone(value)) return value;
    await pause(intervalMs);
  }
  throw new Error(`Rehearsal timed out: ${label}`);
}

function validationFields(buffer) {
  try {
    const messages = JSON.parse(buffer.toString()).message;
    const list = Array.isArray(messages) ? messages : [messages];
    return [...new Set(list.map((value) => typeof value === 'string' ? /^[a-zA-Z][a-zA-Z.]{0,40}(?=[: ])/u.exec(value)?.[0] : null).filter(Boolean))].join(',');
  } catch { return ''; }
}
