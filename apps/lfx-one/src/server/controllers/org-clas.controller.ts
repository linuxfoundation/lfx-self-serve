// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_CLA_APPROVAL_CRITERIA, ORG_CLA_APPROVAL_UPDATE_MAX_ENTRIES } from '@lfx-one/shared/constants';
import type { OrgClaApprovalCriteriaKind, OrgClaApprovalEntryInput, OrgClaApprovalListUpdate } from '@lfx-one/shared/interfaces';
import { validateOrgClaApprovalValue } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { OrgClaService } from '../services/org-cla.service';
import { logger } from '../services/logger.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

const APPROVAL_CRITERIA_KINDS = new Set<string>(ORG_CLA_APPROVAL_CRITERIA.map((option) => option.kind));

/**
 * Parses one side of the approval-list delta out of an untrusted body.
 *
 * Returns the entries, or a message naming the first problem — the caller turns that into a 400.
 * Nothing is coerced: a non-string value is rejected rather than `String()`-ed, because
 * `String({})` is `"[object Object]"`, which would sail past a blank check and then be stored as
 * an approval rule that can never match anybody.
 *
 * Values are checked against the producer's own validators here rather than left to the round
 * trip. The producer rejects the whole request if any single value fails and answers with one
 * joined sentence about all of them, so catching it here is what lets the error name the entry
 * the user needs to fix.
 */
function parseApprovalEntries(raw: unknown, side: 'add' | 'remove'): { entries: OrgClaApprovalEntryInput[] } | { message: string } {
  if (raw === undefined || raw === null) return { entries: [] };
  if (!Array.isArray(raw)) return { message: `"${side}" must be an array of approval list entries` };

  const entries: OrgClaApprovalEntryInput[] = [];

  for (const item of raw) {
    const kind = (item as { kind?: unknown } | null)?.kind;
    if (typeof kind !== 'string' || !APPROVAL_CRITERIA_KINDS.has(kind)) {
      return { message: 'Each approval list entry needs a known criteria type' };
    }

    const value = (item as { value?: unknown }).value;
    if (typeof value !== 'string') return { message: 'Each approval list entry needs a text value' };

    const trimmed = value.trim();
    const problem = validateOrgClaApprovalValue(kind as OrgClaApprovalCriteriaKind, trimmed);
    if (problem) return { message: problem };

    entries.push({ kind: kind as OrgClaApprovalCriteriaKind, value: trimmed });
  }

  return { entries };
}

export class OrgClasController {
  private readonly orgClaService = new OrgClaService();

  // GET /api/orgs/:orgUid/lens/cla-groups
  public async listClaGroups(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'list_org_cla_groups');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'list_org_cla_groups' });
      }

      const orgUid = req.params['orgUid'];
      assertOrgUid(orgUid, 'list_org_cla_groups');

      const result = await this.orgClaService.listClaGroups(req, orgUid);

      logger.success(req, 'list_org_cla_groups', startTime, { org_uid: orgUid, cla_group_count: result.claGroups.length });
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/orgs/:orgUid/lens/cla-groups/:signatureId/pdf-url
  public async getPdfUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_cla_pdf_url');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_org_cla_pdf_url' });
      }

      const orgUid = req.params['orgUid'];
      assertOrgUid(orgUid, 'get_org_cla_pdf_url');

      const signatureId = (req.params['signatureId'] ?? '').trim();
      if (!signatureId) {
        throw ServiceValidationError.forField('signatureId', 'signatureId path parameter is required', { operation: 'get_org_cla_pdf_url' });
      }

      const pdf = await this.orgClaService.getPdfUrl(req, orgUid, signatureId);

      // Ahead of the branch, so the 404 carries it too, as `sendBlock` in
      // org-lens-project-detail.controller.ts does. A 404 is heuristically cacheable, and this
      // one is transient — it is also the answer while a signed document is not yet available
      // upstream — so a cached copy would keep failing retries after the document exists. The
      // success body is a short-lived presigned URL, which must not be stored either.
      res.setHeader('Cache-Control', 'no-store');

      if (!pdf) {
        // A handled outcome, not an error: absent is what the service returns for a signature
        // this organization does not hold, an unsigned agreement, or a document upstream has
        // no URL for. It still closes the operation, so request duration stays balanced.
        logger.success(req, 'get_org_cla_pdf_url', startTime, { org_uid: orgUid, signature_id: signatureId, found: false });
        res.status(404).json({ message: 'Signed document not found' });
        return;
      }

      logger.success(req, 'get_org_cla_pdf_url', startTime, { org_uid: orgUid, signature_id: signatureId, found: true });
      res.json(pdf);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/orgs/:orgUid/lens/cla-groups/:signatureId/approval-list
  public async getApprovalList(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_cla_approval_list');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_org_cla_approval_list' });
      }

      const orgUid = req.params['orgUid'];
      assertOrgUid(orgUid, 'get_org_cla_approval_list');

      const signatureId = (req.params['signatureId'] ?? '').trim();
      if (!signatureId) {
        throw ServiceValidationError.forField('signatureId', 'signatureId path parameter is required', { operation: 'get_org_cla_approval_list' });
      }

      const list = await this.orgClaService.getApprovalList(req, orgUid, signatureId);

      // Ahead of the branch so the 404 carries it too, as `getPdfUrl` does. The body is an
      // organization's approval rules — contributor addresses and domains — which no shared cache
      // may hold, and the `canEdit` flag is per-caller, so one viewer's answer must never be
      // replayed to another.
      res.setHeader('Cache-Control', 'no-store');

      if (!list) {
        logger.success(req, 'get_org_cla_approval_list', startTime, { org_uid: orgUid, signature_id: signatureId, found: false });
        res.status(404).json({ message: 'CLA agreement not found' });
        return;
      }

      logger.success(req, 'get_org_cla_approval_list', startTime, {
        org_uid: orgUid,
        signature_id: signatureId,
        entry_count: list.entries.length,
        can_edit: list.canEdit,
      });
      res.json(list);
    } catch (error) {
      next(error);
    }
  }

  // PUT /api/orgs/:orgUid/lens/cla-groups/:signatureId/approval-list
  public async updateApprovalList(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'update_org_cla_approval_list');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'update_org_cla_approval_list' });
      }

      const orgUid = req.params['orgUid'];
      assertOrgUid(orgUid, 'update_org_cla_approval_list');

      const signatureId = (req.params['signatureId'] ?? '').trim();
      if (!signatureId) {
        throw ServiceValidationError.forField('signatureId', 'signatureId path parameter is required', { operation: 'update_org_cla_approval_list' });
      }

      const body = req.body as { add?: unknown; remove?: unknown } | undefined;

      /**
       * Answers a malformed delta with a 400 the UI can show verbatim.
       *
       * `{ message }` rather than a thrown `ServiceValidationError`, which is what the path-param
       * check above uses. The two are not interchangeable here: that error serialises its text
       * under `error`, and these messages are the producer's own sentences about a *value* — which
       * the approval tab reads off `message` and puts in front of the CLA manager who has to fix
       * it. The path-param case has no such copy to carry.
       *
       * Closes the operation as it answers. Without that a rejected write logs a start that never
       * finishes, and the endpoint's completion count drifts from its request count.
       */
      const reject = (message: string, reason: string): void => {
        logger.success(req, 'update_org_cla_approval_list', startTime, { org_uid: orgUid, signature_id: signatureId, rejected: reason });
        res.status(400).json({ message });
      };

      const add = parseApprovalEntries(body?.add, 'add');
      if ('message' in add) {
        reject(add.message, 'invalid_add');
        return;
      }

      const remove = parseApprovalEntries(body?.remove, 'remove');
      if ('message' in remove) {
        reject(remove.message, 'invalid_remove');
        return;
      }

      if (add.entries.length === 0 && remove.entries.length === 0) {
        // The producer answers 400 "missing approval list items" for this. Answered here so the
        // copy is usable and the round trip is not spent to learn nothing changed.
        reject('Provide at least one entry to add or remove', 'empty_update');
        return;
      }

      if (add.entries.length + remove.entries.length > ORG_CLA_APPROVAL_UPDATE_MAX_ENTRIES) {
        reject(`A single change may cover at most ${ORG_CLA_APPROVAL_UPDATE_MAX_ENTRIES} entries`, 'too_many_entries');
        return;
      }

      const update: OrgClaApprovalListUpdate = { add: add.entries, remove: remove.entries };
      const result = await this.orgClaService.updateApprovalList(req, orgUid, signatureId, update);

      res.setHeader('Cache-Control', 'no-store');

      if (result.outcome === 'not-found') {
        logger.success(req, 'update_org_cla_approval_list', startTime, { org_uid: orgUid, signature_id: signatureId, found: false });
        res.status(404).json({ message: 'CLA agreement not found' });
        return;
      }

      if (result.outcome === 'not-signed') {
        logger.success(req, 'update_org_cla_approval_list', startTime, { org_uid: orgUid, signature_id: signatureId, signed: false });
        res.status(400).json({ message: 'This CLA has not been signed yet, so it has no approval list to change' });
        return;
      }

      logger.success(req, 'update_org_cla_approval_list', startTime, {
        org_uid: orgUid,
        signature_id: signatureId,
        added: add.entries.length,
        removed: remove.entries.length,
        entry_count: result.list.entries.length,
      });
      res.json(result.list);
    } catch (error) {
      next(error);
    }
  }
}
