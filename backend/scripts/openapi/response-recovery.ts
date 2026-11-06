import type { ReferenceObject, SchemaObject } from '@nestjs/swagger';
import { NULL_ONLY } from './response-schema';

/** The same traversed collections and early returns as JobRecoveryInterceptor. */
export function addRecoverySchema(schema: SchemaObject | ReferenceObject): void {
  if ('$ref' in schema) return;
  schema.anyOf?.forEach(addRecoverySchema);
  if (schema.type === 'array' && schema.items) { addRecoverySchema(schema.items); return; }
  const properties = schema.properties;
  if (!properties) return;
  if (isArray(properties.items)) { addRecoverySchema(properties.items); return; }
  if (isArray(properties.signatureUploads)) { addRecoverySchema(properties.signatureUploads); return; }
  if (!Object.hasOwn(properties, 'failureReason')) return;
  properties.recovery = { anyOf: [{ $ref: '#/components/schemas/JobRecoveryDto' }, NULL_ONLY] };
  schema.required = [...new Set([...(schema.required ?? []), 'recovery'])];
}

function isArray(schema?: SchemaObject | ReferenceObject): schema is SchemaObject {
  return schema !== undefined && !('$ref' in schema) && schema.type === 'array';
}
