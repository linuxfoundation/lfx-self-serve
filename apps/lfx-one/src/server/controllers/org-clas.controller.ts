// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CLA_GROUP_ID_PATTERN,
  CLA_GROUP_SEARCH_MIN_CHARS,
  ORG_CLA_APPROVAL_CRITERIA,
  ORG_CLA_APPROVAL_UPDATE_MAX_ENTRIES,
  SALESFORCE_ID_PATTERN,
} from '@lfx-one/shared/constants';
import type { OrgClaApprovalCriteriaKind, OrgClaApprovalEntryInput, OrgClaApprovalListUpdate } from '@lfx-one/shared/interfaces';
import { validateOrgClaApprovalValue } from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { getStringQueryParam } from '../helpers/validation.helper';
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

  // GET /api/orgs/:orgUid/lens/cla-groups/sign-options?search=<term>
  // CLA Groups the organization could sign a corporate CLA for (#1983). A read: impersonation
  // stays allowed, exactly as on the Me-lens picker. The write is next door.
  public async getSignOptions(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_cla_sign_options');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_org_cla_sign_options' });
      }

      const orgUid = req.params['orgUid'];
      assertOrgUid(orgUid, 'get_org_cla_sign_options');

      const searchTerm = (getStringQueryParam(req, 'search') ?? '').trim();

      // Upstream requires three characters and 400s below that. The picker gates on the same
      // length; this is the second line, so a caller that skips the picker gets an empty set
      // rather than an error describing a mistake nobody made.
      if (searchTerm.length < CLA_GROUP_SEARCH_MIN_CHARS) {
        logger.success(req, 'get_org_cla_sign_options', startTime, { result_count: 0, term_too_short: true });
        res.setHeader('Cache-Control', 'no-store');
        res.json({ searchTerm, resultCount: 0, truncated: false, results: [] });
        return;
      }

      const envelope = await this.orgClaService.getSignOptions(req, searchTerm);

      logger.success(req, 'get_org_cla_sign_options', startTime, { org_uid: orgUid, result_count: envelope.resultCount });
      res.setHeader('Cache-Control', 'no-store');
      res.json(envelope);
    } catch (error) {
      next(error);
    }
  }

  // POST /api/orgs/:orgUid/lens/cla-groups/sign
  // Opens the corporate signing session and answers with the address EasyCLA returned. Nothing
  // here composes that address, and nothing here decides whether the caller may sign — the CLA
  // service checks signing authority and trade compliance on every request, and its refusal is
  // relayed in its own words rather than pre-empted.
  //
  // Blocked during impersonation at the route, so there is no impersonation branch here.
  public async requestCorporateSignature(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'request_org_cla_corporate_signature');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'request_org_cla_corporate_signature' });
      }

      const orgUid = req.params['orgUid'];
      assertOrgUid(orgUid, 'request_org_cla_corporate_signature');

      // The chosen project and CLA group are the only things taken from the body besides the two
      // attestations. The organization is the grant-checked path parameter, and the return
      // address is derived from the request — EasyCLA stores that value and redirects to it
      // verbatim, so a client-supplied one would turn the hand-off into an open redirect.
      const body = req.body as { projectSfid?: unknown; claGroupId?: unknown; authorityAcked?: unknown; embargoAcked?: unknown } | undefined;

      // Each rejection below throws rather than answering directly, so the shared error handler
      // classifies it: one response envelope, WARN rather than ERROR (bad client input is not an
      // operational fault, and logging it as one inflates the error signal this service is
      // watched by), and the operation terminated on the same path as every other failure. The
      // sibling `getPdfUrl` above already does this; these three were the outliers.
      // Shape-checked, not merely non-empty. A malformed identifier that is only checked for
      // emptiness travels upstream and comes back as a 403 from the project-and-organization
      // authorization check — which relays to the signatory as a refusal about their signing
      // authority, when the real fault is a bad request this boundary could have named.
      const projectSfid = String(body?.projectSfid ?? '').trim();
      if (!SALESFORCE_ID_PATTERN.test(projectSfid)) {
        throw ServiceValidationError.fromFieldErrors({ projectSfid: 'A project identifier is required' }, 'A project identifier is required', {
          operation: 'request_org_cla_corporate_signature',
        });
      }

      const claGroupId = String(body?.claGroupId ?? '').trim();
      if (!CLA_GROUP_ID_PATTERN.test(claGroupId)) {
        throw ServiceValidationError.fromFieldErrors({ claGroupId: 'A CLA group identifier is required' }, 'A CLA group identifier is required', {
          operation: 'request_org_cla_corporate_signature',
        });
      }

      // Compared against the literal `true`, not coerced. These two carry the legal weight of the
      // request: a truthy non-boolean accepted here would record an attestation the signatory
      // never made, and the failure would be invisible everywhere downstream because upstream
      // sees only the boolean that arrives. Upstream refuses a false as well; answering it here
      // spends no round trip to learn that a signatory who withdrew a confirmation cannot sign.
      //
      // Reported against `attestations` rather than against whichever of the two failed. Naming
      // the failing one would record, in a log line and in the response, that this signatory did
      // not affirm that specific statement — which is the legal assertion itself, and the reason
      // the values are not logged either.
      if (body?.authorityAcked !== true || body?.embargoAcked !== true) {
        const message = 'Both the authorization and compliance confirmations are required';
        throw ServiceValidationError.fromFieldErrors({ attestations: message }, message, { operation: 'request_org_cla_corporate_signature' });
      }

      const result = await this.orgClaService.requestCorporateSignature(req, orgUid, {
        projectSfid,
        claGroupId,
        authorityAcked: body.authorityAcked,
        embargoAcked: body.embargoAcked,
      });

      logger.success(req, 'request_org_cla_corporate_signature', startTime, { org_uid: orgUid });
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
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

      const overlapKey = (entry: OrgClaApprovalEntryInput): string => `${entry.kind}:${entry.value.toLowerCase()}`;
      const removing = new Set(remove.entries.map(overlapKey));
      if (add.entries.some((entry) => removing.has(overlapKey(entry)))) {
        reject('The same entry cannot be added and removed in one change', 'add_remove_overlap');
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
