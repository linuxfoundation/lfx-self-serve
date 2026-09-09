// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Organization Lens EasyCLA list (#1978). Reads the organization's corporate CLAs from
// EasyCLA's organization CLA landing list (easycla#5188) and maps them onto the row the
// Org Lens page renders.
//
// One upstream call per page load, whatever the number of agreements. Searching and paging
// happen client-side over the fetched set, so nothing on this path fans out per row.

import type {
  OrgClaApprovalCriteriaKind,
  OrgClaApprovalEntry,
  OrgClaApprovalList,
  OrgClaApprovalListUpdate,
  OrgClaGroup,
  OrgClaGroupList,
  OrgClaGroupProject,
  OrgClaGroupStatus,
  PdfUrlResponse,
} from '@lfx-one/shared/interfaces';
import { sortOrgClaApprovalEntries } from '@lfx-one/shared/utils';
import type { Request } from 'express';

import type {
  EasyClaApprovalItem,
  EasyClaApprovalListUpdateRequest,
  EasyClaCompanyClaGroup,
  EasyClaCompanyClaGroupList,
  EasyClaCorporateSignature,
  EasyClaCorporateSignatureList,
  EasyClaSignatureApprovalLists,
  EasyClaSignedDocument,
} from '../types/cla.types';
import { MicroserviceError } from '../errors';
import { claServiceBaseUrl } from '../helpers/cla-service-url.helper';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
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
    const entries = await this.fetchUpstreamClaGroups(req, orgUid);
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
    }

    return {
      outcome: 'updated',
      list: {
        signatureId,
        entries: result ? toApprovalEntriesFromWrite(result) : [],
        canEdit: context.canEdit,
      },
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
   * Resolves the three upstream ids an approval-list call is addressed by, plus whether the caller
   * may write.
   *
   * `null` means the signature is not on this organization's list — answered without ever calling
   * the approval endpoints.
   */
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
    // producer does not have. `foundationSFID` is deliberately not a fallback — a foundation id is
    // not a project id, and the producer's lookup would 404 on it.
    const projectSfid = entry.projects?.find((project) => !!project.projectSFID)?.projectSFID?.trim() ?? '';

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

    const signatures = Array.isArray(upstream?.signatures) ? upstream.signatures : [];

    // Matched on the signature id rather than taken as the first result. The endpoint is keyed on
    // (project, company) and one company can hold several CCLAs there under different signing
    // entities — which is the same reason the list page is keyed on the signature id and not the
    // CLA Group. Taking `[0]` would show one signing entity's approval list under another's name.
    return signatures.find((signature) => signature?.signatureID === context.signatureId) ?? null;
  }
}

/**
 * Result of an approval-list write.
 *
 * A union rather than `null` plus a thrown error, because the three outcomes map to three
 * different HTTP answers and two of them are ordinary: a signature the organization does not
 * hold is a 404, and an unsigned agreement is a 400 with its own copy. Only `updated` carries a
 * list.
 */
export type OrgClaApprovalUpdateOutcome = { outcome: 'updated'; list: OrgClaApprovalList } | { outcome: 'not-found' } | { outcome: 'not-signed' };

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
