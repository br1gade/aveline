import type { OpenAPIObject } from '@nestjs/swagger';
import { completeOpenApiDocument } from './openapi-document';

const documentWith = (paths: OpenAPIObject['paths']): OpenAPIObject => ({ openapi: '3.0.0', info: { title: 't', version: '1' }, paths });

describe('completeOpenApiDocument', () => {
  // A controller reading `@Param() params` or relying on a guard for the id
  // left the parameter out, and generated clients refused the path (FR-44).
  it('declares every templated path parameter the controller did not', () => {
    const document = completeOpenApiDocument(documentWith({
      '/events/{eventId}/drafts/{draftId}': { post: { responses: {}, parameters: [{ name: 'eventId', in: 'path', required: true, schema: { type: 'string' } }] } },
    }));

    expect(document.paths['/events/{eventId}/drafts/{draftId}'].post?.parameters).toEqual([
      { name: 'eventId', in: 'path', required: true, schema: { type: 'string' } },
      { name: 'draftId', in: 'path', required: true, schema: { type: 'string' } },
    ]);
  });

  // HTTP header names are case-insensitive; `@ApiHeader('Idempotency-Key')`
  // beside `@Headers('idempotency-key')` declared the same header twice.
  it('keeps one declaration of a header named twice in different case, the described one', () => {
    const document = completeOpenApiDocument(documentWith({
      '/enquiries': { post: { responses: {}, parameters: [
        { name: 'Idempotency-Key', in: 'header', required: true, description: '8–128 characters' },
        { name: 'idempotency-key', in: 'header', required: true, schema: { type: 'string' } },
      ] } },
    }));

    expect(document.paths['/enquiries'].post?.parameters).toEqual([
      { name: 'Idempotency-Key', in: 'header', required: true, description: '8–128 characters' },
    ]);
  });
});
