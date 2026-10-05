/**
 * Writes openapi.json without starting a server.
 *
 * A client generator consumes this directly, which means the frontend's types
 * come from the same decorators that define the routes — they cannot drift
 * from the implementation the way a hand-written type file does.
 */
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { writeFileSync } from 'node:fs';
import { AppModule } from '../src/app.module';

async function exportSchema(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api/v1');

  const config = new DocumentBuilder()
    .setTitle('Aveline API')
    .setDescription(
      'Event invitations, guest graph, ticketing and operations. ' +
        'See docs/API.md for conventions that apply across every endpoint.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .addServer('http://localhost:3000', 'Local development')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  writeFileSync('openapi.json', JSON.stringify(document, null, 2));
  await app.close();

  const paths = Object.keys(document.paths).length;
  console.log(`openapi.json written — ${paths} paths`);
}

void exportSchema();
