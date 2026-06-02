// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { uuidV8ToSalesforceId } from '@lfx-one/shared/utils';
import { Request } from 'express';

import { logger } from './logger.service';
import { SfidResolverService } from './sfid-resolver.service';

// Resolves org UUIDs to Salesforce sfids via offline decode first, then NATS fallback.
export class OrgSfidResolver {
  private readonly sfidResolver: SfidResolverService;

  public constructor() {
    this.sfidResolver = new SfidResolverService();
  }

  public async resolveSfid(req: Request, uid: string): Promise<string | null> {
    const offline = uuidV8ToSalesforceId(uid);
    if (offline) return offline;

    const viaNats = await this.sfidResolver.resolve(uid);
    if (viaNats) {
      logger.debug(req, 'resolve_org_sfid', 'Resolved org uid to sfid via NATS fallback (uid is not an LFX UUID v8)', { uid });
      return viaNats;
    }

    logger.warning(req, 'resolve_org_sfid', 'Could not resolve org uid to sfid (offline decode + NATS both missed)', { uid });
    return null;
  }
}
