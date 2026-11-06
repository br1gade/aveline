import Ajv from 'ajv';
import type { OpenAPIObject } from '@nestjs/swagger';

/** Fail export before a malformed success schema reaches the client generator. */
export function validateResponseSchemas(document: OpenAPIObject): void {
  const validator = new Ajv({ strict: false, validateFormats: false });
  validator.addSchema({ ...document, $id: 'aveline-contract' });
  for (const [path, operations] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!operation || typeof operation !== 'object' || !('responses' in operation)) continue;
      validateOperationResponses(validator, operation as Operation, `/paths/${pointerKey(path)}/${method}/responses`);
    }
  }
}

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

function validateOperationResponses(validator: Ajv, operation: Operation, pointer: string): void {
  for (const [status, response] of Object.entries(operation.responses)) {
    if (!response || !/^2\d\d$/.test(status) || '$ref' in response) continue;
    for (const [type, content] of Object.entries(response.content ?? {})) {
      if (!content.schema) continue;
      try { validator.compile({ $ref: `aveline-contract#${pointer}/${status}/content/${pointerKey(type)}/schema` }); }
      catch (error) { throw new Error(`Invalid response schema for ${operation.operationId}: ${String(error)}`); }
    }
  }
}

function pointerKey(value: string): string { return value.replace(/~/g, '~0').replace(/\//g, '~1'); }
