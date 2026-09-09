// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Organization Lens EasyCLA list (#1978). Reads the organization's corporate CLAs from
// EasyCLA's organization CLA landing list (easycla#5188) and maps them onto the row the
// Org Lens page renders.
//
// One upstream call per page load, whatever the number of agreements. Searching and paging
// happen client-side over the fetched set, so nothing on this path fans out per row.

import type { OrgClaGroup, OrgClaGroupList, OrgClaGroupProject, OrgClaGroupStatus, PdfUrlResponse } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import type { EasyClaCompanyClaGroup, EasyClaCompanyClaGroupList, EasyClaSignedDocument } from '../types/cla.types';
import { MicroserviceError } from '../errors';
import { claServiceBaseUrl } from '../helpers/cla-service-url.helper';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
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
 * `autoCreateECLA` and `signed` are likewise not carried: the first belongs to a later
 * feature, the second is folded into `status` so no consumer forms a second opinion about
 * what "signed" means for display.
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
    const startTime = logger.startOperation(req, 'org_cla_get_pdf_url', { signature_id: signatureId });

    const { claGroups } = await this.listClaGroups(req, orgUid);
    const match = claGroups.find((group) => group.id === signatureId);
    if (!match) {
      logger.warning(req, 'org_cla_get_pdf_url', 'signature is not on this organization CLA list', { org_uid: orgUid, signature_id: signatureId });
      logger.success(req, 'org_cla_get_pdf_url', startTime, { outcome: 'not_on_organization_list' });
      return null;
    }

    // Membership is not signedness. A sanctioned row may be unsigned, and upstream presigns the
    // expected S3 key without checking that anything was ever written there — so calling it for
    // an unsigned agreement hands back a URL to a document that does not exist. Absent is the
    // honest answer, and it is the one the caller already handles.
    if (!match.signed) {
      logger.success(req, 'org_cla_get_pdf_url', startTime, { outcome: 'agreement_not_signed' });
      return null;
    }

    let result: EasyClaSignedDocument | null;
    try {
      result = await gatewayFetch<EasyClaSignedDocument>(req, `${claServiceBaseUrl()}/v4/signatures/${encodeURIComponent(signatureId)}/signed-document`, {
        operation: 'org_cla_get_pdf_url',
        service: SERVICE,
        errorMessage: 'Failed to fetch signed document URL',
        errorCode: 'UPSTREAM_ERROR',
        bearerToken: isImpersonating(req) ? req.bearerToken : undefined,
      });
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 404) {
        logger.success(req, 'org_cla_get_pdf_url', startTime, { outcome: 'document_absent' });
        return null;
      }
      logger.error(req, 'org_cla_get_pdf_url', startTime, error, { signature_id: signatureId });
      throw error;
    }

    const url = result?.signed_cla_url?.trim() || result?.signedClaUrl?.trim() || '';
    if (!url) {
      logger.success(req, 'org_cla_get_pdf_url', startTime, { outcome: 'no_url_on_document' });
      return null;
    }

    logger.success(req, 'org_cla_get_pdf_url', startTime, { outcome: 'resolved' });
    // No expiry reported: the signed-document response carries only the URL, so any number here
    // would be invented. The URL is presigned and short-lived, but its lifetime is upstream's to
    // state, and `0` would read to a consumer as already expired.
    return { url };
  }
}
