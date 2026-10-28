// Sentry patches modules as they load, so it must be initialised before
// anything else is imported. This import has to stay first.
import { initialiseSentry } from './infra/observability/sentry';
const isSentryEnabled = initialiseSentry(process.env);

import { Logger as PinoLogger } from 'nestjs-pino';
import { createApplication } from './application';
import { allowsDevelopmentShortcuts } from './common/environment';

async function bootstrap() {
  const app = await createApplication();
  const logger = app.get(PinoLogger);
  const canUseShortcuts = allowsDevelopmentShortcuts(process.env.NODE_ENV);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  logger.log(
    `Aveline API on http://localhost:${port}/api/v1` +
      `${canUseShortcuts ? '  ·  docs at /docs' : ''}` +
      `  ·  errors ${isSentryEnabled ? 'reported to Sentry' : 'logged locally only'}`,
  );
}

void bootstrap();
