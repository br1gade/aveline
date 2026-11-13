import { E2E } from './env';
import { isDevelopmentStack, sendMailNow } from './stack';

/**
 * Mail as a person receives it, read from the stack's Mailpit (setup proposal R20); `devLink` is
 * never used. The backend sends its outbox once a minute. On a development stack the wait asks it
 * to send now (`/development/outbox/send`, FR-152) and is short; anywhere else it waits for the
 * minute, and a test reading mail marks itself slow there (`isMailSlow`).
 */
const WAIT_MS = { development: 15_000, other: 90_000 } as const;
const POLL_MS = 1_000;

/** Whether reading mail waits for the outbox's minute on this stack. */
export async function isMailSlow(): Promise<boolean> {
  return !(await isDevelopmentStack());
}

interface Summary {
  ID: string;
  Subject: string;
}

async function mailpit(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${E2E.mailpitUrl}/api/v1/${path}`, init);
}

/** Whether the stack has a Mailpit to read. */
export async function hasMailpit(): Promise<boolean> {
  try {
    return (await mailpit('info')).ok;
  } catch {
    return false;
  }
}

async function newest(to: string, subject?: RegExp): Promise<Summary | undefined> {
  const response = await mailpit(`search?query=${encodeURIComponent(`to:"${to}"`)}`);
  if (!response.ok) return undefined;
  const { messages } = (await response.json()) as { messages: Summary[] };
  return messages.find((message) => !subject || subject.test(message.Subject));
}

/**
 * The text of the newest message to `to`, waiting for it to arrive. A send that answers 204 has
 * only started (docs/API.md), so the outbox is asked again on each poll until the message is there.
 */
export async function waitForMail(to: string, subject?: RegExp): Promise<string> {
  const isDevelopment = await isDevelopmentStack();
  const waitMs = WAIT_MS[isDevelopment ? 'development' : 'other'];
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    if (isDevelopment) await sendMailNow();
    const found = await newest(to, subject);
    if (found) {
      const message = (await (await mailpit(`message/${found.ID}`)).json()) as { Text: string };
      return message.Text;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`No mail reached the test address within ${waitMs / 1000} s`);
}

/** The first link in `text` on the client's own origin with this path, without its origin. */
export function appLink(text: string, path: RegExp): string {
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gu)) {
    const url = new URL(match[0]);
    if (path.test(url.pathname)) return `${url.pathname}${url.search}`;
  }
  throw new Error(`No link to ${String(path)} in the message`);
}

/** Forgets every message to `to`, so a later wait can't read an earlier one. */
export async function forgetMail(to: string): Promise<void> {
  await mailpit(`search?query=${encodeURIComponent(`to:"${to}"`)}`, { method: 'DELETE' });
}
