import { E2E } from './env';

/**
 * Before any test: the client at the base URL is Aveline. The config reuses whatever already
 * answers there, and on 20 November another project's dev server held port 5173, so the whole
 * suite ran against it and failed for reasons that weren't Aveline's (audit 20 Nov, A4-10).
 */
export default async function assertAvelineAnswers(): Promise<void> {
  // The help page asks the API nothing, so a backend still starting isn't read as another app.
  const response = await fetch(new URL('/help', E2E.baseUrl));
  const title = /<title>([^<]*)<\/title>/.exec(await response.text())?.[1] ?? '';
  if (!response.ok || !title.includes('Aveline')) {
    throw new Error(
      `${E2E.baseUrl} doesn't serve Aveline (status ${response.status}, title "${title}"). ` +
        'Stop what holds the port, or name the client with E2E_BASE_URL.',
    );
  }
}
