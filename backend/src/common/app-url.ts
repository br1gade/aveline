import { ValidateBy } from 'class-validator';

/** Where the client runs when PUBLIC_APP_URL is unset: the Vite dev server. */
export const DEFAULT_APP_URL = 'http://localhost:5173';

/** A page of the client app, as an absolute URL. */
export function appPage(path: string, env: NodeJS.ProcessEnv = process.env): string {
  return `${env.PUBLIC_APP_URL ?? DEFAULT_APP_URL}${path}`;
}

/** Whether a URL is on the client app's own origin — scheme, host and port. */
export function isOnAppOrigin(candidate: unknown, env: NodeJS.ProcessEnv = process.env): boolean {
  if (typeof candidate !== 'string') return false;
  try {
    return new URL(candidate).origin === new URL(env.PUBLIC_APP_URL ?? DEFAULT_APP_URL).origin;
  } catch {
    return false;
  }
}

/**
 * A URL that must lead back into the client app.
 *
 * Where the bank sends the payer afterwards. Unchecked, it made the bank's
 * own page the first hop of a redirect to anywhere: a phishing link that
 * passes through a real payment page is believed.
 */
export function OnAppOrigin(): PropertyDecorator {
  return ValidateBy({
    name: 'onAppOrigin',
    validator: {
      validate: (value: unknown) => isOnAppOrigin(value),
      defaultMessage: () => '$property must be a page of the Aveline app',
    },
  });
}
