import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv from 'ajv';
import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { addRecoverySchema } from '../../scripts/openapi/response-recovery';
import { describeJobRecovery } from './interceptors/job-recovery.interceptor';

const document = JSON.parse(readFileSync(join(__dirname, '../../openapi.json'), 'utf8')) as OpenAPIObject;
type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

function operationNamed(name: string): Operation {
  for (const operations of Object.values(document.paths)) {
    for (const operation of Object.values(operations)) {
      if (operation && typeof operation === 'object' && 'operationId' in operation && operation.operationId === name) return operation as Operation;
    }
  }
  throw new Error(`No operation ${name}`);
}

function mediaFor(name: string, status: string) {
  const response = operationNamed(name).responses[status];
  if (!response || '$ref' in response) throw new Error('No concrete response');
  return response.content;
}

describe('the generated contract matches the serialized wire response', () => {
  it('declares template adoption fields without requiring optional fields', () => {
    const schema = document.components?.schemas?.ChooseTemplateDto as SchemaObject;
    expect(Object.keys(schema.properties ?? {})).toEqual(expect.arrayContaining(['templateKey', 'templateVersionId', 'previewId', 'expectedTemplateVersionId', 'expectedDesignRevision', 'idempotencyKey']));
    expect(schema.required).toEqual(['templateKey']);
  });
  it.each([['CreateTableDto', 'capacity'], ['UpdateTableDto', 'capacity'], ['CreateTablesDto', 'capacity'], ['CreateTablesDto', 'count'], ['AssignSeatDto', 'position']])('declares %s.%s as an integer', (name, property) => {
    const schema = document.components?.schemas?.[name] as SchemaObject;
    expect(schema.properties?.[property]).toMatchObject({ type: 'integer' });
  });
  it('declares optional organization idempotency and ticket-order status filters', () => {
    expect(operationNamed('OrganizationsController_create').parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'idempotency-key', in: 'header', required: false })]));
    expect(operationNamed('TicketSetupController_listOrders').parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'status', in: 'query', required: false, schema: expect.objectContaining({ enum: expect.arrayContaining(['PAID', 'RESERVED']) }) })]));
  });
  it.each(['EnquiriesController_create', 'EnquiryConversionController_convert'])('describes %s creation and replay as JSON', (name) => {
    expect(mediaFor(name, '200')).toHaveProperty('application/json');
    expect(mediaFor(name, '201')).toHaveProperty('application/json');
  });
  it('describes ready and queued template previews as JSON', () => {
    expect(mediaFor('TemplateAdoptionController_preview', '201')).toHaveProperty('application/json');
    expect(mediaFor('TemplateAdoptionController_preview', '202')).toHaveProperty('application/json');
  });
  it('keeps download MIME types and the plain-text webhook challenge', () => {
    const files = mediaFor('ExportSnapshotsController_download', '200');
    expect(Object.keys(files ?? {})).toEqual(['text/csv', 'application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
    expect(files?.['application/pdf'].schema).toEqual({ type: 'string', format: 'binary' });
    expect(mediaFor('WhatsAppWebhookController_verify', '200')).toHaveProperty('text/plain');
  });
  it.each(['root', 'items', 'signatureUploads'])('describes the recovery actually added to %s job summaries', (collection) => {
    const item: SchemaObject = { type: 'object', properties: { id: { type: 'string' }, failureReason: { type: 'string', nullable: true }, status: { type: 'string' } }, required: ['id', 'failureReason', 'status'] };
    const summary = { id: 'job', failureReason: 'GENERATION_FAILED', status: 'FAILED' };
    const schema: SchemaObject = collection === 'root' ? item : { type: 'object', properties: { [collection]: { type: 'array', items: item } }, required: [collection] };
    const raw = collection === 'root' ? summary : { [collection]: [summary] };
    addRecoverySchema(schema);
    const validate = new Ajv({ strict: false, validateFormats: false }).compile({ components: document.components, ...schema });
    expect(validate(describeJobRecovery(raw, 'hy'))).toBe(true);
    expect(validate(raw)).toBe(false);
  });
});
