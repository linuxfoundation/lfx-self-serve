// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Organization Lens EasyCLA list (#1978). Reads the organization's corporate CLAs from
// EasyCLA's organization CLA landing list (easycla#5188) and maps them onto the row the
// Org Lens page renders.

import {
  ORG_CLA_ACKNOWLEDGMENTS_PAGE_SIZE_MAX,
  ORG_EASYCLA_RETURN_ORG_PARAM,
  ORG_EASYCLA_RETURN_SIGNED_PARAM,
  ORG_EASYCLA_RETURN_SIGNED_VALUE,
} from '@lfx-one/shared/constants';
import {
  classifyOrgClaManagerRefusal,
  isSameClaGroup,
  legacyOrgEasyclaReturnPath,
  orgClaPairProjectSfid,
  orgEasyclaReturnPath,
  sortOrgClaApprovalEntries,
} from '@lfx-one/shared/utils';
import type {
  ClaGroupOption,
  ClaGroupSearchResponse,
  OrgClaApprovalCriteriaKind,
  OrgClaApprovalEntry,
  OrgClaActivityLogEntry,
  OrgClaActivityLogPage,
  OrgClaApprovalList,
  OrgClaApprovalListUpdate,
  OrgClaContributorAcknowledgment,
  OrgClaContributorAcknowledgmentList,
  OrgClaGroup,
  OrgClaGroupList,
  OrgClaGroupProject,
  OrgClaGroupStatus,
  OrgClaInvalidateAcknowledgmentRequest,
  OrgClaInvalidateAcknowledgmentResult,
  OrgClaManager,
  OrgClaManagerAddRequest,
  OrgClaManagerList,
  OrgClaSignRequest,
  OrgClaSignResponse,
  PdfUrlResponse,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import type {
  EasyClaApprovalItem,
  EasyClaApprovalListUpdateRequest,
  EasyClaCompanyClaGroup,
  EasyClaCompanyClaGroupList,
  EasyClaCompanyClaManager,
  EasyClaCompanyClaManagerList,
  ManagerTarget,
  EasyClaCorporateContributor,
  EasyClaCorporateContributorList,
  EasyClaCorporateSignature,
  EasyClaCorporateSignatureList,
  EasyClaEclaInvalidateResult,
  EasyClaEclaInvalidationInput,
  EasyClaEvent,
  EasyClaEventList,
  EasyClaSearchList,
  EasyClaSelfServeCorporateSignatureInput,
  EasyClaSelfServeCorporateSignatureOutput,
  EasyClaSignatureApprovalLists,
  EasyClaSignedDocument,
} from '../types/cla.types';
import { MicroserviceError } from '../errors';
import { claServiceBaseUrl } from '../helpers/cla-service-url.helper';
import { gatewayFetchBinary } from '../helpers/gateway-fetch-binary.helper';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { isHttpsUrl, urlSchemeForLog } from '../helpers/validation.helper';
import { claReturnUrl, toClaGroupOption, withoutUpstreamBody, withProducerRefusalMessage } from './cla.service';
import { logger } from './logger.service';
import { getUsernameFromAuth, isImpersonating } from '../utils/auth-helper';

const SERVICE = 'org_cla_service';

/**
 * The one place the six shared criteria kinds are tied to their upstream field names (#1985).
 *
 * Typed as `Record<OrgClaApprovalCriteriaKind, …>` on purpose: the shared union is derived from
 * `ORG_CLA_APPROVAL_CRITERIA`, so a seventh criteria type added there fails to compile here until
 * its upstream fields are named. That is the whole reason these are tables and not switches —
 * twelve write field names spelled out inline is twelve chances to typo a PascalCase key that
 * would then be silently dropped from the request body rather than rejected.
 */
const APPROVAL_READ_FIELDS: Record<OrgClaApprovalCriteriaKind, keyof EasyClaCorporateSignature> = {
  domain: 'domainApprovalList',
  email: 'emailApprovalList',
  'github-org': 'githubOrgApprovalList',
  'github-username': 'githubUsernameApprovalList',
  'gitlab-group': 'gitlabOrgApprovalList',
  'gitlab-username': 'gitlabUsernameApprovalList',
};

/** Same six lists as they are spelled on the write response — flat strings, no dates. */
const APPROVAL_RESPONSE_FIELDS: Record<OrgClaApprovalCriteriaKind, keyof EasyClaSignatureApprovalLists> = {
  domain: 'domainApprovalList',
  email: 'emailApprovalList',
  'github-org': 'githubOrgApprovalList',
  'github-username': 'githubUsernameApprovalList',
  'gitlab-group': 'gitlabOrgApprovalList',
  'gitlab-username': 'gitlabUsernameApprovalList',
};

/**
 * The `Add*` / `Remove*` pair per kind on the write body.
 *
 * Note `gitlab-group` maps to `GitlabOrg*`, not `GitlabGroup*`. GitLab calls the thing a group and
 * the producer's field calls it an org; the shared contract follows GitLab's own noun because that
 * is the word on the screen, and this table is where the two names meet.
 */
const APPROVAL_WRITE_FIELDS: Record<
  OrgClaApprovalCriteriaKind,
  { add: keyof EasyClaApprovalListUpdateRequest; remove: keyof EasyClaApprovalListUpdateRequest }
> = {
  domain: { add: 'AddDomainApprovalList', remove: 'RemoveDomainApprovalList' },
  email: { add: 'AddEmailApprovalList', remove: 'RemoveEmailApprovalList' },
  'github-org': { add: 'AddGithubOrgApprovalList', remove: 'RemoveGithubOrgApprovalList' },
  'github-username': { add: 'AddGithubUsernameApprovalList', remove: 'RemoveGithubUsernameApprovalList' },
  'gitlab-group': { add: 'AddGitlabOrgApprovalList', remove: 'RemoveGitlabOrgApprovalList' },
  'gitlab-username': { add: 'AddGitlabUsernameApprovalList', remove: 'RemoveGitlabUsernameApprovalList' },
};

const ALL_APPROVAL_KINDS = Object.keys(APPROVAL_READ_FIELDS) as OrgClaApprovalCriteriaKind[];

/** Flattens the producer's six per-kind arrays into the one sorted list the table renders. */
function toApprovalEntries(signature: EasyClaCorporateSignature): OrgClaApprovalEntry[] {
  const entries = ALL_APPROVAL_KINDS.flatMap((kind) => {
    const items = signature[APPROVAL_READ_FIELDS[kind]];
    // `x-nullable: true` upstream, so an empty list arrives as `null` rather than `[]`.
    if (!Array.isArray(items)) return [];

    return (items as EasyClaApprovalItem[])
      .map((item) => {
        const value = item?.approval_item?.trim() ?? '';
        const addedOn = item?.date_added?.trim() ?? '';
        // An entry with no value is not a rule — it cannot be matched against, and it cannot be
        // removed either, since the producer validates a removal by the same rules as an addition
        // and would reject the empty string. Dropping it beats rendering a row whose only control
        // fails.
        return value ? { kind, value, ...(addedOn ? { addedOn } : {}) } : null;
      })
      .filter((entry): entry is OrgClaApprovalEntry => entry !== null);
  });

  return sortOrgClaApprovalEntries(entries);
}

/** The same flattening for the write response, which carries values without dates. */
function toApprovalEntriesFromWrite(lists: EasyClaSignatureApprovalLists): OrgClaApprovalEntry[] {
  const entries = ALL_APPROVAL_KINDS.flatMap((kind) => {
    const values = lists[APPROVAL_RESPONSE_FIELDS[kind]];
    if (!Array.isArray(values)) return [];

    return (values as string[])
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .filter((value) => !!value)
      .map((value) => ({ kind, value }));
  });

  return sortOrgClaApprovalEntries(entries);
}

function writeResponseHasApprovalLists(lists: EasyClaSignatureApprovalLists): boolean {
  return ALL_APPROVAL_KINDS.some((kind) => Object.hasOwn(lists, APPROVAL_RESPONSE_FIELDS[kind]));
}

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
 * `autoCreateECLA` is carried, but only on signed rows and under the shared name
 * `autoCreateEcla` (#1988). The Overview toggle renders only there, so an unsigned or preview
 * row omits it. A missing upstream value maps to `false`, matching the producer's default when
 * the column is unset.
 *
 * `signed` is carried, but only as the answer to "is there a document" — never as a display
 * status. `status` remains the single slot the template reads, because sanctions outrank
 * signing there and a consumer forming its own opinion from the two booleans would present a
 * sanctioned entity's agreement as ordinarily signed. What `status` cannot answer is whether a
 * document exists to fetch, since `sanctioned` describes the entity and not the agreement, and
 * that is the one question `signed` is here for.
 */
function toOrgClaGroup(entry: EasyClaCompanyClaGroup & { signatureID: string }, companyName: string): OrgClaGroup {
  const projects: OrgClaGroupProject[] = (entry.projects ?? []).map((project) => ({
    projectName: project.projectName?.trim() ?? '',
    ...(project.projectSFID ? { projectSfid: project.projectSFID } : {}),
  }));
  // ACS pair is scanned on the unfiltered list so a covered project with an id and no name
  // still beats a parent foundation. `projects` then drops nameless rows for chips/search.
  const pairProjectSfid = orgClaPairProjectSfid({ projects });
  const visibleProjects = projects.filter((project) => !!project.projectName);

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
    // Nameless projects cannot be rendered as a chip or matched by search, and counting them
    // would overstate coverage on the "Covers N projects" line. The ACS pair is already pinned.
    projects: visibleProjects,
    ...(pairProjectSfid ? { pairProjectSfid } : {}),
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
    // Auto ECLA toggle state (#1988). Only on signed rows: the toggle in the Overview renders
    // only there, so an unsigned or preview row does not need to carry the flag. Missing on the
    // upstream row maps to false, matching the producer's own default when the column is unset.
    ...(entry.signed === true ? { autoCreateEcla: entry.autoCreateECLA === true } : {}),
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
 * `not-started` cannot come out of this endpoint. Upstream builds every row from a CCLA
 * signature and copies that signature's own signed flag onto it, and the query it draws those
 * signatures from appends `signature_signed == true` to its filter unconditionally, with no
 * parameter to bypass it. So `entry.signed` is true on every row the list returns, and the two
 * statuses reachable from here are `signed` and `sanctioned`.
 *
 * The branch stays, and is read from the flag rather than assumed away, because the status type
 * is not this endpoint's alone: the pre-signing preview builds an `OrgClaGroup` for an agreement
 * nobody has signed, and `not-started` is the whole of what that page renders. Defaulting to
 * `signed` here would additionally mean that the day upstream relaxes that filter, the list
 * states an organization has signed something it has not — the same class of false claim the
 * precedence above avoids.
 */
function toStatus(entry: EasyClaCompanyClaGroup): OrgClaGroupStatus {
  if (entry.sanctioned === true) return 'sanctioned';
  return entry.signed === true ? 'signed' : 'not-started';
}

function upstreamTrimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toOrgClaManager(entry: EasyClaCompanyClaManager): OrgClaManager {
  const name = upstreamTrimmedString(entry.name);
  const email = upstreamTrimmedString(entry.email);
  // Only the events-backed add time, whichever manager list supplied it. `approved_on` is signature
  // creation time, not manager add time — ignore it for display. The managers tab does not surface
  // `addedOn` until EasyCLA event correlation is trustworthy.
  const addedOn = upstreamTrimmedString(entry.added_on);
  const lfUsername = upstreamTrimmedString(entry.lf_username);

  return {
    lfUsername,
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(addedOn ? { addedOn } : {}),
  };
}

/**
 * The write endpoints key on the same ACS pair the list mapper pins: first covered project,
 * else the foundation. Sorting here would send Add/Remove at a different grain than the
 * permission check that hid the buttons.
 */
function pickProjectSfid(entry: EasyClaCompanyClaGroup): string {
  return (
    orgClaPairProjectSfid({
      foundationSfid: entry.foundationSFID,
      projects: (entry.projects ?? []).map((project) => ({
        projectName: project.projectName?.trim() ?? '',
        ...(project.projectSFID ? { projectSfid: project.projectSFID } : {}),
      })),
    }) ?? ''
  );
}

/**
 * Manager writes require a project SFID; an empty id would compose `…/project//…`.
 * Reads prefer the project list and use the CLA-group list when project SFID is missing or upstream 403.
 */
function requireProjectSfid(target: ManagerTarget, operation: string): string {
  if (!target.projectSfid) {
    throw new MicroserviceError('Failed to resolve the agreement: upstream row is missing its project id', 502, 'UPSTREAM_INVALID_RESPONSE', {
      operation,
      service: SERVICE,
    });
  }

  return target.projectSfid;
}

function requireSignedManagerTarget(target: ManagerTarget, operation: string): void {
  if (target.signed) return;

  throw new MicroserviceError('This CLA has not been signed yet, so its managers cannot be changed', 400, 'AGREEMENT_NOT_SIGNED', {
    operation,
    service: SERVICE,
  });
}

function asManagerRefusal(error: unknown, operation: string, errorMessage: string): unknown {
  if (!(error instanceof MicroserviceError)) return error;

  if (error.statusCode >= 500 || error.transportFailure) {
    return new MicroserviceError(error.message, error.statusCode, error.code, {
      operation,
      service: SERVICE,
      transportFailure: error.transportFailure,
    });
  }

  const refusal = classifyOrgClaManagerRefusal(error.statusCode, error.errorBody);

  return new MicroserviceError(`${errorMessage}: refused (${refusal})`, error.statusCode, error.code, {
    operation,
    service: SERVICE,
    errorBody: { error: refusal },
  });
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

    // Membership is not signedness, and this checks rather than assumes. Upstream's list filters
    // to signed signatures, so no row reaching here should fail this — but the document endpoint
    // presigns the expected S3 key without checking that anything was ever written there, so if
    // that ever stopped holding the caller would get a URL to a file that does not exist rather
    // than an error. Absent is the honest answer, and it is the one the caller already handles.
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
   * Streams the CLA Group's current corporate template, watermarked not for execution (#2317).
   *
   * Not the signed-document path: that list-checks the organization's signed rows, and an
   * unsigned overview is precisely a group that is not on that list. The gate is the Org Lens
   * grant on the path organization (the route) plus a well-formed group id (the controller).
   * The catalogue is not organization-scoped upstream — same as `getSignOptions` — so this
   * runs on the default gateway token with no impersonation branch.
   *
   * The hop always sends `claType=ccla&watermark=true` and does not take those as
   * client query params. Whether the bytes are actually watermarked is upstream's.
   */
  public async getCclaPreview(req: Request, claGroupId: string): Promise<Buffer> {
    const params = new URLSearchParams({ claType: 'ccla', watermark: 'true' });
    return gatewayFetchBinary(req, `${claServiceBaseUrl(SERVICE)}/v4/template/${encodeURIComponent(claGroupId)}/preview?${params.toString()}`, {
      operation: 'org_cla_ccla_preview',
      service: SERVICE,
      errorMessage: 'Failed to fetch CCLA review copy',
      errorCode: 'UPSTREAM_ERROR',
      redactResponseBody: true,
    });
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
   * for a token swap to satisfy. The gate on this route is `requireOrgLensAccess` alone; nothing
   * about the caller's company reaches the query. The dark-launch flag is not part of it — that
   * flag is an Angular route guard, so it hides the page without closing this endpoint.
   */
  public async getSignOptions(req: Request, searchTerm: string): Promise<ClaGroupSearchResponse> {
    // No `startOperation` here, for the reason `getPdfUrl` above gives: the HTTP lifecycle is the
    // controller's, and a second one double-counts the completion telemetry for one endpoint.
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

    // A business event, not a request completion. How many of the matches are actually signable is
    // the thing worth watching here: a search that returns rows the picker then greys out is how a
    // project-to-CLA-Group mapping gap shows up in production.
    logger.info(req, 'org_cla_sign_options', 'searched signable CLA groups', {
      result_count: envelope.resultCount,
      truncated: envelope.truncated,
      signable_count: results.filter((option) => !!option.projectSfid && option.cclaEnabled === true).length,
    });
    return envelope;
  }

  /**
   * Opens a corporate signing session for the organization (#1983), or emails it to a named
   * signatory (#2365). Self-sign returns where that person completes it. Send-by-email returns an
   * empty signing address — the named person signs, not this browser.
   *
   * Three values are deliberately not taken from the caller's body:
   *
   * - the organization, which is the grant-checked `orgUid` path parameter;
   * - the return address on self-sign, derived from the request Host and host-checked, because
   *   EasyCLA stores it and later redirects to it verbatim — a client-supplied one would be an
   *   open redirect. Send-by-email omits it: the producer documents `return_url` as self-sign only;
   * - the caller's identity, which travels as the default gateway token. That token is the
   *   requester's own, exchanged for the gateway audience. On self-sign the requester is the
   *   signatory, which is what makes the signature attributable. On send-by-email the requester is
   *   the CLA manager and the signatory is `authorityName` / `authorityEmail`. There is no
   *   impersonation branch precisely because the route is blocked during impersonation instead: a
   *   corporate agreement signed under an impersonated session would bind a company on behalf of
   *   somebody who did not act.
   *
   * The two attestations are passed through exactly as received on self-sign. They are not
   * defaulted here and must not be. Send-by-email (#2365 / #2590) omits them: the producer
   * skips that gate when `send_as_email` is set, and this layer does not invent `true`.
   *
   * Authorization is upstream's alone. It checks the caller's signing authority for the project
   * and organization pair — refusing a platform-administrator token, which an org-lens read grant
   * has no bearing on — and screens the company for trade compliance on every request. Neither is
   * pre-empted here: the compliance status carried on an existing agreement row cannot answer for
   * an organization that holds no agreements yet, which is the population this flow serves.
   */
  public async requestCorporateSignature(req: Request, orgUid: string, request: OrgClaSignRequest): Promise<OrgClaSignResponse> {
    // No `startOperation` here, for the reason `getPdfUrl` above gives: the HTTP lifecycle is the
    // controller's. The events below are business events on top of it, not a second request.
    // snake_case on the wire, unlike the Me-lens prepare-sign next door. Built as a typed object
    // rather than spread from the request so every field crossing the spelling boundary is named.
    // Send-by-email names the signatory and omits the acks and `return_url`; self-sign does the
    // reverse. Spreading optional acks would let `undefined` cross as a JSON null, which upstream
    // would treat as unaffirmed — so the mail path leaves those keys off the object entirely.
    // `return_url` is the same omit: the producer documents it as self-sign only, and still
    // writes a supplied value onto a mailed signature.
    // Forward the accepted UUID spelling: linuxfoundation/easycla#5219 normalizes it before comparison.
    let body: EasyClaSelfServeCorporateSignatureInput;
    if (request.sendAsEmail) {
      body = {
        project_sfid: request.projectSfid,
        company_sfid: orgUid,
        cla_group_id: request.claGroupId,
        send_as_email: true,
        authority_name: request.authorityName,
        authority_email: request.authorityEmail,
      };
    } else {
      // Derived before the call: an unusable origin dead-ends the hand-off anyway, and failing
      // afterwards would leave a real signing session behind with nowhere to return to.
      // The agreement's own address, not the list (#2352). It can be named here even though the
      // signature cannot, because the page is addressed by CLA Group (#2364) and the group is the
      // one thing this request already knows — so the signatory returns looking at the agreement
      // they signed rather than at a list that then has to hop somewhere.
      //
      // The organization rides along because the signatory comes back through a cross-site
      // navigation and which organization is selected survives that only in a `SameSite=Lax` cookie;
      // without it the page falls to the first organization in their list, so signing for one company
      // lands them looking at another. `orgUid` is the value the grant check already cleared and the
      // same one sent as `company_sfid`, so the address describes the session that was actually
      // opened. Where it rides is gated (`ServerFeatureFlag.OrgEasyclaReturnInPath`, OFF by default):
      // in the path once every replica that could serve the return routes `/org/{org}/easycla`
      // (spec 050, #2743), else in `?org=` on the leftover address, which every release reads. The
      // signed flag rides along either way, because the row will not be on the list the instant
      // they arrive — without it the page would read a group with no signed agreement and settle
      // straight onto the cannot-preview state.
      body = {
        project_sfid: request.projectSfid,
        company_sfid: orgUid,
        cla_group_id: request.claGroupId,
        return_url: isServerFeatureEnabled(ServerFeatureFlag.OrgEasyclaReturnInPath)
          ? claReturnUrl(req, orgEasyclaReturnPath(orgUid, request.claGroupId), { [ORG_EASYCLA_RETURN_SIGNED_PARAM]: ORG_EASYCLA_RETURN_SIGNED_VALUE })
          : claReturnUrl(req, legacyOrgEasyclaReturnPath(request.claGroupId), {
              [ORG_EASYCLA_RETURN_ORG_PARAM]: orgUid,
              [ORG_EASYCLA_RETURN_SIGNED_PARAM]: ORG_EASYCLA_RETURN_SIGNED_VALUE,
            }),
        authority_acked: request.authorityAcked,
        embargo_acked: request.embargoAcked,
      };
    }

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
    const mailed = request.sendAsEmail === true;

    // An empty signing address is how upstream signals that the agreement was emailed to a named
    // signatory instead. Self-sign never asks for that shape, so an empty address there means the
    // request was not fulfilled the way it was made, and it fails loudly. Navigating to an empty
    // address would send the signatory to this application's own root and read as a successful
    // hand-off that silently signed nothing.
    // Send-by-email (#2365) is the path that *does* ask for mail: empty `signUrl` is success,
    // and the client stays in Org Lens rather than navigating. Empty is the mail signal only —
    // the producer still returns `signature_id` and `cla_group_id` on that path, and those are
    // what prove a signature was created for the chosen agreement. A missing body (gatewayFetch
    // maps 204 to null) collapses to the same empty strings and must not be reported as mailed.
    // A non-empty address on that path is the self-sign shape: `send_as_email` was ignored or
    // regressed. Reporting mail would discard a live signing session and tell the manager the
    // named person was emailed when they were not.
    // The scheme is checked, not just the presence of a string. The self-sign client assigns this
    // value straight to `document.location.href`, so a `javascript:` address coming back from a
    // malformed or compromised response would execute in this application's origin, with this
    // application's session — and it would arrive at exactly the moment the signatory is
    // expecting to be sent somewhere. Nothing downstream of here looks at it again.
    //
    // Scheme only, not a host allowlist. The signing addresses are EasyCLA's to choose and it has
    // not published the set, so pinning hosts here would break the hand-off the first time one
    // changed. The scheme is the part that carries the execution risk.
    if (signUrl && !isHttpsUrl(signUrl)) {
      logger.warning(req, 'org_cla_request_corporate_signature', 'upstream returned a signing address that is not an https URL', {
        // The address itself is deliberately not logged: it is a capability — anyone holding it can
        // open a named person's agreement — and if it is hostile it does not belong in a log either.
        sign_url_scheme: urlSchemeForLog(signUrl),
      });
      throw new MicroserviceError('Upstream returned an unusable corporate signing address', 502, 'CLA_SIGN_URL_INVALID', {
        operation: 'org_cla_request_corporate_signature',
        service: SERVICE,
      });
    }

    if (mailed && signUrl) {
      logger.warning(req, 'org_cla_request_corporate_signature', 'upstream returned a signing address for an emailed request', {
        has_sign_url: true,
        has_signature_id: !!signatureId,
        send_as_email: true,
      });
      throw new MicroserviceError('Upstream opened a signing session instead of sending the agreement by email', 502, 'CLA_SIGN_MAIL_UNEXPECTED_URL', {
        operation: 'org_cla_request_corporate_signature',
        service: SERVICE,
      });
    }

    if (!signatureId || (!mailed && !signUrl)) {
      // The fields, not the severity: the throw below reaches the shared error handler, which logs
      // the failure centrally. Duplicating that here as an error would double-count it.
      logger.warning(req, 'org_cla_request_corporate_signature', 'upstream returned no usable signing session', {
        has_sign_url: !!signUrl,
        has_signature_id: !!signatureId,
        send_as_email: mailed,
      });
      throw new MicroserviceError('Upstream opened no usable corporate signing session', 502, 'CLA_SIGN_SESSION_INCOMPLETE', {
        operation: 'org_cla_request_corporate_signature',
        service: SERVICE,
      });
    }

    // Deploy this consumer before linuxfoundation/easycla#5219: older producers ignore the
    // requested `cla_group_id`, so the response echo remains their only chosen-group check.
    // The upgraded producer independently resolves the project's signing group and rejects
    // mismatches before creating an envelope; this check then catches inconsistent responses,
    // not the project/group binding itself.
    // Refusing here can leave an envelope already created or emailed upstream, but must not
    // hand the browser a signing session for the wrong agreement.
    // Compared canonically, never as raw strings. The request boundary accepts the hyphenated and
    // unhyphenated spellings in either case, because the producer does, and the producer answers in
    // its own canonical one — so a request that spelled the id differently would fail a raw
    // comparison and have a perfectly valid signing session refused out from under it.
    //
    // An absent echo is refused for the same reason a mismatched one is. The field is declared
    // always-present upstream, so losing it means the check itself is gone — and a session that
    // cannot be shown to be the chosen agreement is indistinguishable, from here, from one that is
    // not. Proceeding would hand it over on the strength of the field being missing.
    const returnedClaGroupId = result?.cla_group_id?.trim() ?? '';
    if (!returnedClaGroupId) {
      // The producer always echoes the CLA Group, including on send-by-email. Waiving that here
      // would report a completed send for an agreement this application cannot show was the one
      // the manager chose.
      logger.warning(req, 'org_cla_request_corporate_signature', 'upstream opened a session it attributed to no CLA Group', {
        requested_cla_group_id: request.claGroupId,
        project_sfid: request.projectSfid,
        send_as_email: mailed,
      });
      throw new MicroserviceError('Upstream opened a corporate signing session it attributed to no CLA Group', 502, 'CLA_SIGN_GROUP_UNVERIFIABLE', {
        operation: 'org_cla_request_corporate_signature',
        service: SERVICE,
      });
    } else if (!isSameClaGroup(returnedClaGroupId, request.claGroupId)) {
      logger.warning(req, 'org_cla_request_corporate_signature', 'upstream opened a session for a different CLA Group', {
        requested_cla_group_id: request.claGroupId,
        returned_cla_group_id: returnedClaGroupId,
        project_sfid: request.projectSfid,
      });
      throw new MicroserviceError('Upstream opened a signing session for a different CLA Group', 502, 'CLA_SIGN_GROUP_MISMATCH', {
        operation: 'org_cla_request_corporate_signature',
        service: SERVICE,
      });
    }

    // A corporate agreement was just opened — the notable business event on this path, and the only
    // record tying this request to the signature it created.
    logger.info(req, 'org_cla_request_corporate_signature', mailed ? 'sent a corporate signing request by email' : 'opened a corporate signing session', {
      org_uid: orgUid,
      send_as_email: mailed,
      ...(signatureId ? { signature_id: signatureId } : {}),
    });

    // The signature id goes back as the record tying this request to the signature it created, not
    // as something the return trip needs: `return_url` is an input to the request above and is
    // therefore fixed before a signature exists, so the address names the CLA Group instead (#2352).
    return { signUrl, signatureId };
  }

  /**
   * Reads one agreement's approval list — the rules deciding who this CCLA covers (#1985).
   *
   * Resolved through the organization's own list first, exactly as `getPdfUrl` is and for the same
   * reason: `requireOrgLensAccess` proves which organization the caller may view as, and says
   * nothing about which signatures belong to it. Without that step the `orgUid` in the path is
   * decorative and the signature id alone selects the list.
   *
   * Returns `null` for a signature this organization does not hold. An unsigned agreement is a
   * different answer: it has no approval list to read, but it is a real row, so it comes back as
   * an empty and uneditable list rather than as absent.
   */
  public async getApprovalList(req: Request, orgUid: string, signatureId: string): Promise<OrgClaApprovalList | null> {
    const context = await this.resolveClaGroupContext(req, orgUid, signatureId, 'org_cla_get_approval_list');
    if (!context) return null;

    if (!context.signed) {
      // The tab is locked client-side for an unsigned agreement, so this is the defensive arm: a
      // direct caller gets the truthful empty rather than a 404 that would read as "no such
      // agreement". Uneditable, because the producer has no CCLA to attach a rule to.
      logger.warning(req, 'org_cla_get_approval_list', 'agreement is not signed, so it holds no approval list', {
        org_uid: orgUid,
        signature_id: signatureId,
      });
      return { signatureId, entries: [], canEdit: false };
    }

    return this.readApprovalList(req, context, 'org_cla_get_approval_list');
  }

  /**
   * Applies a delta to one agreement's approval list.
   *
   * Every removal invalidates the employee acknowledgements that matched the removed rule — the
   * producer does it synchronously, inside this request, and reports no count of what it touched.
   * So this is not a list edit with a side effect; the side effect is the larger half of it, and
   * the caller is required to have named its removals explicitly rather than have them computed.
   *
   * Takes an already-validated delta — the controller rejects an unknown kind or a value the
   * producer would refuse, so a malformed request is answered as a 400 naming the offending entry
   * rather than reaching upstream. The producer rejects the *entire* request if any one value
   * fails, so validating per entry is what keeps a typo in the sixth row from losing the first
   * five.
   */
  public async updateApprovalList(req: Request, orgUid: string, signatureId: string, update: OrgClaApprovalListUpdate): Promise<OrgClaApprovalUpdateOutcome> {
    const context = await this.resolveClaGroupContext(req, orgUid, signatureId, 'org_cla_update_approval_list');
    if (!context) return { outcome: 'not-found' };

    if (!context.signed) {
      logger.warning(req, 'org_cla_update_approval_list', 'agreement is not signed, so it has no approval list to change', {
        org_uid: orgUid,
        signature_id: signatureId,
      });
      return { outcome: 'not-signed' };
    }

    if (!context.canEdit) {
      logger.warning(req, 'org_cla_update_approval_list', 'caller is not a CLA manager on this agreement', {
        org_uid: orgUid,
        signature_id: signatureId,
      });
      return { outcome: 'forbidden' };
    }

    this.requireApprovalListProject(context, 'org_cla_update_approval_list');

    const body = buildApprovalListUpdateBody(update);

    const result = await gatewayFetch<EasyClaSignatureApprovalLists>(
      req,
      `${claServiceBaseUrl(SERVICE)}/v4/signatures/project/${encodeURIComponent(context.projectSfid)}/company/${encodeURIComponent(context.companyId)}/clagroup/${encodeURIComponent(context.claGroupId)}/approval-list`,
      {
        method: 'PUT',
        body,
        operation: 'org_cla_update_approval_list',
        service: SERVICE,
        errorMessage: 'Failed to update the approval list',
        errorCode: 'UPSTREAM_ERROR',
        // The success body is the whole CCLA signature, which carries the agreement's ACL — every
        // CLA manager by id and LF username. A non-OK body names the authenticated user. Neither
        // belongs in application logs, and a 403 here is an expected outcome rather than an
        // exceptional one, so the routine case would be the one writing identities out.
        redactResponseBody: true,
        // No `bearerToken` override: the route blocks this path during impersonation, so there is
        // no impersonated identity to forward. Reads above forward one; a write must not.
      }
    );

    // Re-read so the rows carry their `date_added`, which the write response drops. One extra
    // upstream GET on a button press, not on a render — the same trade `getPdfUrl` makes.
    //
    // A failure here must not be reported as a failed write: the write already succeeded, and
    // saying otherwise would invite a CLA manager to retry a removal that has already invalidated
    // acknowledgements. So the fallback is the write's own post-update lists, dateless.
    try {
      // Re-read against the context already in hand, not through `getApprovalList`, which would
      // resolve the same three ids again and fetch the organization's whole agreement list a
      // second time to do it. Two upstream calls per write rather than four.
      return { outcome: 'updated', list: await this.readApprovalList(req, context, 'org_cla_update_approval_list') };
    } catch (error) {
      logger.warning(req, 'org_cla_update_approval_list', 'approval list was updated, but re-reading it failed', {
        signature_id: signatureId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (result && writeResponseHasApprovalLists(result)) {
        return {
          outcome: 'updated',
          list: {
            signatureId,
            entries: toApprovalEntriesFromWrite(result),
            canEdit: context.canEdit,
          },
        };
      }
      throw error;
    }
  }

  /**
   * Turns Auto ECLA on or off for one signed CCLA (#1988).
   *
   * Enable and disable are one write against the same producer endpoint — the toggle is
   * symmetric and both directions travel the same sanctions and ACL gates. Not a computed
   * update: the caller sends the target state, and the producer records it as such.
   *
   * Resolves the agreement through the organization's own list first, mirroring
   * `updateApprovalList` and `getPdfUrl`: `requireOrgLensAccess` proves which organization the
   * caller may view as, and says nothing about which signatures belong to it. Only signed
   * agreements accept the write, because the flag lives on the corporate signature record —
   * an unsigned row has no record for the producer to update.
   *
   * The write path runs with the caller's own token (no impersonation forwarding). The route
   * has `blockDuringImpersonation` in front of it; the direction is the same as the peer
   * approval-list write, because a support engineer flipping this flag against an ordinary
   * customer's CCLA would attribute a legally-recorded change to the person being impersonated.
   *
   * A 403 refusal from the producer is the sanctions path. The refusal
   * sentence upstream sends belongs on screen — the CLA manager needs the reason and the
   * support route — and does not belong in an application log. The `withProducerRefusalMessage`
   * plus `withoutUpstreamBody` composition is the same one the corporate hand-off uses, and it
   * is the whole of the difference between a sanctioned outcome and a 403 that just says
   * "Forbidden". The producer answers 403 for a viewer without the ACS grant too, and both
   * refusals travel this branch — the client hides the toggle when ACS says the grant is not
   * held, so the runtime 403 the client actually sees is nearly always the sanctions one.
   */
  public async updateEclaAutoCreate(req: Request, orgUid: string, signatureId: string, enable: boolean): Promise<OrgClaEclaAutoCreateUpdateOutcome> {
    const context = await this.resolveClaGroupContext(req, orgUid, signatureId, 'org_cla_update_ecla_auto_create');
    if (!context) return { outcome: 'not-found' };

    if (!context.signed) {
      logger.warning(req, 'org_cla_update_ecla_auto_create', 'agreement is not signed, so it has no Auto ECLA flag to change', {
        org_uid: orgUid,
        signature_id: signatureId,
      });
      return { outcome: 'not-signed' };
    }

    try {
      await gatewayFetch<unknown>(
        req,
        `${claServiceBaseUrl(SERVICE)}/v4/signatures/company/${encodeURIComponent(context.companyId)}/clagroup/${encodeURIComponent(context.claGroupId)}/ecla-auto-create`,
        {
          method: 'PUT',
          // snake_case on the wire; keep it typed rather than spread so a rename here cannot leak
          // an extra key upstream.
          body: { auto_create_ecla: enable },
          operation: 'org_cla_update_ecla_auto_create',
          service: SERVICE,
          errorMessage: 'Failed to update the Auto ECLA setting',
          errorCode: 'UPSTREAM_ERROR',
          // The refusal body is the copy the CLA manager needs to see (sanctions reason and
          // support route). Kept out of application logs; the `withoutUpstreamBody` at the throw
          // below takes it back off the error before it reaches the handler.
          redactResponseBodyFromLogs: true,
          // The handler returns 200 and sets no body. An empty 200 is the success, not a 502.
          acceptEmptyBody: true,
          // No `bearerToken` override: this route is blocked during impersonation, so there is
          // no impersonated identity to forward. A write must not run as the impersonator either.
        }
      );
    } catch (error) {
      throw withoutUpstreamBody(withProducerRefusalMessage(error, 'org_cla_update_ecla_auto_create', SERVICE));
    }

    logger.info(req, 'org_cla_update_ecla_auto_create', 'updated the Auto ECLA setting', {
      org_uid: orgUid,
      signature_id: signatureId,
      auto_create_ecla: enable,
    });

    return { outcome: 'updated', autoCreateEcla: enable };
  }

  public async getManagers(req: Request, orgUid: string, signatureId: string): Promise<OrgClaManagerList | null> {
    const target = await this.resolveManagerTarget(req, orgUid, signatureId, 'org_cla_list_managers');
    if (!target) return null;

    if (!target.signed) {
      // The tab is locked client-side for an unsigned agreement, so this is the defensive arm: a
      // direct caller gets the truthful empty rather than manager PII from a stale upstream list.
      logger.warning(req, 'org_cla_list_managers', 'agreement is not signed, so it holds no manager roster', {
        org_uid: orgUid,
        signature_id: signatureId,
      });
      return { signatureId, managers: [] };
    }

    const projectSfid = target.projectSfid.trim();
    const managerListFetchOptions = {
      service: SERVICE,
      errorMessage: 'Failed to fetch CLA managers',
      errorCode: 'UPSTREAM_ERROR',
      redactResponseBody: true,
      bearerToken: isImpersonating(req) ? req.bearerToken : undefined,
    } as const;
    const claGroupManagerListUrl = `${claServiceBaseUrl(SERVICE)}/v4/company/${encodeURIComponent(target.companyId)}/cla-group/${encodeURIComponent(target.claGroupId)}/cla-managers`;

    let managerListOperation = 'org_cla_list_managers';
    const fetchClaGroupManagerList = () => {
      managerListOperation = 'org_cla_list_managers_cla_group_fallback';
      return gatewayFetch<EasyClaCompanyClaManagerList>(req, claGroupManagerListUrl, {
        ...managerListFetchOptions,
        operation: 'org_cla_list_managers_cla_group_fallback',
      });
    };

    let upstream: EasyClaCompanyClaManagerList | null;
    if (!projectSfid) {
      upstream = await fetchClaGroupManagerList();
    } else {
      try {
        managerListOperation = 'org_cla_list_managers';
        upstream = await gatewayFetch<EasyClaCompanyClaManagerList>(
          req,
          `${claServiceBaseUrl(SERVICE)}/v4/company/${encodeURIComponent(target.companyId)}/project/${encodeURIComponent(projectSfid)}/cla-managers`,
          { ...managerListFetchOptions, operation: 'org_cla_list_managers' }
        );
      } catch (error) {
        if (!(error instanceof MicroserviceError) || error.statusCode !== 403) {
          throw error;
        }

        logger.warning(req, 'org_cla_list_managers', 'project-scoped manager list refused; falling back to CLA-group list', {
          org_uid: orgUid,
          signature_id: signatureId,
          company_id: target.companyId,
          project_sfid: projectSfid,
        });

        upstream = await fetchClaGroupManagerList();
      }
    }

    if (!upstream || !Array.isArray(upstream.list)) {
      throw new MicroserviceError('Failed to fetch CLA managers: malformed response from upstream', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation: managerListOperation,
        service: SERVICE,
      });
    }

    return {
      signatureId,
      managers: upstream.list
        .filter((entry): entry is EasyClaCompanyClaManager => !!upstreamTrimmedString(entry?.lf_username))
        .map((entry) => toOrgClaManager(entry)),
    };
  }

  public async addManager(req: Request, orgUid: string, signatureId: string, request: OrgClaManagerAddRequest): Promise<OrgClaManager | null> {
    const target = await this.resolveManagerTarget(req, orgUid, signatureId, 'org_cla_add_manager');
    if (!target) return null;

    requireSignedManagerTarget(target, 'org_cla_add_manager');
    const projectSfid = requireProjectSfid(target, 'org_cla_add_manager');

    try {
      // The write answers with an updated Signature (`signature_acl`), not a `company-cla-manager`
      // row, so success is re-read from the manager list rather than parsed off the POST body.
      await gatewayFetch<unknown>(
        req,
        `${claServiceBaseUrl(SERVICE)}/v4/company/${encodeURIComponent(target.companyId)}/project/${encodeURIComponent(projectSfid)}/cla-manager`,
        {
          operation: 'org_cla_add_manager',
          service: SERVICE,
          errorMessage: 'Failed to add the CLA manager',
          errorCode: 'UPSTREAM_ERROR',
          method: 'POST',
          body: { firstName: request.firstName, lastName: request.lastName, userEmail: request.email },
          redactResponseBodyFromLogs: true,
        }
      );
    } catch (error) {
      throw asManagerRefusal(error, 'org_cla_add_manager', 'Failed to add the CLA manager');
    }

    try {
      const roster = await this.getManagers(req, orgUid, signatureId);
      const normalizedEmail = request.email.trim().toLowerCase();
      const added = roster?.managers.find((manager) => manager.email?.trim().toLowerCase() === normalizedEmail);
      if (added?.lfUsername?.trim()) {
        logger.debug(req, 'org_cla_add_manager', 'added a cla manager', { org_uid: orgUid, signature_id: signatureId });
        return added;
      }
    } catch (error) {
      logger.warning(req, 'org_cla_add_manager', 'add succeeded but re-reading the roster failed', {
        org_uid: orgUid,
        signature_id: signatureId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    logger.debug(req, 'org_cla_add_manager', 'added a cla manager; roster re-read did not return the new row yet', {
      org_uid: orgUid,
      signature_id: signatureId,
    });
    return this.managerFromAddRequest(request);
  }

  public async removeManager(req: Request, orgUid: string, signatureId: string, lfUsername: string): Promise<boolean> {
    const target = await this.resolveManagerTarget(req, orgUid, signatureId, 'org_cla_remove_manager');
    if (!target) return false;

    requireSignedManagerTarget(target, 'org_cla_remove_manager');
    const projectSfid = requireProjectSfid(target, 'org_cla_remove_manager');

    try {
      await gatewayFetch<null>(
        req,
        `${claServiceBaseUrl(SERVICE)}/v4/company/${encodeURIComponent(target.companyId)}/project/${encodeURIComponent(projectSfid)}/cla-manager/${encodeURIComponent(lfUsername)}`,
        {
          operation: 'org_cla_remove_manager',
          service: SERVICE,
          errorMessage: 'Failed to remove the CLA manager',
          errorCode: 'UPSTREAM_ERROR',
          method: 'DELETE',
          redactResponseBodyFromLogs: true,
        }
      );
    } catch (error) {
      throw asManagerRefusal(error, 'org_cla_remove_manager', 'Failed to remove the CLA manager');
    }

    logger.debug(req, 'org_cla_remove_manager', 'removed a cla manager', { org_uid: orgUid, signature_id: signatureId });
    return true;
  }

  /**
   * Lists one agreement's contributor acknowledgments (#1986).
   *
   * Resolved through the organization's own CLA list first, exactly as `getApprovalList` and
   * `getPdfUrl` are and for the same reason: `requireOrgLensAccess` proves which organization the
   * caller may view as, and says nothing about which signatures belong to it. Without that step
   * the `orgUid` in the path is decorative and the signature id alone selects the list.
   *
   * Returns `null` for a signature this organization does not hold. An unsigned agreement is a
   * different answer: it has no acknowledgments to hold, but it is a real row, so it comes back
   * as an empty uneditable page rather than as absent — matching the sibling approval-list posture.
   *
   * Never drops a row for a missing LF Login: the identity fallback lives at the mapper below, and
   * the source-of-truth attribute for each fallback stays on the wire only when the producer sent
   * a non-empty value.
   */
  public async getContributorAcknowledgments(
    req: Request,
    orgUid: string,
    signatureId: string,
    query: ContributorAcknowledgmentQuery
  ): Promise<OrgClaContributorAcknowledgmentList | null> {
    const context = await this.resolveClaGroupContext(req, orgUid, signatureId, 'org_cla_get_acknowledgments');
    if (!context) return null;

    if (!context.signed) {
      logger.warning(req, 'org_cla_get_acknowledgments', 'agreement is not signed, so it holds no acknowledgments', {
        org_uid: orgUid,
        signature_id: signatureId,
      });
      return { signatureId, list: [], canEdit: false, resultCount: 0, totalCount: 0, nextKey: null };
    }

    const page = await this.fetchContributorAcknowledgmentsPage(req, context, query, 'org_cla_get_acknowledgments');
    const upstreamRows = Array.isArray(page.list) ? page.list : [];
    const mapped: OrgClaContributorAcknowledgment[] = [];
    let dropped = 0;
    for (const row of upstreamRows) {
      const ack = toContributorAcknowledgment(row);
      if (ack) mapped.push(ack);
      else dropped += 1;
    }
    if (dropped > 0) {
      // A producer row without a per-ack signature id cannot be invalidated and, if kept, collides
      // with any sibling absent-id row on `@for` tracking in the browser. Dropping is the safe
      // choice — the row's identity attributes are unreachable anyway.
      logger.warning(req, 'org_cla_get_acknowledgments', 'skipped producer rows without a per-ack signature id', {
        org_uid: orgUid,
        signature_id: signatureId,
        skipped_count: dropped,
      });
    }

    return {
      signatureId,
      list: mapped,
      canEdit: context.canEdit,
      resultCount: mapped.length,
      totalCount: typeof page.totalCount === 'number' ? page.totalCount : mapped.length,
      nextKey: page.nextKey && page.nextKey.trim().length > 0 ? page.nextKey : null,
    };
  }

  /**
   * Invalidates one contributor acknowledgment on this agreement (#1986, #2807).
   *
   * Four gates stand in front of the producer call, two of them in the route file:
   *
   *   1. `blockDuringImpersonation`, declared *before* `requireOrgLensAccess` — a write, and the
   *      producer stamps the acting user on the signature as `invalidatedBy`.
   *   2. `requireOrgLensAccess` — the Org Lens grant on the organization.
   *   3. `canEdit` — the caller must be named on the CCLA's own manager roster. Fails open only
   *      when the producer sent no roster, matching the sibling approval-list posture.
   *   4. The id verify below, which refuses an acknowledgment id that is not on this company's
   *      roster for this CLA Group.
   *
   * A verify miss answers not-found rather than bad-request: the id may be a perfectly real
   * acknowledgment on a different agreement, and saying which would confirm its existence to a
   * caller who cannot see it.
   *
   * The caller's own token is forwarded with no impersonated override, matching every other write
   * on this router.
   */
  public async invalidateAcknowledgment(
    req: Request,
    orgUid: string,
    signatureId: string,
    acknowledgmentSignatureId: string,
    input: OrgClaInvalidateAcknowledgmentRequest
  ): Promise<OrgClaInvalidateAcknowledgmentOutcome> {
    const context = await this.resolveClaGroupContext(req, orgUid, signatureId, 'org_cla_invalidate_acknowledgment');
    if (!context) return { outcome: 'not-found' };

    if (!context.signed) {
      logger.warning(req, 'org_cla_invalidate_acknowledgment', 'agreement is not signed, so it has no acknowledgments to invalidate', {
        org_uid: orgUid,
        signature_id: signatureId,
      });
      return { outcome: 'not-signed' };
    }

    if (!context.canEdit) {
      logger.warning(req, 'org_cla_invalidate_acknowledgment', 'caller is not a CLA manager on this agreement', {
        org_uid: orgUid,
        signature_id: signatureId,
      });
      return { outcome: 'forbidden' };
    }

    const onThisClaGroup = await this.acknowledgmentBelongsToCompanyClaGroup(req, context, acknowledgmentSignatureId, 'org_cla_invalidate_acknowledgment');
    if (!onThisClaGroup) {
      logger.warning(req, 'org_cla_invalidate_acknowledgment', 'acknowledgment id is not on this company CLA Group', {
        org_uid: orgUid,
        signature_id: signatureId,
        acknowledgment_signature_id: acknowledgmentSignatureId,
      });
      return { outcome: 'not-found' };
    }

    // Both fields are optional upstream and an empty body is valid, so an absent or blank value is
    // elided rather than sent as `""` — which the producer would store as an empty reason.
    const body: EasyClaEclaInvalidationInput = {};
    if (input.reason) body.reason = input.reason;
    const note = input.note?.trim() ?? '';
    if (note.length > 0) body.note = note;

    // PUT, not POST: the producer declares this operation as `put` on
    // `/v4/cla-group/{claGroupID}/ecla/{signatureID}/invalidate`.
    const upstream = await gatewayFetch<EasyClaEclaInvalidateResult>(
      req,
      `${claServiceBaseUrl(SERVICE)}/v4/cla-group/${encodeURIComponent(context.claGroupId)}/ecla/${encodeURIComponent(acknowledgmentSignatureId)}/invalidate`,
      {
        method: 'PUT',
        body,
        operation: 'org_cla_invalidate_acknowledgment',
        service: SERVICE,
        errorMessage: 'Failed to invalidate the acknowledgment',
        errorCode: 'UPSTREAM_ERROR',
        // The success body echoes the EasyCLA user id of the contributor who was invalidated, and
        // a non-OK body names the authenticated caller. Neither belongs in application logs, and a
        // 403 here is an ordinary outcome rather than an exceptional one — so the routine case
        // would be the one writing identities out.
        redactResponseBody: true,
        // No `bearerToken` override: the route blocks this path during impersonation, so there is
        // no impersonated identity to forward. A write must run as the acting user.
      }
    );

    if (!upstream || typeof upstream !== 'object') {
      throw new MicroserviceError('Failed to invalidate the acknowledgment: upstream returned no body', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation: 'org_cla_invalidate_acknowledgment',
        service: SERVICE,
      });
    }

    // The producer's CLA Group id, internal company id and EasyCLA user id stop here — see the
    // shared result type. An echoed signature id that names a different acknowledgment is not a
    // receipt for the write we sent. A body that omits the id still uses the id on the path,
    // because that path is what the producer addressed.
    // Same rule as the corporate signing echo: the producer accepts hyphenated and unhyphenated
    // spellings in either case, and answers in its own. A raw compare would 502 a write that
    // already succeeded.
    const echoed = typeof upstream.signature_id === 'string' ? upstream.signature_id.trim() : '';
    if (echoed && echoed !== acknowledgmentSignatureId && !isSameClaGroup(echoed, acknowledgmentSignatureId)) {
      throw new MicroserviceError('Failed to invalidate the acknowledgment: upstream named a different acknowledgment', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation: 'org_cla_invalidate_acknowledgment',
        service: SERVICE,
      });
    }
    return {
      outcome: 'invalidated',
      result: { signatureId: echoed || acknowledgmentSignatureId },
    };
  }

  /**
   * Reads the activity log for one CCLA on this organization (#1987, #2857).
   *
   * The producer already writes one event per audited action against a `(company, CLA Group)`
   * pair, partitioned on `company_sfid_cla_group_id`, so the scope check that matters is `is this
   * signature actually on this organization for this CLA Group?` — and that is exactly what
   * `resolveClaGroupContext` answers, the same helper the sibling read-tabs use.
   *
   * Authorization posture is broader than the write tabs: an org-lens caller who is NOT a CLA
   * manager on this CCLA still reads the log (auditors, program leads). The producer's own
   * `IsUserAuthorizedForOrganization(ALLOW_ADMIN_SCOPE)` accepts an org-scoped caller for this
   * endpoint. `canEdit` is deliberately absent from the envelope — the log has no per-row write.
   *
   * `returnAllEvents` is never sent. The flag only raises the page limit to 10000 on the same
   * `company_sfid_cla_group_id` partition; it does not widen which group is read. Leaving it
   * off keeps the page bound this route already clamps.
   *
   * The producer's paging cursor (`NextKey`) is opaque; forward it verbatim from the client.
   * Search stays on the client, over actor and EventSummary. The producer's `searchTerm`
   * matches EventData, the detailed audit sentence this tab does not show.
   */
  public async getActivityLog(req: Request, orgUid: string, signatureId: string, query: ActivityLogQuery): Promise<OrgClaActivityLogPage | null> {
    const context = await this.resolveClaGroupContext(req, orgUid, signatureId, 'org_cla_get_activity_log');
    if (!context) return null;

    if (!context.signed) {
      logger.warning(req, 'org_cla_get_activity_log', 'agreement is not signed, so it holds no activity', {
        org_uid: orgUid,
        signature_id: signatureId,
      });
      return { signatureId, list: [], resultCount: 0, nextKey: null };
    }

    if (!context.projectSfid) {
      throw new MicroserviceError('Failed to fetch the activity log: upstream row is missing the ids it is addressed by', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation: 'org_cla_get_activity_log',
        service: SERVICE,
      });
    }

    const page = await this.fetchActivityLogPage(req, context, query, 'org_cla_get_activity_log');
    const upstreamRows = Array.isArray(page.Events) ? page.Events : [];
    const mapped: OrgClaActivityLogEntry[] = [];
    let dropped = 0;
    for (const row of upstreamRows) {
      const entry = toActivityLogEntry(row);
      if (entry) mapped.push(entry);
      else dropped += 1;
    }
    if (dropped > 0) {
      // A producer row without a stable event id collides with sibling id-less rows on `@for`
      // tracking in the browser. Dropping is the safe choice — the row has no address anyway, so
      // no downstream action (link, resolve, deep-link) can reach it.
      logger.warning(req, 'org_cla_get_activity_log', 'skipped producer rows without an event id', {
        org_uid: orgUid,
        signature_id: signatureId,
        skipped_count: dropped,
      });
    }

    return {
      signatureId,
      list: mapped,
      resultCount: mapped.length,
      nextKey: page.NextKey && page.NextKey.trim().length > 0 ? page.NextKey : null,
    };
  }

  /** Toast copy when the write succeeded but the roster re-read has not caught up yet. */
  private managerFromAddRequest(request: OrgClaManagerAddRequest): OrgClaManager {
    const name = [request.firstName.trim(), request.lastName.trim()].filter(Boolean).join(' ');
    return {
      lfUsername: '',
      email: request.email.trim(),
      ...(name ? { name } : {}),
    };
  }

  /**
   * The organization's agreements as upstream sends them, validated but unmapped.
   *
   * Split out from `listClaGroups` because the write paths need three ids the shared row
   * deliberately does not carry — the internal company UUID, the CLA Group id, and a project SFID
   * — and widening `OrgClaGroup` to reach them would ship the internal company id to every
   * browser that loads the list page. The mapper's boundary holds; this is the server-side door
   * behind it.
   */
  private async fetchUpstreamClaGroups(req: Request, orgUid: string): Promise<(EasyClaCompanyClaGroup & { signatureID: string })[]> {
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

    return upstream.list;
  }

  /**
   * Returns null when the signature is not on this organization's list, which is both the
   * not-found answer and the authorization gate.
   */
  private async resolveManagerTarget(req: Request, orgUid: string, signatureId: string, operation: string): Promise<ManagerTarget | null> {
    const entries = await this.fetchUpstreamClaGroups(req, orgUid);
    const entry = entries.find((candidate) => isSameClaGroup(candidate.signatureID, signatureId) || candidate.signatureID === signatureId);
    if (!entry) {
      logger.warning(req, operation, 'signature is not on this organization CLA list', { org_uid: orgUid, signature_id: signatureId });
      return null;
    }

    const companyId = entry.companyID?.trim() ?? '';
    const claGroupId = entry.claGroupID?.trim() ?? '';
    if (!companyId || !claGroupId) {
      throw new MicroserviceError('Failed to resolve the agreement: upstream row is missing its company or CLA group id', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation,
        service: SERVICE,
      });
    }

    this.assertUnambiguousManagerTarget(entries, entry, operation);

    return { companyId, claGroupId, projectSfid: pickProjectSfid(entry), signed: entry.signed === true };
  }

  /**
   * The company CLA-group manager endpoints are not signature-scoped. When this organization holds
   * more than one signature on the same pair, upstream resolves the first match — the same class of
   * bug the approval-list read avoids by filtering on `signatureID`.
   */
  private assertUnambiguousManagerTarget(
    entries: readonly (EasyClaCompanyClaGroup & { signatureID: string })[],
    entry: EasyClaCompanyClaGroup & { signatureID: string },
    operation: string
  ): void {
    this.assertUnambiguousCompanyClaGroup(
      entries,
      entry,
      operation,
      'This CLA shares its company and CLA group with another agreement, so its managers cannot be read or changed here yet.',
      'AMBIGUOUS_MANAGER_TARGET'
    );
  }

  /**
   * Company + CLA-group URLs are not signature-scoped. Upstream resolves one signature for the
   * pair, so a second signature on that pair would be the one a write for the first can change.
   */
  private assertUnambiguousCompanyClaGroup(
    entries: readonly (EasyClaCompanyClaGroup & { signatureID: string })[],
    entry: EasyClaCompanyClaGroup & { signatureID: string },
    operation: string,
    message: string,
    code: string
  ): void {
    const companyId = entry.companyID?.trim() ?? '';
    const claGroupId = entry.claGroupID?.trim() ?? '';
    const peers = entries.filter((candidate) => candidate.companyID?.trim() === companyId && candidate.claGroupID?.trim() === claGroupId);
    if (peers.length <= 1) return;

    throw new MicroserviceError(message, 409, code, { operation, service: SERVICE });
  }

  private async resolveClaGroupContext(req: Request, orgUid: string, signatureId: string, operation: string): Promise<ApprovalContext | null> {
    const entries = await this.fetchUpstreamClaGroups(req, orgUid);
    const entry = entries.find((candidate) => isSameClaGroup(candidate.signatureID, signatureId) || candidate.signatureID === signatureId);
    if (!entry) {
      logger.warning(req, operation, 'signature is not on this organization CLA list', { org_uid: orgUid, signature_id: signatureId });
      return null;
    }

    const claGroupId = entry.claGroupID?.trim() ?? '';
    const companyId = entry.companyID?.trim() ?? '';
    // Any project the CLA Group covers satisfies the producer's project-scope check, and it maps
    // the SFID back to the CLA Group itself — so the first is as good as any. It is not
    // arbitrary in one respect: the producer records this SFID on the activity-log entry it
    // writes, so a multi-project CLA Group attributes every approval-list change to whichever
    // project upstream happens to list first. The alternative is inventing a selection rule the
    // producer does not have.
    //
    // `GetCompanyClaGroups` drops the foundation marker from `projects[]` so the foundation is
    // not drawn as a covered project. That skip is correct for the chips. A foundation-level
    // group therefore arrives with no project SFID and a present `foundationSFID`. The producer's
    // `GetClaGroupIDForProject` already falls back to a foundation lookup, so that id is a valid
    // path segment for the approval-list endpoints, which require it via `requireApprovalListProject`.
    // The acknowledgments read does not: its URL is company Salesforce id, CLA Group id, and the
    // company id query, so a held agreement with neither project nor foundation still lists.
    const projectSfid = entry.projects?.find((project) => !!project.projectSFID?.trim())?.projectSFID?.trim() || entry.foundationSFID?.trim() || '';

    if (!claGroupId || !companyId) {
      // Not a 404: the agreement exists and the caller may see it. The row simply cannot be
      // addressed, which is an upstream data problem rather than anything the caller can fix
      // by asking differently. A missing project id is not this failure — only the approval-list
      // paths need one.
      throw new MicroserviceError('Failed to resolve the agreement: upstream row is missing the ids it is addressed by', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation,
        service: SERVICE,
      });
    }

    // The Auto ECLA producer loads one corporate signature for the company and CLA group. A
    // second signature on that pair would be the record a toggle of the first can change.
    if (operation === 'org_cla_update_ecla_auto_create') {
      this.assertUnambiguousCompanyClaGroup(
        entries,
        entry,
        operation,
        'This CLA shares its company and CLA group with another agreement, so its Auto ECLA setting cannot be changed here yet.',
        'AMBIGUOUS_AGREEMENT_TARGET'
      );
    }

    return {
      // The row's own spelling: downstream reads match upstream records on it exactly.
      signatureId: entry.signatureID,
      claGroupId,
      companyId,
      companySfid: orgUid,
      projectSfid,
      signed: entry.signed === true,
      canEdit: await this.callerCanEdit(req, entry, operation),
    };
  }

  /**
   * Whether the signed-in caller may change this agreement's approval list.
   *
   * The producer's rule is membership of the CCLA's own ACL, matched on LF username, and it
   * explicitly refuses to let an organization-level admin scope stand in for it. So an org admin
   * who can load this page is not thereby able to write, and the client cannot work that out for
   * itself — hence a server-decided flag.
   *
   * Derived from the list row's `claManagers`, which is the same roster the producer checks. The
   * identities do not leave the server: the row mapper drops them, and what crosses to the
   * browser is this boolean.
   *
   * Fails OPEN when the producer sent no roster at all. That is the deliberate direction: the
   * producer is the authority and rejects the write regardless, so failing open costs a CLA
   * manager one clear error message, where failing closed would hide the only approval-list
   * controls Self Serve has from someone entitled to use them.
   */
  private async callerCanEdit(req: Request, entry: EasyClaCompanyClaGroup, operation: string): Promise<boolean> {
    if (!Array.isArray(entry.claManagers)) {
      logger.warning(req, operation, 'upstream sent no CLA manager roster, so write access was not narrowed', { signature_id: entry.signatureID });
      return true;
    }

    const username = (await getUsernameFromAuth(req))?.trim().toLowerCase() ?? '';
    if (!username) return false;

    return entry.claManagers.some((manager) => manager?.lfUsername?.trim().toLowerCase() === username);
  }

  private requireApprovalListProject(context: ApprovalContext, operation: string): void {
    if (context.projectSfid) return;
    // Not a 404: the agreement exists. The approval-list URL is keyed on a project (or foundation)
    // Salesforce id, and a row with neither cannot be addressed there.
    throw new MicroserviceError('Failed to resolve the approval list: upstream row is missing the ids it is addressed by', 502, 'UPSTREAM_INVALID_RESPONSE', {
      operation,
      service: SERVICE,
    });
  }

  /**
   * Reads the approval list of an agreement whose context is already resolved.
   *
   * Split from `getApprovalList` so the write path can re-read without paying for the resolution
   * again — it holds the same context, and re-resolving would refetch the organization's whole
   * agreement list to arrive at ids it already has.
   */
  private async readApprovalList(req: Request, context: ApprovalContext, operation: string): Promise<OrgClaApprovalList> {
    this.requireApprovalListProject(context, operation);
    const signature = await this.fetchCorporateSignature(req, context, operation);

    return {
      signatureId: context.signatureId,
      // A resolved agreement whose CCLA the read path did not return is an empty list, not a
      // failure: the producer selects the signed and approved CCLA for the project, and a
      // signature that is signed but not approved legitimately matches nothing there.
      entries: signature ? toApprovalEntries(signature) : [],
      canEdit: context.canEdit,
    };
  }

  /** Reads the CCLA the approval list lives on. */
  private async fetchCorporateSignature(req: Request, context: ApprovalContext, operation: string): Promise<EasyClaCorporateSignature | null> {
    const upstream = await gatewayFetch<EasyClaCorporateSignatureList>(
      req,
      `${claServiceBaseUrl(SERVICE)}/v4/signatures/project/${encodeURIComponent(context.projectSfid)}/company/${encodeURIComponent(context.companyId)}`,
      {
        operation,
        service: SERVICE,
        errorMessage: 'Failed to fetch the approval list',
        errorCode: 'UPSTREAM_ERROR',
        // These signatures carry `signatureACL` — the CLA managers by name — and the approval
        // list itself, which is a list of contributors' email addresses and domains. Redacted for
        // both reasons.
        redactResponseBody: true,
        bearerToken: isImpersonating(req) ? req.bearerToken : undefined,
      }
    );

    if (!upstream || !Array.isArray(upstream.signatures)) {
      throw new MicroserviceError('Failed to fetch the approval list: malformed response from upstream', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation,
        service: SERVICE,
      });
    }

    // Matched on the signature id rather than taken as the first result. The endpoint is keyed on
    // (project, company) and one company can hold several CCLAs there under different signing
    // entities — which is the same reason the list page is keyed on the signature id and not the
    // CLA Group. Taking `[0]` would show one signing entity's approval list under another's name.
    return upstream.signatures.find((signature) => signature?.signatureID === context.signatureId) ?? null;
  }

  /**
   * Fetches one page of the paginated contributor list for the resolved agreement.
   *
   * `redactResponseBody: true` because the page carries every listed contributor's identity
   * attributes — logging them on a non-OK status would put them in application logs, which is the
   * only reason the mapper below can drop them cleanly.
   *
   * Impersonated read: forwards the impersonated bearer so a support engineer sees what the
   * target sees, matching the sibling approval-list read.
   */
  private async fetchContributorAcknowledgmentsPage(
    req: Request,
    context: ApprovalContext,
    query: ContributorAcknowledgmentQuery,
    operation: string
  ): Promise<EasyClaCorporateContributorList> {
    const params = new URLSearchParams();
    params.set('companyID', context.companyId);
    if (query.search) params.set('searchTerm', query.search);
    params.set('pageSize', String(query.pageSize));
    if (query.nextKey) params.set('nextKey', query.nextKey);

    const url =
      `${claServiceBaseUrl(SERVICE)}/v4/company/external/${encodeURIComponent(context.companySfid)}` +
      `/cla-group/${encodeURIComponent(context.claGroupId)}/corporate-contributors?${params.toString()}`;

    const upstream = await gatewayFetch<EasyClaCorporateContributorList>(req, url, {
      operation,
      service: SERVICE,
      errorMessage: 'Failed to fetch the contributor acknowledgments',
      errorCode: 'UPSTREAM_ERROR',
      redactResponseBody: true,
      bearerToken: isImpersonating(req) ? req.bearerToken : undefined,
    });

    if (!upstream) {
      throw new MicroserviceError('Failed to fetch the contributor acknowledgments: upstream returned no body', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation,
        service: SERVICE,
      });
    }

    // A missing, null, or non-array list is a malformed body, not an empty page. Truthiness would
    // let those through, and the mapper would render them as "no acknowledgments yet". An empty
    // array is the real empty page and passes this check. Same rule as the organization-list read.
    if (!Array.isArray(upstream.list)) {
      throw new MicroserviceError('Failed to fetch the contributor acknowledgments: malformed response from upstream', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation,
        service: SERVICE,
      });
    }

    return upstream;
  }

  /**
   * Fetches one page of the producer's per-(company, CLA Group) event stream (#1987).
   *
   * The producer's route is `GET /v4/company/{companyID}/project/{projectSFID}/events`. Its handler
   * looks up the CLA Group id from `projectSFID` (via `GetClaGroupIDForProject`, which also
   * accepts a foundation SFID), then queries DynamoDB by the composite partition
   * `company_sfid_cla_group_id`. So the same `projectSfid` used by the sibling approval-list read
   * — filled from the project SFID for a project-scoped CLA Group, or the foundation SFID for a
   * foundation-level one — is the correct path segment here.
   *
   * `returnAllEvents` is never forwarded. On this route it only lifts the query limit to 10000
   * rows of the same company-and-CLA-Group partition.
   *
   * `redactResponseBody: true` because a non-OK body from the producer can echo request
   * attributes including a company id, and a routine 4xx here (a stale CCLA id, a temporarily
   * expired grant) is the case, not the exception. Same rule as the sibling acknowledgments read.
   *
   * Impersonated read: forwards the impersonated bearer so a support engineer sees what the
   * target sees, matching the sibling approval-list read.
   */
  private async fetchActivityLogPage(req: Request, context: ApprovalContext, query: ActivityLogQuery, operation: string): Promise<EasyClaEventList> {
    const params = new URLSearchParams();
    params.set('pageSize', String(query.pageSize));
    if (query.nextKey) params.set('nextKey', query.nextKey);

    const url =
      `${claServiceBaseUrl(SERVICE)}/v4/company/${encodeURIComponent(context.companyId)}` +
      `/project/${encodeURIComponent(context.projectSfid)}/events?${params.toString()}`;

    const upstream = await gatewayFetch<EasyClaEventList>(req, url, {
      operation,
      service: SERVICE,
      errorMessage: 'Failed to fetch the activity log',
      errorCode: 'UPSTREAM_ERROR',
      redactResponseBody: true,
      bearerToken: isImpersonating(req) ? req.bearerToken : undefined,
    });

    if (!upstream) {
      throw new MicroserviceError('Failed to fetch the activity log: upstream returned no body', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation,
        service: SERVICE,
      });
    }

    // A missing, null, or non-array event set is a malformed body, not an empty page. Truthiness
    // would let those through, and the mapper would render them as "no activity yet". An empty
    // array is the real empty page and passes this check.
    if (!Array.isArray(upstream.Events)) {
      throw new MicroserviceError('Failed to fetch the activity log: malformed response from upstream', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation,
        service: SERVICE,
      });
    }

    return upstream;
  }

  /**
   * Whether this acknowledgment id is on the resolved company's roster for this CLA Group.
   *
   * The grain is **company × CLA Group** — not the CCLA named on `:signatureId` — and that is
   * deliberate, because it is the grain the producer itself acts at. Its invalidate endpoint is
   * keyed on the CLA Group with no CCLA id anywhere in the path, so a company holding two CCLAs
   * under one CLA Group has one blast radius across both. Verifying against the narrower CCLA
   * would refuse writes the producer would allow, which is a different contract, not a stricter
   * reading of this one.
   *
   * Bounded by the producer's own paging cursor, with a cap on pages walked so a producer that
   * keeps handing back a non-null `nextKey` cannot spin this forever. Hitting the cap returns
   * false — the write is refused rather than let through unverified.
   */
  private async acknowledgmentBelongsToCompanyClaGroup(
    req: Request,
    context: ApprovalContext,
    acknowledgmentSignatureId: string,
    operation: string
  ): Promise<boolean> {
    const target = acknowledgmentSignatureId.trim();
    if (!target) return false;

    let nextKey: string | undefined;
    for (let pages = 0; pages < CONTRIBUTOR_ACK_VERIFY_MAX_PAGES; pages += 1) {
      const page = await this.fetchContributorAcknowledgmentsPage(
        req,
        context,
        { search: '', pageSize: ORG_CLA_ACKNOWLEDGMENTS_PAGE_SIZE_MAX, nextKey },
        operation
      );

      if (
        Array.isArray(page.list) &&
        page.list.some((row) => {
          const id = row?.signatureID?.trim();
          return id === target || isSameClaGroup(id, target);
        })
      )
        return true;

      const cursor = page.nextKey?.trim();
      if (!cursor) return false;
      nextKey = cursor;
    }

    logger.warning(req, operation, 'acknowledgment id verify walked more pages than allowed', {
      cla_group_id: context.claGroupId,
      pages_walked: CONTRIBUTOR_ACK_VERIFY_MAX_PAGES,
    });
    return false;
  }
}

/**
 * Cap on the pages the id verify will walk before giving up and refusing the write.
 *
 * The invalidate flow only reaches the walker for an acknowledgment the browser has already
 * rendered, so a hit on the first page is by far the common case. 100 pages of 100 rows covers a
 * per-agreement roster orders of magnitude larger than any this feature has seen — so reaching
 * the cap means the producer is misbehaving, and the write is refused rather than forwarded on an
 * unverified id.
 */
const CONTRIBUTOR_ACK_VERIFY_MAX_PAGES = 100;

/**
 * Result of a per-acknowledgment invalidate (#1986, #2807).
 *
 * Mirrors `OrgClaApprovalUpdateOutcome`: three ordinary refusals map to three distinct HTTP
 * answers and only `invalidated` carries a receipt. Impersonation is refused by middleware before
 * this union is reachable.
 */
export type OrgClaInvalidateAcknowledgmentOutcome =
  | { outcome: 'invalidated'; result: OrgClaInvalidateAcknowledgmentResult }
  | { outcome: 'not-found' }
  | { outcome: 'not-signed' }
  | { outcome: 'forbidden' };

/**
 * Result of an approval-list write.
 *
 * A union rather than `null` plus a thrown error, because the four outcomes map to four
 * different HTTP answers and three of them are ordinary: a signature the organization does not
 * hold is a 404, an unsigned agreement is a 400 with its own copy, and a caller who is not a CLA
 * manager on it is a 403. Only `updated` carries a list.
 */
export type OrgClaApprovalUpdateOutcome =
  | { outcome: 'updated'; list: OrgClaApprovalList }
  | { outcome: 'not-found' }
  | { outcome: 'not-signed' }
  | { outcome: 'forbidden' };

/**
 * Result of an Auto ECLA toggle write (#1988).
 *
 * A union rather than a bare boolean plus a thrown error, because the two ordinary outcomes map
 * to distinct HTTP answers: a signature the organization does not hold is a 404, and an unsigned
 * agreement is a 400 with its own copy. `updated` is the success shape and carries the state the
 * producer now records — the caller sends the target, the service echoes it back so the client
 * can trust the new value without a re-read.
 *
 * Producer refusals (sanctions, ACL) travel as thrown 403s carrying the producer's own sentence
 * on `clientMessage`; they are not one of these outcomes. Splitting them out here would force the
 * BFF to translate copy the producer already wrote.
 */
export type OrgClaEclaAutoCreateUpdateOutcome = { outcome: 'updated'; autoCreateEcla: boolean } | { outcome: 'not-found' } | { outcome: 'not-signed' };

/** Query parameters accepted on the acknowledgments read. Every field is already validated. */
export interface ContributorAcknowledgmentQuery {
  search: string;
  pageSize: number;
  nextKey?: string;
}

/** Query parameters accepted on the activity log read. Every field is already validated. */
export interface ActivityLogQuery {
  pageSize: number;
  nextKey?: string;
}

/**
 * Maps one producer event onto the shared `OrgClaActivityLogEntry` shape (#1987).
 *
 * Returns `null` for a row without a stable event id — an entry without an id collides with
 * sibling id-less entries on `@for` tracking in the browser and has no address downstream can
 * reach. A dropped row is logged at the caller.
 *
 * `summary` is the producer's `EventSummary` only. A missing summary stays empty and the client
 * renders an em-dash. `EventData` is the detailed audit sentence and is not copied onto the row.
 * A present `EventSummary` is opaque display copy: rendered as plain text, never parsed, never
 * re-linked. Some historical summaries carry a project name behind the literal label "with
 * project SFID"; the tab leaves that sentence unchanged.
 *
 * `actor` prefers `UserName` (a display name) and falls back to `LfUsername` (an LF login) —
 * neither is guaranteed to be present, so a producer row with neither leaves `actor` as `null`
 * and the render site substitutes an em-dash. `when` passes the producer's timestamp through
 * verbatim; the client renders it in the viewer's locale. Every event type maps the same way, so a
 * type the producer adds later still renders.
 */
function toActivityLogEntry(row: EasyClaEvent | undefined | null): OrgClaActivityLogEntry | null {
  const id = row?.EventID?.trim() ?? '';
  if (!id) return null;

  const nonEmpty = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const summary = nonEmpty(row?.EventSummary) ?? '';
  const actor = nonEmpty(row?.UserName) ?? nonEmpty(row?.LfUsername) ?? null;
  const when = nonEmpty(row?.EventTime) ?? '';

  return {
    id,
    when,
    actor,
    summary,
  };
}

/**
 * Maps one producer row onto the shared `OrgClaContributorAcknowledgment` shape.
 *
 * Returns `null` for a row without a per-ack signature id — the id is what the invalidate write
 * would need to address the row, and, if kept, two absent-id rows would collide on `@for`
 * tracking in the browser. A dropped row is logged upstream at the caller.
 *
 * Never drops a row for a missing LF Login: the identity fallback lives at the render site, and
 * this mapper's job is to pass through every attribute the producer sent as a non-empty string.
 * `github_id` and `gitlab_id` are documented on the producer model as usernames (logins); this
 * mapper carries them forward as `githubUsername` / `gitlabUsername` for that reason.
 *
 * `approved` defaults to `true` when the producer omits it — the field was added later and older
 * rows predate it. `name` is the DocuSign signing name: the producer stores that on
 * `userDocusignName` and puts the profile name (or, when that is empty, the username) on `name`,
 * so a row that has both can disagree. Prefer the DocuSign field and keep `name` as the fallback
 * for rows recorded before that field existed. `signedOn` prefers `userDocusignDateSigned` (a
 * signing timestamp) and falls back to `timestamp` (the signature's creation time). It does not
 * use `signatureModified`: an invalidation refreshes that field, so it would show the
 * invalidation instant under Acknowledged On. `cclaVersion` normalizes to a `v`-prefixed
 * string; a value already prefixed with `v`/`V` is returned unchanged, an empty version stays
 * empty so the row renders an em-dash.
 */
function toContributorAcknowledgment(row: EasyClaCorporateContributor | undefined | null): OrgClaContributorAcknowledgment | null {
  const signatureId = row?.signatureID?.trim() ?? '';
  if (!signatureId) return null;

  const nonEmpty = (value: string | undefined): string | undefined => {
    const trimmed = value?.trim() ?? '';
    return trimmed.length > 0 ? trimmed : undefined;
  };

  return {
    signatureId,
    lfLogin: nonEmpty(row?.linux_foundation_id),
    githubUsername: nonEmpty(row?.github_id),
    gitlabUsername: nonEmpty(row?.gitlab_id),
    email: nonEmpty(row?.email),
    name: nonEmpty(row?.userDocusignName) ?? nonEmpty(row?.name),
    cclaVersion: normalizeCclaVersion(row?.signature_version),
    signedOn: nonEmpty(row?.userDocusignDateSigned) ?? nonEmpty(row?.timestamp),
    approved: row?.signatureApproved !== false,
    invalidatedAt: nonEmpty(row?.invalidatedAt),
    invalidatedBy: nonEmpty(row?.invalidatedBy),
    invalidationReason: nonEmpty(row?.invalidationReason),
  };
}

/**
 * Normalizes a producer `signature_version` to a `v`-prefixed string.
 *
 * A value already prefixed with `v`/`V` is returned unchanged (so `v1` stays `v1` — never `vv1`);
 * a bare `2.1` becomes `v2.1`; an empty or whitespace-only value stays empty so the row's render
 * site can substitute an em-dash.
 */
function normalizeCclaVersion(value: string | undefined): string {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return '';
  return /^v/i.test(trimmed) ? trimmed : `v${trimmed}`;
}

/** The upstream ids one approval-list call is addressed by, resolved from the organization's list. */
interface ApprovalContext {
  signatureId: string;
  claGroupId: string;
  companyId: string;
  companySfid: string;
  projectSfid: string;
  signed: boolean;
  canEdit: boolean;
}

/**
 * Turns the shared delta into the producer's twelve-array body.
 *
 * Takes an already-validated delta: the controller rejects an unknown kind or a value the
 * producer would refuse, so this is a pure mapping. Deduplicates within each array, because the
 * producer appends adds to the stored list and a value sent twice is a rule stored twice.
 */
function buildApprovalListUpdateBody(update: OrgClaApprovalListUpdate): EasyClaApprovalListUpdateRequest {
  const body: EasyClaApprovalListUpdateRequest = {};

  for (const [entries, side] of [
    [update.add, 'add'],
    [update.remove, 'remove'],
  ] as const) {
    for (const entry of entries) {
      const field = APPROVAL_WRITE_FIELDS[entry.kind][side];
      const value = entry.value.trim();
      const existing = body[field] ?? [];
      if (!existing.includes(value)) body[field] = [...existing, value];
    }
  }

  return body;
}
