import { ApiQuery } from '@nestjs/swagger';
import type { OpenAPIObject } from '@nestjs/swagger';

type OperationObject = NonNullable<OpenAPIObject['paths'][string]['get']>;
type Parameter = NonNullable<OperationObject['parameters']>[number];
type ParameterObject = Extract<Parameter, { in: string }>;

/**
 * Fills what Nest's schema generator cannot see, so the generated client a
 * type generator builds from `openapi.json` accepts every real request:
 *
 * - **Path parameters** read as `@Param() params: {…}`, or not read at all
 *   because a guard resolves them, are invisible to it. Every `{name}` in a
 *   route is required by the router, so it is declared.
 * - **Headers declared twice** in different case (`@ApiHeader` beside
 *   `@Headers`) are one header; the described declaration is kept.
 */
export function completeOpenApiDocument(document: OpenAPIObject): OpenAPIObject {
  for (const [path, operations] of Object.entries(document.paths)) {
    for (const operation of Object.values(operations) as OperationObject[]) {
      if (typeof operation !== 'object' || !('responses' in operation)) continue;
      operation.parameters = withPathParameters(path, uniqueHeaders(operation.parameters ?? []));
    }
  }
  return document;
}

function withPathParameters(path: string, parameters: Parameter[]): Parameter[] {
  const declared = new Set(parameters.filter(isPathParameter).map((parameter) => parameter.name));
  const missing = [...path.matchAll(/\{(\w+)\}/g)]
    .map(([, name]) => name)
    .filter((name) => !declared.has(name))
    .map((name): ParameterObject => ({ name, in: 'path', required: true, schema: { type: 'string' } }));
  return [...parameters, ...missing];
}

function uniqueHeaders(parameters: Parameter[]): Parameter[] {
  const kept = new Map<string, ParameterObject>();
  for (const parameter of parameters) {
    if (!('in' in parameter) || parameter.in !== 'header') continue;
    const key = parameter.name.toLowerCase();
    const current = kept.get(key);
    if (!current || (!current.description && parameter.description)) kept.set(key, parameter);
  }
  return parameters.filter((parameter) => !('in' in parameter) || parameter.in !== 'header' || kept.get(parameter.name.toLowerCase()) === parameter);
}

const isPathParameter = (parameter: Parameter): parameter is ParameterObject => 'in' in parameter && parameter.in === 'path';

/**
 * Declares a query parameter optional. `@Query('x') x?: string` is optional
 * in TypeScript only; the schema generator cannot see it and marked it
 * required, so generated clients demanded it (FR-17).
 */
export function OptionalQuery(name: string, description?: string): MethodDecorator {
  return ApiQuery({ name, required: false, description });
}
