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

import {
  Auth0Identity,
  EmailManagementData,
  GithubAccountOption,
  GithubAccountOptions,
  MyClaAgreement,
  MyClasResponse,
  PdfUrlResponse,
  SigningIdentityRefusal,
  SigningIdentityResponse,
  type ClaStatus,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import { EasyClaMyCla, EasyClaMyClaList, EasyClaMyClaPdf, EasyClaSigningIdentity, ResolvedClaIdentity } from '../types/cla.types';
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

/**
 * The refusal reasons the CLA service can answer a binding request with. A closed set, in
 * the order they are tested — no reason is a substring of another, so a match is exact
 * even though the search is not anchored.
 */
const SIGNING_IDENTITY_REFUSALS: readonly SigningIdentityRefusal[] = [
  'identity_unavailable',
  'identity_mismatch',
  'record_conflict',
  'record_unclaimed',
  'duplicate_github_id',
  'lf_record_already_bound',
  'recorded_mismatch',
];

/**
 * Finds the refusal reason in an upstream error body.
 *
 * The reason has to be recovered from the message text because the CLA service's shared
 * error shape carries only `code`, `message` and a request id, and adding a field to it
 * would change every endpoint that uses it. Searching a closed set of known reasons keeps
 * that safe: an unrecognised body yields null and the error passes through untouched,
 * rather than being guessed into the nearest reason.
 */
export function signingIdentityRefusalFrom(errorBody: unknown): SigningIdentityRefusal | null {
  if (!errorBody) return null;
  const text = typeof errorBody === 'string' ? errorBody : JSON.stringify(errorBody);
  return SIGNING_IDENTITY_REFUSALS.find((reason) => text.includes(reason)) ?? null;
}

/**
 * Re-labels an upstream failure with its refusal reason, so the reason survives to the
 * browser rather than being flattened into a single "conflict".
 *
 * Carried on `errorBody.error`, which the error response already forwards as
 * `upstreamCode` — the existing route for exactly this, since `code` is derived from the
 * HTTP status and collapses every 409 together.
 */
function withSigningIdentityRefusal(error: unknown): unknown {
  if (!(error instanceof MicroserviceError)) return error;

  const reason = signingIdentityRefusalFrom(error.errorBody);
  if (!reason) return error;

  return new MicroserviceError(error.message, error.statusCode, error.code, {
    operation: 'cla_bind_signing_identity',
    service: SERVICE,
    errorBody: { error: reason },
  });
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
   * Lists the GitHub accounts the contributor has already linked, so the picker can render
   * and so the flow can tell whether a picker is needed at all (#1252).
   *
   * This list carries no authority. The CLA service re-derives the attested set from the
   * caller's own token and refuses anything outside it, so a stale or over-broad list here
   * can only cause a refusal downstream, never an incorrect association. That independence
   * is what makes it safe to read from the same convenient source the My CLAs page uses.
   *
   * One behaviour differs from that read path on purpose: `resolveIdentity` degrades when
   * the identity lookup fails, continuing without GitHub keys, which is right for a list
   * where a partial answer beats an error. It is wrong here, because an empty list is
   * indistinguishable from "no accounts linked" and would send a contributor who does have
   * a linked account into an account-linking flow they do not need. A failure surfaces.
   */
  public async listGithubAccounts(req: Request): Promise<GithubAccountOptions> {
    const startTime = logger.startOperation(req, 'cla_list_github_accounts');

    const auth0Sub = getEffectiveSub(req);
    if (!auth0Sub) {
      throw new MicroserviceError('No identity subject on the session', 401, 'CLA_IDENTITY_UNAVAILABLE', { service: SERVICE });
    }

    // Deliberately not wrapped: a rejection here must reach the caller as a failure.
    const identities = await this.auth0Service.getUserIdentities(req, auth0Sub);

    const accounts = identities
      .filter((identity) => identity.provider === 'github')
      .map((identity) => ({
        githubId: normalizeGithubId(identity.user_id),
        githubUsername: identity.profileData?.nickname?.trim() ?? '',
      }))
      // An identity whose number cannot be read is dropped rather than refused: it can
      // never be selected, since the backend would not attest an unreadable account either.
      .filter((account): account is GithubAccountOption => account.githubId !== null);

    logger.success(req, 'cla_list_github_accounts', startTime, { account_count: accounts.length });
    return { accounts };
  }

  /**
   * Submits the contributor's chosen GitHub account and returns the EasyCLA record
   * identifier the hand-off consumes (#1252).
   *
   * This layer is where the account is established as the contributor's, and the check that
   * establishes it is here rather than in the browser. The CLA service records what it is
   * sent without re-deriving ownership, so the submitted account is matched against the
   * accounts the identity provider reports for this session before it is relayed. The picker
   * makes the same match, but a caller can reach this endpoint without going through it.
   *
   * It still decides nothing about the outcome: it does not resolve a record and does not
   * fall back when the upstream refuses, because what the contributor should do next differs
   * per refusal and a fallback here could only mask one.
   *
   * No `bearerToken` override, unlike the read paths above: the default gateway token is
   * the contributor's own token exchanged for the gateway audience, which is what makes the
   * caller identifiable upstream. This route is blocked during impersonation instead.
   */
  public async bindSigningIdentity(req: Request, githubId: string): Promise<SigningIdentityResponse> {
    const startTime = logger.startOperation(req, 'cla_bind_signing_identity');

    // Derived before the write, not after. If the origin is unusable the hand-off cannot
    // proceed anyway, and this endpoint records an identity attribute on a real record —
    // so failing afterwards would leave that write behind with nothing to show for it.
    const redirectUrl = claReturnUrl(req);

    // Matched on the account number, and the handle taken from the match rather than from the
    // request: a handle is never matched on upstream, so accepting the submitted one would let
    // a correct account be recorded under a handle the contributor does not own. A failed
    // lookup throws out of here rather than yielding an empty list, so this cannot pass by the
    // session's accounts being unreadable.
    const { accounts } = await this.listGithubAccounts(req);
    const chosen = accounts.find((account) => account.githubId === githubId);
    if (!chosen) {
      throw new MicroserviceError('The chosen GitHub account is not linked to this session', 403, 'CLA_ACCOUNT_NOT_LINKED', { service: SERVICE });
    }

    let result: EasyClaSigningIdentity | null;
    try {
      result = await gatewayFetch<EasyClaSigningIdentity>(req, `${claServiceBaseUrl()}/v4/my-clas/signing-identity`, {
        operation: 'cla_bind_signing_identity',
        service: SERVICE,
        errorMessage: 'Failed to record the signing GitHub identity',
        errorCode: 'UPSTREAM_ERROR',
        method: 'POST',
        // The account is sent as a number: it is stored and queried as one upstream, and the
        // endpoint's own model types it as an integer. The handle rides along because it
        // cannot be derived upstream, and a record without one is unmatchable by the
        // approval lists that are written against handles.
        body: { githubId: Number(chosen.githubId), ...(chosen.githubUsername ? { githubUsername: chosen.githubUsername } : {}) },
      });
    } catch (error) {
      // Refusals pass through as refusals, each keeping its own reason. Rethrown rather
      // than handled: what the contributor should do next differs per reason, and only
      // they can act on it.
      throw withSigningIdentityRefusal(error);
    }

    const claUserId = result?.userId?.trim();
    // `== null` rather than `=== undefined`: a JSON null would otherwise reach String() and be
    // returned as the literal "null", which no account can equal.
    if (!claUserId || result?.githubId == null) {
      throw new MicroserviceError('Upstream did not return a recorded signing identity', 502, 'CLA_BINDING_INCOMPLETE', { service: SERVICE });
    }

    logger.success(req, 'cla_bind_signing_identity', startTime, { outcome: result.outcome ?? 'unknown' });
    return {
      claUserId,
      githubId: String(result.githubId),
      githubUsername: result.githubUsername,
      // Returned from the binding rather than fetched by a second call, so the hand-off has
      // no way to assemble a URL before the association exists. The record this hand-off
      // belongs to is the one the binding just confirmed — never whichever record an identity
      // search happens to return first, which is what this endpoint replaced.
      redirectUrl,
    };
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
