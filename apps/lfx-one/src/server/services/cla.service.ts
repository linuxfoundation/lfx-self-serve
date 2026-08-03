// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Read-only "My CLAs" service (Milestone 1). Resolves the session identity to a
// set of identity keys, then delegates listing, validity computation and PDF
// retrieval to the EasyCLA `/v4/my-clas` endpoints via lfx-gateway.
//
// The SS server sources identity keys only from the trusted session, never from
// request input (research R3). EasyCLA re-verifies each key belongs to the
// authenticated user before searching and reports unverifiable keys in
// `skippedIdentities` — SS surfaces that as identity-gap telemetry.

import { MyClaAgreement, MyClasResponse, PdfUrlResponse } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { EasyClaMyCla, EasyClaMyClaList, EasyClaMyClaPdf, ResolvedClaIdentity } from '../types/cla.types';
import { MicroserviceError } from '../errors';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import { getEffectiveEmail, getEffectiveSub, getEffectiveUsername, isImpersonating } from '../utils/auth-helper';
import { Auth0Service } from './auth0.service';
import { logger } from './logger.service';

const SERVICE = 'cla_service';

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
 * Maps an upstream `my-cla` record to the UI view model.
 *
 * Validity is authoritative from upstream (`valid`, computed against the *current*
 * CCLA approval lists), so SS does not recompute it: `valid` ⇒ 'valid', otherwise
 * 'inactive'. The 'superseded' label is not derivable here — the endpoint does not
 * expose the CLA group's current version — so it is not produced in M1.
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
    status: cla.valid ? 'valid' : 'inactive',
    documentVersion,
    pdfAvailable: isIcla && cla.pdfAvailable === true,
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ClaService {
  private readonly auth0Service = new Auth0Service();

  /**
   * Resolves the session identity to the identity-key set passed to `/v4/my-clas`:
   * LF username, verified email, and linked GitHub numeric IDs *and* usernames.
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
    const emails = primaryEmail ? [primaryEmail] : [];

    // Linked GitHub identities enrich resolution with githubId/githubUsername keys, but are
    // not load-bearing: if the auth-service lookup fails (e.g. NATS unavailable), degrade to
    // LF-username + email resolution rather than failing the whole page.
    const auth0Sub = getEffectiveSub(req);
    let identities: Awaited<ReturnType<Auth0Service['getUserIdentities']>> = [];
    if (auth0Sub) {
      try {
        identities = await this.auth0Service.getUserIdentities(req, auth0Sub);
      } catch (error) {
        logger.warning(req, 'cla_resolve_identity', 'linked-identity lookup failed; continuing without GitHub keys', {
          err: error instanceof Error ? error.message : String(error),
        });
      }
    }
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
    });
    return resolved;
  }

  /** Builds the `/api/me/clas` response from the resolved identity. */
  public async getMyClas(req: Request): Promise<MyClasResponse> {
    const startTime = logger.startOperation(req, 'cla_get_my_clas');

    const identity = await this.resolveIdentity(req);
    const list = await this.fetchMyClas(req, identity);

    // Show only currently-valid CLAs: the endpoint returns invalid rows too (valid=false) by
    // design (#1158, docs/MY_CLAS_API.md); the consumer drops them (valid !== true, per FR-002).
    const agreements = (list.clas ?? []).filter((cla) => cla.valid === true).map(toMyClaAgreement);

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
    for (const email of identity.emails) params.append('email', email);
    for (const githubId of identity.githubIds) params.append('githubId', githubId);
    for (const githubUsername of identity.githubUsernames) params.append('githubUsername', githubUsername);
    return params;
  }
}
