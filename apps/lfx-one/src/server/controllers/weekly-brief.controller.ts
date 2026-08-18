// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { WEEKLY_BRIEF_TEXT_MAX_LENGTH } from '@lfx-one/shared/constants';
import { GenerateWeeklyBriefRequest, RateWeeklyBriefRequest, SaveWeeklyBriefRequest } from '@lfx-one/shared/interfaces';
import { NextFunction, Request, Response } from 'express';

import { ServiceValidationError } from '../errors';
import { assertCommitteeRead } from '../helpers/committee-read-access.helper';
import { assertCommitteeWrite } from '../helpers/committee-write-access.helper';
import { validateUidParameter } from '../helpers/validation.helper';
import { logger } from '../services/logger.service';
import { WeeklyBriefService } from '../services/weekly-brief.service';

/**
 * Narrow `req.body` to a SaveWeeklyBriefRequest, returning a ServiceValidationError
 * with a per-field reason when anything is missing or has the wrong type.
 * Without this, e.g. a string `revision` of "1" would cause `revision + 1`
 * to concatenate to "11" downstream.
 */
function validateSaveBriefBody(body: unknown): { ok: true; value: SaveWeeklyBriefRequest } | { ok: false; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  if (!body || typeof body !== 'object') {
    return { ok: false, fieldErrors: { body: 'Request body must be a JSON object' } };
  }
  const b = body as Record<string, unknown>;
  // [...str].length counts Unicode code points, not UTF-16 code units — upstream's
  // maxLength validates rune count, so a plain `.length` check here could reject
  // astral-plane text (emoji, some CJK extensions) that upstream would accept.
  if (typeof b['brief_text'] !== 'string' || b['brief_text'].trim().length === 0) {
    fieldErrors['brief_text'] = 'brief_text is required and must be a non-empty string';
  } else if ([...b['brief_text']].length > WEEKLY_BRIEF_TEXT_MAX_LENGTH) {
    fieldErrors['brief_text'] = `brief_text must be ${WEEKLY_BRIEF_TEXT_MAX_LENGTH} characters or fewer`;
  }
  if (typeof b['revision'] !== 'number' || !Number.isInteger(b['revision']) || b['revision'] < 1) {
    fieldErrors['revision'] = 'revision is required and must be an integer of at least 1';
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  return {
    ok: true,
    value: {
      brief_text: b['brief_text'] as string,
      revision: b['revision'] as number,
    },
  };
}

/**
 * Narrow `req.body` to a GenerateWeeklyBriefRequest. Upstream's
 * GenerateWeeklyBriefRequestBody has exactly one field (`force: boolean`) —
 * this whitelists it explicitly rather than forwarding `req.body` verbatim,
 * so a caller cannot smuggle extra fields through to the proxy call.
 */
function validateGenerateBriefBody(body: unknown): { ok: true; value: GenerateWeeklyBriefRequest } | { ok: false; fieldErrors: Record<string, string> } {
  if (body === undefined || body === null) {
    return { ok: true, value: {} };
  }
  // typeof [] === 'object' in JS — without the explicit Array.isArray check, an array body
  // has no `force` key, so every field is "absent" and this would return `{ ok: true, value: {}
  // }` instead of rejecting the malformed request (dealako review round 3).
  if (typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, fieldErrors: { body: 'Request body must be a JSON object' } };
  }
  const b = body as Record<string, unknown>;
  if (b['force'] !== undefined && typeof b['force'] !== 'boolean') {
    return { ok: false, fieldErrors: { force: 'force must be a boolean when present' } };
  }
  return { ok: true, value: { force: b['force'] as boolean | undefined } };
}

/**
 * Narrow `req.body` to `{ revision: number }` for the share endpoint. The confirmation
 * dialog shows a specific rendered revision — the caller must send it back so the
 * service can reject a stale approval (another writer saved an edit in between)
 * instead of silently sharing content the caller never actually reviewed.
 *
 * Same bound as `validateRateBriefBody`/`validateClearRatingBody` (integer, >= 1), not the
 * looser finite-number check this used to have (LFXV2-3080): shareBrief's revision only ever
 * fed a local equality comparison, but shareToSlack's now also crosses the wire as the
 * committee-service share-to-chat request body, which declares it `UInt64, Minimum(1)` — a
 * malformed value here should fail loudly at this boundary with a clear 400, not ride into an
 * upstream Goa validation error. `isSafeInteger`, not just `isInteger`: a value beyond
 * `Number.MAX_SAFE_INTEGER` (e.g. `1e20`) still passes `isInteger` but can't faithfully
 * represent a `UInt64` — same failure mode as an out-of-range value, just one `isInteger` alone
 * wouldn't catch.
 */
function validateShareBriefBody(body: unknown): { ok: true; value: { revision: number } } | { ok: false; fieldErrors: Record<string, string> } {
  if (!body || typeof body !== 'object') {
    return { ok: false, fieldErrors: { body: 'Request body must be a JSON object' } };
  }
  const b = body as Record<string, unknown>;
  if (typeof b['revision'] !== 'number' || !Number.isSafeInteger(b['revision']) || b['revision'] < 1) {
    return { ok: false, fieldErrors: { revision: 'revision is required and must be an integer of at least 1' } };
  }
  return { ok: true, value: { revision: b['revision'] as number } };
}

/**
 * Narrow `req.body` to a RateWeeklyBriefRequest for the rating endpoint. `rating` is a
 * closed two-value type, not a free string — whitelisted explicitly like every other
 * body-narrowing function in this file, rather than forwarding req.body verbatim.
 */
function validateRateBriefBody(body: unknown): { ok: true; value: RateWeeklyBriefRequest } | { ok: false; fieldErrors: Record<string, string> } {
  if (!body || typeof body !== 'object') {
    return { ok: false, fieldErrors: { body: 'Request body must be a JSON object' } };
  }
  const b = body as Record<string, unknown>;
  const fieldErrors: Record<string, string> = {};
  if (b['rating'] !== 'up' && b['rating'] !== 'down') {
    fieldErrors['rating'] = 'rating is required and must be "up" or "down"';
  }
  if (typeof b['revision'] !== 'number' || !Number.isInteger(b['revision']) || b['revision'] < 1) {
    fieldErrors['revision'] = 'revision is required and must be an integer of at least 1';
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, fieldErrors };
  }
  return { ok: true, value: { rating: b['rating'] as 'up' | 'down', revision: b['revision'] as number } };
}

/**
 * Narrow `req.body` to `{ revision: number }` for the clear-rating (DELETE) endpoint. The caller
 * must send back the revision they actually saw so the service can reject a stale clear (PR #1361
 * review) instead of silently deleting whatever revision happens to be current. Same bound as
 * `validateRateBriefBody`'s (and now `validateShareBriefBody`'s) revision check (integer, >= 1) —
 * rate and clear are the same closed pair of endpoints and should share one boundary contract
 * (PR #1361 review, round 2).
 */
function validateClearRatingBody(body: unknown): { ok: true; value: { revision: number } } | { ok: false; fieldErrors: Record<string, string> } {
  if (!body || typeof body !== 'object') {
    return { ok: false, fieldErrors: { body: 'Request body must be a JSON object' } };
  }
  const b = body as Record<string, unknown>;
  if (typeof b['revision'] !== 'number' || !Number.isInteger(b['revision']) || b['revision'] < 1) {
    return { ok: false, fieldErrors: { revision: 'revision is required and must be an integer of at least 1' } };
  }
  return { ok: true, value: { revision: b['revision'] as number } };
}

/**
 * Controller for the WG Weekly Brief endpoints.
 *
 * Upstream HTTP status codes (202 accepted, 429 throttle, 409 edited-brief
 * conflict) are propagated through — generate forwards the real upstream
 * status via `weeklyBriefService.generateBrief`'s `{ status, data }` return;
 * everything else propagates through `next(error)` to the shared
 * apiErrorHandler, which renders the original `statusCode` from MicroserviceError.
 */
export class WeeklyBriefController {
  private weeklyBriefService: WeeklyBriefService = new WeeklyBriefService();

  /**
   * GET /api/committees/:committeeId/weekly-briefs/current
   *
   * Gated by `assertCommitteeRead` (committee#auditor) — the service layer proxies
   * straight through to committee-service in live mode with no authorization of its
   * own, so without this gate any authenticated caller who knows a committee UID
   * could read draft/edited brief text. (LFXV2-2175 review.)
   */
  public async getCurrentBrief(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { committeeId } = req.params;
    const startTime = logger.startOperation(req, 'get_weekly_brief_current', {
      committee_id: committeeId,
    });

    try {
      if (
        !validateUidParameter(committeeId, req, next, {
          operation: 'get_weekly_brief_current',
          service: 'weekly_brief_controller',
        })
      ) {
        return;
      }

      await assertCommitteeRead(req, committeeId, 'get_weekly_brief_current');

      const result = await this.weeklyBriefService.getCurrentBrief(req, committeeId);

      logger.success(req, 'get_weekly_brief_current', startTime, {
        committee_id: committeeId,
        has_brief: !!result.brief,
        state: result.brief?.state,
        revision: result.brief?.revision,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/committees/:committeeId/weekly-briefs/action-items
   *
   * Gated by `assertCommitteeRead` (committee#auditor) — same gate as getCurrentBrief, since
   * this is a read of brief-derived content, not a new privilege. Extraction failures degrade
   * to an empty list inside `WeeklyBriefService.getActionItems` (LFXV2-3043) — this controller
   * never sees an extraction error as distinct from "no items".
   */
  public async getActionItems(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { committeeId } = req.params;
    const startTime = logger.startOperation(req, 'get_weekly_brief_action_items', {
      committee_id: committeeId,
    });

    try {
      if (
        !validateUidParameter(committeeId, req, next, {
          operation: 'get_weekly_brief_action_items',
          service: 'weekly_brief_controller',
        })
      ) {
        return;
      }

      await assertCommitteeRead(req, committeeId, 'get_weekly_brief_action_items');

      const result = await this.weeklyBriefService.getActionItems(req, committeeId);

      logger.success(req, 'get_weekly_brief_action_items', startTime, {
        committee_id: committeeId,
        item_count: result.items.length,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/committees/:committeeId/weekly-briefs/generate
   *
   * Gated by `assertCommitteeWrite` (committee#writer) — same missing-authorization gap as
   * getCurrentBrief, but for a quota-consuming write action. (LFXV2-2175/2176 review.)
   */
  public async generateBrief(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { committeeId } = req.params;
    const startTime = logger.startOperation(req, 'generate_weekly_brief', {
      committee_id: committeeId,
    });

    try {
      if (
        !validateUidParameter(committeeId, req, next, {
          operation: 'generate_weekly_brief',
          service: 'weekly_brief_controller',
        })
      ) {
        return;
      }

      const validation = validateGenerateBriefBody(req.body);
      if (!validation.ok) {
        return next(
          ServiceValidationError.fromFieldErrors(validation.fieldErrors, 'Invalid generate-weekly-brief request body', {
            operation: 'generate_weekly_brief',
            service: 'weekly_brief_controller',
            path: req.path,
          })
        );
      }
      const body = validation.value;

      await assertCommitteeWrite(req, committeeId, 'generate_weekly_brief');

      const { status, data } = await this.weeklyBriefService.generateBrief(req, committeeId, body);

      // Upstream marks no attribute of the generate result Required — guard every
      // read the same way getCurrentBrief already guards `result.brief?.state`,
      // so a sparse 202 envelope can't turn a successful upstream call into a 500
      // after the throttle slot has already been consumed.
      logger.success(req, 'generate_weekly_brief', startTime, {
        committee_id: committeeId,
        status_code: status,
        brief_uid: data.brief?.uid,
        state: data.brief?.state,
        revision: data.brief?.revision,
        regeneration_count: data.brief?.regeneration_count,
        generates_used: data.throttle?.generates_used,
        regenerations_used: data.throttle?.regenerations_used,
      });

      // Forward the upstream status code — 202 (accepted, still generating)
      // vs 200 must reach the client so it can tell "accepted" from "done".
      res.status(status).json(data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/committees/:committeeId/weekly-briefs/current
   *
   * Gated by `assertCommitteeWrite` (committee#writer) — same missing-authorization gap as
   * getCurrentBrief, but for overwriting the brief's content. (LFXV2-2175/2176 review.)
   */
  public async saveBrief(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { committeeId } = req.params;
    const startTime = logger.startOperation(req, 'save_weekly_brief', {
      committee_id: committeeId,
    });

    try {
      if (
        !validateUidParameter(committeeId, req, next, {
          operation: 'save_weekly_brief',
          service: 'weekly_brief_controller',
        })
      ) {
        return;
      }

      const validation = validateSaveBriefBody(req.body);
      if (!validation.ok) {
        return next(
          ServiceValidationError.fromFieldErrors(validation.fieldErrors, 'Invalid save-weekly-brief request body', {
            operation: 'save_weekly_brief',
            service: 'weekly_brief_controller',
            path: req.path,
          })
        );
      }
      const body = validation.value;

      await assertCommitteeWrite(req, committeeId, 'save_weekly_brief');

      const result = await this.weeklyBriefService.saveBrief(req, committeeId, body);

      logger.success(req, 'save_weekly_brief', startTime, {
        committee_id: committeeId,
        brief_uid: result.uid,
        revision: result.revision,
        state: result.state,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/committees/:committeeId/weekly-briefs/share
   *
   * Gated by `assertCommitteeRead` (committee#auditor) — `shareBrief` reads the current
   * brief internally before doing anything else, same unguarded-proxy gap as
   * getCurrentBrief without this. The actual send is authorized separately and more
   * narrowly inside the service (`project:{project_uid}#writer`, not committee#auditor),
   * since that's the newsletter service's real enforcement boundary; this gate only
   * closes the existence/state read, not the write.
   */
  public async shareBrief(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { committeeId } = req.params;
    const startTime = logger.startOperation(req, 'share_weekly_brief', {
      committee_id: committeeId,
    });

    try {
      if (
        !validateUidParameter(committeeId, req, next, {
          operation: 'share_weekly_brief',
          service: 'weekly_brief_controller',
        })
      ) {
        return;
      }

      await assertCommitteeRead(req, committeeId, 'share_weekly_brief');

      const validation = validateShareBriefBody(req.body);
      if (!validation.ok) {
        return next(
          ServiceValidationError.fromFieldErrors(validation.fieldErrors, 'Invalid share-weekly-brief request body', {
            operation: 'share_weekly_brief',
            service: 'weekly_brief_controller',
            path: req.path,
          })
        );
      }

      const result = await this.weeklyBriefService.shareBrief(req, committeeId, validation.value.revision);

      logger.success(req, 'share_weekly_brief', startTime, {
        committee_id: committeeId,
        total_recipients: result.total_recipients,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/committees/:committeeId/weekly-briefs/share-slack
   *
   * Same gating shape as {@link shareBrief}: `assertCommitteeRead` (committee#auditor) closes
   * the existence/state read this method does internally before anything else; the actual send
   * is authorized separately and more narrowly inside the service
   * (`project:{project_uid}#writer`).
   */
  public async shareToSlack(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { committeeId } = req.params;
    const startTime = logger.startOperation(req, 'share_weekly_brief_slack', {
      committee_id: committeeId,
    });

    try {
      if (
        !validateUidParameter(committeeId, req, next, {
          operation: 'share_weekly_brief_slack',
          service: 'weekly_brief_controller',
        })
      ) {
        return;
      }

      await assertCommitteeRead(req, committeeId, 'share_weekly_brief_slack');

      const validation = validateShareBriefBody(req.body);
      if (!validation.ok) {
        return next(
          ServiceValidationError.fromFieldErrors(validation.fieldErrors, 'Invalid share-weekly-brief-to-slack request body', {
            operation: 'share_weekly_brief_slack',
            service: 'weekly_brief_controller',
            path: req.path,
          })
        );
      }

      const result = await this.weeklyBriefService.shareToSlack(req, committeeId, validation.value.revision);

      logger.success(req, 'share_weekly_brief_slack', startTime, {
        committee_id: committeeId,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/committees/:committeeId/weekly-briefs/:briefUid/rating
   *
   * BFF-only feature (LFXV2-3042) — no upstream endpoint, no committee-write involved. Gated by
   * `assertCommitteeRead`, same as `getCurrentBrief`/`shareBrief`: a rating is a personal
   * read-time reaction to a brief the caller can already see, not a committee edit.
   */
  public async rateBrief(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { committeeId, briefUid } = req.params;
    const startTime = logger.startOperation(req, 'rate_weekly_brief', {
      committee_id: committeeId,
      brief_uid: briefUid,
    });

    try {
      if (
        !validateUidParameter(committeeId, req, next, { operation: 'rate_weekly_brief', service: 'weekly_brief_controller' }) ||
        !validateUidParameter(briefUid, req, next, { operation: 'rate_weekly_brief', service: 'weekly_brief_controller' })
      ) {
        return;
      }

      const validation = validateRateBriefBody(req.body);
      if (!validation.ok) {
        return next(
          ServiceValidationError.fromFieldErrors(validation.fieldErrors, 'Invalid rate-weekly-brief request body', {
            operation: 'rate_weekly_brief',
            service: 'weekly_brief_controller',
            path: req.path,
          })
        );
      }

      await assertCommitteeRead(req, committeeId, 'rate_weekly_brief');

      const result = await this.weeklyBriefService.rateBrief(req, committeeId, briefUid, validation.value.rating, validation.value.revision);

      logger.success(req, 'rate_weekly_brief', startTime, {
        committee_id: committeeId,
        brief_uid: briefUid,
        rating: result.rating,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/committees/:committeeId/weekly-briefs/:briefUid/rating
   *
   * Clears the caller's own rating on the brief's current revision. Same gate as `rateBrief`.
   */
  public async clearBriefRating(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { committeeId, briefUid } = req.params;
    const startTime = logger.startOperation(req, 'clear_weekly_brief_rating', {
      committee_id: committeeId,
      brief_uid: briefUid,
    });

    try {
      if (
        !validateUidParameter(committeeId, req, next, { operation: 'clear_weekly_brief_rating', service: 'weekly_brief_controller' }) ||
        !validateUidParameter(briefUid, req, next, { operation: 'clear_weekly_brief_rating', service: 'weekly_brief_controller' })
      ) {
        return;
      }

      const validation = validateClearRatingBody(req.body);
      if (!validation.ok) {
        return next(
          ServiceValidationError.fromFieldErrors(validation.fieldErrors, 'Invalid clear-weekly-brief-rating request body', {
            operation: 'clear_weekly_brief_rating',
            service: 'weekly_brief_controller',
            path: req.path,
          })
        );
      }

      await assertCommitteeRead(req, committeeId, 'clear_weekly_brief_rating');

      await this.weeklyBriefService.clearBriefRating(req, committeeId, briefUid, validation.value.revision);

      logger.success(req, 'clear_weekly_brief_rating', startTime, {
        committee_id: committeeId,
        brief_uid: briefUid,
      });

      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }
}
