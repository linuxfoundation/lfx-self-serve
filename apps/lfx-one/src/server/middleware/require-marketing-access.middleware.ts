// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { AccessCheckAccessType, PersonaType } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { AuthorizationError } from '../errors';
import { ServerFeatureFlag, isServerFeatureEnabled } from '../helpers/server-feature-flag.helper';
import { AccessCheckService } from '../services/access-check.service';
import { logger } from '../services/logger.service';
import { ProjectService } from '../services/project.service';
import { personaDetectionService } from '../utils/persona-helper';
import { requireExecutiveDirector } from './require-executive-director.middleware';

const ED: PersonaType = 'executive-director';

type MarketingAccessType = Extract<AccessCheckAccessType, 'marketing_auditor' | 'campaign_manager'>;

interface MarketingAccessMiddlewareOptions {
  allowLfStaff?: boolean;
}

const accessCheckService = new AccessCheckService();
const projectService = new ProjectService();

/**
 * Marketing-ops FGA authorization for the Campaigns (`campaign_manager`) and marketing analytics
 * (`marketing_auditor`) routes. LFXV2-2235.
 *
 * While `ServerFeatureFlag.MarketingOpsFga` is OFF (the default), this delegates unchanged to
 * `requireExecutiveDirector` — the ED-only gate LFXV2-3294 already shipped on these routes. When
 * the flag is ON: root-writer bypasses unconditionally; ED bypasses only for foundations it
 * actually holds the persona for (same scoping `requireExecutiveDirector` applies, checked
 * against `personaProjects`) — an ED out of scope for the requested slug is not hard-denied, it
 * falls through to the FGA checks below. LF Staff bypass the entire check only when `allowLfStaff`
 * is set to true in options; this allows shared endpoints (e.g. marketing analytics used by both
 * ED and LF Staff) to grant LF Staff access while keeping other endpoints ED/FGA-only. A caller
 * without ED/root status is authorized only via an actual FGA relation: either a ROOT-scoped grant
 * (cascades to every project) or a grant scoped to the specific foundation/project the request names.
 *
 * Deliberately never a single all-or-nothing check: a caller can pass via ED persona OR root FGA
 * grant OR per-project FGA grant, and a transient failure on any one path denies only that path,
 * not the whole request. This is a direct response to the #1112 post-mortem, which found that PR
 * shipped a single async guard with no synchronous fast path — see the LFXV2-2231 gap-analysis
 * G2 finding.
 */
function createMarketingAccessMiddleware(
  access: MarketingAccessType,
  slugQueryParams: string[],
  operation: string,
  options: MarketingAccessMiddlewareOptions = {}
) {
  return async function requireMarketingAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      // Only the single relation this middleware instance cares about is needed here — the other
      // relation's ROOT-scoped FGA check would otherwise be computed and discarded unread.
      const result = await personaDetectionService.getPersonas(req, undefined, access);

      // LF Staff bypass (if enabled) works regardless of flag state — no need to evaluate ED/FGA paths
      if (options.allowLfStaff && result.isLFStaff) {
        next();
        return;
      }

      if (!isServerFeatureEnabled(ServerFeatureFlag.MarketingOpsFga)) {
        await requireExecutiveDirector(req, res, next);
        return;
      }
      if (result.isRootWriter) {
        next();
        return;
      }

      // The two route files this middleware gates name the foundation/project differently
      // (`analytics.route.ts` reads `foundationSlug`, `campaign.controller.ts` reads `project`);
      // each caller lists its own primary param first purely for logging clarity — in practice a
      // request only ever sets one of the two, so the fallback order never has to arbitrate.
      const requestedSlug = slugQueryParams.map((param) => req.query[param]).find((value): value is string => typeof value === 'string' && value.length > 0);

      // ED is scoped to the foundations it's actually held for (mirrors `requireExecutiveDirector`)
      // — an ED for foundation A must not read foundation B just by passing B's slug. A request
      // with no slug has nothing to scope against, so an ED passes unconditionally, matching the
      // unscoped-endpoint behavior in `requireExecutiveDirector`. An ED who IS out of scope for the
      // requested slug does not get hard-denied here: they fall through to the root/project FGA
      // checks below, preserving the "never a single all-or-nothing check" design (see file doc
      // comment) — a scoped-out ED can still pass via an actual FGA grant on that project.
      if (result.personas.includes(ED)) {
        const edSlugs = (result.personaProjects?.[ED] ?? []).map((project) => project.projectSlug);
        if (!requestedSlug || edSlugs.includes(requestedSlug)) {
          next();
          return;
        }
      }

      const hasRootAccess =
        access === 'marketing_auditor'
          ? await personaDetectionService.checkRootMarketingAuditor(req)
          : await personaDetectionService.checkRootCampaignManager(req);
      if (hasRootAccess) {
        next();
        return;
      }

      // No slug to scope against — the route handler is responsible for rejecting a missing
      // required parameter. Without ED/root access there is nothing left to authorize on.
      if (!requestedSlug) {
        denyMarketingAccess(req, next, operation, access, 'no_slug');
        return;
      }

      const { uid, exists } = await projectService.getProjectIdBySlug(req, requestedSlug);
      if (!exists) {
        denyMarketingAccess(req, next, operation, access, 'project_not_found', requestedSlug);
        return;
      }

      const hasProjectAccess = await accessCheckService.checkSingleAccess(req, { resource: 'project', id: uid, access });
      if (hasProjectAccess) {
        next();
        return;
      }

      denyMarketingAccess(req, next, operation, access, 'no_grant', requestedSlug);
    } catch (error) {
      next(error);
    }
  };
}

type DenyReason = 'no_slug' | 'project_not_found' | 'no_grant';

// `apiErrorHandler` logs every rejected request centrally (ADR 0002); this only adds the
// triage detail — which of the three deny paths fired — that the generic error log can't carry.
function denyMarketingAccess(
  req: Request,
  next: NextFunction,
  operation: string,
  access: MarketingAccessType,
  reason: DenyReason,
  requestedSlug?: string
): void {
  logger.debug(req, operation, `Denying marketing-ops access (${access})`, {
    path: req.path,
    reason,
    requestedSlug,
  });

  next(
    new AuthorizationError(`${access} access required for this resource`, {
      operation,
      service: 'authorization',
      path: req.path,
      code: 'MARKETING_ACCESS_REQUIRED',
    })
  );
}

/** Marketing Impact and other read-only marketing analytics endpoints. */
export const requireMarketingAuditor = createMarketingAccessMiddleware('marketing_auditor', ['foundationSlug', 'project'], 'require_marketing_auditor');

/** Marketing analytics endpoints shared with LF Staff (Marketing Overview widget). */
export const requireMarketingAuditorOrLfStaff = createMarketingAccessMiddleware(
  'marketing_auditor',
  ['foundationSlug', 'project'],
  'require_marketing_auditor_or_lf_staff',
  { allowLfStaff: true }
);

/** Campaigns endpoints — read and write. */
export const requireCampaignManager = createMarketingAccessMiddleware('campaign_manager', ['project', 'foundationSlug'], 'require_campaign_manager');
