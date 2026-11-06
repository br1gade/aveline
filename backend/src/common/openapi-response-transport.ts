import { HEADERS_METADATA, INTERCEPTORS_METADATA, RESPONSE_PASSTHROUGH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { DECORATORS } from '@nestjs/swagger';
import { JobRecoveryInterceptor } from './interceptors/job-recovery.interceptor';

export interface ResponseTransport { isRaw: boolean; mediaTypes: string[]; hasJobRecovery: boolean }
interface ControllerType { prototype: object }

/** Read the runtime metadata rather than parsing the spelling of decorators. */
export function responseTransportFor(controller: ControllerType, method: string): ResponseTransport {
  const handler: object = Object.getOwnPropertyDescriptor(controller.prototype, method)?.value as object;
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) as Record<string, unknown> | undefined;
  const isPassthrough = Reflect.getMetadata(RESPONSE_PASSTHROUGH_METADATA, controller, method) === true;
  const hasResponse = Object.keys(args ?? {}).some((key) => key.startsWith(`${RouteParamtypes.RESPONSE}:`));
  const interceptors = [...(Reflect.getMetadata(INTERCEPTORS_METADATA, controller) as unknown[] ?? []),
    ...(Reflect.getMetadata(INTERCEPTORS_METADATA, handler) as unknown[] ?? [])];
  return { isRaw: hasResponse && !isPassthrough, mediaTypes: responseMediaTypes(controller, handler),
    hasJobRecovery: interceptors.includes(JobRecoveryInterceptor) };
}

function responseMediaTypes(controller: object, handler: object): string[] {
  const headers = Reflect.getMetadata(HEADERS_METADATA, handler) as { name: string; value: unknown }[] | undefined;
  const contentType = headers?.find((header) => header.name.toLowerCase() === 'content-type')?.value;
  if (typeof contentType === 'string') return [contentType.split(';')[0].trim()];
  return (Reflect.getMetadata(DECORATORS.API_PRODUCES, handler) ?? Reflect.getMetadata(DECORATORS.API_PRODUCES, controller) ?? []) as string[];
}
