// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Read-only "CLAs" service (Milestone 1). Resolves the session identity to a
// set of identity keys, then delegates listing, validity computation and PDF
// retrieval to the EasyCLA `/v4/my-clas` endpoints via lfx-gateway.
//
// The SS server sources identity keys only from the trusted session, never from
// request input (research R3). EasyCLA re-verifies each key belongs to the
// authenticated user before searching and reports unverifiable keys in
// `skippedIdentities` — SS surfaces that as identity-gap telemetry.

import { Auth0Identity, EmailManagementData, MyClaAgreement, MyClasResponse, PdfUrlResponse, type ClaStatus } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { EasyClaMyCla, EasyClaMyClaList, EasyClaMyClaPdf, ResolvedClaIdentity } from '../types/cla.types';
import { MicroserviceError } from '../errors';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import { getEffectiveEmail, getEffectiveSub, getEffectiveUsername, isImpersonating } from '../utils/auth-helper';
import { Auth0Service } from './auth0.service';
import { EmailVerificationService } from './email-verification.service';
import { logger } from './logger.service';

const SERVICE = 'cla_service';

// Upstream `/v4/my-clas` caps the repeatable `email` query param at maxItems: 100
// (easycla cla-backend-go/swagger/cla.v2.yaml). Exceeding it fails validation and 400s the
// whole request, so the collected set is capped rather than letting a pathological account
// (many verified + linked-identity emails) break the page instead of degrading.
const MAX_CLA_EMAILS = 100;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in isolation). No I/O.
// ---------------------------------------------------------------------------

/**
 * Base URL for the CLA service behind the API gateway. Derived from API_GW_AUDIENCE
 * (already required to mint the gateway token), mirroring user.service.ts.
 */
export function claServiceBaseUrl(): string {
  const audience = process.env['API_GW_AUDIENCE'];
  if (!audience) {
    throw new MicroserviceError('API_GW_AUDIENCE environment variable is not configured', 503, 'API_GATEWAY_MISCONFIGURED', { service: SERVICE });
  }
  return `${audience.replace(/\/+$/, '')}/cla-service`;
}

/**
 * Normalizes a linked-identity GitHub ID to the bare numeric form EasyCLA keys on.
 * Auth0 may return either a bare id ("13434323") or a "github|13434323" form —
 * accept both. Returns null for non-numeric values.
 */
export function normalizeGithubId(rawUserId: string): string | null {
  const stripped = rawUserId.includes('|') ? rawUserId.substring(rawUserId.indexOf('|') + 1) : rawUserId;
  return /^\d+$/.test(stripped) ? stripped : null;
}

/**
 * Builds the deduplicated email set sent to `/v4/my-clas`. Contributors often sign under a
 * work email that is not their LFID primary, so all of the user's verified emails are sent
 * (#1227) — each via the indexed `email` query param.
 *
 * Two server-side sources are unioned; both are re-verified upstream (EasyCLA drops any email
 * the user does not actually own into `skippedIdentities`), so over-sending is safe:
 *   - the authoritative verified-email list (`user_emails.read`): primary + `verified` alternates.
 *   - emails carried on the already-fetched linked identities (`profileData.email`).
 *
 * The session primary is always included as a floor so behaviour never regresses when the
 * auth-service email read is unavailable. Values are lowercased/trimmed and deduped. Emails are
 * sent only via `email` (never `secondaryEmail`, an unindexed upstream table scan), so a work
 * email EasyCLA filed solely as a record's secondary email is intentionally not matched.
 *
 * The result is capped at MAX_CLA_EMAILS to stay within the upstream `email` param limit. The
 * session primary is added first and higher-signal sources precede linked-identity emails, so
 * truncating the tail preserves primary priority.
 */
export function collectClaEmails(primaryEmail: string | null, emailData: EmailManagementData | null, identities: Auth0Identity[]): string[] {
  const emails = new Set<string>();
  const add = (value: string | null | undefined): void => {
    const normalized = value?.toLowerCase().trim();
    if (normalized) emails.add(normalized);
  };

  add(primaryEmail);

  if (emailData) {
    add(emailData.primary_email);
    for (const alternate of emailData.alternate_emails ?? []) {
      if (alternate.verified) add(alternate.email);
    }
  }

  for (const identity of identities) {
    add(identity.profileData?.email);
  }

  return [...emails].slice(0, MAX_CLA_EMAILS);
}

/**
 * Temporary consumer-side status derivation pending EasyCLA publishing an
 * explicit per-row `status` (#1423). Delete this function and read the
 * producer's field directly when that lands — the UI vocabulary and table
 * stay unchanged.
 *
 * not approved            ⇒ invalidated
 * approved and not valid  ⇒ needs_attention  (ECLA coverage miss only)
 * approved and valid      ⇒ valid
 *
 * An absent or null `approved` is treated as not approved. Individual CLAs
 * never derive `needs_attention`: their validity tracks approval one-to-one
 * upstream, and the unreachable approved-but-not-valid combo is pinned to
 * `invalidated` so the amber state cannot leak onto an ICLA.
 */
export function deriveMyClaStatus(cla: Pick<EasyClaMyCla, 'claType' | 'approved' | 'valid'>): ClaStatus {
  if (cla.approved !== true) {
    return 'invalidated';
  }
  if (cla.valid === true) {
    return 'valid';
  }
  if (cla.claType === 'icla') {
    return 'invalidated';
  }
  return 'needs_attention';
}

/**
 * Maps an upstream `my-cla` record to the UI view model.
 *
 * Status is derived from the two flags the endpoint already publishes
 * (`approved`, `valid`) via {@link deriveMyClaStatus}. That helper is
 * scaffolding for #1423 and must not be inlined — adopting the upstream
 * field is a deletion of the helper, not a rewrite of this mapper.
 * `superseded` is not derivable here (the endpoint does not expose the
 * CLA group's current version) and is not produced.
 */
export function toMyClaAgreement(cla: EasyClaMyCla): MyClaAgreement {
  const isIcla = cla.claType === 'icla';

  const documentVersion =
    cla.documentMajorVersion !== undefined
      ? `${cla.documentMajorVersion}${cla.documentMinorVersion !== undefined ? `.${cla.documentMinorVersion}` : ''}`
      : undefined;

  return {
    id: cla.signatureID,
    kind: isIcla ? 'ICLA' : 'ECLA',
    claGroupName: cla.claGroupName || cla.claGroupID || '',
    // Salesforce project name/logo (upstream omits both when unresolvable) — normalize
    // empty strings to undefined so the Project cell falls back to claGroupName / the icon.
    projectName: cla.projectName || undefined,
    projectLogo: cla.projectLogo || undefined,
    companyName: !isIcla ? cla.signingEntityName || cla.companyName || undefined : undefined,
    signedOn: cla.signedOn ?? '',
    status: deriveMyClaStatus(cla),
    documentVersion,
    pdfAvailable: isIcla && cla.pdfAvailable === true,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ClaService {
  private readonly auth0Service = new Auth0Service();
  private readonly emailVerificationService = new EmailVerificationService();

  /**
   * Resolves the session identity to the identity-key set passed to `/v4/my-clas`:
   * LF username, all of the user's verified emails, and linked GitHub numeric IDs *and*
   * usernames.
   *
   * All verified emails are sent (#1227), not just the session primary: contributors often
   * sign under a work email that differs from their LFID primary, so those signatures would
   * otherwise be missed. See collectClaEmails for the sources and the indexed-`email` rationale.
   *
   * Both the numeric GitHub id and the username are sent: the numeric id validates
   * upstream against EasyCLA user records, while the username validates via the
   * platform user-service — which is the only path that authorizes a pre-LFID
   * GitHub signer whose numeric id has no EasyCLA LFID record.
   */
  public async resolveIdentity(req: Request): Promise<ResolvedClaIdentity> {
    const startTime = logger.startOperation(req, 'cla_resolve_identity');

    const lfUsername = getEffectiveUsername(req);
    const primaryEmail = getEffectiveEmail(req);
    const auth0Sub = getEffectiveSub(req);

    // The linked identities (GitHub keys) and the full verified-email set both come from the
    // auth-service; fetch them concurrently so the extra call adds no serial latency. Neither is
    // load-bearing: a NATS/auth-service failure degrades to LF-username + session-primary-email
    // resolution rather than failing the whole page. getUserEmails already returns null on
    // failure; getUserIdentities throws, so its rejection is handled here.
    let identities: Auth0Identity[] = [];
    let emailData: EmailManagementData | null = null;
    if (auth0Sub) {
      const [identitiesResult, emailsResult] = await Promise.allSettled([
        this.auth0Service.getUserIdentities(req, auth0Sub),
        this.emailVerificationService.getUserEmails(req, auth0Sub),
      ]);

      if (identitiesResult.status === 'fulfilled') {
        identities = identitiesResult.value;
      } else {
        logger.warning(req, 'cla_resolve_identity', 'linked-identity lookup failed; continuing without GitHub keys', {
          err: identitiesResult.reason instanceof Error ? identitiesResult.reason.message : String(identitiesResult.reason),
        });
      }

      if (emailsResult.status === 'fulfilled') {
        emailData = emailsResult.value;
      } else {
        logger.warning(req, 'cla_resolve_identity', 'verified-email lookup failed; continuing without the verified-email list', {
          err: emailsResult.reason instanceof Error ? emailsResult.reason.message : String(emailsResult.reason),
        });
      }
    }

    const emails = collectClaEmails(primaryEmail, emailData, identities);

    const githubIdentities = identities.filter((i) => i.provider === 'github');
    const githubIds = githubIdentities.map((i) => normalizeGithubId(i.user_id)).filter((id): id is string => id !== null);
    const githubUsernames = githubIdentities.map((i) => i.profileData?.nickname?.trim()).filter((name): name is string => !!name);
    const githubLinked = githubIdentities.length > 0;

    const resolved: ResolvedClaIdentity = {
      lfUsername,
      emails,
      githubIds,
      githubUsernames,
      githubLinked,
    };

    logger.success(req, 'cla_resolve_identity', startTime, {
      github_linked: githubLinked,
      github_id_count: githubIds.length,
      github_username_count: githubUsernames.length,
      email_count: emails.length,
    });
    return resolved;
  }

  /** Builds the `/api/me/clas` response from the resolved identity. */
  public async getMyClas(req: Request): Promise<MyClasResponse> {
    const startTime = logger.startOperation(req, 'cla_get_my_clas');

    const identity = await this.resolveIdentity(req);
    const list = await this.fetchMyClas(req, identity);

    const agreements = (list.clas ?? []).map(toMyClaAgreement);

    if (list.skippedIdentities?.length) {
      // Identities EasyCLA could not verify as owned — the natural telemetry signal
      // for identity-mapping gaps (e.g. pre-LFID GitHub signers). Not user-facing.
      logger.warning(req, 'cla_get_my_clas', 'upstream skipped unverifiable identities', {
        skipped_count: list.skippedIdentities.length,
      });
    }

    logger.success(req, 'cla_get_my_clas', startTime, {
      agreement_count: agreements.length,
      matched_user_ids: list.userIds?.length ?? 0,
    });

    return {
      agreements,
      identity: {
        matchedUserIds: list.userIds?.length ?? 0,
        unmatched: (list.userIds?.length ?? 0) === 0,
        githubLinked: identity.githubLinked,
      },
    };
  }

  /**
   * Resolves the presigned signed-document URL for an ICLA the session owns via
   * `GET /v4/my-clas/{signatureID}/pdf`. EasyCLA enforces ownership + ICLA
   * eligibility and returns 404 for unknown, not-owned and ECLA signature IDs, so
   * no separate ownership pre-check is needed here. Returns null on 404.
   */
  public async getPdfUrl(req: Request, signatureId: string, identity: ResolvedClaIdentity): Promise<PdfUrlResponse | null> {
    const startTime = logger.startOperation(req, 'cla_get_pdf_url', { signature_id: signatureId });

    const params = this.identityQuery(identity);

    let result: EasyClaMyClaPdf | null;
    try {
      result = await gatewayFetch<EasyClaMyClaPdf>(req, `${claServiceBaseUrl()}/v4/my-clas/${encodeURIComponent(signatureId)}/pdf?${params.toString()}`, {
        operation: 'cla_get_pdf_url',
        service: SERVICE,
        errorMessage: 'Failed to fetch signed document URL',
        errorCode: 'UPSTREAM_ERROR',
        // During impersonation the query identity is the target user's, so the upstream ownership
        // check must run under the target's token — not the impersonator's apiGatewayToken.
        bearerToken: isImpersonating(req) ? req.bearerToken : undefined,
      });
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 404) return null;
      throw error;
    }

    if (!result?.url) return null;

    logger.success(req, 'cla_get_pdf_url', startTime);
    return { url: result.url, expiresInSeconds: result.expiresInSeconds ?? 0 };
  }

  /** Fetches the composed CLA list for the resolved identity from `GET /v4/my-clas`. */
  private async fetchMyClas(req: Request, identity: ResolvedClaIdentity): Promise<EasyClaMyClaList> {
    const params = this.identityQuery(identity);

    const list = await gatewayFetch<EasyClaMyClaList>(req, `${claServiceBaseUrl()}/v4/my-clas?${params.toString()}`, {
      operation: 'cla_get_my_clas',
      service: SERVICE,
      errorMessage: 'Failed to fetch CLAs',
      errorCode: 'UPSTREAM_ERROR',
      // During impersonation the query identity is the target user's, so the upstream
      // authorization must run under the target's token — not the impersonator's apiGatewayToken.
      bearerToken: isImpersonating(req) ? req.bearerToken : undefined,
    });

    return list ?? {};
  }

  /**
   * Builds the `/v4/my-clas` identity query from a resolved session identity.
   * `lfUsername` defaults to the authenticated principal upstream when omitted,
   * but is sent explicitly for clarity. GitHub id and username are both sent (see
   * resolveIdentity).
   */
  private identityQuery(identity: ResolvedClaIdentity): URLSearchParams {
    const params = new URLSearchParams();

    if (identity.lfUsername) params.set('lfUsername', identity.lfUsername);
    for (const email of identity.emails) {
      params.append('email', email);
    }
    for (const githubId of identity.githubIds) {
      params.append('githubId', githubId);
    }
    for (const githubUsername of identity.githubUsernames) {
      params.append('githubUsername', githubUsername);
    }
    return params;
  }
}
