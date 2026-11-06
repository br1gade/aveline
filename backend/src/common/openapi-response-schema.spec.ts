import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import Ajv from 'ajv';
import { ResponseSchemaBuilder } from '../../scripts/openapi/response-schema';

describe('response schemas describe the serialized TypeScript return value', () => {
  const directory = mkdtempSync(join(tmpdir(), 'aveline-response-schema-'));
  const file = join(directory, 'response.ts');
  writeFileSync(file, `interface JsonArray extends Array<unknown> {}\nexport function response(): { amount: bigint; at: Date; status: 'OPEN' | 'CLOSED'; label?: string; rows: { id: string }[]; value: boolean | null; json: JsonArray; mixed: string | { name: string } | null; empty: null; nullableStatus: 'OPEN' | 'CLOSED' | null } { throw new Error(); }`);
  const program = ts.createProgram([file], { strict: true, target: ts.ScriptTarget.ES2023 });
  const checker = program.getTypeChecker();
  const node = program.getSourceFile(file)!.statements.find(ts.isFunctionDeclaration)!;
  const signature = checker.getSignatureFromDeclaration(node)!;
  const schema = new ResponseSchemaBuilder(checker).build(checker.getReturnTypeOfSignature(signature));
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  it('keeps money exact and dates as ISO strings', () => {
    expect(schema.properties).toMatchObject({ amount: { type: 'string', pattern: '^-?[0-9]+$' }, at: { type: 'string', format: 'date-time' } });
  });
  it('preserves enums, collection shapes, nullability and optional properties', () => {
    expect(schema.properties).toMatchObject({ status: { type: 'string', enum: ['OPEN', 'CLOSED'] }, rows: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' } } } }, value: { type: 'boolean', nullable: true } });
    expect(schema.required).toEqual(['amount', 'at', 'status', 'rows', 'value', 'json', 'mixed', 'empty', 'nullableStatus']);
  });
  it('represents array interfaces as arrays and nullable unions as valid schemas', () => {
    expect(schema.properties?.json).toMatchObject({ type: 'array', items: {} });
    const validate = new Ajv({ strict: false, validateFormats: false }).compile(schema);
    const base = { amount: '25000', at: '2026-11-05T09:00:00Z', status: 'OPEN', rows: [], value: null, json: [1, 'x', null], mixed: null, empty: null, nullableStatus: null };
    expect(validate(base)).toBe(true);
    expect(validate({ ...base, mixed: { name: 'Ani' } })).toBe(true);
    expect(validate({ ...base, mixed: 'text' })).toBe(true);
    expect(validate({ ...base, mixed: 12 })).toBe(false);
    expect(validate({ ...base, empty: 'not null' })).toBe(false);
    expect(validate({ ...base, nullableStatus: 'OPEN' })).toBe(true);
    expect(validate({ ...base, nullableStatus: 'UNKNOWN' })).toBe(false);
  });
});
