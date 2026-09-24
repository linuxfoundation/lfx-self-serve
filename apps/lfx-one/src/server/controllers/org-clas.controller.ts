// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  CLA_GROUP_ID_PATTERN,
  CLA_GROUP_SEARCH_MIN_CHARS,
  ORG_CLA_ACKNOWLEDGMENTS_PAGE_SIZE_DEFAULT,
  ORG_CLA_ACKNOWLEDGMENTS_PAGE_SIZE_MAX,
  ORG_CLA_ACKNOWLEDGMENTS_PAGE_SIZE_MIN,
  ORG_CLA_ACTIVITY_LOG_PAGE_SIZE_DEFAULT,
  ORG_CLA_ACTIVITY_LOG_PAGE_SIZE_MAX,
  ORG_CLA_ACTIVITY_LOG_PAGE_SIZE_MIN,
  ORG_CLA_APPROVAL_CRITERIA,
  ORG_CLA_APPROVAL_UPDATE_MAX_ENTRIES,
  ORG_CLA_AUTHORITY_NAME_MAX_LENGTH,
  ORG_CLA_AUTHORITY_NAME_MIN_LENGTH,
  ORG_CLA_INVALIDATION_NOTE_MAX_LENGTH,
  ORG_CLA_INVALIDATION_REASONS,
  ORG_CLA_REVIEW_COPY_FILENAME,
  SALESFORCE_ID_PATTERN,
} from '@lfx-one/shared/constants';
import {
  type OrgClaApprovalCriteriaKind,
  type OrgClaApprovalEntryInput,
  type OrgClaApprovalListUpdate,
  type OrgClaInvalidateAcknowledgmentRequest,
  type OrgClaInvalidationReason,
  type OrgClaManagerAddRequest,
  type OrgClaPermissionCheckRequest,
  type OrgClaSignRequest,
} from '@lfx-one/shared/interfaces';
import {
  codePointLength,
  hasOrgClaManagerAddErrors,
  isEmailShape,
  isOrgClaManagerLfUsername,
  isOrgClaPermissionAction,
  isSendableAuthorityName,
  validateOrgClaApprovalValue,
  validateOrgClaManagerAdd,
} from '@lfx-one/shared/utils';
import { NextFunction, Request, Response } from 'express';

import { AuthenticationError, ServiceValidationError } from '../errors';
import { contentDispositionAttachment } from '../helpers/content-disposition.helper';
import { getStringQueryParam } from '../helpers/validation.helper';
import { assertOrgUid } from '../helpers/org-uid.helper';
import { OrgClaPermissionsService } from '../services/org-cla-permissions.service';
import { OrgClaService } from '../services/org-cla.service';
import { logger } from '../services/logger.service';
import { getUsernameFromAuth } from '../utils/auth-helper';

const APPROVAL_CRITERIA_KINDS = new Set<string>(ORG_CLA_APPROVAL_CRITERIA.map((option) => option.kind));

const INVALIDATION_REASONS = new Set<string>(ORG_CLA_INVALIDATION_REASONS);

function isOrgClaInvalidationReason(value: unknown): value is OrgClaInvalidationReason {
  return typeof value === 'string' && INVALIDATION_REASONS.has(value);
}

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
  private readonly orgClaPermissions = new OrgClaPermissionsService();

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

  // GET /api/orgs/:orgUid/lens/cla-groups/:claGroupId/ccla-preview
  // Watermarked corporate template for the unsigned overview (#2317). A read: impersonation
  // stays allowed, same as sign-options. The client cannot choose the CLA type or turn the
  // watermark off — those are pinned in the service.
  public async getCclaPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_cla_ccla_preview');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_org_cla_ccla_preview' });
      }

      const orgUid = req.params['orgUid'];
      assertOrgUid(orgUid, 'get_org_cla_ccla_preview');

      const claGroupId = (req.params['claGroupId'] ?? '').trim();
      if (!CLA_GROUP_ID_PATTERN.test(claGroupId)) {
        throw ServiceValidationError.forField('claGroupId', 'A CLA group identifier is required', { operation: 'get_org_cla_ccla_preview' });
      }

      const pdf = await this.orgClaService.getCclaPreview(req, claGroupId);

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', contentDispositionAttachment(ORG_CLA_REVIEW_COPY_FILENAME));
      res.setHeader('Content-Length', pdf.length);
      logger.success(req, 'get_org_cla_ccla_preview', startTime, { org_uid: orgUid, cla_group_id: claGroupId, bytes: pdf.length });
      res.send(pdf);
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

      // The chosen project and CLA group are taken from the body, plus either the two
      // attestations (self-sign) or the named signatory (send-by-email, #2365). The
      // organization is the grant-checked path parameter, and the return address is derived
      // from the request — EasyCLA stores that value and redirects to it verbatim, so a
      // client-supplied one would turn the hand-off into an open redirect.
      const body = req.body as
        | {
            projectSfid?: unknown;
            claGroupId?: unknown;
            authorityAcked?: unknown;
            embargoAcked?: unknown;
            sendAsEmail?: unknown;
            authorityName?: unknown;
            authorityEmail?: unknown;
          }
        | undefined;

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
      //
      // Send-by-email (#2365 / #2590) is the other shape. It does not collect those boxes, and
      // this boundary does not invent them: `sendAsEmail: true` skips the ack gate and requires
      // the named signatory instead. The producer skips the same gate. The values themselves
      // are not logged either.
      const sendAsEmail = body?.sendAsEmail === true;
      let request: OrgClaSignRequest;
      if (sendAsEmail) {
        // Typed, not `String()`-ed. `String({})` is `"[object Object]"`, which would pass a
        // blank check and then go upstream as a signatory name.
        const authorityName = typeof body?.authorityName === 'string' ? body.authorityName.trim() : '';
        const authorityEmail = typeof body?.authorityEmail === 'string' ? body.authorityEmail.trim() : '';
        if (!authorityName || !isEmailShape(authorityEmail)) {
          const message = 'A name and email address are required';
          throw ServiceValidationError.fromFieldErrors({ signatory: message }, message, { operation: 'request_org_cla_corporate_signature' });
        }
        // The floor is the producer's own. Its handler only refuses a blank, so a single-character
        // name is rejected a layer above it by generated request validation — at a status this
        // boundary does not relabel, so the body is dropped and the dialog falls back to generic
        // failure copy with nothing to act on. Naming the field is the whole gain.
        //
        // The length is mirrored; the producer's `authority_email` pattern is not. That pattern
        // caps the TLD at ten letters and leaves `'` out of the local part, so mirroring it would
        // refuse `.international` addresses and names like `o'brien@…` as a Self Serve validation
        // error for a constraint that belongs upstream.
        if (!isSendableAuthorityName(authorityName)) {
          const message =
            authorityName.length > ORG_CLA_AUTHORITY_NAME_MAX_LENGTH
              ? `The signatory name must be ${ORG_CLA_AUTHORITY_NAME_MAX_LENGTH} characters or fewer`
              : `The signatory name must be at least ${ORG_CLA_AUTHORITY_NAME_MIN_LENGTH} characters`;
          throw ServiceValidationError.fromFieldErrors({ authorityName: message }, message, { operation: 'request_org_cla_corporate_signature' });
        }
        request = { projectSfid, claGroupId, sendAsEmail: true, authorityName, authorityEmail };
      } else {
        if (body?.authorityAcked !== true || body?.embargoAcked !== true) {
          const message = 'Both the authorization and compliance confirmations are required';
          throw ServiceValidationError.fromFieldErrors({ attestations: message }, message, { operation: 'request_org_cla_corporate_signature' });
        }
        request = { projectSfid, claGroupId, authorityAcked: body.authorityAcked, embargoAcked: body.embargoAcked };
      }

      const result = await this.orgClaService.requestCorporateSignature(req, orgUid, request);

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

      if (result.outcome === 'forbidden') {
        logger.success(req, 'update_org_cla_approval_list', startTime, { org_uid: orgUid, signature_id: signatureId, can_edit: false });
        res.status(403).json({ message: 'Only a CLA manager named on this CLA can change its approval list' });
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

  /**
   * PUT /api/orgs/:orgUid/lens/cla-groups/:signatureId/ecla-auto-create
   *
   * Turns Auto ECLA on or off for one signed CCLA (#1988). The route is behind
   * `blockDuringImpersonation` + `requireOrgLensAccess`; the service raises a 403 with the
   * producer's own refusal sentence on the sanctions path, and this handler leaves that error
   * to the shared error handler rather than translating it here — the producer's copy is what
   * belongs on screen.
   *
   * `Cache-Control: no-store` because the response echoes the just-written state, and a CDN
   * substituting an earlier body would tell the manager the toggle held a value it does not.
   */
  public async updateEclaAutoCreate(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'update_org_cla_ecla_auto_create');

    try {
      const { orgUid, signatureId } = await this.requireAgreementContext(req, 'update_org_cla_ecla_auto_create');

      // Boolean-only body. Coercion is refused: a stringified `"false"` is `true` under `Boolean`,
      // and the toggle would then always turn on. Same discipline as the approval-list write
      // above, which rejects a non-string value rather than `String()`-ing it.
      const body = req.body as { autoCreateEcla?: unknown } | undefined;
      if (typeof body?.autoCreateEcla !== 'boolean') {
        logger.success(req, 'update_org_cla_ecla_auto_create', startTime, {
          org_uid: orgUid,
          signature_id: signatureId,
          rejected: 'invalid_body',
        });
        res.status(400).json({ message: 'Body must include boolean "autoCreateEcla"' });
        return;
      }

      const result = await this.orgClaService.updateEclaAutoCreate(req, orgUid, signatureId, body.autoCreateEcla);

      res.setHeader('Cache-Control', 'no-store');

      if (result.outcome === 'not-found') {
        logger.success(req, 'update_org_cla_ecla_auto_create', startTime, { org_uid: orgUid, signature_id: signatureId, found: false });
        res.status(404).json({ message: 'CLA agreement not found' });
        return;
      }

      if (result.outcome === 'not-signed') {
        logger.success(req, 'update_org_cla_ecla_auto_create', startTime, { org_uid: orgUid, signature_id: signatureId, signed: false });
        res.status(400).json({ message: 'This CLA has not been signed yet, so its Auto ECLA setting cannot be changed' });
        return;
      }

      logger.success(req, 'update_org_cla_ecla_auto_create', startTime, {
        org_uid: orgUid,
        signature_id: signatureId,
        auto_create_ecla: result.autoCreateEcla,
      });
      res.json({ autoCreateEcla: result.autoCreateEcla });
    } catch (error) {
      next(error);
    }
  }

  // GET /api/orgs/:orgUid/lens/cla-groups/:signatureId/acknowledgments
  //
  // Reads the paginated contributor acknowledgments (ECLA signatures) for one CCLA. Impersonation
  // is allowed; the upstream call runs as the impersonated user. `Cache-Control: no-store` on
  // every path because the body carries contributor identity attributes and a per-caller flag.
  public async getContributorAcknowledgments(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_cla_acknowledgments');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_org_cla_acknowledgments' });
      }

      const orgUid = req.params['orgUid'];
      assertOrgUid(orgUid, 'get_org_cla_acknowledgments');

      const signatureId = (req.params['signatureId'] ?? '').trim();
      if (!signatureId) {
        throw ServiceValidationError.forField('signatureId', 'signatureId path parameter is required', {
          operation: 'get_org_cla_acknowledgments',
        });
      }

      const rawPageSize = getStringQueryParam(req, 'pageSize');
      const parsedPageSize = rawPageSize ? Number(rawPageSize) : NaN;
      // Silent clamp — a page above 100 protects the producer, a request for zero rows prevents a
      // runaway zero-loop. Anything else outside the range is a caller mistake the producer would
      // punish; treating it as "give me the default" is friendlier than a 400 for what is a hint.
      const pageSize = Number.isFinite(parsedPageSize)
        ? Math.min(Math.max(Math.trunc(parsedPageSize), ORG_CLA_ACKNOWLEDGMENTS_PAGE_SIZE_MIN), ORG_CLA_ACKNOWLEDGMENTS_PAGE_SIZE_MAX)
        : ORG_CLA_ACKNOWLEDGMENTS_PAGE_SIZE_DEFAULT;

      const search = (getStringQueryParam(req, 'search') ?? '').trim();
      const nextKeyRaw = (getStringQueryParam(req, 'nextKey') ?? '').trim();
      const nextKey = nextKeyRaw.length > 0 ? nextKeyRaw : undefined;

      const list = await this.orgClaService.getContributorAcknowledgments(req, orgUid, signatureId, { search, pageSize, nextKey });

      res.setHeader('Cache-Control', 'no-store');

      if (!list) {
        logger.success(req, 'get_org_cla_acknowledgments', startTime, { org_uid: orgUid, signature_id: signatureId, found: false });
        res.status(404).json({ message: 'CLA agreement not found' });
        return;
      }

      logger.success(req, 'get_org_cla_acknowledgments', startTime, {
        org_uid: orgUid,
        signature_id: signatureId,
        result_count: list.resultCount,
        total_count: list.totalCount,
        can_edit: list.canEdit,
        has_next: !!list.nextKey,
      });
      res.json(list);
    } catch (error) {
      next(error);
    }
  }

  // GET /api/orgs/:orgUid/lens/cla-groups/:signatureId/activity
  //
  // Reads one page of the per-CCLA activity log. Read-only, org-scope: the middleware chain is
  // `requireOrgLensAccess` only — no `blockDuringImpersonation`, no CLA-manager check. That is
  // wider than the write tabs on this router by design (see the service header for why the log
  // is a broader grant than the manager-only writes). `Cache-Control: no-store` on every path
  // because the body carries actor names and timestamps.
  public async getActivityLog(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'get_org_cla_activity_log');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'get_org_cla_activity_log' });
      }

      const orgUid = req.params['orgUid'];
      assertOrgUid(orgUid, 'get_org_cla_activity_log');

      const signatureId = (req.params['signatureId'] ?? '').trim();
      if (!signatureId) {
        throw ServiceValidationError.forField('signatureId', 'signatureId path parameter is required', {
          operation: 'get_org_cla_activity_log',
        });
      }

      const rawPageSize = getStringQueryParam(req, 'pageSize');
      const parsedPageSize = rawPageSize ? Number(rawPageSize) : NaN;
      // Silent clamp — a page above 100 protects the producer, a request for zero rows prevents a
      // runaway zero-loop. Same discipline as the sibling acknowledgments read.
      const pageSize = Number.isFinite(parsedPageSize)
        ? Math.min(Math.max(Math.trunc(parsedPageSize), ORG_CLA_ACTIVITY_LOG_PAGE_SIZE_MIN), ORG_CLA_ACTIVITY_LOG_PAGE_SIZE_MAX)
        : ORG_CLA_ACTIVITY_LOG_PAGE_SIZE_DEFAULT;

      const nextKeyRaw = (getStringQueryParam(req, 'nextKey') ?? '').trim();
      const nextKey = nextKeyRaw.length > 0 ? nextKeyRaw : undefined;

      // `returnAllEvents` only raises the producer's page limit on the same partition.
      // It is not read or forwarded; the page size this route already clamps is the bound.

      const page = await this.orgClaService.getActivityLog(req, orgUid, signatureId, { pageSize, nextKey });

      res.setHeader('Cache-Control', 'no-store');

      if (!page) {
        logger.success(req, 'get_org_cla_activity_log', startTime, { org_uid: orgUid, signature_id: signatureId, found: false });
        res.status(404).json({ message: 'CLA agreement not found' });
        return;
      }

      logger.success(req, 'get_org_cla_activity_log', startTime, {
        org_uid: orgUid,
        signature_id: signatureId,
        result_count: page.resultCount,
        has_next: !!page.nextKey,
      });
      res.json(page);
    } catch (error) {
      // The error handler closes the operation and picks the severity. Logging here first
      // deletes the registered operation, so the handler then logs again under a path-derived
      // name — and a client 4xx is recorded at error level. Sibling reads only call `next`.
      next(error);
    }
  }

  // POST /api/orgs/:orgUid/lens/cla-groups/:signatureId/acknowledgments/:acknowledgmentSignatureId/invalidate
  //
  // Invalidates one acknowledgment. The route blocks impersonation ahead of the grant check, so
  // there is no impersonation branch here. `reason` and `note` are both optional — the producer
  // accepts an empty body — but a reason it does not define, or a note past its cap, is refused
  // here rather than forwarded for the producer to reject with wording the tab cannot show.
  public async invalidateAcknowledgment(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'invalidate_org_cla_acknowledgment');

    try {
      const { orgUid, signatureId } = await this.requireAgreementContext(req, 'invalidate_org_cla_acknowledgment');

      const acknowledgmentSignatureId = (req.params['acknowledgmentSignatureId'] ?? '').trim();
      if (!CLA_GROUP_ID_PATTERN.test(acknowledgmentSignatureId)) {
        throw ServiceValidationError.forField('acknowledgmentSignatureId', 'A valid acknowledgmentSignatureId path parameter is required', {
          operation: 'invalidate_org_cla_acknowledgment',
        });
      }

      // Same shape as the approval-list write's rejections: `{ message }` the tab shows verbatim,
      // and the operation is closed as it answers so a refused write does not log a start that
      // never finishes.
      const reject = (message: string, reason: string): void => {
        logger.success(req, 'invalidate_org_cla_acknowledgment', startTime, { org_uid: orgUid, signature_id: signatureId, rejected: reason });
        res.status(400).json({ message });
      };

      const body = req.body as { reason?: unknown; note?: unknown } | undefined;

      if (body?.reason !== undefined && !isOrgClaInvalidationReason(body.reason)) {
        reject('Choose one of the offered reasons for invalidating this acknowledgment', 'invalid_reason');
        return;
      }

      // Refused, not truncated. A note silently cut at the cap is recorded on a legal audit trail
      // as something the CLA manager did not write.
      if (body?.note !== undefined && typeof body.note !== 'string') {
        reject('The note must be text', 'invalid_note');
        return;
      }
      // Code points, not UTF-16 units, to match the producer's go-swagger rune cap.
      if (typeof body?.note === 'string' && codePointLength(body.note.trim()) > ORG_CLA_INVALIDATION_NOTE_MAX_LENGTH) {
        reject(`The note may be at most ${ORG_CLA_INVALIDATION_NOTE_MAX_LENGTH} characters`, 'note_too_long');
        return;
      }

      const input: OrgClaInvalidateAcknowledgmentRequest = {
        ...(isOrgClaInvalidationReason(body?.reason) ? { reason: body.reason } : {}),
        ...(typeof body?.note === 'string' ? { note: body.note } : {}),
      };

      const result = await this.orgClaService.invalidateAcknowledgment(req, orgUid, signatureId, acknowledgmentSignatureId, input);

      res.setHeader('Cache-Control', 'no-store');

      if (result.outcome === 'not-found') {
        logger.success(req, 'invalidate_org_cla_acknowledgment', startTime, {
          org_uid: orgUid,
          signature_id: signatureId,
          found: false,
        });
        res.status(404).json({ message: 'Acknowledgment not found' });
        return;
      }

      if (result.outcome === 'not-signed') {
        logger.success(req, 'invalidate_org_cla_acknowledgment', startTime, { org_uid: orgUid, signature_id: signatureId, signed: false });
        res.status(400).json({ message: 'This CLA has not been signed yet, so it has no acknowledgments to invalidate' });
        return;
      }

      if (result.outcome === 'forbidden') {
        logger.success(req, 'invalidate_org_cla_acknowledgment', startTime, { org_uid: orgUid, signature_id: signatureId, can_edit: false });
        res.status(403).json({ message: 'Only a CLA manager named on this CLA can invalidate acknowledgments' });
        return;
      }

      logger.success(req, 'invalidate_org_cla_acknowledgment', startTime, {
        org_uid: orgUid,
        signature_id: signatureId,
        // The reason is one of four fixed enum values, so it carries no contributor detail. The
        // note is free text a CLA manager typed and stays out of the log entirely.
        reason: input.reason ?? 'none',
      });
      res.json(result.result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/orgs/:orgUid/lens/cla-groups/permissions/checks
   *
   * Visibility helper only. The browser posts a typed action; this interpolates the ACS string
   * and answers `{ allowed }`. Failures and missing identifiers answer `{ allowed: false }` rather
   * than 5xx, so a timeout cannot continue Sign. Not mounted on the Sign or approval-list write.
   */
  public async checkPermission(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'check_org_cla_permission');

    try {
      if (!(await getUsernameFromAuth(req))) {
        throw new AuthenticationError('User authentication required', { operation: 'check_org_cla_permission' });
      }

      const orgUid = req.params['orgUid'];
      assertOrgUid(orgUid, 'check_org_cla_permission');

      const raw = req.body as { action?: unknown; projectSfid?: unknown } | undefined;
      const action = raw?.action;
      if (!isOrgClaPermissionAction(action)) {
        logger.success(req, 'check_org_cla_permission', startTime, { org_uid: orgUid, rejected: 'unknown_action' });
        res.status(400).json({ message: 'Unknown permission action' });
        return;
      }

      const projectSfid = typeof raw?.projectSfid === 'string' ? raw.projectSfid.trim() : undefined;
      const request: OrgClaPermissionCheckRequest = {
        action,
        ...(projectSfid ? { projectSfid } : {}),
      };
      const allowed = await this.orgClaPermissions.check(req, orgUid, request.action, request.projectSfid);

      logger.success(req, 'check_org_cla_permission', startTime, { org_uid: orgUid, action, allowed });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ allowed });
    } catch (error) {
      next(error);
    }
  }

  // GET /api/orgs/:orgUid/lens/cla-groups/:signatureId/managers
  public async listManagers(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'list_org_cla_managers');

    try {
      const { orgUid, signatureId } = await this.requireAgreementContext(req, 'list_org_cla_managers');

      const result = await this.orgClaService.getManagers(req, orgUid, signatureId);

      res.setHeader('Cache-Control', 'no-store');

      if (!result) {
        logger.success(req, 'list_org_cla_managers', startTime, { org_uid: orgUid, signature_id: signatureId, found: false });
        res.status(404).json({ message: 'Agreement not found' });
        return;
      }

      logger.success(req, 'list_org_cla_managers', startTime, { org_uid: orgUid, signature_id: signatureId, manager_count: result.managers.length });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // POST /api/orgs/:orgUid/lens/cla-groups/:signatureId/managers
  public async addManager(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'add_org_cla_manager');

    try {
      const { orgUid, signatureId } = await this.requireAgreementContext(req, 'add_org_cla_manager');

      const body = (req.body ?? {}) as Partial<OrgClaManagerAddRequest>;
      const validation = validateOrgClaManagerAdd(body);
      if (hasOrgClaManagerAddErrors(validation)) {
        throw ServiceValidationError.fromFieldErrors(validation as Record<string, string>, 'Validation failed', { operation: 'add_org_cla_manager' });
      }

      const manager = await this.orgClaService.addManager(req, orgUid, signatureId, {
        firstName: body.firstName!.trim(),
        lastName: body.lastName!.trim(),
        email: body.email!.trim(),
      });

      res.setHeader('Cache-Control', 'no-store');

      if (!manager) {
        logger.success(req, 'add_org_cla_manager', startTime, { org_uid: orgUid, signature_id: signatureId, found: false });
        res.status(404).json({ message: 'Agreement not found' });
        return;
      }

      logger.success(req, 'add_org_cla_manager', startTime, { org_uid: orgUid, signature_id: signatureId });
      res.status(201).json(manager);
    } catch (error) {
      next(error);
    }
  }

  // DELETE /api/orgs/:orgUid/lens/cla-groups/:signatureId/managers/:lfUsername
  public async removeManager(req: Request, res: Response, next: NextFunction): Promise<void> {
    const startTime = logger.startOperation(req, 'remove_org_cla_manager');

    try {
      const { orgUid, signatureId } = await this.requireAgreementContext(req, 'remove_org_cla_manager');

      const lfUsername = (req.params['lfUsername'] ?? '').trim();
      if (!isOrgClaManagerLfUsername(lfUsername)) {
        throw ServiceValidationError.forField('lfUsername', 'A valid lfUsername path parameter is required', { operation: 'remove_org_cla_manager' });
      }

      const removed = await this.orgClaService.removeManager(req, orgUid, signatureId, lfUsername);

      res.setHeader('Cache-Control', 'no-store');

      if (!removed) {
        logger.success(req, 'remove_org_cla_manager', startTime, { org_uid: orgUid, signature_id: signatureId, found: false });
        res.status(404).json({ message: 'Agreement not found' });
        return;
      }

      logger.success(req, 'remove_org_cla_manager', startTime, { org_uid: orgUid, signature_id: signatureId });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  }

  private async requireAgreementContext(req: Request, operation: string): Promise<{ orgUid: string; signatureId: string }> {
    if (!(await getUsernameFromAuth(req))) {
      throw new AuthenticationError('User authentication required', { operation });
    }

    const orgUid = req.params['orgUid'];
    assertOrgUid(orgUid, operation);

    const signatureId = (req.params['signatureId'] ?? '').trim();
    if (!CLA_GROUP_ID_PATTERN.test(signatureId)) {
      throw ServiceValidationError.forField('signatureId', 'A valid signatureId path parameter is required', { operation });
    }

    return { orgUid, signatureId };
  }
}
