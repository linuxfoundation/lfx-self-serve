// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Organization Lens EasyCLA list (#1978). Reads the organization's corporate CLAs from
// EasyCLA's organization CLA landing list (easycla#5188) and maps them onto the row the
// Org Lens page renders.
//
// One upstream call per page load, whatever the number of agreements. Searching and paging
// happen client-side over the fetched set, so nothing on this path fans out per row.

import type { OrgClaGroup, OrgClaGroupList, OrgClaGroupProject, OrgClaGroupStatus } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import type { EasyClaCompanyClaGroup, EasyClaCompanyClaGroupList } from '../types/cla.types';
import { MicroserviceError } from '../errors';
import { claServiceBaseUrl } from '../helpers/cla-service-url.helper';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import { isImpersonating } from '../utils/auth-helper';

const SERVICE = 'org_cla_service';

/**
 * Maps one upstream entry onto the list row.
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
function toOrgClaGroup(entry: EasyClaCompanyClaGroup, companyName: string): OrgClaGroup {
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
    id: entry.signatureID ?? '',
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
    ...(entry.signedOn ? { signedOn: entry.signedOn } : {}),
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
      `${claServiceBaseUrl()}/v4/company/external/${encodeURIComponent(orgUid)}/cla-groups`,
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

    const entries = upstream.list;
    const companyName = entries.find((entry) => !!entry.companyName)?.companyName ?? '';

    return {
      orgUid,
      // Upstream order (signing entity, then CLA group name) is preserved, so what a support
      // engineer sees probing the endpoint directly matches what the page shows.
      claGroups: entries.map((entry) => toOrgClaGroup(entry, companyName)),
    };
  }
}
