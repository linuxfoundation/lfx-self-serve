// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { NextFunction, Request, Response } from 'express';

import { AuthenticationError } from '../errors';
import { logger } from '../services/logger.service';
import { OrgLensEmployerAffiliationService } from '../services/org-lens-employer-affiliation.service';
import { getEffectiveUsername } from '../utils/auth-helper';

/**
 * #4314 — `GET /api/profile/employer-affiliation`: the caller's current employer and whether that
 * company holds an active LF membership. Read by the Org Lens empty states to tell "you have no
 * affiliation" apart from "your employer is not an LF member", which are two different dead ends with
 * two different ways out.
 *
 * Its own controller rather than a method on `ProfileController`: this is the only profile-path route
 * that reaches Snowflake, and keeping that dependency out of the profile controller keeps the rest of
 * the profile surface free of it.
 *
 * Not behind the Org Lens read gate by design — only a caller with no grant ever asks, and the answer
 * is their own employer's name plus one boolean about that company's membership.
 */
export class OrgLensEmployerAffiliationController {
  private employerAffiliationService: OrgLensEmployerAffiliationService = new OrgLensEmployerAffiliationService();

  public async getEmployerAffiliation(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_employer_affiliation');

    try {
      // Impersonation-aware, and the only identity CDP reads are keyed on. Throws 401 when none resolves.
      const lfid = getEffectiveUsername(req);
      if (!lfid) {
        throw new AuthenticationError('User authentication required', {
          operation: 'get_employer_affiliation',
          service: 'org_lens_employer_affiliation_controller',
          path: req.path,
        });
      }

      const affiliation = await this.employerAffiliationService.getEmployerAffiliation(req, lfid);

      logger.success(req, 'get_employer_affiliation', startTime, {
        lfid,
        has_employer: !!affiliation.employerName,
        has_active_membership: affiliation.hasActiveMembership,
      });

      res.json(affiliation);
    } catch (error) {
      next(error);
    }
  }
}
