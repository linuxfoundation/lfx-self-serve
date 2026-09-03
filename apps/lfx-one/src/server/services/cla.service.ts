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

import { MY_CLAS_PATH } from '@lfx-one/shared/constants';
import {
  Auth0Identity,
  ClaGroupOption,
  ClaGroupSearchResponse,
  EmailManagementData,
  ClaManagerList,
  ClaManagerRequest,
  ClaManagerRequestResult,
  GithubAccountOption,
  GithubAccountOptions,
  MyClaAgreement,
  MyClasResponse,
  PdfUrlResponse,
  PrepareSignResponse,
  type ClaGroupMatchType,
  type ClaGroupOrgSource,
  type ClaSignedVia,
  type ClaStatus,
} from '@lfx-one/shared/interfaces';
import { Request } from 'express';

import {
  EasyClaMyCla,
  EasyClaMyClaList,
  EasyClaMyClaManagerList,
  EasyClaMyClaManagerRequest,
  EasyClaMyClaManagerRequestResult,
  EasyClaMyClaPdf,
  EasyClaPrepareSign,
  EasyClaSearchList,
  EasyClaSearchOrg,
  EasyClaSearchResult,
  RecordedGithubIdentity,
  ResolvedClaIdentity,
} from '../types/cla.types';
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
  // Local-only override so a laptop BFF can talk to a standalone cla-backend-go
  // (see CLA_SERVICE_URL in apps/lfx-one/.env). Do not commit a non-empty value.
  const override = process.env['CLA_SERVICE_URL'];
  if (override) {
    return override.replace(/\/+$/, '');
  }
  const audience = process.env['API_GW_AUDIENCE'];
  if (!audience) {
    throw new MicroserviceError('API_GW_AUDIENCE environment variable is not configured', 503, 'API_GATEWAY_MISCONFIGURED', { service: SERVICE });
  }
  return `${audience.replace(/\/+$/, '')}/cla-service`;
}

// Values the producer's `matchTypes` and `organizations[].source` enums may take. Anything else
// is out of contract and is dropped rather than forwarded: the picker renders each of these with
// its own label and icon, so an unrecognised value would reach the template as a bare string.
const KNOWN_MATCH_TYPES = new Set<string>(['claGroup', 'project', 'organization', 'repository']);
const KNOWN_ORG_SOURCES = new Set<string>(['github', 'gitlab', 'gerrit']);

/** Maps one upstream search result onto the option the picker and the hand-off consume. */
function toClaGroupOption(result: EasyClaSearchResult): ClaGroupOption {
  return {
    claGroupId: result.claGroupID ?? '',
    projectName: result.projectName || undefined,
    claGroupName: result.claGroupName || undefined,
    matchTypes: (result.matchTypes ?? []).filter((type): type is ClaGroupMatchType => KNOWN_MATCH_TYPES.has(type)),
    organizations: (result.organizations ?? [])
      .filter((org): org is EasyClaSearchOrg & { source: ClaGroupOrgSource } => !!org.source && KNOWN_ORG_SOURCES.has(org.source))
      // Some linked GitLab groups carry a URL but no name upstream. Falling back to the URL keeps
      // the org — and its source — in the list; dropping it would undercount "N linked orgs" and
      // hide provenance the contributor is being shown the list to check.
      .map((org) => ({ name: org.name || org.url || '', source: org.source, ...(org.url ? { url: org.url } : {}) }))
      .filter((org) => !!org.name),
    ...(result.matchedRepositoryName ? { matchedRepositoryName: result.matchedRepositoryName } : {}),
    ...(result.matchedRepositoryURL ? { matchedRepositoryURL: result.matchedRepositoryURL } : {}),
    iclaEnabled: result.iclaEnabled === true,
    cclaEnabled: result.cclaEnabled === true,
  };
}

/**
 * Maps `GET /v4/cla-group/search` onto the envelope `GET /api/me/clas/sign-options` returns.
 *
 * The envelope is mirrored rather than flattened to an array because `truncated` describes the
 * result *set* — a cap cannot ride inside one of the results. The one field renamed is the
 * identifier (`claGroupID` → `claGroupId`), so Angular is not made to carry two spellings of the
 * same UUID. Salesforce ids are deliberately not carried across. ICLA/CCLA enablement flags are
 * forwarded for Gerrit contract-type routing (#2066); the GitHub prepare-sign path does not branch on them.
 *
 * `searchTerm` falls back to the term the BFF actually sent, so the client can always tell which
 * query a set belongs to even if the producer echoes nothing.
 */
export function toClaGroupSearchResponse(list: EasyClaSearchList | null, searchTerm = ''): ClaGroupSearchResponse {
  const results = (list?.results ?? []).map(toClaGroupOption);

  return {
    searchTerm: list?.searchTerm ?? searchTerm,
    resultCount: list?.resultCount ?? results.length,
    truncated: list?.truncated === true,
    results,
  };
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

// Identity keys the CLA service reports as `"<type>:<value>"`, both in the verified `identity`
// list and in `skippedIdentities`.
const GITHUB_ID_KEY_PREFIX = 'github-id:';
const GITHUB_USERNAME_KEY_PREFIX = 'github-username:';

/**
 * Reads the verified GitHub account out of a prepare-sign `identity` list.
 *
 * Only `github-id:` answers the question this exists for — whether the account the contributor
 * picked is the account the signing session was opened for. A handle cannot: GitHub lets handles
 * be renamed and reclaimed, so `github-username:octocat` names whoever holds that handle now
 * rather than the account that was chosen. The handle is carried for display and returned
 * alongside, never compared.
 *
 * Null means the answer is unusable, not that verification failed — the caller must refuse to
 * hand off rather than proceed on an unchecked assumption.
 */
export function recordedGithubIdentity(identity: readonly string[] | undefined): RecordedGithubIdentity | null {
  let githubId: string | null = null;
  let githubUsername: string | undefined;

  for (const key of identity ?? []) {
    if (key.startsWith(GITHUB_ID_KEY_PREFIX)) {
      const value = key.slice(GITHUB_ID_KEY_PREFIX.length);
      if (/^\d+$/.test(value)) githubId = value;
    } else if (key.startsWith(GITHUB_USERNAME_KEY_PREFIX)) {
      const value = key.slice(GITHUB_USERNAME_KEY_PREFIX.length).trim();
      if (value) githubUsername = value;
    }
  }

  return githubId === null ? null : { githubId, ...(githubUsername ? { githubUsername } : {}) };
}

/**
 * Whether the CLA service listed the chosen account among the identity keys it did *not* apply.
 *
 * A prepare that skipped the pick still succeeds — it opened a session for whatever identity it
 * did verify. Treating that as success for the skipped account would sign against a different
 * one, so it is a failure here even though the status was 200.
 */
export function githubIdWasSkipped(skippedIdentities: readonly string[] | undefined, githubId: string): boolean {
  return (skippedIdentities ?? []).includes(`${GITHUB_ID_KEY_PREFIX}${githubId}`);
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
const KNOWN_CLA_STATUSES = new Set<string>(['valid', 'needs_attention', 'revoked', 'invalidated', 'unknown', 'superseded']);

const KNOWN_CLA_SIGNED_VIA = new Set<string>(['github', 'gitlab', 'gerrit']);

/** Narrows the wire `status` to `ClaStatus`, or null when it is absent or out of contract. */
function asClaStatus(status: string | undefined): ClaStatus | null {
  return status !== undefined && KNOWN_CLA_STATUSES.has(status) ? (status as ClaStatus) : null;
}

/** Narrows the wire `signedVia` to `ClaSignedVia`, or undefined when absent or unrecognised. */
function asSignedVia(via: string | undefined): ClaSignedVia | undefined {
  return via !== undefined && KNOWN_CLA_SIGNED_VIA.has(via) ? (via as ClaSignedVia) : undefined;
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
    projectSfid: cla.projectSFID?.trim() || undefined,
    foundationSfid: cla.foundationSFID?.trim() || undefined,
    claGroupId: cla.claGroupID?.trim() || undefined,
    claManager: cla.claManager === true,
    companyName: !isIcla ? cla.signingEntityName || cla.companyName || undefined : undefined,
    signedOn: cla.signedOn ?? '',
    signedVia: asSignedVia(cla.signedVia),
    signedAs: cla.signedAs?.trim() || undefined,
    status,
    statusReason,
    documentVersion,
    pdfAvailable: isIcla && cla.pdfAvailable === true,
  };
}

/**
 * The message the CLA service sent with an error, or null when it sent nothing usable.
 *
 * The body arrives as raw text: a non-OK response is not parsed on the way through, so the
 * producer's own words are only reachable from here. Deliberately no reason code is derived
 * from it — the prepare endpoint ships none, and inventing one from substrings of prose would
 * invite per-code copy that the producer never promised to keep stable.
 */
export function producerMessageFrom(errorBody: unknown): string | null {
  const raw = typeof errorBody === 'string' ? errorBody.trim() : null;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as { message?: unknown };
    return typeof parsed.message === 'string' && parsed.message.trim() ? parsed.message.trim() : null;
  } catch {
    // Some refusals ahead of the CLA service (the gateway's own) answer in plain text rather
    // than the shared error shape. Markup is not a message, though: an error page rendered
    // into a toast is noise, and the generic failure copy reads better than its first tag.
    return raw.startsWith('<') ? null : raw;
  }
}

/**
 * Re-labels an ownership refusal with the message the CLA service sent, so that message —
 * rather than "403 Forbidden" — is what the contributor is shown.
 *
 * Scoped to 403 on purpose. That is the one status whose body is a statement about the
 * contributor's own identity and therefore worth repeating verbatim; relaying the prose of a
 * 500 would put upstream internals on screen for something they can do nothing about.
 */
function withProducerRefusalMessage(error: unknown): unknown {
  if (!(error instanceof MicroserviceError) || error.statusCode !== 403) return error;

  const message = producerMessageFrom(error.errorBody);
  if (!message) return error;

  return new MicroserviceError(message, error.statusCode, error.code, {
    operation: 'cla_prepare_sign',
    service: SERVICE,
    errorBody: error.errorBody,
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
   * Searches CLA Groups by project name, CLA group name, linked organization, or a pasted
   * repository URL via `GET /v4/cla-group/search` (#1250), and maps the producer's envelope onto
   * the one `GET /api/me/clas/sign-options` returns.
   *
   * Runs on the default gateway token with no impersonation branch. Unlike `/v4/my-clas` and the
   * PDF download, this call carries no identity: it asks which CLA Groups exist, not which ones
   * belong to anybody, so there is no ownership check upstream for a token swap to satisfy.
   *
   * The caller is responsible for the minimum term length — see `getClaGroupOptions`.
   */
  public async searchClaGroups(req: Request, searchTerm: string): Promise<ClaGroupSearchResponse> {
    const startTime = logger.startOperation(req, 'cla_search_cla_groups');

    const params = new URLSearchParams({ searchTerm });
    const list = await gatewayFetch<EasyClaSearchList>(req, `${claServiceBaseUrl()}/v4/cla-group/search?${params.toString()}`, {
      operation: 'cla_search_cla_groups',
      service: SERVICE,
      errorMessage: 'Failed to search CLA groups',
      errorCode: 'UPSTREAM_ERROR',
    });

    const envelope = toClaGroupSearchResponse(list, searchTerm);

    logger.success(req, 'cla_search_cla_groups', startTime, { result_count: envelope.resultCount, truncated: envelope.truncated });
    return envelope;
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
   * Asks the CLA service to open a signing session for the contributor's chosen GitHub account,
   * and returns the Contributor Console address it wants them sent to (#1252).
   *
   * Ownership is the CLA service's to establish: it verifies the submitted identity belongs to
   * the caller before it writes anything. This layer still matches the chosen account against
   * the accounts the identity provider reports for this session, for two narrower reasons — to
   * fail a number that is not linked without spending an upstream round trip, and to supply the
   * handle. The handle matters because the producer resolves it live through GitHub and admits
   * the number only if the two agree, so a caller able to name a handle could pair a number
   * they own with a handle they do not. A failed lookup throws rather than yielding an empty
   * list, so this cannot be passed by the session's accounts being unreadable.
   *
   * It decides nothing about the outcome beyond refusing to hand off an answer that does not
   * name the chosen account: what the contributor should do next after a refusal is theirs, and
   * a fallback here could only mask it.
   *
   * No `bearerToken` override, unlike the read paths above: the default gateway token is the
   * contributor's own token exchanged for the gateway audience, which is what makes the caller
   * identifiable upstream. This route is blocked during impersonation instead.
   */
  public async prepareSign(req: Request, githubId: string, claGroupId: string): Promise<PrepareSignResponse> {
    const startTime = logger.startOperation(req, 'cla_prepare_sign', { cla_group_id: claGroupId });

    // Derived before the call, not after. The CLA service stores this value on the signing
    // session and later redirects to it verbatim, so an unusable origin dead-ends the flow
    // anyway — and failing afterwards would leave that session behind with nowhere to return to.
    const returnUrl = claReturnUrl(req);

    const { accounts } = await this.listGithubAccounts(req);
    const chosen = accounts.find((account) => account.githubId === githubId);
    if (!chosen) {
      throw new MicroserviceError('The chosen GitHub account is not linked to this session', 403, 'CLA_ACCOUNT_NOT_LINKED', { service: SERVICE });
    }

    let result: EasyClaPrepareSign | null;
    try {
      result = await gatewayFetch<EasyClaPrepareSign>(req, `${claServiceBaseUrl()}/v4/self-serve/prepare-sign`, {
        operation: 'cla_prepare_sign',
        service: SERVICE,
        errorMessage: 'Failed to prepare the CLA signing session',
        errorCode: 'UPSTREAM_ERROR',
        method: 'POST',
        // The account goes as a number: it is stored and queried as one upstream, and the
        // endpoint's own model types it as an integer.
        body: {
          claGroupId,
          returnUrl,
          githubId: Number(chosen.githubId),
          ...(chosen.githubUsername ? { githubUsername: chosen.githubUsername } : {}),
        },
      });
    } catch (error) {
      throw withProducerRefusalMessage(error);
    }

    const userId = result?.userId?.trim();
    const signUrl = result?.signUrl?.trim();
    // The verified account is parsed out of `identity` rather than assumed to be the one sent.
    // Without it there is nothing to check the pick against, which is not a success.
    const recorded = recordedGithubIdentity(result?.identity);
    const skippedIdentities = result?.skippedIdentities ?? [];

    if (!userId || !signUrl || !recorded) {
      throw new MicroserviceError('Upstream prepared no usable signing session', 502, 'CLA_BINDING_INCOMPLETE', { service: SERVICE });
    }

    // A prepare that skipped the chosen account still opened a session — for whatever identity
    // it did verify. Passing that on as success would sign against an account nobody picked.
    if (githubIdWasSkipped(skippedIdentities, chosen.githubId)) {
      throw new MicroserviceError('Upstream did not apply the chosen GitHub account', 502, 'CLA_BINDING_INCOMPLETE', { service: SERVICE });
    }

    const githubUsername = recorded.githubUsername ?? result?.githubUsername;

    logger.success(req, 'cla_prepare_sign', startTime, {
      cla_group_id: claGroupId,
      user_created: result?.userCreated === true,
      skipped_count: skippedIdentities.length,
    });
    return {
      userId,
      // The producer's address, passed through unchanged. It owns the session this belongs to,
      // so a second address composed here would ignore whatever that session carries.
      signUrl,
      githubId: recorded.githubId,
      ...(githubUsername ? { githubUsername } : {}),
      skippedIdentities,
    };
  }

  /**
   * CLA managers of the CCLA covering an owned ECLA (`GET /v4/my-clas/{id}/cla-managers`).
   * EasyCLA 404s unknown, not-owned, and ICLA ids — those become null here, same as PDF,
   * so the controller never turns a miss into an empty list the modal would treat as
   * "no manager reachable".
   */
  public async getClaManagers(req: Request, signatureId: string, identity: ResolvedClaIdentity): Promise<ClaManagerList | null> {
    const startTime = logger.startOperation(req, 'cla_get_cla_managers', { signature_id: signatureId });
    const params = this.identityQuery(identity);

    let result: EasyClaMyClaManagerList | null;
    try {
      result = await gatewayFetch<EasyClaMyClaManagerList>(
        req,
        `${claServiceBaseUrl()}/v4/my-clas/${encodeURIComponent(signatureId)}/cla-managers?${params.toString()}`,
        {
          operation: 'cla_get_cla_managers',
          service: SERVICE,
          errorMessage: 'Failed to fetch CLA managers',
          errorCode: 'UPSTREAM_ERROR',
          bearerToken: isImpersonating(req) ? req.bearerToken : undefined,
        }
      );
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 404) return null;
      throw error;
    }

    if (!result) return null;

    const managers = (result.managers ?? [])
      .map((manager) => ({
        lfUsername: manager.lfUsername?.trim() ?? '',
        ...(manager.name?.trim() ? { name: manager.name.trim() } : {}),
        ...(manager.email?.trim() ? { email: manager.email.trim() } : {}),
      }))
      .filter((manager) => manager.lfUsername.length > 0);

    logger.success(req, 'cla_get_cla_managers', startTime, { manager_count: managers.length });
    return {
      signatureId: result.signatureID?.trim() || signatureId,
      managers,
      resultCount: managers.length,
    };
  }

  /**
   * Records an approval, removal, or contact request and emails the selected CLA managers
   * (`POST /v4/my-clas/{id}/cla-manager-requests`). Does not change signature state.
   * 404 (unknown / not-owned / ICLA) becomes null, matching getClaManagers.
   *
   * The message is passed through as given. A contact request needs a non-blank one — the
   * producer rejects an empty message for that type — and the controller enforces it, so a
   * blank one is not quietly dropped here into a request the producer will refuse.
   *
   * No bearerToken override: this is a write, blocked at the route during impersonation,
   * so the default gateway token is the caller EasyCLA should attribute.
   */
  public async createClaManagerRequest(
    req: Request,
    signatureId: string,
    identity: ResolvedClaIdentity,
    request: ClaManagerRequest
  ): Promise<ClaManagerRequestResult | null> {
    const startTime = logger.startOperation(req, 'cla_create_cla_manager_request', {
      signature_id: signatureId,
      request_type: request.requestType,
    });
    const params = this.identityQuery(identity);

    const body: EasyClaMyClaManagerRequest = {
      requestType: request.requestType,
      recipients: request.recipients,
      ...(request.message ? { message: request.message } : {}),
    };

    let result: EasyClaMyClaManagerRequestResult | null;
    try {
      result = await gatewayFetch<EasyClaMyClaManagerRequestResult>(
        req,
        `${claServiceBaseUrl()}/v4/my-clas/${encodeURIComponent(signatureId)}/cla-manager-requests?${params.toString()}`,
        {
          operation: 'cla_create_cla_manager_request',
          service: SERVICE,
          errorMessage: 'Failed to send the CLA manager request',
          errorCode: 'UPSTREAM_ERROR',
          method: 'POST',
          body,
        }
      );
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 404) return null;
      throw error;
    }

    const requestId = result?.requestID?.trim();
    const requestType = result?.requestType;
    const status = result?.status;
    if (!requestId || requestType !== request.requestType || (status !== 'sent' && status !== 'recorded')) {
      throw new MicroserviceError('Upstream recorded no usable CLA manager request', 502, 'UPSTREAM_ERROR', { service: SERVICE });
    }

    logger.success(req, 'cla_create_cla_manager_request', startTime, { request_type: requestType, status });
    return {
      requestId,
      signatureId: result?.signatureID?.trim() || signatureId,
      requestType,
      status,
      recipients: result?.recipients ?? request.recipients,
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
