import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TemplateGatesService {
  constructor(private readonly config: ConfigService) {}
  require(feature: 'AUTHORING' | 'ASSETS' | 'ADOPTION' | 'PUBLISH'): void {
    if (this.config.get(`TEMPLATE_${feature}_ENABLED`) !== 'true') throw new ServiceUnavailableException({ code: 'TEMPLATE_FEATURE_DISABLED', message: `${feature.toLowerCase()} is not enabled` });
  }
  canPublish(): boolean { return this.config.get('TEMPLATE_PUBLISH_ENABLED') === 'true'; }
  publicationStatus() {
    return { canPublish: false, code: 'TEMPLATE_CAPABILITY_NOT_DEPLOYED', rendererAcceptance: 'PAYLOAD_ONLY' } as const;
  }
}
