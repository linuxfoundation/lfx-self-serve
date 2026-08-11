// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { JOB_LOST_MESSAGE } from '@lfx-one/shared/constants';
import type {
  ApiResponse,
  CampaignBriefLoadResult,
  CampaignBriefOutput,
  CampaignBriefPersistResult,
  CampaignEventDetails,
  CampaignGoal,
  CampaignJobStatus,
  CampaignKeyword,
  CampaignPlatform,
  CampaignPlatformResult,
  CampaignProgramType,
  LinkedInBriefCopy,
  MetaBriefCopy,
  RedditBriefCopy,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { MicroserviceError } from '../errors/microservice.error';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * `job-poll-response` as lfx-v2-campaign-service publishes it (`design/brief.go`).
 *
 * Declared here rather than in `@lfx-one/shared` on purpose: it is the WIRE shape of another
 * service, not a type this application exchanges between its own tiers. Putting it in the
 * shared package would invite a component to import it, and then a contract change upstream
 * would reach the browser instead of stopping at the adapter below.
 */
interface CampaignServiceJobPollResponse {
  job_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed';
  result?: {
    platform: string;
    ok: boolean;
    campaign_id?: string;
    error?: string;
  }[];
  error?: string;
}

/**
 * `brief-input` as lfx-v2-campaign-service accepts it (`design/brief.go`), and `brief` as it
 * returns it. Local for the same reason as `CampaignServiceJobPollResponse` above.
 *
 * Four fields are `Any` in the Goa design — `event_details`, `copy`, `keywords`, `targeting` —
 * so the service stores whatever JSON it is handed and validates none of it. They are typed
 * `unknown`-ish here rather than mirrored from `CampaignBriefOutput`, because the adapter below
 * is the only thing that decides their shape and pinning them would make a UI-side field rename
 * look like a service contract change.
 */
interface CampaignServiceBriefInput {
  program_type: string;
  event_slug: string;
  url?: string;
  platforms?: string[];
  event_details?: Record<string, unknown>;
  copy?: Record<string, unknown>;
  keywords?: unknown;
  targeting?: Record<string, unknown>;
}

/**
 * `brief` as campaign-service returns it in the response BODY.
 *
 * No `etag` field, deliberately: the design maps it to the `ETag` HTTP header on every brief
 * response, so Goa leaves it out of the generated body struct. Declaring it here would compile
 * and read `undefined` forever. `readEtag` takes it off the headers instead.
 *
 * The four content fields are declared here as well as on the input above, because the read
 * path needs them: `Brief` inherits `event_details`, `copy`, `keywords` and `targeting` from
 * `BriefData` via `Reference`, so a find returns everything a save wrote. They stay `unknown`-ish
 * for the same reason as on the input — the service validates none of them, so a value coming
 * back is not evidence of its shape and the adapter has to check rather than trust.
 */
interface CampaignServiceBrief {
  id: string;
  project_id: string;
  program_type: string;
  event_slug: string;
  status: string;
  version: number;
  url?: string;
  platforms?: string[];
  event_details?: unknown;
  copy?: unknown;
  keywords?: unknown;
  targeting?: unknown;
}

/**
 * The wrapper both `create-brief` and `update-brief` require around the payload.
 *
 * The body is `{"brief": {…}}`, NOT the brief object itself. Goa builds the request body from
 * the payload attributes that are not mapped to the path, headers or query, and the design
 * declares `Attribute("brief", BriefInput)` without a `Body("brief")` override — so the
 * attribute name survives into the wire format. Posting a bare brief object produces a 400 on
 * every required field at once, which reads like a mapping bug rather than a missing wrapper.
 */
interface CampaignServiceBriefEnvelope {
  brief: CampaignServiceBriefInput;
}

/**
 * The canonical slug for The Linux Foundation's own project row.
 *
 * Used ONLY by `getJobStatus`, and only because campaign-creation has not been cut over yet.
 * An earlier revision of this comment claimed `/foundation/campaigns` is "a fixed route with no
 * project or slug segment", LF-scoped by construction. That is wrong: the route carries
 * `projectQueryParamGuard` and the sidebar preserves `?project=<slug>`, so an ED of any
 * foundation reaches the page with their own foundation selected. Anything that WRITES must
 * take the slug from that context — see `saveBrief` — or it files a CNCF ED's work under TLF.
 *
 * The job poll keeps the constant because it is currently unreachable with a real id:
 * `isCampaignServiceJobId` only routes UUIDs here, and no UUID job can exist until creation
 * goes through campaign-service. Phase 3 cuts creation over and must thread the slug through
 * both the create and the poll in the same change, at which point this constant goes away.
 *
 * Not 'the-linux-foundation' — 'tlf' is the canonical form; the longer spelling resolves to
 * nothing. It goes on the wire AS THE SLUG, deliberately un-resolved: campaign-service's
 * `create-brief` accepts a slug ONLY — its `project_id` carries `Pattern(^[a-z0-9]+(-[a-z0-9]+)*$)`,
 * which a UUID fails — and it stores exactly that string in `campaign_briefs.project_id`.
 * `GetJob` then scopes by joining `b.project_id = $2` with an EXACT comparison, so a job
 * written under `tlf` is invisible to a poll made under the project's uid. Resolving the slug
 * to a uid here would look more canonical and find nothing.
 */
const LF_PROJECT_SLUG = 'tlf';

/**
 * True when `jobId` is a job campaign-service could possibly know about.
 *
 * The flag alone is not a safe router, and this is the reason. Campaign CREATION has not been
 * cut over: `campaign-proxy.service.ts` still mints `job_<epoch>_<rand>` ids into an in-process
 * `Map`. campaign-service's `get-job` declares `Format(FormatUUID)` on `job_id`, so such an id
 * is rejected by the request decoder with a 400 before any lookup happens — and even without
 * that validation there is no row to find, because nothing created one. Routing purely on the
 * flag would therefore break every poll the moment the flag went on, which is the exact failure
 * the flag exists to fix.
 *
 * Routing on the id's SHAPE is safe in both directions and needs no second flag: a `job_` id can
 * only have come from this process, and a UUID can only have come from campaign-service. When
 * creation is cut over, new ids become UUIDs and start taking the new path on their own; ids
 * minted before the cutover keep resolving against the map that holds them.
 */
export function isCampaignServiceJobId(jobId: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId);
}

/**
 * Client for lfx-v2-campaign-service.
 *
 * Separate from `campaign-proxy.service.ts` on purpose: that file talks to the VENDOR APIs
 * (Google Ads, Meta Graph, LinkedIn, Reddit, HubSpot) with credentials held in this tier,
 * and it is what the cutover retires. Keeping the two apart means each endpoint's migration
 * is an addition here plus a branch at the call site, and a rollback is the flag alone —
 * rather than an edit tangled through the vendor code that has to be reverted by hand.
 */
export class CampaignServiceClient {
  private readonly microserviceProxy: MicroserviceProxyService;

  public constructor(microserviceProxy?: MicroserviceProxyService) {
    this.microserviceProxy = microserviceProxy ?? new MicroserviceProxyService();
  }

  /**
   * Read a campaign-creation job's status.
   *
   * The path this replaces keeps jobs in an in-process `Map`
   * (`campaign-proxy.service.ts`), which only works while every poll happens to land on the
   * pod that started the job — the code already logs that symptom by name. campaign-service
   * persists jobs, so this survives a replica switch.
   *
   * An upstream 404 becomes `not_found`, not a thrown error, because that is what the path
   * being replaced returns for an unknown job — and the poller has an arm for it
   * (`campaign.service.ts` renders "Lost connection to the campaign creation process"). A
   * flagged cutover whose two sides disagree on a reachable outcome is not a cutover; it is a
   * second behaviour hidden behind an environment variable, and the difference would surface
   * only for the expired-job case nobody exercises before shipping.
   *
   * ONLY campaign-service's OWN 404, and the distinction matters most during the cutover this
   * flag gates. A bare `statusCode === 404` also catches a 404 the GATEWAY produced because the
   * campaign-service route is absent or misrouted — the single most likely way the cutover fails
   * on first deploy. Because `not_found` is terminal for the poller, that misconfiguration would
   * be reported to the user as a lost campaign and the real fault would never surface. So the
   * translation requires the typed body campaign-service returns for an unknown job,
   * `{"code":"404","message":...}` (its Goa `not-found-error`, populated at
   * `internal/service/brief.go`: `&briefs.NotFoundError{Code: "404", ...}`). Traefik's own 404 is
   * plain text, which `api-client.service.ts` leaves as a null `errorBody`, so it cannot pass.
   *
   * Every other failure — a 401, a 503, a gateway timeout, an untyped 404 — is rethrown, because
   * those mean the status is UNKNOWN, and reporting unknown as `not_found` would tell the user
   * their campaign creation was lost when it may be running perfectly well. Note the asymmetry is
   * deliberate: if campaign-service ever changes that body shape, a real expired job surfaces as
   * an error rather than as a false "lost" — loud instead of quietly wrong.
   */
  public async getJobStatus(req: Request, jobId: string): Promise<CampaignJobStatus> {
    try {
      const response = await this.microserviceProxy.proxyRequest<CampaignServiceJobPollResponse>(
        req,
        'LFX_V2_CAMPAIGN_SERVICE',
        `/projects/${encodeURIComponent(LF_PROJECT_SLUG)}/jobs/${encodeURIComponent(jobId)}`,
        'GET'
      );
      return adaptJobPollResponse(response);
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 404 && isCampaignServiceNotFound(error.errorBody)) {
        return { status: 'not_found', error: JOB_LOST_MESSAGE };
      }
      throw error;
    }
  }

  /**
   * Save the generated brief, creating it the first time and replacing it thereafter.
   *
   * campaign-service has no upsert, so this is find-then-create-or-update, and the find is not
   * an optimisation — it is how the second save of an event reaches `update-brief` at all.
   * `create-brief` cannot produce a duplicate: migration 000003 puts a partial unique index on
   * `(project_id, event_slug) WHERE status <> 'archived'`, and `CreateBrief` maps that violation
   * to `ErrConflict` -> 409. Without the find, every save after the first would simply 409. The
   * 404 arm is the documented happy path, not an error: `design/brief.go:302` calls it "the
   * ordinary first-time-generation case".
   *
   * The 404 is gated on campaign-service's own typed body for the same reason `getJobStatus`
   * gates its own, and the consequence here is worse. A gateway 404 — the campaign-service route
   * absent or misrouted, the single most likely first-deploy failure — read as "no brief yet"
   * would send this to `create-brief` on every save, and the moment the route came up the user
   * would have one brief row per attempt.
   *
   * There is no retry on `PreconditionFailed`. A 412 means another writer replaced this brief
   * between the find and the PUT; re-reading and overwriting would silently discard their work.
   * The user is told instead — see the caller.
   *
   * `projectSlug` is the foundation the user has selected, NOT a constant. `/foundation/campaigns`
   * is reachable by an ED of any foundation (`executiveDirectorGuard` gates on persona, and
   * `projectQueryParamGuard` seeds the context from `?project=`), while campaign-service scopes
   * and authorises every brief on its project. Hard-coding `tlf` would either 403 a CNCF ED or —
   * for an LF staffer who also holds TLF access — file their CNCF work in TLF's brief table,
   * where the partial unique index on `(project_id, event_slug)` then collides it with unrelated
   * TLF work for the same event.
   */
  public async saveBrief(req: Request, brief: CampaignBriefOutput, eventSlug: string, projectSlug: string): Promise<CampaignBriefPersistResult> {
    const basePath = `/projects/${encodeURIComponent(projectSlug)}/briefs`;
    const envelope: CampaignServiceBriefEnvelope = { brief: toBriefInput(brief, eventSlug) };
    const existing = await this.findBrief(req, basePath, eventSlug);

    if (existing === null) {
      const created = await this.microserviceProxy.proxyRequestWithResponse<CampaignServiceBrief>(
        req,
        'LFX_V2_CAMPAIGN_SERVICE',
        basePath,
        'POST',
        undefined,
        envelope
      );
      return this.approveBrief(req, basePath, created, true);
    }

    // `update-brief` declares `PreconditionRequired` (428) for a missing `If-Match`, and the
    // version number is NOT a substitute: the design says the ETag "mirrors" the version, which
    // fixes the correspondence but not the serialisation — quoting, weak-validator prefix and
    // all. Synthesising one would be a guess that either 428s or, worse, matches the wrong
    // revision. Fail loudly instead.
    if (existing.etag === null) {
      throw new Error(`campaign-service returned brief ${existing.brief.id} with no ETag; cannot safely replace it`);
    }

    const updated = await this.microserviceProxy.proxyRequestWithResponse<CampaignServiceBrief>(
      req,
      'LFX_V2_CAMPAIGN_SERVICE',
      `${basePath}/${encodeURIComponent(existing.brief.id)}`,
      'PUT',
      undefined,
      envelope,
      { 'If-Match': existing.etag }
    );
    return this.approveBrief(req, basePath, updated, false);
  }

  /**
   * Move the brief just written from `draft` to `approved`, and report the result of the save.
   *
   * campaign-service creates every brief as `draft`, and `replaceBriefQuery` deliberately resets
   * an existing one to `draft` on every PUT — its comment says why: "a modified brief cannot
   * silently retain status='approved' (which would let changed ad inputs be treated as approved
   * and dispatched without re-review)". So a save on its own always leaves the row unapproved.
   *
   * That is not a durable record of what happened. This save is triggered by the user reviewing
   * the generated brief and choosing to proceed to Implementation — an approval, in the product's
   * own terms — and downstream campaign-service refuses to act on anything else: `create-campaigns`
   * and `build-audience` both gate on `status = 'approved'` at a specific version. Leaving the row
   * in `draft` would mean Phase 3 could not create a campaign from the very brief the user
   * approved. Approving immediately after the write is also exactly the case the repo's warning
   * permits: the content being approved is the content just sent, not a stale snapshot.
   *
   * `If-Match` is the validator from the write, which is why this takes the whole response rather
   * than an id: `approve-brief` declares `PreconditionRequired` for a missing one, and every write
   * response carries the fresh ETag in its header. A write that answered without one cannot be
   * approved — reported as `approved: false` rather than guessed at, for the same reason
   * `saveBrief` refuses to synthesise an `If-Match` above.
   *
   * A failed approval is NOT a failed save, and is not reported as one. The brief is durable at
   * this point; telling the user it could not be saved would be false, and would push them to
   * regenerate a brief that is sitting in the database. It is surfaced instead as `approved:
   * false` on the result plus a warning log, and Phase 3 — which has to re-check approval at a
   * version anyway, since anyone may have edited the brief in between — can re-approve.
   */
  private async approveBrief(
    req: Request,
    basePath: string,
    written: ApiResponse<CampaignServiceBrief>,
    created: boolean
  ): Promise<CampaignBriefPersistResult> {
    const briefId = written.data.id;
    const writeEtag = readEtag(written);
    const saved = { enabled: true as const, briefId, created };

    if (writeEtag === null) {
      logger.warning(req, 'campaign_persist_brief_approve', 'campaign-service returned no ETag for the written brief; leaving it in draft', {
        briefId,
      });
      return { ...saved, etag: null, approved: false };
    }

    try {
      const approved = await this.microserviceProxy.proxyRequestWithResponse<CampaignServiceBrief>(
        req,
        'LFX_V2_CAMPAIGN_SERVICE',
        `${basePath}/${encodeURIComponent(briefId)}/approve`,
        'POST',
        undefined,
        undefined,
        { 'If-Match': writeEtag }
      );
      return { ...saved, etag: readEtag(approved), approved: true };
    } catch (error) {
      logger.warning(req, 'campaign_persist_brief_approve', 'brief was saved but could not be approved', {
        briefId,
        error: error instanceof Error ? error.message : String(error),
      });
      // The write's own validator, not null: it is still the current one, because the approve
      // that would have bumped the version is precisely what failed.
      return { ...saved, etag: writeEtag, approved: false };
    }
  }

  /**
   * Read back the brief saved for this event slug.
   *
   * The inverse of `saveBrief`, and it reuses the same find so the two agree on what "no brief"
   * means — including the 404 gating. A gateway 404 read as "none" would be worse here than a
   * thrown error: the page would silently offer a blank Planning tab for an event that already
   * has an approved brief, and the first save after that is an UPDATE that replaces it.
   *
   * `unreadable` rather than `none` when the row cannot be mapped back, for the same reason. The
   * three outcomes are the caller's to render; see `CampaignBriefLoadResult`.
   */
  public async loadBrief(req: Request, eventSlug: string): Promise<CampaignBriefLoadResult> {
    const basePath = `/projects/${encodeURIComponent(LF_PROJECT_SLUG)}/briefs`;
    const found = await this.findBrief(req, basePath, eventSlug);

    if (found === null) {
      return { status: 'none', briefId: null, brief: null };
    }

    // `found.etag` is deliberately dropped. It is the write path's concurrency token, and this
    // read hands its result to a component that may sit on it for minutes before the user
    // restores anything — by which time the validator would be stale. The save path re-reads it
    // at the moment it needs one, so carrying a copy here could only ever be the wrong copy.
    const brief = fromBriefResponse(found.brief);
    return brief === null
      ? { status: 'unreadable', briefId: found.brief.id, brief: null }
      : { status: 'loaded', briefId: found.brief.id, brief };
  }

  /**
   * The saved brief for this event slug and its ETag, or `null` when there is none.
   *
   * `proxyRequestWithResponse`, not `proxyRequest`, and that is the whole point of this helper:
   * the ETag is NOT in the JSON body. Every brief response in the design maps it to the HTTP
   * header instead — `Response(StatusOK, func() { Header("etag:ETag") })` — so Goa omits it from
   * the generated response body struct (`gen/http/.../server/types.go`,
   * `FindBriefResponseBody` has no ETag field). Reading `data.etag` yields `undefined` every
   * time, which would make the second save of any event throw on the guard above rather than
   * issue its PUT.
   */
  private async findBrief(req: Request, basePath: string, eventSlug: string): Promise<{ brief: CampaignServiceBrief; etag: string | null } | null> {
    try {
      const response = await this.microserviceProxy.proxyRequestWithResponse<CampaignServiceBrief>(req, 'LFX_V2_CAMPAIGN_SERVICE', basePath, 'GET', {
        event_slug: eventSlug,
      });
      return { brief: response.data, etag: readEtag(response) };
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 404 && isCampaignServiceNotFound(error.errorBody)) {
        return null;
      }
      throw error;
    }
  }
}

/**
 * The `ETag` response header, or `null` when the response carried none.
 *
 * Lower-case key without a fallback: `api-client.service.ts` builds this map with
 * `Object.fromEntries(response.headers.entries())` over a fetch `Headers`, and the Fetch
 * standard requires that iteration to yield lower-cased names. A `headers['ETag']` fallback
 * would be unreachable code that implies the casing is uncertain.
 */
function readEtag(response: ApiResponse<unknown>): string | null {
  const etag = response.headers['etag'];
  return typeof etag === 'string' && etag.length > 0 ? etag : null;
}

/**
 * The event slug to file this brief under, or `null` when the brief carries none.
 *
 * `find-brief` and `BriefInput` both declare `MinLength(1)` on `event_slug`, and the Planning
 * tab can reach here with an empty one: when the scrape produced no `eventDetails`, it
 * synthesises them and derives the slug from the pasted URL's last path segment, which is `''`
 * for a bare origin or an unparseable string. Posting that is a 400 whose message names a field
 * the user never filled in. Catching it here lets the caller say what actually went wrong.
 *
 * Trimming DETECTS an empty slug; it deliberately does not rewrite the value sent upstream. The
 * slug is the lookup key for every later find, so normalising it here and not in whatever writes
 * the next one would make the two disagree.
 */
export function deriveEventSlug(brief: CampaignBriefOutput): string | null {
  const slug = brief.eventDetails?.slug ?? '';
  return slug.trim().length > 0 ? slug : null;
}

/**
 * Map the UI's brief onto `brief-input`.
 *
 * `event_details`, `copy`, `keywords` and `targeting` are `Any` in the design — the service
 * stores them opaquely — so this is the only place their shape is decided, and it is chosen to
 * round-trip: everything the Implementation tab reads off `CampaignBriefOutput` must survive a
 * save and a reload.
 *
 * `targeting` carries the campaign-level planning fields — goal, budget, the HubSpot UTM and the
 * Drive folder. `BriefInput` has no first-class home for them, and dropping them would make a
 * reloaded brief quietly less complete than the one the user approved. They are grouped under
 * `targeting` because it is the only opaque slot whose meaning ("how this campaign is aimed and
 * paid for") they fit; if the design later grows real fields for them, this is the one function
 * that moves.
 */
function toBriefInput(brief: CampaignBriefOutput, eventSlug: string): CampaignServiceBriefInput {
  return {
    // `CampaignProgramType` is `events | education`; the service's enum is
    // `events | education | membership`. Every UI value is accepted as-is and `membership` is
    // simply unreachable from here. The default matches the Planning tab's own default.
    program_type: brief.programType ?? 'events',
    event_slug: eventSlug,
    url: brief.eventDetails?.registrationUrl || undefined,
    platforms: brief.selectedPlatforms,
    event_details: brief.eventDetails ? { ...brief.eventDetails } : undefined,
    copy: {
      structured: brief.structuredCopy,
      linkedIn: brief.linkedInCopy ?? null,
      reddit: brief.redditCopy ?? null,
      meta: brief.metaCopy ?? null,
    },
    keywords: brief.keywords,
    targeting: {
      campaignGoal: brief.campaignGoal,
      totalBudget: brief.totalBudget,
      hsUtm: brief.hsUtm,
      driveFolderUrl: brief.driveFolderUrl,
    },
  };
}

/**
 * Rebuild the UI's brief from a stored one — the exact inverse of `toBriefInput`.
 *
 * Returns `null` for a row this build cannot represent, which the caller reports as
 * `unreadable`. Everything here is defensive because the four fields it reads are `Any`
 * upstream: the service validated none of them on the way in, so a value coming back is not
 * evidence of its shape. It may also have been written by an OLDER build of this file.
 *
 * The line between "coerce" and "give up" is drawn at what the Implementation tab requires.
 * `eventDetails` is non-optional on `CampaignBriefOutput` and every tab reads off it, so a row
 * without a usable one is genuinely unopenable — that is the only `null` this returns for a
 * brief that came from this UI. A missing keyword list, on the other hand, costs the user a
 * section, not the brief, so it degrades to `[]`.
 *
 * The other `null` is `program_type`: the service's enum has `membership`, `CampaignProgramType`
 * does not, and the whole page is built around the two it has. Silently rendering a membership
 * brief as an events one would show the wrong labels, the wrong URL help and the wrong goal
 * list for a brief someone else's client wrote. Unreachable from here today — `toBriefInput`
 * can only ever send `events` or `education` — which is exactly why it must not be assumed.
 */
export function fromBriefResponse(found: CampaignServiceBrief): CampaignBriefOutput | null {
  const eventDetails = asEventDetails(found.event_details);
  if (eventDetails === null) {
    return null;
  }

  if (found.program_type !== 'events' && found.program_type !== 'education') {
    return null;
  }

  const copy = asRecord(found.copy) ?? {};
  const targeting = asRecord(found.targeting) ?? {};

  return {
    eventDetails,
    programType: found.program_type as CampaignProgramType,
    // Narrowed against the union rather than passed through: an unknown platform id reaches a
    // template that indexes icon and label maps by it, and renders blank rather than erroring.
    selectedPlatforms: (found.platforms ?? []).filter((p): p is CampaignPlatform => CAMPAIGN_PLATFORM_IDS.includes(p as CampaignPlatform)),
    structuredCopy: asRecord(copy['structured']),
    linkedInCopy: asVariantCopy<LinkedInBriefCopy>(copy['linkedIn']),
    redditCopy: asVariantCopy<RedditBriefCopy>(copy['reddit']),
    metaCopy: asVariantCopy<MetaBriefCopy>(copy['meta']),
    keywords: asKeywords(found.keywords),
    campaignGoal: CAMPAIGN_GOAL_IDS.includes(targeting['campaignGoal'] as CampaignGoal) ? (targeting['campaignGoal'] as CampaignGoal) : null,
    totalBudget: typeof targeting['totalBudget'] === 'number' && Number.isFinite(targeting['totalBudget']) ? targeting['totalBudget'] : null,
    hsUtm: typeof targeting['hsUtm'] === 'string' ? targeting['hsUtm'] : null,
    driveFolderUrl: typeof targeting['driveFolderUrl'] === 'string' ? targeting['driveFolderUrl'] : '',
  };
}

/** The platform ids the page can render. Kept next to the only thing that filters against it. */
const CAMPAIGN_PLATFORM_IDS: readonly CampaignPlatform[] = ['google-ads', 'microsoft-ads', 'linkedin-ads', 'meta-ads', 'reddit-ads', 'twitter-ads'];

const CAMPAIGN_GOAL_IDS: readonly CampaignGoal[] = ['conversions', 'brand-awareness', 'traffic', 'lead-generation', 'engagement'];

/** A plain JSON object, or `null` for anything else — arrays and `null` included. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asTextList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

/**
 * `event_details` as a `CampaignEventDetails`, or `null` when there is nothing usable.
 *
 * Every field is coerced rather than required, because `CampaignEventDetails` is what the SCRAPE
 * produced and the scrape is best-effort — a brief saved from a page with no listed speakers has
 * an empty `speakers`, and a brief saved by an older build may not have `formatNotes` at all.
 * Rejecting those would report a perfectly good brief as unreadable.
 *
 * The one thing that IS required is a name or a slug. With neither, the object carries no
 * identity: the Implementation tab's campaign names are built from them, and the reload would
 * present an unnamed event the user cannot recognise as theirs.
 */
function asEventDetails(value: unknown): CampaignEventDetails | null {
  const details = asRecord(value);
  if (details === null) {
    return null;
  }

  const name = asText(details['name']);
  const slug = asText(details['slug']);
  if (name.trim().length === 0 && slug.trim().length === 0) {
    return null;
  }

  return {
    name,
    slug,
    dates: asText(details['dates']),
    city: asText(details['city']),
    countryCode: asText(details['countryCode']),
    audience: asText(details['audience']),
    themes: asTextList(details['themes']),
    registrationUrl: asText(details['registrationUrl']),
    speakers: asTextList(details['speakers']),
    formatNotes: asText(details['formatNotes']),
  };
}

/**
 * One of the three per-platform copy blocks, or `undefined` when it is absent or unusable.
 *
 * `variants` is the discriminator: all three types have one, every consumer iterates it, and a
 * block without it would reach a template that does `@for (v of copy.variants)`. Their INNER
 * shape is not validated — doing so would restate the generator's schema in a second place, and
 * the fields are rendered as text, so a missing one is a blank line rather than a crash.
 *
 * `undefined` and not `null`: all three are optional on `CampaignBriefOutput`, and absent is
 * exactly what a brief generated for a different platform set looks like.
 */
function asVariantCopy<T>(value: unknown): T | undefined {
  const block = asRecord(value);
  return block !== null && Array.isArray(block['variants']) ? (block as T) : undefined;
}

/**
 * The keyword table, dropping entries that carry no term.
 *
 * `matchType` and `intentLevel` fall back to their broadest values rather than dropping the row:
 * they drive a filter chip and a sort, so a wrong one costs ordering, while a dropped keyword
 * costs the user research they already paid for.
 */
function asKeywords(value: unknown): CampaignKeyword[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.reduce<CampaignKeyword[]>((keywords, entry) => {
    const record = asRecord(entry);
    const term = asText(record?.['term']);
    if (record === null || term.trim().length === 0) {
      return keywords;
    }

    const matchType = record['matchType'];
    const intentLevel = record['intentLevel'];
    keywords.push({
      term,
      matchType: matchType === 'Exact' || matchType === 'Phrase' ? matchType : 'Broad',
      intentLevel: intentLevel === 'High' || intentLevel === 'Low' ? intentLevel : 'Medium',
      notes: asText(record['notes']),
    });
    return keywords;
  }, []);
}

/**
 * Whether a 404's body is campaign-service's own typed not-found rather than someone else's 404.
 *
 * Its Goa `not-found-error` requires both `code` and `message` as strings, and the service
 * populates `code` with the literal `"404"`. Anything that fails this test — a null body from a
 * plain-text Traefik 404, or a differently shaped JSON error from another hop — is NOT evidence
 * that the job is gone. Exported for the spec.
 */
export function isCampaignServiceNotFound(errorBody: unknown): boolean {
  if (typeof errorBody !== 'object' || errorBody === null) {
    return false;
  }
  const body = errorBody as { code?: unknown; message?: unknown };
  return body.code === '404' && typeof body.message === 'string';
}

/**
 * Translate campaign-service's `job-poll-response` into the shape the poller expects.
 *
 * This is NOT a pass-through, and the difference matters more than it looks. The Angular
 * poller terminates on `takeWhile((s) => s.status === 'running', true)`
 * (`campaign.service.ts`), so the status vocabulary is load-bearing:
 *
 *   - `queued` is the state a job is in for its first tick. Forwarded raw it is not
 *     `'running'`, so the poll STOPS on the first response and the UI reports a finished
 *     create with no campaigns — for a job that has not started yet.
 *   - `succeeded` forwarded raw is likewise not `'running'`, and `takeWhile`'s inclusive form
 *     emits that final value before completing — so the poll ends promptly, but on a status
 *     `getCreateResult` matches none of its arms. It falls through to the last `throw` and
 *     reports "Campaign creation is taking longer than expected" for a job that finished
 *     immediately and successfully. The failure is not a hang; it is a completed create
 *     reported as a timeout, with the campaigns it made never rendered.
 *
 * Both failures are silent, which is why the mapping is explicit and tested rather than
 * inferred. `partial` maps to `done`: some platforms succeeded, and each platform's own `ok`
 * flag carries the per-platform truth, so reporting the JOB as failed would hide the
 * campaigns that were really created.
 */
export function adaptJobPollResponse(response: CampaignServiceJobPollResponse): CampaignJobStatus {
  // Stays `undefined` when campaign-service sent no `result` — it is NOT defaulted to `[]`.
  // An empty array would assert "the job reported on zero platforms", which is a different
  // claim from "the job reported nothing yet"; the poller reaches here for terminal states
  // that legitimately carry no result (a job that failed before dispatch). The component
  // coalesces to `[]` at the point of rendering, where the distinction no longer matters.
  const platformResults: CampaignPlatformResult[] | undefined = response.result?.map((r) => ({
    platform: r.platform,
    ok: r.ok,
    campaignId: r.campaign_id,
    error: r.error,
  }));

  switch (response.status) {
    case 'queued':
    case 'running':
      return { status: 'running' };
    case 'succeeded':
    case 'partial':
      return { status: 'done', platformResults, error: response.error };
    case 'failed':
      return { status: 'error', platformResults, error: response.error ?? 'campaign creation failed' };
    default:
      // An unrecognised status is a contract change, not a terminal state. Reporting it as
      // `done` would claim campaigns exist that nobody verified; `error` at least stops the
      // poll and says so out loud.
      return { status: 'error', error: `unrecognised job status '${response.status}' from campaign-service` };
  }
}
