/**
 * Writes openapi.json without starting a server.
 *
 * A client generator consumes this directly, which means the frontend's types
 * come from the same decorators that define the routes — they cannot drift
 * from the implementation the way a hand-written type file does.
 *
 * The committed file can, though, if nobody regenerates it: it once sat at 36
 * paths while the API had grown to 107, and a client generating types from it
 * would never have seen the other 71. `--check` regenerates in memory and
 * fails if the committed file differs, and `npm run verify` runs it.
 */
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { AppModule } from '../src/app.module';

const OUTPUT = 'openapi.json';

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
  await app.close();

  const generated = JSON.stringify(document, null, 2);
  const paths = Object.keys(document.paths).length;

  if (process.argv.includes('--check')) {
    const committed = existsSync(OUTPUT) ? readFileSync(OUTPUT, 'utf8') : '';
    if (committed !== generated) {
      console.error(`${OUTPUT} is out of date with the code (${paths} paths). Run: npm run openapi`);
      process.exit(1);
    }
    console.log(`${OUTPUT} matches the code — ${paths} paths`);
    return;
  }

  writeFileSync(OUTPUT, generated);
  console.log(`${OUTPUT} written — ${paths} paths`);
}

void exportSchema();
