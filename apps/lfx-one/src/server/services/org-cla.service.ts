// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Organization Lens EasyCLA list (#1978). Reads the organization's corporate CLAs from
// EasyCLA's organization CLA landing list (easycla#5188) and maps them onto the row the
// Org Lens page renders.
//
// One upstream call per page load, whatever the number of agreements. Searching and paging
// happen client-side over the fetched set, so nothing on this path fans out per row.

import { ORG_EASYCLA_PATH } from '@lfx-one/shared/constants';
import type {
  ClaGroupOption,
  ClaGroupSearchResponse,
  OrgClaGroup,
  OrgClaGroupList,
  OrgClaGroupProject,
  OrgClaGroupStatus,
  OrgClaSignRequest,
  OrgClaSignResponse,
  PdfUrlResponse,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import type {
  EasyClaCompanyClaGroup,
  EasyClaCompanyClaGroupList,
  EasyClaSearchList,
  EasyClaSelfServeCorporateSignatureInput,
  EasyClaSelfServeCorporateSignatureOutput,
  EasyClaSignedDocument,
} from '../types/cla.types';
import { MicroserviceError } from '../errors';
import { claServiceBaseUrl } from '../helpers/cla-service-url.helper';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import { claReturnUrl, toClaGroupOption, withoutUpstreamBody, withProducerRefusalMessage } from './cla.service';
import { logger } from './logger.service';
import { isImpersonating } from '../utils/auth-helper';

const SERVICE = 'org_cla_service';

/**
 * Maps one upstream entry onto the list row, once its signature id is known to be present.
 *
 * The id is required here rather than defaulted, so the check for it stays at the point where a
 * malformed response can still be rejected as one. A default inside the mapper would silently
 * produce a row that renders.
 *
 * Two upstream fields are dropped here rather than left unrendered, because a field the
 * template ignores still reaches the browser inside the transferred state:
 *
 * - `claManagers` — the managers by id and LF username. This surface shows only how many
 *   there are, so the identities have no reason to leave the server. Rendering them is a
 *   separate feature and needs its own authorization argument.
 * - `approvedContributorsCount` — a real number, but not the one the card's first stat
 *   names. That slot is `approvalCriteriaCount` (the rules deciding who may be covered);
 *   this is the count of employee acknowledgements (the people covered). They are easy to
 *   confuse because the console this replaces labels its rules section as though it listed
 *   contributors. Mapping it here is how it ends up under the wrong label.
 *
 * `autoCreateECLA` is likewise not carried: it belongs to a later feature.
 *
 * `signed` is carried, but only as the answer to "is there a document" — never as a display
 * status. `status` remains the single slot the template reads, because sanctions outrank
 * signing there and a consumer forming its own opinion from the two booleans would present a
 * sanctioned entity's agreement as ordinarily signed. What `status` cannot answer is whether a
 * document exists to fetch, since a `sanctioned` row may be signed or unsigned, and that is the
 * one question `signed` is here for.
 */
function toOrgClaGroup(entry: EasyClaCompanyClaGroup & { signatureID: string }, companyName: string): OrgClaGroup {
  const projects: OrgClaGroupProject[] = (entry.projects ?? [])
    .map((project) => ({
      projectName: project.projectName?.trim() ?? '',
      ...(project.projectSFID ? { projectSfid: project.projectSFID } : {}),
    }))
    // A project that arrives without a name cannot be rendered as a chip or matched by
    // search, and counting it would overstate coverage on the "Covers N projects" line.
    .filter((project) => !!project.projectName);

  const signingEntityName = entry.signingEntityName?.trim() ?? '';
  const claGroupName = entry.claGroupName?.trim() ?? '';

  return {
    id: entry.signatureID,
    // Upstream declares claGroupName always present; the UUID fallback exists so a producer
    // that drops it yields an identifiable card rather than a blank heading.
    claGroupName: claGroupName || (entry.claGroupID ?? ''),
    ...(entry.claGroupID ? { claGroupId: entry.claGroupID } : {}),
    // Suppressed when it matches the organization's own name, which is the common case:
    // upstream falls back to the company name for a record with no signing entity of its
    // own, and echoing the page title under every card's heading is noise. It earns its
    // place only when it distinguishes two rows that share a CLA Group name.
    ...(signingEntityName && signingEntityName !== companyName.trim() ? { signingEntityName } : {}),
    ...(entry.foundationName ? { foundationName: entry.foundationName } : {}),
    ...(entry.foundationSFID ? { foundationSfid: entry.foundationSFID } : {}),
    projects,
    // Only for an agreement that was actually signed. Upstream backfills this field with the
    // signature's creation time when there is no signing timestamp, so on an unsigned row it
    // holds when the signing was begun, not when it completed. Carrying it under a field the
    // shared contract defines as the instant the CCLA was signed would hand the detail view a
    // date to present as a signature date for an agreement that has none.
    ...(entry.signed === true && entry.signedOn ? { signedOn: entry.signedOn } : {}),
    // Gated on `signed` for the same reason as the date above, and omitted when upstream sent no
    // name — a deployment predating the field, or a signature whose signatory name is blank. Both
    // read as "the signer is not known", which the overview answers by naming nobody.
    ...(entry.signed === true && entry.signedBy ? { signedBy: entry.signedBy } : {}),
    signed: entry.signed === true,
    status: toStatus(entry),
    needsClaManager: entry.needsClaManager === true,
    claManagersCount: entry.claManagersCount ?? 0,
    // Carried only when upstream actually sent a number, so an environment still running a
    // producer without the field renders the stat as unavailable rather than asserting 0.
    // `?? 0` here would turn "this deployment cannot tell you" into "this agreement approves
    // nobody" — a legal claim, and a false one.
    ...(typeof entry.approvalCriteriaCount === 'number' ? { approvalCriteriaCount: entry.approvalCriteriaCount } : {}),
  };
}

/**
 * Sanctions win over signed-ness.
 *
 * Upstream carries the two as independent booleans and the card has one status slot, so the
 * combination has to collapse somewhere. It collapses toward sanctioned: showing a
 * sanctioned entity's agreement as ordinarily signed is the more damaging of the two errors
 * available here.
 *
 * An unsigned agreement is a real case, and it is read from the flag rather than assumed
 * away. The producer sets each row's signed flag from the signature it was built from, and
 * its own tests pin a returned row whose flag is false, so the list is not exclusively
 * signed agreements. Defaulting to `signed` would state that an organization has signed
 * something it has not — the same class of false claim the precedence above avoids, and the
 * reason the flag is checked explicitly rather than treated as always true.
 *
 * Sanctions still win over an unsigned agreement, for the same reason they win over a signed
 * one: the sanctions fact is the one a viewer must not miss.
 */
function toStatus(entry: EasyClaCompanyClaGroup): OrgClaGroupStatus {
  if (entry.sanctioned === true) return 'sanctioned';
  return entry.signed === true ? 'signed' : 'not-started';
}

export class OrgClaService {
  /**
   * Lists the organization's corporate CLAs.
   *
   * `orgUid` is the grant-checked path parameter, and it goes to the upstream unchanged:
   * org-lens routes carry the 18-character Salesforce account id, which member-service made
   * the canonical org uid, and that is the same value EasyCLA keys `companySFID` on. No
   * resolution step sits between the two. The caller's own `orgUid` is the only source —
   * nothing is read from the query string or the body.
   *
   * An empty list is a valid answer meaning the organization has signed nothing. Upstream
   * returns the same for an organization it has no record of, and deliberately does not
   * create one; there is no 404 on this path. An upstream failure therefore propagates
   * rather than degrading to an empty list — with no 404 to distinguish them, "we could not
   * load your CLAs" and "you have signed none" would otherwise be indistinguishable, and
   * only one of them is a claim about a company's legal position.
   */
  public async listClaGroups(req: Request, orgUid: string): Promise<OrgClaGroupList> {
    const upstream = await gatewayFetch<EasyClaCompanyClaGroupList>(
      req,
      `${claServiceBaseUrl(SERVICE)}/v4/company/external/${encodeURIComponent(orgUid)}/cla-groups`,
      {
        operation: 'org_cla_list_cla_groups',
        service: SERVICE,
        errorMessage: 'Failed to fetch organization CLA groups',
        errorCode: 'UPSTREAM_ERROR',
        // This response carries CLA managers by id and LF username. The mapper drops them, but
        // that boundary only covers the browser: on a non-OK status or unparseable body the
        // fetch helper logs the raw payload, which would put manager identities in application
        // logs. Redaction closes the second path (same reason as rewards.service.ts).
        redactResponseBody: true,
        // The route authorizes the impersonated user, so the upstream call must run as that
        // user too. Without this it runs as the impersonator, which is audited as the wrong
        // identity and fails outright where only the target holds the organization scope.
        bearerToken: isImpersonating(req) ? req.bearerToken : undefined,
      }
    );

    // A malformed response is a failure, not an answer. `gatewayFetch` returns null on a 204,
    // and a 200 can arrive without the list the contract guarantees; both would otherwise fall
    // through to an empty list and be rendered as "this organization has signed nothing" —
    // precisely the false claim the paragraph above refuses to make for a failed request.
    if (!upstream || !Array.isArray(upstream.list)) {
      throw new MicroserviceError('Failed to fetch organization CLA groups: malformed response from upstream', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation: 'org_cla_list_cla_groups',
        service: SERVICE,
      });
    }

    // A row without its signature id is malformed for the same reason the envelope above is: the
    // id is the row's identity, and the list renders keyed on it. Substituting an empty string
    // makes every such row share one key, which lets the view reuse one card's DOM for another
    // agreement — a worse outcome than the load failure this raises instead.
    if (!upstream.list.every((entry): entry is EasyClaCompanyClaGroup & { signatureID: string } => !!entry?.signatureID)) {
      throw new MicroserviceError('Failed to fetch organization CLA groups: upstream row is missing its signature id', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation: 'org_cla_list_cla_groups',
        service: SERVICE,
      });
    }

    const entries = upstream.list;
    const companyName = entries.find((entry) => !!entry.companyName)?.companyName ?? '';

    return {
      orgUid,
      // Upstream order (signing entity, then CLA group name) is preserved, so what a support
      // engineer sees probing the endpoint directly matches what the page shows.
      claGroups: entries.map((entry) => toOrgClaGroup(entry, companyName)),
    };
  }

  /**
   * Resolves the download URL for one agreement's signed CCLA.
   *
   * The signature is resolved through the organization's own list first, and a signature that is
   * not on it is answered as absent without the upstream ever being called. `requireOrgLensAccess`
   * proves which organization the caller may view as; it says nothing about which signatures
   * belong to that organization, so without this step the `orgUid` in the path is decorative and
   * the id alone selects the document. That is the whole gate on this path: upstream authorizes
   * the signed-document read against project scope, which is a different question from the
   * company-level grant this route is reached with, so it cannot be relied on to answer this one.
   *
   * The cost is the list call the page has already made — paid once per download, which is a
   * button press, not a render.
   */
  public async getPdfUrl(req: Request, orgUid: string, signatureId: string): Promise<PdfUrlResponse | null> {
    // No `startOperation` here: the HTTP lifecycle belongs to the controller, which already opens
    // and closes one for this endpoint. A second timer would double the completion telemetry and
    // measure a different span than the request it is attributed to.
    const { claGroups } = await this.listClaGroups(req, orgUid);
    const match = claGroups.find((group) => group.id === signatureId);
    if (!match) {
      logger.warning(req, 'org_cla_get_pdf_url', 'signature is not on this organization CLA list', { org_uid: orgUid, signature_id: signatureId });
      return null;
    }

    // Membership is not signedness. A sanctioned row may be unsigned, and upstream presigns the
    // expected S3 key without checking that anything was ever written there — so calling it for
    // an unsigned agreement hands back a URL to a document that does not exist. Absent is the
    // honest answer, and it is the one the caller already handles.
    if (!match.signed) {
      logger.warning(req, 'org_cla_get_pdf_url', 'agreement is not signed, so no document exists', { org_uid: orgUid, signature_id: signatureId });
      return null;
    }

    let result: EasyClaSignedDocument | null;
    try {
      result = await gatewayFetch<EasyClaSignedDocument>(
        req,
        `${claServiceBaseUrl(SERVICE)}/v4/signatures/${encodeURIComponent(signatureId)}/signed-document`,
        {
          operation: 'org_cla_get_pdf_url',
          service: SERVICE,
          errorMessage: 'Failed to fetch signed document URL',
          errorCode: 'UPSTREAM_ERROR',
          // As the list call above, and this path needs it more. A 403 here is expected rather
          // than exceptional — the producer authorizes the document by project scope, which an
          // organization-only viewer can lack for an agreement they can see listed — and its body
          // names the authenticated user. On a non-OK status or an unparseable body the fetch
          // helper logs the raw payload, so without this the routine case writes an identity into
          // application logs. A malformed success would put the presigned URL there too.
          redactResponseBody: true,
          bearerToken: isImpersonating(req) ? req.bearerToken : undefined,
        }
      );
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 404) {
        logger.warning(req, 'org_cla_get_pdf_url', 'upstream holds no signed document for this signature', { signature_id: signatureId });
        return null;
      }
      // Rethrown unlogged: `apiErrorHandler` logs every error centrally with the request context,
      // and the signature id is in the path it records.
      throw error;
    }

    const url = result?.signed_cla_url?.trim() || result?.signedClaUrl?.trim() || '';
    if (!url) {
      logger.warning(req, 'org_cla_get_pdf_url', 'signed document carries no url', { signature_id: signatureId });
      return null;
    }

    logger.debug(req, 'org_cla_get_pdf_url', 'resolved a signed document url', { signature_id: signatureId });
    // No expiry reported: the signed-document response carries only the URL, so any number here
    // would be invented. The URL is presigned and short-lived, but its lifetime is upstream's to
    // state, and `0` would read to a consumer as already expired.
    return { url };
  }

  /**
   * Searches CLA Groups the organization could sign a corporate CLA for (#1983).
   *
   * Wraps the Me-lens per-result mapper rather than reimplementing or amending it, and appends
   * `projectSfid` afterwards. That id is what the corporate signature request is keyed on, and it
   * has no consumer on the Me-lens path, so carrying it in the shared mapper would put an unread
   * field into that response and into the state it ships with. Keeping the append here leaves the
   * Me-lens envelope byte-identical.
   *
   * Upstream sets the id from a project-to-CLA-Group mapping row and deliberately leaves it unset
   * when a CLA Group maps to several projects with none of them foundation-level. It is therefore
   * carried only when upstream sent one, and its absence is what the picker renders as
   * "cannot be signed from here" — a property of the CLA Group, not a failure.
   *
   * Runs on the default gateway token with no impersonation branch, same as the Me-lens search:
   * the CLA Group catalogue is not organization-scoped upstream, so there is no ownership check
   * for a token swap to satisfy. The organization gate on this route is the dark-launch flag and
   * `requireOrgLensAccess`; nothing about the caller's company reaches the query.
   */
  public async getSignOptions(req: Request, searchTerm: string): Promise<ClaGroupSearchResponse> {
    const startTime = logger.startOperation(req, 'org_cla_sign_options');

    const params = new URLSearchParams({ searchTerm });
    const list = await gatewayFetch<EasyClaSearchList>(req, `${claServiceBaseUrl(SERVICE)}/v4/cla-group/search?${params.toString()}`, {
      operation: 'org_cla_sign_options',
      service: SERVICE,
      errorMessage: 'Failed to search CLA groups',
      errorCode: 'UPSTREAM_ERROR',
    });

    const upstreamResults = list?.results ?? [];
    const results: ClaGroupOption[] = upstreamResults.map((result) => {
      const option = toClaGroupOption(result);
      const projectSfid = result.projectSFID?.trim();
      return projectSfid ? { ...option, projectSfid } : option;
    });

    const envelope: ClaGroupSearchResponse = {
      searchTerm: list?.searchTerm ?? searchTerm,
      resultCount: list?.resultCount ?? results.length,
      truncated: list?.truncated === true,
      results,
    };

    logger.success(req, 'org_cla_sign_options', startTime, {
      result_count: envelope.resultCount,
      truncated: envelope.truncated,
      signable_count: results.filter((option) => !!option.projectSfid && option.cclaEnabled === true).length,
    });
    return envelope;
  }

  /**
   * Opens a corporate signing session for the organization and returns where the signatory
   * completes it (#1983).
   *
   * Three values are deliberately not taken from the caller's body:
   *
   * - the organization, which is the grant-checked `orgUid` path parameter;
   * - the return address, derived from the request Host and host-checked, because EasyCLA stores
   *   it and later redirects to it verbatim — a client-supplied one would be an open redirect;
   * - the caller's identity, which travels as the default gateway token. That token is the
   *   signatory's own, exchanged for the gateway audience, and it is what makes the signature
   *   attributable. There is no impersonation branch precisely because the route is blocked
   *   during impersonation instead: a corporate agreement signed under an impersonated session
   *   would bind a company on behalf of somebody who did not act.
   *
   * The two attestations are passed through exactly as received. They are not defaulted here and
   * must not be: the client gates on both, so a request arriving with either false is either a
   * signatory who withdrew a confirmation or a client that has regressed, and both must reach the
   * refusal rather than be papered over. Upstream rejects the request ahead of any signing work
   * for the same reason.
   *
   * Authorization is upstream's alone. It checks the caller's signing authority for the project
   * and organization pair — refusing a platform-administrator token, which an org-lens read grant
   * has no bearing on — and screens the company for trade compliance on every request. Neither is
   * pre-empted here: the compliance status carried on an existing agreement row cannot answer for
   * an organization that holds no agreements yet, which is the population this flow serves.
   */
  public async requestCorporateSignature(req: Request, orgUid: string, request: OrgClaSignRequest): Promise<OrgClaSignResponse> {
    const startTime = logger.startOperation(req, 'org_cla_request_corporate_signature', {
      project_sfid: request.projectSfid,
      cla_group_id: request.claGroupId,
    });

    // Derived before the call: an unusable origin dead-ends the hand-off anyway, and failing
    // afterwards would leave a real signing session behind with nowhere to return to.
    const returnUrl = claReturnUrl(req, ORG_EASYCLA_PATH);

    // snake_case on the wire, unlike the Me-lens prepare-sign next door. Built as a typed object
    // rather than spread from the request so every field crossing the spelling boundary is named.
    const body: EasyClaSelfServeCorporateSignatureInput = {
      project_sfid: request.projectSfid,
      company_sfid: orgUid,
      return_url: returnUrl,
      authority_acked: request.authorityAcked,
      embargo_acked: request.embargoAcked,
    };

    let result: EasyClaSelfServeCorporateSignatureOutput | null;
    try {
      result = await gatewayFetch<EasyClaSelfServeCorporateSignatureOutput>(req, `${claServiceBaseUrl(SERVICE)}/v4/self-serve/request-corporate-signature`, {
        operation: 'org_cla_request_corporate_signature',
        service: SERVICE,
        errorMessage: 'Failed to request the corporate CLA signature',
        errorCode: 'UPSTREAM_ERROR',
        method: 'POST',
        body,
        // A refusal from this endpoint names the caller's LF username when it is about scope, and
        // the organization's trade-compliance standing when it is about sanctions. Neither belongs
        // in an application log. Full redaction would take the refusal sentence with it — the body
        // is the only place that sentence exists — so the body is kept out of the log here and
        // dropped from the error below, once the message has been taken out of it.
        redactResponseBodyFromLogs: true,
      });
    } catch (error) {
      // A 403 here is a sentence written for the signatory — the trade-compliance refusal names
      // the reason and the support route, and the authority refusal names the missing scope.
      // Relabelling is what puts those words on screen instead of "403 Forbidden".
      //
      // Then the body goes, message already extracted. Without that second step the error reaches
      // the API error handler still carrying it, and `getLogContext` writes it to the log line
      // that handler emits — which is the same disclosure the fetch option just prevented.
      throw withoutUpstreamBody(withProducerRefusalMessage(error, 'org_cla_request_corporate_signature', SERVICE));
    }

    const signUrl = result?.sign_url?.trim() ?? '';
    const signatureId = result?.signature_id?.trim() ?? '';

    // An empty signing address is how upstream signals that the agreement was emailed to a named
    // signatory instead — a shape this route never requests, since it sends no `send_as_email`.
    // Receiving one means the request was not fulfilled the way it was made, so it fails loudly.
    // Navigating to an empty address would send the signatory to this application's own root and
    // read as a successful hand-off that silently signed nothing.
    if (!signUrl || !signatureId) {
      logger.error(req, 'org_cla_request_corporate_signature', startTime, new Error('upstream returned no usable signing session'), {
        has_sign_url: !!signUrl,
        has_signature_id: !!signatureId,
      });
      throw new MicroserviceError('Upstream opened no usable corporate signing session', 502, 'CLA_SIGN_SESSION_INCOMPLETE', {
        operation: 'org_cla_request_corporate_signature',
        service: SERVICE,
      });
    }

    // The signature id is logged for correlation and deliberately not returned: nothing on the
    // client reads it, and it identifies a named person's agreement.
    logger.success(req, 'org_cla_request_corporate_signature', startTime, { org_uid: orgUid, signature_id: signatureId });

    return { signUrl };
  }
}
