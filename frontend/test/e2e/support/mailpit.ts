import { E2E } from './env';

/**
 * Mail as a person receives it, read from the stack's Mailpit (setup proposal R20); `devLink` is
 * never used. The backend sends its outbox once a minute, so a message can take that long to
 * arrive (BACKEND_REQUESTS FR-152): a test reading mail calls `test.slow()`.
 */
const WAIT_MS = 90_000;
const POLL_MS = 2_000;

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

/** The text of the newest message to `to`, waiting for it to arrive. */
export async function waitForMail(to: string, subject?: RegExp): Promise<string> {
  const until = Date.now() + WAIT_MS;
  while (Date.now() < until) {
    const found = await newest(to, subject);
    if (found) {
      const message = (await (await mailpit(`message/${found.ID}`)).json()) as { Text: string };
      return message.Text;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`No mail reached the test address within ${WAIT_MS / 1000} s`);
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
