import ts from 'typescript';
import type { SchemaObject } from '@nestjs/swagger';

/** Describes the value after the API's date/bigint JSON serialization. */
export class ResponseSchemaBuilder {
  private readonly active = new Set<ts.Type>();
  constructor(private readonly checker: ts.TypeChecker) {}

  build(type: ts.Type): SchemaObject {
    const awaited = this.checker.getAwaitedType(type) ?? type;
    if (this.active.has(awaited)) return {};
    this.active.add(awaited);
    try { return this.describe(awaited); }
    finally { this.active.delete(awaited); }
  }

  private describe(type: ts.Type): SchemaObject {
    if (type.isUnion()) return this.union(type.types);
    const scalar = scalarSchema(type, this.checker);
    if (scalar) return scalar;
    if (this.checker.isArrayLikeType(type)) {
      const item = this.checker.getIndexTypeOfType(type, ts.IndexKind.Number);
      return { type: 'array', items: item ? this.build(item) : {} };
    }
    return this.object(type);
  }

  private union(types: readonly ts.Type[]): SchemaObject {
    const present = types.filter((type) => !(type.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)));
    const schemas = [...new Map(present.map((type) => { const schema = this.build(type); return [JSON.stringify(schema), schema]; })).values()];
    if (!present.length && types.some((type) => type.flags & ts.TypeFlags.Null)) return NULL_ONLY;
    const schema = combineUnion(schemas);
    return types.some((type) => type.flags & ts.TypeFlags.Null) ? withNull(schema) : schema;
  }

  private object(type: ts.Type): SchemaObject {
    const properties: Record<string, SchemaObject> = {};
    const required: string[] = [];
    for (const symbol of this.checker.getPropertiesOfType(type)) {
      const value = this.checker.getTypeOfSymbol(symbol);
      if (value.getCallSignatures().length) continue;
      properties[symbol.name] = this.build(value);
      if (!(symbol.flags & ts.SymbolFlags.Optional) && !hasUndefined(value)) required.push(symbol.name);
    }
    const index = this.checker.getIndexTypeOfType(type, ts.IndexKind.String);
    return { type: 'object', properties, ...(required.length ? { required } : {}),
      ...(index ? { additionalProperties: this.build(index) } : {}) };
  }
}

function scalarSchema(type: ts.Type, checker: ts.TypeChecker): SchemaObject | undefined {
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.Void | ts.TypeFlags.Undefined)) return {};
  if (type.isStringLiteral()) return { type: 'string', enum: [type.value] };
  if (type.isNumberLiteral()) return { type: 'number', enum: [type.value] };
  if (type.flags & ts.TypeFlags.StringLike) return { type: 'string' };
  if (type.flags & ts.TypeFlags.NumberLike) return { type: 'number' };
  if (type.flags & ts.TypeFlags.BooleanLike) return { type: 'boolean' };
  if (type.flags & ts.TypeFlags.BigIntLike) return { type: 'string', pattern: '^-?[0-9]+$' };
  return namedScalar(type.getSymbol()?.name, checker.typeToString(type));
}

function namedScalar(name: string | undefined, display: string): SchemaObject | undefined {
  if (name === 'Date') return { type: 'string', format: 'date-time' };
  if (name === 'Buffer' || name === 'StreamableFile') return { type: 'string', format: 'binary' };
  if (display === 'null') return NULL_ONLY;
  return undefined;
}

export const NULL_ONLY: SchemaObject = { type: 'string', nullable: true, enum: [null] };

function withNull(schema: SchemaObject): SchemaObject {
  if (!Object.keys(schema).length) return schema;
  return schema.type ? { ...schema, nullable: true, ...(schema.enum ? { enum: [...schema.enum, null] } : {}) } : { anyOf: [schema, NULL_ONLY] };
}

function combineUnion(schemas: SchemaObject[]): SchemaObject {
  if (!schemas.length) return {};
  if (schemas.length === 1) return schemas[0];
  const type = schemas[0].type;
  if (schemas.every((schema) => schema.type === type && schema.enum)) {
    return { type, enum: [...new Set(schemas.flatMap((schema) => schema.enum ?? []))] };
  }
  return { anyOf: schemas };
}

function hasUndefined(type: ts.Type): boolean {
  return Boolean(type.flags & ts.TypeFlags.Undefined) || (type.isUnion() && type.types.some((entry) => Boolean(entry.flags & ts.TypeFlags.Undefined)));
}
