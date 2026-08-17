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

import { Auth0Identity, ClaSignHandoff, EmailManagementData, MyClaAgreement, MyClasResponse, PdfUrlResponse, type ClaStatus } from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { EasyClaMyCla, EasyClaMyClaList, EasyClaMyClaPdf, EasyClaUserFromTokenV2, ResolvedClaIdentity } from '../types/cla.types';
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

// Where the Contributor Console returns a contributor after signing (#1251). Mirrors the
// `clas` child route under /profile in profile.routes.ts.
const MY_CLAS_PATH = '/profile/clas';

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

// Hostnames this app is served from. Pinned in code rather than an allowlist env var because the
// hand-off adds no new configuration; the per-PR previews below are why the host cannot simply be
// read from one configured base URL.
const TRUSTED_RETURN_HOSTNAMES = new Set(['app.lfx.dev', 'app.dev.lfx.dev', 'localhost', '127.0.0.1']);

// Per-PR preview deployments, e.g. ui-pr-1440.dev.v2.cluster.linuxfound.info. Fully anchored with a
// bounded digit run — no nested quantifier, so it cannot backtrack pathologically.
const PREVIEW_RETURN_HOSTNAME = /^ui-pr-\d{1,10}\.dev\.v2\.cluster\.linuxfound\.info$/;

/**
 * Absolute URL back to the contributor's CLAs view, for the Sign CLA hand-off (#1251).
 *
 * Absolute, not relative: after signing, the last hop is a server-side redirect issued by the
 * CLA API using the stored value verbatim, so a relative path would resolve against the CLA
 * API's origin instead of ours.
 *
 * Derived from the request rather than configured, so preview deployments (per-PR hostnames)
 * are correct without templating a fourth environment value. `trust proxy` is set, so
 * `protocol`/`host` already reflect the forwarded headers behind the ingress.
 *
 * Because that makes the origin request-controlled, the host is checked against our own origins
 * before it is handed onward: EasyCLA stores this value and later redirects to it verbatim, so an
 * unchecked forged Host would turn a trusted hand-off into an open redirect.
 */
export function claReturnUrl(req: Request): string {
  const host = req.get('host');
  if (!host) {
    throw new MicroserviceError('Cannot derive the CLA return URL: request has no Host header', 500, 'RETURN_URL_UNRESOLVABLE', { service: SERVICE });
  }

  if (req.protocol !== 'http' && req.protocol !== 'https') {
    throw new MicroserviceError('Cannot derive the CLA return URL: unsupported protocol', 500, 'RETURN_URL_UNTRUSTED', { service: SERVICE });
  }

  // Parsed rather than string-split so a port (previews use one) and IPv6 literals resolve
  // correctly, and so a host carrying userinfo or a path cannot smuggle another origin through.
  let hostname: string;
  try {
    hostname = new URL(`${req.protocol}://${host}`).hostname.toLowerCase();
  } catch {
    throw new MicroserviceError('Cannot derive the CLA return URL: unparseable Host header', 500, 'RETURN_URL_UNTRUSTED', { service: SERVICE });
  }

  if (!TRUSTED_RETURN_HOSTNAMES.has(hostname) && !PREVIEW_RETURN_HOSTNAME.test(hostname)) {
    throw new MicroserviceError('Cannot derive the CLA return URL: untrusted Host header', 500, 'RETURN_URL_UNTRUSTED', { service: SERVICE });
  }

  return `${req.protocol}://${host}${MY_CLAS_PATH}`;
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

// Every `ClaStatus` the UI can label. `superseded` is declared but unproduced today; it is
// accepted here so that shipping it upstream needs no consumer change. Anything else is a
// contract break on the producer's side and must not reach the template, where the label and
// severity helpers are exhaustive switches with no fallthrough — an unrecognised value would
// render an unlabelled, severity-less pill.
const KNOWN_CLA_STATUSES = new Set<string>(['valid', 'needs_attention', 'invalidated', 'unknown', 'superseded']);

/** Narrows the wire `status` to `ClaStatus`, or null when it is absent or out of contract. */
function asClaStatus(status: string | undefined): ClaStatus | null {
  return status !== undefined && KNOWN_CLA_STATUSES.has(status) ? (status as ClaStatus) : null;
}

/**
 * Maps an upstream `my-cla` record to the UI view model.
 *
 * `status` and `statusReason` are the producer's: neither is derived from
 * `approved`/`valid` for a record that honours the contract. Two out-of-contract
 * inputs are corrected rather than forwarded:
 *
 * - An ICLA carries no coverage dimension, so `needs_attention` / `unknown`
 *   cannot describe one. Such a row collapses to the binary ICLA standing —
 *   `valid` when `approved`, else `invalidated` — and drops its reason. This is
 *   the one place `approved` is consulted, and only for a row the producer
 *   should never have emitted.
 * - A `status` outside `ClaStatus` becomes `unknown`, which the UI renders as
 *   an em dash rather than an unlabelled pill, and its reason is dropped with it.
 */
export function toMyClaAgreement(cla: EasyClaMyCla): MyClaAgreement {
  const isIcla = cla.claType === 'icla';

  const documentVersion =
    cla.documentMajorVersion !== undefined
      ? `${cla.documentMajorVersion}${cla.documentMinorVersion !== undefined ? `.${cla.documentMinorVersion}` : ''}`
      : undefined;

  const wireStatus = asClaStatus(cla.status);

  let status: ClaStatus = wireStatus ?? 'unknown';
  // A reason qualifies the status it shipped with, so an out-of-contract status invalidates it too;
  // keeping it would pair an em dash with a sentence explaining a coverage miss.
  let statusReason = wireStatus === null ? undefined : cla.statusReason;
  if (isIcla) {
    statusReason = undefined;
    if (status === 'needs_attention' || status === 'unknown') {
      status = cla.approved === true ? 'valid' : 'invalidated';
    }
  }

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
    status,
    statusReason,
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

  /**
   * Resolves the contributor's EasyCLA user-record UUID for the Sign CLA hand-off (#1251), from
   * the `userIds` the identity search already returns.
   *
   * TEMPORARY BRIDGE. The intended source is a resolve-or-create "current user" endpoint, which
   * `GET /v4/user-from-token` would be — except it is not reachable authenticated. The CLA
   * backend's security scheme is an API key on the `X-ACL` header, injected by the platform
   * gateway on authenticated routes; `/v4/user-from-token` is configured as an unauthenticated
   * passthrough, so nothing injects it and go-swagger rejects the call before the authenticator
   * runs. The BFF cannot supply `X-ACL` itself — the backend trusts that header precisely because
   * only the gateway can set it. `/v4/my-clas` is an authenticated route, so its `userIds` are
   * the same records, obtained through a door that is actually open.
   *
   * Two gaps this bridge cannot close, both of which the proper endpoint fixes:
   *
   * - It is a pure read. A contributor with no EasyCLA record yet — a first-time signer, the very
   *   person this feature exists for — resolves to nothing and is refused below.
   * - It can match several records, and nothing here can tell which one a signature ought to be
   *   attributed to. We take the first and log the ambiguity rather than fail, because refusing a
   *   returning contributor helps nobody; the proper endpoint returns one canonical record.
   *
   * No impersonation branch, on purpose: the hand-off route is blocked outright while
   * impersonating, because a signature must never be attributed to the wrong person.
   */
  public async resolveContributorId(req: Request): Promise<string> {
    const startTime = logger.startOperation(req, 'cla_resolve_contributor_id');

    const resolvedOrCreated = await this.tryResolveOrCreateContributor(req);
    if (resolvedOrCreated) {
      logger.success(req, 'cla_resolve_contributor_id', startTime);
      return resolvedOrCreated;
    }

    const identity = await this.resolveIdentity(req);
    const list = await this.fetchMyClas(req, identity);
    const userIds = (list.userIds ?? []).map((id) => id.trim()).filter(Boolean);

    if (userIds.length === 0) {
      // Handing off without a real id lands the contributor on the Console's "invalid user ID"
      // screen, which reads as a broken product rather than a failed lookup — fail here instead.
      throw new MicroserviceError('No EasyCLA user record matches this session', 502, 'CLA_USER_UNRESOLVED', { service: SERVICE });
    }

    if (userIds.length > 1) {
      logger.warning(req, 'cla_resolve_contributor_id', 'identity matches several EasyCLA user records; handing off the first', {
        matched_count: userIds.length,
      });
    }

    logger.success(req, 'cla_resolve_contributor_id', startTime);
    return userIds[0] as string;
  }

  /**
   * Builds the two halves of the Console hand-off URL that only the server can produce: the
   * session-resolved contributor id and the absolute return address.
   *
   * The client composes the final URL, because the Console base lives in the Angular environment
   * (`urls.contributorConsole`) which the server layer does not import. Keeping these two here
   * is what makes the identifier un-spoofable (FR-003) and the return address origin-correct.
   */
  public async getSignHandoff(req: Request): Promise<ClaSignHandoff> {
    // Derived first: if the origin is unusable there is no point minting a user record upstream.
    const redirectUrl = claReturnUrl(req);
    const claUserId = await this.resolveContributorId(req);

    return { claUserId, redirectUrl };
  }

  /**
   * PROBE — `GET /v2/user-from-token`, the resolve-or-create the bridge below cannot do.
   *
   * Unlike its v4 namesake this route is *not* exempted from gateway auth, so it arrives with the
   * gateway's injected headers, and it calls `get_or_create_user` — meaning it mints a record for a
   * first-time signer instead of resolving to nothing.
   *
   * Whether it accepts *our* token is the open question. Its validator only requires a token
   * signed by the configured Auth0 domain that carries a username claim; it does not check the
   * audience, so a gateway-audience token is not disqualified on that ground. But the custom
   * username claim is added by an Auth0 Action and is not guaranteed on every audience — if it is
   * absent the validator answers "username claim not found".
   *
   * Returns null on any failure so the caller falls back rather than breaking the hand-off. The
   * outcome is logged either way: this is here to answer the question, not to stay.
   */
  private async tryResolveOrCreateContributor(req: Request): Promise<string | null> {
    try {
      const user = await gatewayFetch<EasyClaUserFromTokenV2>(req, `${claServiceBaseUrl()}/v2/user-from-token`, {
        operation: 'cla_probe_user_from_token_v2',
        service: SERVICE,
        errorMessage: 'Probe of /v2/user-from-token failed',
        errorCode: 'UPSTREAM_ERROR',
      });

      const claUserId = user?.user_id?.trim();
      if (!claUserId) {
        logger.warning(req, 'cla_probe_user_from_token_v2', 'probe answered without a user_id; falling back to the userIds bridge');
        return null;
      }

      logger.info(req, 'cla_probe_user_from_token_v2', 'probe succeeded — resolve-or-create is reachable with our token');
      return claUserId;
    } catch (error) {
      logger.warning(req, 'cla_probe_user_from_token_v2', 'probe rejected; falling back to the userIds bridge', {
        probe_status: error instanceof MicroserviceError ? error.statusCode : 'unknown',
        probe_detail: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
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
