import type { INestApplication } from '@nestjs/common';
import { METHOD_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { EVENT_SCOPE, IS_PUBLIC, ORGANIZATION_SCOPE } from '../infra/auth/actor';
import { responseTransportFor, ResponseTransport } from './openapi-response-transport';

export interface OpenApiRoutePolicy { isPublic: boolean; isOrganizationSelectable: boolean; response?: ResponseTransport }

/** The same method-over-class precedence the runtime guard uses. */
export function routePolicyFor(controller: object, handler: object): OpenApiRoutePolicy {
  const metadata = (key: string): unknown => Reflect.getMetadata(key, handler) ?? Reflect.getMetadata(key, controller);
  const isPublic = metadata(IS_PUBLIC) === true;
  return { isPublic, isOrganizationSelectable: !isPublic && Boolean(metadata(EVENT_SCOPE) || metadata(ORGANIZATION_SCOPE)) };
}

export function openApiRoutePolicies(app: INestApplication): Map<string, OpenApiRoutePolicy> {
  const policies = new Map<string, OpenApiRoutePolicy>();
  for (const module of app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype;
      if (!controller) continue;
      registerControllerPolicies(policies, controller);
    }
  }
  return policies;
}

function registerControllerPolicies(policies: Map<string, OpenApiRoutePolicy>, controller: { name: string; prototype: object }): void {
  const prototype = controller.prototype;
  for (const name of Object.getOwnPropertyNames(prototype)) {
    const handler: unknown = Object.getOwnPropertyDescriptor(prototype, name)?.value;
    if (typeof handler === 'function' && Reflect.hasMetadata(METHOD_METADATA, handler)) {
      policies.set(`${controller.name}_${name}`, { ...routePolicyFor(controller, handler), response: responseTransportFor(controller, name) });
    }
  }
}
