import ts from 'typescript';
import type { OpenAPIObject, SchemaObject } from '@nestjs/swagger';
import { ResponseSchemaBuilder } from './response-schema';
import { addRecoverySchema } from './response-recovery';
import type { OpenApiRoutePolicy } from '../../src/common/openapi-route-policy';
import type { ResponseTransport } from '../../src/common/openapi-response-transport';

interface ResponseShape { schema: SchemaObject; isVoid: boolean; isStream: boolean }

/** Export-time only: production does not need the TypeScript compiler. */
export function addInferredResponses(document: OpenAPIObject, policies: Map<string, OpenApiRoutePolicy>): void {
  const configPath = ts.findConfigFile(process.cwd(), ts.sys.fileExists, 'tsconfig.build.json');
  if (!configPath) throw new Error('Cannot find the backend TypeScript configuration');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, process.cwd());
  const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true, incremental: false });
  const checker = program.getTypeChecker();
  const builder = new ResponseSchemaBuilder(checker);
  const shapes = new Map<string, ResponseShape>();
  for (const file of program.getSourceFiles().filter((source) => source.fileName.endsWith('.controller.ts'))) {
    for (const declaration of file.statements.filter(ts.isClassDeclaration)) collectResponses(declaration, { checker, builder, shapes });
  }
  document.components ??= {};
  document.components.schemas ??= {};
  for (const operations of Object.values(document.paths)) {
    for (const operation of Object.values(operations)) {
      if (operation && typeof operation === 'object' && 'responses' in operation) {
        completeResponse(document, operation as Operation, shapes, policies);
      }
    }
  }
}

type Operation = NonNullable<OpenAPIObject['paths'][string]['get']>;

function collectResponses(declaration: ts.ClassDeclaration, context: { checker: ts.TypeChecker; builder: ResponseSchemaBuilder; shapes: Map<string, ResponseShape> }): void {
  for (const method of declaration.members.filter(ts.isMethodDeclaration)) {
    const signature = context.checker.getSignatureFromDeclaration(method);
    if (!signature) continue;
    const result = context.checker.getReturnTypeOfSignature(signature);
    const type = context.checker.getAwaitedType(result) ?? result;
    context.shapes.set(`${declaration.name?.text}_${method.name.getText()}`, {
      schema: context.builder.build(type), isVoid: Boolean(type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Undefined)), isStream: type.getSymbol()?.name === 'StreamableFile',
    });
  }
}

function completeResponse(document: OpenAPIObject, operation: Operation, shapes: Map<string, ResponseShape>, policies: Map<string, OpenApiRoutePolicy>): void {
  const shape = shapes.get(operation.operationId ?? '');
  if (!shape) throw new Error(`No typed return for ${operation.operationId}`);
  const transport = policies.get(operation.operationId ?? '')?.response;
  if (!transport) throw new Error(`No response transport for ${operation.operationId}`);
  if (transport.hasJobRecovery) addRecoverySchema(shape.schema);
  for (const [status, response] of Object.entries(operation.responses)) {
    if (!response || !/^2\d\d$/.test(status) || '$ref' in response || response.content) continue;
    if (shape.isVoid && !transport.isRaw) continue;
    const name = `${operation.operationId}Response`;
    if (transport.isRaw || shape.isStream) response.content = binaryContent(transport);
    else {
      document.components!.schemas![name] = shape.schema;
      response.content = Object.fromEntries((transport.mediaTypes.length ? transport.mediaTypes : ['application/json'])
        .map((type) => [type, { schema: { $ref: `#/components/schemas/${name}` } }]));
    }
  }
}

function binaryContent(transport: ResponseTransport) {
  return Object.fromEntries((transport.mediaTypes.length ? transport.mediaTypes : ['application/octet-stream'])
    .map((type) => [type, { schema: { type: 'string' as const, format: 'binary' } }]));
}
