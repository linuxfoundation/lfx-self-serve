// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Base URL for the EasyCLA service behind the API gateway.
//
// Lives in its own helper rather than in cla.service.ts because two unrelated services now
// need it — the Me-lens CLA service and the Org Lens EasyCLA service (#1978) — and importing
// the whole Me-lens service to reach one pure string function would give the Org Lens module
// a dependency on Auth0 and email-verification wiring it does not use.

import { MicroserviceError } from '../errors';

/**
 * Derived from API_GW_AUDIENCE, which is already required to mint the gateway token —
 * mirroring user.service.ts.
 */
export function claServiceBaseUrl(): string {
  // Local-only override so a laptop BFF can talk to a standalone cla-backend-go
  // (see CLA_SERVICE_URL in apps/lfx-one/.env). Do not commit a non-empty value.
  const override = process.env['CLA_SERVICE_URL'];
  if (override) {
    return override.replace(/\/+$/, '');
  }
  const audience = process.env['API_GW_AUDIENCE'];
  if (!audience) {
    throw new MicroserviceError('API_GW_AUDIENCE environment variable is not configured', 503, 'API_GATEWAY_MISCONFIGURED', {
      service: 'cla_service',
    });
  }
  return `${audience.replace(/\/+$/, '')}/cla-service`;
}
