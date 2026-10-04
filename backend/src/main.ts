import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { SerializeInterceptor } from './common/interceptors/serialize';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  const isProduction = process.env.NODE_ENV === 'production';

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  // Money is BigInt in the domain and JSON.stringify throws on it, so every
  // response passes through here rather than each endpoint remembering.
  app.useGlobalInterceptors(new SerializeInterceptor());

  // Without this, the disconnect handlers on the Redis and Mongo modules never
  // run: a deploy leaves connections open until the server times them out.
  app.enableShutdownHooks();

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
  logger.log(`Aveline API on http://localhost:${port}/api${isProduction ? '' : '  ·  docs at /docs'}`);
}

void bootstrap();
