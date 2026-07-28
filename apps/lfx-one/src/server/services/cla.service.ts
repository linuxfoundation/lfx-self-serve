// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

// Read-only "My CLAs" service (Milestone 1). Resolves the session identity to
// EasyCLA user record(s), fetches their signatures via lfx-gateway /cla-service,
// and normalizes them into the shared MyCla* view models.
//
// The server is the authorization boundary (research R3): every upstream query
// iterates only over user IDs resolved from the session, never from request input.

import { MyClaAgreement, MyClasResponse, PdfUrlResponse } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { EasyClaSignature, EasyClaSignedDocument, EasyClaUser, EasyClaUserSignatures, ResolvedClaIdentity } from '../types/cla.types';
import { MicroserviceError } from '../errors';
import { gatewayFetch } from '../helpers/gateway-fetch.helper';
import { getEffectiveEmail, getEffectiveSub, getEffectiveUsername } from '../utils/auth-helper';
import { Auth0Service } from './auth0.service';
import { logger } from './logger.service';

const SERVICE = 'cla_service';

/** Presigned signed-document URLs are minted with a ~15-minute TTL upstream (research R4). */
const PDF_URL_TTL_SECONDS = 15 * 60;

/** Page size for the paginated user-signatures endpoint. */
const SIGNATURES_PAGE_SIZE = 100;

/** Safety bound on pagination to avoid unbounded loops on a misbehaving upstream. */
const MAX_SIGNATURE_PAGES = 50;

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in isolation — see T013/T014). No I/O.
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
 * Auth0 may return either a bare id ("13434323") or a "github|13434323" form
 * (confirmed by spike T003) — accept both. Returns null for non-numeric values.
 */
export function normalizeGithubId(rawUserId: string): string | null {
  const stripped = rawUserId.includes('|') ? rawUserId.substring(rawUserId.indexOf('|') + 1) : rawUserId;
  return /^\d+$/.test(stripped) ? stripped : null;
}

/** True when the signature is an Individual CLA (has a downloadable PDF). */
export function isIcla(sig: EasyClaSignature): boolean {
  if (sig.claType) return sig.claType === 'icla';
  // Fallback when claType is absent: cla + user reference + no company ⇒ ICLA.
  return sig.signatureType === 'cla' && sig.signatureReferenceType === 'user' && !sig.companyName;
}

/** True when the signature is an Employee CLA (acknowledgement; no PDF). */
export function isEcla(sig: EasyClaSignature): boolean {
  if (sig.claType) return sig.claType === 'ecla';
  return sig.signatureType === 'cla' && sig.signatureReferenceType === 'user' && !!sig.companyName;
}

/**
 * Derives the display status for a signature (research R6):
 * - signed + approved            ⇒ 'valid'
 * - signed + !approved           ⇒ 'inactive' (invalidated / criteria removed)
 * - superseded document version  ⇒ 'superseded' (only when currentMajorVersion known)
 *
 * `currentMajorVersion` is optional; superseded detection is skipped when the CLA
 * group's current version is not available (T004 confirms field exposure).
 */
export function deriveStatus(sig: EasyClaSignature, currentMajorVersion?: number): 'valid' | 'superseded' | 'inactive' {
  if (!sig.signatureApproved) return 'inactive';
  if (currentMajorVersion !== undefined && sig.signatureDocumentMajorVersion) {
    const signedMajor = Number(sig.signatureDocumentMajorVersion);
    if (Number.isFinite(signedMajor) && signedMajor < currentMajorVersion) return 'superseded';
  }
  return 'valid';
}

/**
 * Maps a raw EasyCLA signature to the UI view model, or null when it is not an
 * individual/employee CLA (e.g. a corporate CCLA record — excluded from M1).
 * Only `signature_signed=true` records are surfaced.
 */
export function toMyClaAgreement(sig: EasyClaSignature): MyClaAgreement | null {
  if (!sig.signatureSigned) return null;

  const icla = isIcla(sig);
  const ecla = isEcla(sig);
  if (!icla && !ecla) return null;

  const documentVersion =
    sig.signatureDocumentMajorVersion !== undefined
      ? `${sig.signatureDocumentMajorVersion}${sig.signatureDocumentMinorVersion !== undefined ? `.${sig.signatureDocumentMinorVersion}` : ''}`
      : undefined;

  return {
    id: sig.signatureID,
    kind: icla ? 'ICLA' : 'ECLA',
    // Prefer the upstream-resolved CLA Group display name; fall back to the CLA Group ID
    // (projectID) for records where the name could not be resolved.
    projectName: sig.projectName || sig.projectID || '',
    companyName: ecla ? sig.signingEntityName || sig.companyName || undefined : undefined,
    signedOn: sig.signedOn ?? '',
    status: deriveStatus(sig),
    documentVersion,
    pdfAvailable: icla,
  };
}

/**
 * Merges signatures from all resolved user records into the final agreement list:
 * classify → drop CCLA/unsigned → filter invalid ECLAs (FR-002) → dedupe by
 * signatureID → sort by signedOn desc. ICLAs are kept regardless of status (FR-001).
 */
export function buildAgreements(signatures: EasyClaSignature[]): MyClaAgreement[] {
  const bySignatureId = new Map<string, MyClaAgreement>();
  for (const sig of signatures) {
    const agreement = toMyClaAgreement(sig);
    if (!agreement) continue;
    // ECLAs are shown only when currently valid (FR-002); ICLAs keep their status label.
    if (agreement.kind === 'ECLA' && agreement.status !== 'valid') continue;
    if (!bySignatureId.has(agreement.id)) bySignatureId.set(agreement.id, agreement);
  }
  return Array.from(bySignatureId.values()).sort((a, b) => (b.signedOn ?? '').localeCompare(a.signedOn ?? ''));
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ClaService {
  private readonly auth0Service = new Auth0Service();

  /**
   * Resolves the session identity to EasyCLA user record(s) using the three-key union
   * (LF username + verified emails + linked GitHub numeric IDs) via `GET /v4/users/by-identity`.
   *
   * If that endpoint is unavailable (e.g. not yet deployed in an environment), it degrades
   * gracefully to username-only resolution via `/v3/users/username/{userName}` so the page
   * still works for post-LF-login users.
   */
  public async resolveIdentity(req: Request): Promise<ResolvedClaIdentity> {
    const startTime = logger.startOperation(req, 'cla_resolve_identity');

    const lfUsername = getEffectiveUsername(req);
    const primaryEmail = getEffectiveEmail(req);
    const emails = primaryEmail ? [primaryEmail] : [];

    // Linked GitHub identities (research R2) — highest-precision key for pre-LF-login history.
    const auth0Sub = getEffectiveSub(req);
    const identities = auth0Sub ? await this.auth0Service.getUserIdentities(req, auth0Sub) : [];
    const githubIds = identities
      .filter((i) => i.provider === 'github')
      .map((i) => normalizeGithubId(i.user_id))
      .filter((id): id is string => id !== null);
    const githubLinked = identities.some((i) => i.provider === 'github');

    const easyclaUserIds = new Set<string>();
    if (lfUsername || emails.length || githubIds.length) {
      const users = await this.getUsersByIdentity(req, lfUsername, emails, githubIds);
      for (const user of users) {
        if (user.userID) easyclaUserIds.add(user.userID);
      }
    }

    const resolved: ResolvedClaIdentity = {
      lfUsername,
      emails,
      githubIds,
      easyclaUserIds: Array.from(easyclaUserIds),
      githubLinked,
    };

    logger.success(req, 'cla_resolve_identity', startTime, {
      matched_user_ids: resolved.easyclaUserIds.length,
      github_linked: githubLinked,
    });
    return resolved;
  }

  /** Fetches and merges all signatures for the resolved user IDs. */
  public async getUserSignatures(req: Request, userIds: string[]): Promise<EasyClaSignature[]> {
    const startTime = logger.startOperation(req, 'cla_get_user_signatures', { user_count: userIds.length });

    const all: EasyClaSignature[] = [];
    for (const userId of userIds) {
      all.push(...(await this.getSignaturesForUser(req, userId)));
    }

    logger.success(req, 'cla_get_user_signatures', startTime, { signature_count: all.length });
    return all;
  }

  /** Builds the `/api/me/clas` response from the resolved identity. */
  public async getMyClas(req: Request): Promise<MyClasResponse> {
    const identity = await this.resolveIdentity(req);
    const signatures = identity.easyclaUserIds.length ? await this.getUserSignatures(req, identity.easyclaUserIds) : [];

    return {
      agreements: buildAgreements(signatures),
      identity: {
        matchedUserIds: identity.easyclaUserIds.length,
        unmatched: identity.easyclaUserIds.length === 0,
        githubLinked: identity.githubLinked,
      },
    };
  }

  /**
   * Resolves the presigned signed-document URL for an ICLA the session owns.
   * Ownership + ICLA-eligibility is verified by the caller (controller) against
   * the session's resolved agreement set before this is invoked (research R3).
   */
  public async getSignedDocumentUrl(req: Request, signatureId: string): Promise<PdfUrlResponse | null> {
    const startTime = logger.startOperation(req, 'cla_get_signed_document_url', { signature_id: signatureId });

    let result: EasyClaSignedDocument | null;
    try {
      result = await gatewayFetch<EasyClaSignedDocument>(req, `${claServiceBaseUrl()}/v4/signatures/${encodeURIComponent(signatureId)}/signed-document`, {
        operation: 'cla_get_signed_document_url',
        service: SERVICE,
        errorMessage: 'Failed to fetch signed document URL',
        errorCode: 'UPSTREAM_ERROR',
      });
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 404) return null;
      throw error;
    }

    if (!result?.signed_cla_url) return null;

    logger.success(req, 'cla_get_signed_document_url', startTime);
    return { url: result.signed_cla_url, expiresInSeconds: PDF_URL_TTL_SECONDS };
  }

  /**
   * Resolves the union of EasyCLA users matching any identity key via
   * `GET /v4/users/by-identity`. Falls back to username-only resolution
   * (`/v3/users/username/{userName}`) if that endpoint is unavailable, so the
   * feature still works in environments where it has not yet been deployed.
   */
  private async getUsersByIdentity(req: Request, lfUsername: string | null, emails: string[], githubIds: string[]): Promise<EasyClaUser[]> {
    const params = new URLSearchParams();
    if (lfUsername) params.set('lfUsername', lfUsername);
    for (const email of emails) params.append('email', email);
    for (const githubId of githubIds) params.append('githubId', githubId);

    try {
      const users = await gatewayFetch<EasyClaUser[]>(req, `${claServiceBaseUrl()}/v4/users/by-identity?${params.toString()}`, {
        operation: 'cla_get_users_by_identity',
        service: SERVICE,
        errorMessage: 'Failed to resolve EasyCLA users by identity',
        errorCode: 'UPSTREAM_ERROR',
      });
      return users ?? [];
    } catch (error) {
      // 404 ⇒ endpoint not present in this environment: degrade to username-only.
      if (error instanceof MicroserviceError && error.statusCode === 404 && lfUsername) {
        logger.warning(req, 'cla_get_users_by_identity', 'by-identity endpoint unavailable; falling back to username-only resolution', {});
        const user = await this.getUserByUsername(req, lfUsername);
        return user ? [user] : [];
      }
      throw error;
    }
  }

  /** Looks up a single EasyCLA user by LF username. Returns null on 404. */
  private async getUserByUsername(req: Request, userName: string): Promise<EasyClaUser | null> {
    try {
      return await gatewayFetch<EasyClaUser>(req, `${claServiceBaseUrl()}/v3/users/username/${encodeURIComponent(userName)}`, {
        operation: 'cla_get_user_by_username',
        service: SERVICE,
        errorMessage: 'Failed to look up EasyCLA user by username',
        errorCode: 'UPSTREAM_ERROR',
      });
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 404) return null;
      throw error;
    }
  }

  /** Pages through `GET /v4/signatures/user/{userID}` for a single user. */
  private async getSignaturesForUser(req: Request, userId: string): Promise<EasyClaSignature[]> {
    const collected: EasyClaSignature[] = [];
    let nextKey: string | undefined;

    for (let page = 0; page < MAX_SIGNATURE_PAGES; page++) {
      const params = new URLSearchParams({ pageSize: String(SIGNATURES_PAGE_SIZE) });
      if (nextKey) params.set('nextKey', nextKey);

      const result = await gatewayFetch<EasyClaUserSignatures>(
        req,
        `${claServiceBaseUrl()}/v4/signatures/user/${encodeURIComponent(userId)}?${params.toString()}`,
        {
          operation: 'cla_get_signatures_for_user',
          service: SERVICE,
          errorMessage: 'Failed to fetch EasyCLA user signatures',
          errorCode: 'UPSTREAM_ERROR',
        }
      );

      collected.push(...(result?.signatures ?? []));
      nextKey = result?.lastKeyScanned || undefined;
      if (!nextKey) break;
    }

    return collected;
  }
}
