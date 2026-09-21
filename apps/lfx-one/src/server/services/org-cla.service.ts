// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Organization Lens EasyCLA list (#1978). Reads the organization's corporate CLAs from
// EasyCLA's organization CLA landing list (easycla#5188) and maps them onto the row the
// Org Lens page renders.
//
// One upstream call per page load, whatever the number of agreements. Searching and paging
// happen client-side over the fetched set, so nothing on this path fans out per row.

import { ORG_EASYCLA_RETURN_ORG_PARAM, ORG_EASYCLA_RETURN_SIGNED_PARAM, ORG_EASYCLA_RETURN_SIGNED_VALUE } from '@lfx-one/shared/constants';
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
  OrgClaApprovalList,
  OrgClaApprovalListUpdate,
  OrgClaGroup,
  OrgClaGroupList,
  OrgClaGroupProject,
  OrgClaGroupStatus,
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
  EasyClaCorporateSignature,
  EasyClaCorporateSignatureList,
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
 * `autoCreateECLA` is likewise not carried: it belongs to a later feature.
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

function toOrgClaManager(entry: EasyClaCompanyClaManager): OrgClaManager {
  const name = entry.name?.trim() ?? '';
  const email = entry.email?.trim() ?? '';
  // Only the events-backed add time. `approved_on` is the CCLA's signature_created and is not when
  // this manager was added; the UI renders an em dash when this is absent.
  const addedOn = entry.added_on?.trim() ?? '';

  return {
    lfUsername: entry.lf_username?.trim() ?? '',
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
 * The write endpoints key on the project, and an empty id would compose `…/project//cla-manager` —
 * a path the caller cannot tell from a well-formed one. Only the write paths require it: listing
 * managers keys on the CLA group alone, so an agreement covering no project still lists.
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
    let body: EasyClaSelfServeCorporateSignatureInput;
    if (request.sendAsEmail) {
      body = {
        project_sfid: request.projectSfid,
        company_sfid: orgUid,
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

    // The agreement is requested by project, not by CLA Group: the upstream input takes
    // `project_sfid` and has no field for a CLA Group, so the group the signatory chose cannot be
    // bound to the request. It comes back on the response, and that echo is the only place the two
    // can be compared. Without this check a project whose CLA Group mapping moved between the
    // search and the confirmation — or a client that posted a mismatched pair — hands the signatory
    // a session for an agreement they did not choose, and nothing anywhere would say so.
    //
    // This necessarily refuses after the envelope exists, leaving one abandoned upstream. That is
    // the cheaper of the two outcomes by a wide margin: the alternative is a corporate agreement
    // signed against the wrong CLA Group, which is a legal instrument that cannot be withdrawn by
    // this application. Binding the group in the request instead needs an upstream field.
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
    const context = await this.resolveApprovalContext(req, orgUid, signatureId, 'org_cla_get_approval_list');
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
    const context = await this.resolveApprovalContext(req, orgUid, signatureId, 'org_cla_update_approval_list');
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
   * The organization's agreements as upstream sends them, validated but unmapped.
   *
   * Split out from `listClaGroups` because the write paths need three ids the shared row
   * deliberately does not carry — the internal company UUID, the CLA Group id, and a project SFID
   * — and widening `OrgClaGroup` to reach them would ship the internal company id to every
   * browser that loads the list page. The mapper's boundary holds; this is the server-side door
   * behind it.
   */

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

    const upstream = await gatewayFetch<EasyClaCompanyClaManagerList>(
      req,
      `${claServiceBaseUrl(SERVICE)}/v4/company/${encodeURIComponent(target.companyId)}/cla-group/${encodeURIComponent(target.claGroupId)}/cla-managers`,
      {
        operation: 'org_cla_list_managers',
        service: SERVICE,
        errorMessage: 'Failed to fetch CLA managers',
        errorCode: 'UPSTREAM_ERROR',
        redactResponseBody: true,
        bearerToken: isImpersonating(req) ? req.bearerToken : undefined,
      }
    );

    const list = Array.isArray(upstream?.list) ? upstream.list : [];

    return {
      signatureId,
      managers: list.filter((entry): entry is EasyClaCompanyClaManager => !!entry?.lf_username?.trim()).map((entry) => toOrgClaManager(entry)),
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

    const roster = await this.getManagers(req, orgUid, signatureId);
    const normalizedEmail = request.email.trim().toLowerCase();
    const added = roster?.managers.find((manager) => manager.email?.trim().toLowerCase() === normalizedEmail);

    if (!added?.lfUsername?.trim()) {
      throw new MicroserviceError('Failed to add the CLA manager: upstream returned no manager record', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation: 'org_cla_add_manager',
        service: SERVICE,
      });
    }

    logger.debug(req, 'org_cla_add_manager', 'added a cla manager', { org_uid: orgUid, signature_id: signatureId });
    return added;
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
    const companyId = entry.companyID?.trim() ?? '';
    const claGroupId = entry.claGroupID?.trim() ?? '';
    const peers = entries.filter((candidate) => candidate.companyID?.trim() === companyId && candidate.claGroupID?.trim() === claGroupId);
    if (peers.length <= 1) return;

    throw new MicroserviceError(
      'This CLA shares its company and CLA group with another agreement, so its managers cannot be read or changed here yet.',
      409,
      'AMBIGUOUS_MANAGER_TARGET',
      { operation, service: SERVICE }
    );
  }

  private async resolveApprovalContext(req: Request, orgUid: string, signatureId: string, operation: string): Promise<ApprovalContext | null> {
    const entries = await this.fetchUpstreamClaGroups(req, orgUid);
    const entry = entries.find((candidate) => candidate.signatureID === signatureId);
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
    // path segment — refusing it 502s a real signed CCLA before the approval-list API is called.
    const projectSfid = entry.projects?.find((project) => !!project.projectSFID?.trim())?.projectSFID?.trim() || entry.foundationSFID?.trim() || '';

    if (!claGroupId || !companyId || !projectSfid) {
      // Not a 404: the agreement exists and the caller may see it. The row simply cannot be
      // addressed on the approval-list endpoints, which is an upstream data problem rather than
      // anything the caller can fix by asking differently.
      throw new MicroserviceError('Failed to resolve the approval list: upstream row is missing the ids it is addressed by', 502, 'UPSTREAM_INVALID_RESPONSE', {
        operation,
        service: SERVICE,
      });
    }

    return {
      signatureId,
      claGroupId,
      companyId,
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

  /**
   * Reads the approval list of an agreement whose context is already resolved.
   *
   * Split from `getApprovalList` so the write path can re-read without paying for the resolution
   * again — it holds the same context, and re-resolving would refetch the organization's whole
   * agreement list to arrive at ids it already has.
   */
  private async readApprovalList(req: Request, context: ApprovalContext, operation: string): Promise<OrgClaApprovalList> {
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
}

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

/** The upstream ids one approval-list call is addressed by, resolved from the organization's list. */
interface ApprovalContext {
  signatureId: string;
  claGroupId: string;
  companyId: string;
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
