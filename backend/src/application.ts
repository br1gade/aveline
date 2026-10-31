import { completeOpenApiDocument } from './common/openapi-document';
import { configureWhatsAppBodyParser } from './modules/communications/whatsapp/whatsapp-body-parser';
import { ValidationPipe } from '@nestjs/common';
import { FEEDBACK_MODELS } from './common/feedback.dto';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { StorageService } from './infra/storage/storage.service';
import { Logger as PinoLogger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { SerializeInterceptor } from './common/interceptors/serialize';
import { proxyHopsFrom } from './common/proxy-trust';
import { corsOptionsFor } from './common/cors';
import { allowsDevelopmentShortcuts } from './common/environment';

/**
 * With no object store configured, uploads land on this server's disk under
 * URLs like /files/ab/<key> — which nothing served, so every image and song
 * was a broken link. The same root the filesystem adapter writes to.
 */
function serveLocalUploads(app: NestExpressApplication): void {
  if (app.get(StorageService).backend !== 'filesystem') return;
  app.useStaticAssets(process.env.STORAGE_ROOT ?? './storage', { prefix: '/files', index: false, dotfiles: 'deny' });
}

/** Shared by the normal server and the disposable production rehearsal. */
export async function createApplication() {
  // bufferLogs holds startup messages until pino is attached, so nothing is
  // emitted in the default format and then again in ours.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true });
  configureWhatsAppBodyParser(app);
  app.useLogger(app.get(PinoLogger));

  // Development conveniences — open CORS, the schema page — only when
  // NODE_ENV says development or test outright; see common/environment.ts.
  const canUseShortcuts = allowsDevelopmentShortcuts(process.env.NODE_ENV);

  // Versioned from the start. Adding a version once clients exist means
  // supporting both forever; carrying one from day one costs nothing.
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // Money is BigInt in the domain and JSON.stringify throws on it, so every
  // response passes through here rather than each endpoint remembering.
  app.useGlobalInterceptors(new SerializeInterceptor());

  serveLocalUploads(app);

  // Without this, the disconnect handlers on the Redis and Mongo modules never
  // run: a deploy leaves connections open until the server times them out.
  app.enableShutdownHooks();

  // Decides whether the rate limiter is per-client or global; see
  // proxy-trust.ts for why it is a hop count and not a boolean.
  const proxyHops = proxyHopsFrom(process.env);
  if (proxyHops > 0) app.set('trust proxy', proxyHops);

  app.enableCors(corsOptionsFor(canUseShortcuts, process.env));

  configureSchema(app, canUseShortcuts);
  return app;
}

function configureSchema(app: NestExpressApplication, canUseShortcuts: boolean): void {
  // The schema describes the whole surface, including which routes are
  // public — useful to read, and not something to publish in production.
  if (canUseShortcuts) {
    const config = new DocumentBuilder()
      .setTitle('Aveline API')
      .setDescription('Event invitations, guest graph, ticketing and operations')
      .setVersion('0.1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup(
      'docs',
      app,
      completeOpenApiDocument(
        SwaggerModule.createDocument(app, config, { extraModels: FEEDBACK_MODELS }),
      ),
    );
  }
}
