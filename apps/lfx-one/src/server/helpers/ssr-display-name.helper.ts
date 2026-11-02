// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NATS_CONFIG } from '@lfx-one/shared/constants';
import { NatsSubjects } from '@lfx-one/shared/enums';
import { OidcNameParts, UserMetadataUpdateResponse } from '@lfx-one/shared/interfaces';
// Deep import on purpose: the `@lfx-one/shared/utils` barrel pulls in `@angular/forms`, which throws at load in
// plain-Node runtimes (e.g. this helper's vitest spec) that have no Angular compiler.
import { buildDisplayName } from '@lfx-one/shared/utils/display-name.utils';
import { Request } from 'express';

import { logger } from '../services/logger.service';
import { NatsService } from '../services/nats.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

let natsService: NatsService | null = null;

async function readStoredDisplayName(req: Request, fallback: OidcNameParts): Promise<string | null> {
  const username = await getUsernameFromAuth(req);
  if (!username) {
    return null;
  }

  natsService ??= new NatsService();
  const codec = natsService.getCodec();
  const response = await natsService.request(NatsSubjects.USER_METADATA_READ, codec.encode(username), {
    timeout: NATS_CONFIG.SSR_DISPLAY_NAME_TIMEOUT,
  });
  const body = JSON.parse(codec.decode(response.data)) as UserMetadataUpdateResponse;
  if (!body?.success || !body.data) {
    return null;
  }

  // Per-part fallback to the OIDC claims, matching `GET /api/profile`, so a single stored part doesn't
  // render alone on first paint and then change once the client fetches the profile.
  return buildDisplayName(body.data.given_name || fallback.given_name, body.data.family_name || fallback.family_name) || null;
}

/**
 * Best-effort lookup of the user's stored display name for SSR. The OIDC `name` claim only refreshes
 * on the next login, so a saved name change would revert on every reload without this overlay.
 *
 * The whole lookup — connection attempt included, not just the request — races a wall-clock budget
 * (NATS_CONFIG.SSR_DISPLAY_NAME_TIMEOUT) and resolves to null on timeout or any failure, so it can
 * only ever fall back to the OIDC name, never delay or break the render beyond that budget.
 */
export async function resolveStoredDisplayName(req: Request, fallback: OidcNameParts = {}): Promise<string | null> {
  let timer: NodeJS.Timeout | undefined;
  const budget = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), NATS_CONFIG.SSR_DISPLAY_NAME_TIMEOUT);
  });

  try {
    return await Promise.race([readStoredDisplayName(req, fallback), budget]);
  } catch (error) {
    logger.debug(req, 'ssr_display_name', 'Stored display name unavailable; using OIDC name', { err: error });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
