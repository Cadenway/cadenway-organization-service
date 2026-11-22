import { CONFIG, InternalHttpClient, InternalTokenSigner } from '@cadenway/nest-common';
import type { FactoryProvider } from '@nestjs/common';

import type { AppConfig } from '../../../../../../config/app-config.js';
import type { VerifiedEmailAuthority } from '../../../../application/ports/outbound/identity/invitations/verified-email-authority.port.js';
import { IdentityVerifiedEmailAuthority } from '../../../../infrastructure/adapters/identity/invitations/identity-verified-email-authority.adapter.js';

export const VERIFIED_EMAIL_AUTHORITY = Symbol('VerifiedEmailAuthority');

export const verifiedEmailAuthorityProvider: FactoryProvider<VerifiedEmailAuthority> = {
  provide: VERIFIED_EMAIL_AUTHORITY,
  inject: [CONFIG],
  useFactory: async (config: AppConfig): Promise<VerifiedEmailAuthority> => {
    const baseUrl = config.IDENTITY_SERVICE_URL;
    const privateJwk = config.ORGANIZATION_SERVICE_INTERNAL_TOKEN_PRIVATE_JWK;
    if (baseUrl === undefined || privateJwk === undefined) {
      return new IdentityVerifiedEmailAuthority(null);
    }
    const signer = await InternalTokenSigner.create({ issuer: 'organization-service', privateJwk });
    return new IdentityVerifiedEmailAuthority(
      new InternalHttpClient({
        service: 'identity-service',
        baseUrl,
        signer,
        callTimeoutMs: 1_000,
      }),
    );
  },
};
