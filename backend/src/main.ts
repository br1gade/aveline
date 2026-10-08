// Sentry patches modules as they load, so it must be initialised before
// anything else is imported. This import has to stay first.
import { initialiseSentry } from './infra/observability/sentry';
const isSentryEnabled = initialiseSentry(process.env);

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as PinoLogger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { SerializeInterceptor } from './common/interceptors/serialize';
import { proxyHopsFrom } from './common/proxy-trust';

async function bootstrap() {
  // bufferLogs holds startup messages until pino is attached, so nothing is
  // emitted in the default format and then again in ours.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(PinoLogger));

  const logger = app.get(PinoLogger);
  const isProduction = process.env.NODE_ENV === 'production';

  // Versioned from the start. Adding a version once clients exist means
  // supporting both forever; carrying one from day one costs nothing.
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // Money is BigInt in the domain and JSON.stringify throws on it, so every
  // response passes through here rather than each endpoint remembering.
  app.useGlobalInterceptors(new SerializeInterceptor());

  // Without this, the disconnect handlers on the Redis and Mongo modules never
  // run: a deploy leaves connections open until the server times them out.
  app.enableShutdownHooks();

  // Decides whether the rate limiter is per-client or global; see
  // proxy-trust.ts for why it is a hop count and not a boolean.
  const proxyHops = proxyHopsFrom(process.env);
  if (proxyHops > 0) app.set('trust proxy', proxyHops);

  // An open CORS policy lets any site call the API with a user's credentials.
  // Development stays permissive; production must name its origins.
  const origins = process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim());
  app.enableCors({ origin: isProduction ? (origins ?? false) : true, credentials: true });

  // The schema describes the whole surface, including which routes are
  // public — useful to read, and not something to publish in production.
  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('Aveline API')
      .setDescription('Event invitations, guest graph, ticketing and operations')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  logger.log(
    `Aveline API on http://localhost:${port}/api/v1` +
      `${isProduction ? '' : '  ·  docs at /docs'}` +
      `  ·  errors ${isSentryEnabled ? 'reported to Sentry' : 'logged locally only'}`,
  );
}

void bootstrap();
