// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CAMPAIGN_GOALS, CAMPAIGN_PLATFORMS, JOB_LOST_MESSAGE } from '@lfx-one/shared/constants';
import type {
  BuildAudienceResult,
  GenerateEmailCopyResult,
  ApiResponse,
  BriefMetrics,
  CampaignBriefLoadResult,
  CampaignServiceCreateResult,
  CampaignBriefOutput,
  CampaignBriefPersistResult,
  CampaignMetricsWindow,
  HubSpotEmailSearchResult,
  HubSpotMarketingEmail,
  CampaignEventDetails,
  CampaignGoal,
  CampaignIndexDoc,
  CampaignJobStatus,
  CampaignListResult,
  CampaignKeyword,
  CampaignPlatform,
  CampaignPlatformResult,
  CampaignProgramType,
  CampaignServiceCampaign,
  CampaignToggleStatus,
  LinkedInBriefCopy,
  LinkedInCreativeVariant,
  MetaAdVariant,
  RedditAdVariant,
  MetaBriefCopy,
  QueryServiceResponse,
  RedditBriefCopy,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { MicroserviceError } from '../errors/microservice.error';
import { fetchAllQueryResources } from '../helpers/query-service.helper';
import { isServerFeatureEnabled, ServerFeatureFlag } from '../helpers/server-feature-flag.helper';
import { logger } from './logger.service';
import { MicroserviceProxyService } from './microservice-proxy.service';

/**
 * The 202 body from `POST /projects/{slug}/briefs/{brief_id}/campaigns`.
 *
 * Declared locally rather than in `@lfx-one/shared` for the same reason as its siblings below:
 * this is campaign-service's WIRE shape, which no browser code touches. Promoting it would
 * publish an upstream contract into the client bundle.
 */
interface CampaignServiceJobCreateResponse {
  job_id?: string;
  status?: string;
}

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
/**
 * The upstream audience shape, snake_case exactly as campaign-service returns it.
 *
 * Local to this file for the same reason the brief shapes are: it is a WIRE type, and exporting
 * it would invite the app to depend on upstream naming that this layer exists to translate.
 */
/** Upstream email-copy shape, snake_case-free but exactly as campaign-service returns it. */
interface CampaignServiceEmailCopy {
  subject: string;
  preheader: string;
  body: string;
  cta: string;
}

interface CampaignServiceAudience {
  id: string;
  project_id: string;
  brief_id: string;
  platform: string;
  platform_master_list_id?: string;
  suppression_list_ids?: string[];
  inclusion_summary?: string;
  status: string;
  version: number;
  etag?: string;
}

interface CampaignServiceBrief {
  id: string;
  project_id: string;
  program_type: string;
  event_slug: string;
  status: string;
  version: number;
  // Returned by every brief response: `Brief` Reference()s `BriefData` in `design/brief.go`, so
  // these come back on the find whether or not this phase renders them. Declared for the create
  // reconciliation, which has to tell THIS request's row from another writer's — not because the
  // write path reads them.
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
 * True when `id` is one campaign-service could possibly know about — a bare UUID.
 *
 * TWO callers, two id spaces, one shape test. The name says "job" for its original caller and is
 * kept for that continuity, but the predicate is a UUID check and the campaign status toggle
 * (`updateCampaignStatus`) now routes on it too. Read what follows as applying to BOTH: if the
 * job-id shape ever changes, this function is also what decides where a money-affecting status
 * toggle is dispatched, and that second caller has no other guard. Do not narrow it to jobs.
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
 * Does the envelope carry the config this platform needs to dispatch?
 *
 * The mapping is the dispatcher's, not ours: each `<platform>Dispatcher.Dispatch` in
 * campaign-service reads exactly one envelope key, and `unmarshalPlatformConfig` treats an absent
 * key as a zero value rather than an error — which is why the check has to happen on this side.
 *
 * An unmapped platform is REFUSED, not waved through.
 *
 * The first version returned true for anything unmapped, reasoning that this should not police the
 * platform list. That was wrong for the same reason the LinkedIn-strategy guard was: a platform can
 * be `disabled: true` in `CAMPAIGN_PLATFORMS`, but that is a CLIENT guarantee, and the upstream
 * `CampaignCreateInput` accepts twitter/microsoft/hubspot regardless. Waving an unmapped platform
 * through queued a job whose dispatcher reads an absent key as a zero value — exactly the defect
 * the mapped platforms are protected from.
 *
 * `twitter-ads` is the remaining example: nothing builds a `twitterConfig`, so it is refused here.
 * `microsoft-ads` was one too until LFXV2-3312 added `buildMicrosoftConfig` and mapped it below —
 * which is the order this guard enforces, and why the roster is stated as a rule rather than a
 * list that goes stale the next time a platform is enabled.
 *
 * `hubspot` joined the map when `buildHubSpotConfig` landed (LFXV2-3256), which is the order this
 * guard is designed to enforce: map a platform only once something builds its config. Note that a
 * mapped `hubspot` is necessary but NOT sufficient to stage an email — the dispatcher also needs
 * the brief's audience to be BUILT (`hubspot.go:432-456`), which it resolves by `brief.ID` rather
 * than from this envelope, so that failure surfaces upstream and not here.
 *
 * The cost of refusing is a clear error when a platform is enabled before its config builder
 * exists, which is the failure you want. The cost of allowing was a dispatched, unusable job.
 */
function hasPlatformConfig(platform: string, envelope: Record<string, unknown>): boolean {
  const requiredKey: Record<string, string> = {
    'google-ads': 'googleAdsConfig',
    'linkedin-ads': 'linkedInConfig',
    'reddit-ads': 'redditConfig',
    'meta-ads': 'metaConfig',
    'microsoft-ads': 'microsoftConfig',
    hubspot: 'hubspotConfig',
  };
  const key = requiredKey[platform];
  if (key === undefined) return false;
  return envelope[key] !== undefined;
}

/**
 * Did the request definitively never reach campaign-service?
 *
 * Only CONNECT-time failures qualify: the connection was never established, so the bytes never
 * left this process and nothing upstream can have started. That is as DEFINITE as a 4xx refusal,
 * and safer to retry than one.
 *
 * `ECONNRESET` is deliberately EXCLUDED even though it is a transport error. Node reports it for
 * a reset at any point, and this code cannot tell a connect-time reset from one that arrives
 * after the request was sent and processed — where the write may well have committed and only
 * the reply was lost. Calling that "nothing was created" on a path with no idempotency key is
 * the one wrong answer worth avoiding, because it invites the retry that duplicates a paid
 * campaign. The sibling approve path pins the same distinction (see its `definitelyRejected`).
 *
 * It needs its own check because a MicroserviceError alone does not distinguish a response from
 * a failure to reach the service at all: `ApiClientService.executeRequest` wraps a Node fetch
 * failure as `MicroserviceError(500, cause.code)`, so an unreachable service and a genuine 500
 * arrive as the same class. Only the `code` tells them apart — a syscall name versus an HTTP-ish
 * one — which is what `requestNeverLeft` below keys on.
 *
 * Observed 2026-08-13: with campaign-service stopped, a create answered "could not be confirmed —
 * check the ad platforms before retrying" for a request that was never sent. That is the exact
 * harm those predicates exist to prevent, told to a user who then has to go read an ad account to
 * rule out a campaign that could not exist.
 *
 * Deliberately NOT keyed on the message text, which is not a contract. `code` is the documented
 * Node.js system-error field, and an unrecognised code stays indeterminate — this widens what
 * counts as definite, and a wrong guess in that direction is the dangerous one.
 */
const NEVER_SENT_ERROR_CODES: ReadonlySet<string> = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);

function requestNeverLeft(error: unknown): boolean {
  // A MicroserviceError is NOT automatically a response. `ApiClientService.executeRequest`
  // (`api-client.service.ts:313-320`) wraps a Node fetch failure as
  // `MicroserviceError(500, cause.code)` — so the production shape of an unreachable service is a
  // 500 whose `code` is `ECONNREFUSED`, not a raw Error. An earlier revision returned false for
  // every MicroserviceError and therefore fixed nothing in production; the tests passed only
  // because they mocked a raw Error, which this client never throws. Both bots caught it.
  //
  // A REAL 500 from campaign-service carries an HTTP-ish code (`INTERNAL_ERROR`), never a
  // syscall name, so keying on the code rather than the class keeps the two apart.
  const code = error instanceof MicroserviceError ? error.code : (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && NEVER_SENT_ERROR_CODES.has(code);
}

/** The wire shape campaign-service returns for one marketing email (snake_case timestamps). */
interface CampaignServiceMarketingEmail {
  id?: string;
  name?: string;
  subject?: string;
  state?: string;
  updated_at?: string;
}

/**
 * The number of emails campaign-service returns for an UNFILTERED listing.
 *
 * Mirrors `hubspot.maxUnfilteredEmails` in campaign-service. Duplicated rather than fetched
 * because the wire result carries no pagination field at all — a capped 500 and a complete 500
 * are byte-identical — so the only way a caller can flag truncation is to know the cap.
 *
 * KNOWN GAP (LFXV2-3255): the two services deploy independently, so this constant can drift from
 * the one it mirrors, in EITHER direction. A raised cap under-reports (a 600-email portal
 * returning 600 is not flagged, failing toward silence); a LOWERED cap over-reports the opposite
 * way, calling a genuinely capped list complete — which is the false absence this flag exists to
 * prevent. The real fix is upstream returning explicit truncation metadata, so a consumer reads
 * the fact instead of re-deriving it. Not a live defect: the constants agree today.
 */
const UNFILTERED_EMAIL_CAP = 500;

/**
 * One wire email onto the shared interface.
 *
 * Only `id` is guaranteed by the service's design, so everything else is optional here rather
 * than defaulted to `''` — an empty string would render as a nameless row that looks like data,
 * where an absent field lets the template show what it actually knows.
 */
function fromMarketingEmail(email: CampaignServiceMarketingEmail): HubSpotMarketingEmail {
  return {
    id: email.id ?? '',
    name: email.name,
    subject: email.subject,
    state: email.state,
    updatedAt: email.updated_at,
  };
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
/**
 * Whether this deployment can create a Demand Gen Google campaign.
 *
 * NOT simply `CampaignServiceDemandGen`. That flag gates the campaign-service create path only;
 * while the create cutover is dark the controller falls through to the LEGACY creator, whose
 * `includeGoogle` gates on platform membership alone and which creates demand-gen campaigns
 * perfectly well (see the note above `unconfigured` in `createCampaigns`).
 *
 * So the capability is missing only in the narrow window where campaign-service owns creation and
 * has not been told it understands `googleAdsConfig.channel`. Reporting the raw flag instead would
 * hide a working legacy option — including for the whole of the staged CREATE-off rollout this
 * chart prescribes, which is exactly the deployment state most likely to be in effect.
 *
 * Mirrors `createCampaigns`' own three-flag gate rather than restating it as two: a partial flag
 * set is equivalent to "cutover off" there, and it has to mean the same here or the two disagree
 * mid-rollout.
 */
function canCreateDemandGen(): boolean {
  const cutoverOwnsCreate =
    isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceCreate) &&
    isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceBriefs) &&
    isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceJobs);

  return !cutoverOwnsCreate || isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceDemandGen);
}

export class CampaignServiceClient {
  private readonly microserviceProxy: MicroserviceProxyService;

  /**
   * Bounds on the lost-write reconciliation: how many times it reads, how long it waits between
   * attempts, and the WALL-CLOCK budget the whole loop may spend.
   *
   * Instance members rather than module constants: CLAUDE.md's "all shared constants and interfaces live in `@lfx-one/shared`" rule keeps shared values in
   * `@lfx-one/shared`, and these are neither shared nor meaningful outside this client.
   *
   * The wall-clock bound is the one that actually holds. An earlier revision counted only the
   * sleeps and claimed "~2s added", which was wrong: `proxyRequestWithResponse` exposes no timeout
   * parameter, so every read carries the client default (30s, `api-client.service.ts`). Three hung
   * GETs plus the delays is ~92s of a session's save queue blocked before the original failure
   * even surfaces — and these saves are serialised, so the next Proceed waits behind it.
   */
  private readonly reconcileReadAttempts = 3;
  private readonly reconcileReadDelayMs = 1000;
  private readonly reconcileReadBudgetMs = 5000;

  public constructor(microserviceProxy?: MicroserviceProxyService) {
    this.microserviceProxy = microserviceProxy ?? new MicroserviceProxyService();
  }

  /**
   * List the campaigns belonging to a brief, from the platform's Query Service.
   *
   * NOT from campaign-service. That service has no list endpoint by DESIGN — `docs/architecture.md`
   * D5 and `docs/api-catalog.md` rule 3 give Query Service ownership of lists, and an earlier
   * attempt to add one (campaign-service PR #117) was built and withdrawn for exactly that reason.
   * The absent route is a decision, not a gap, so this reads the index instead.
   *
   * Scoped BOTH ways, and neither is redundant. `parent=project:<slug>` is what the platform
   * applies FGA against — campaign docs carry `AccessCheckRelation: campaign_manager` on that
   * project — so it is the authorization boundary, not a filter. `filters=brief_id:<id>` narrows
   * to the brief, and it has to be a filter rather than a parent because `ParentRefs` is
   * project-scoped only: there is no `brief:<id>` ref to address.
   *
   * The brief id is RE-CHECKED on every row rather than trusted from the filter. Whether
   * `data.brief_id` is a term field or an analysed one is the single assumption this read rests
   * on (LFXV2-3099), and an analysed field would match on token overlap — returning another
   * brief's campaigns for a similar id. A wrong row here would put one brief's campaigns, and
   * their spend, under another's. Cheap to verify, expensive to get wrong.
   *
   * `failOnPartial: true` because a truncated list is worse than an error: the caller cannot tell
   * a short list from a complete one, and the missing campaigns are live and spending.
   */
  public async listBriefCampaigns(req: Request, projectSlug: string, briefId: string): Promise<CampaignListResult> {
    if (projectSlug === '' || briefId === '') {
      // Refused rather than defaulted: a query missing either scope would either fail
      // authorization or, worse, widen past the brief the caller asked about.
      //
      // `possiblyStale: true` on a REFUSAL, which looks odd until you read what the field means to
      // a caller: `false` asserts the empty list is authoritative — that this brief has no
      // campaigns. Nothing was queried here, so that assertion would be manufactured from a
      // programming error, and it is exactly the false absence this field exists to prevent. The
      // HTTP path never reaches this (the controller refuses both blanks first), so this guards
      // direct callers, where an unqualified "no campaigns" is the most expensive thing to say.
      return {
        campaigns: [],
        possiblyStale: true,
        statusToggleEnabled: isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceStatusToggle),
        demandGenEnabled: canCreateDemandGen(),
      };
    }

    const docs = await fetchAllQueryResources<CampaignIndexDoc>(
      req,
      (pageToken) =>
        this.microserviceProxy.proxyRequest<QueryServiceResponse<CampaignIndexDoc>>(req, 'LFX_V2_SERVICE', '/query/resources', 'GET', {
          type: 'campaign',
          parent: `project:${projectSlug}`,
          filters: [`brief_id:${briefId}`],
          ...(pageToken && { page_token: pageToken }),
        }),
      { failOnPartial: true }
    );

    // Derive the ETag here, where the wire contract lives. The index stores `version` only, but a
    // write against a campaign needs `If-Match`, and campaign-service's ETag is exactly
    // `"<version>"` — quotes included (`briefETag` in internal/service/brief.go). Deriving it once
    // beats leaving each caller to rediscover a quoting rule that only Go source states; a caller
    // that got it wrong would see a 412 and read it as someone else's concurrent edit.
    const campaigns = docs.filter((d) => d?.brief_id === briefId).map((d) => ({ ...d, etag: typeof d.version === 'number' ? `"${d.version}"` : undefined }));
    if (campaigns.length !== docs.length) {
      // The filter matched rows this brief does not own — the field is analysed, not a term, or
      // the contract moved. Report it loudly: the rows are dropped here, but every other consumer
      // of this filter has the same exposure.
      logger.warning(req, 'list_brief_campaigns', 'query returned campaigns belonging to another brief', {
        briefId,
        returned: docs.length,
        kept: campaigns.length,
      });
    }

    // An empty result is ambiguous by construction: indexing is asynchronous, so "not indexed
    // yet" and "none exist" are the same answer here. Say so rather than letting the caller read
    // absence as proof.
    // Reported with the list because the client cannot infer it: this read is ungated, while the
    // toggle route refuses every UUID when the flag is off. The chart now ships the flag on, but
    // it is read per request from the environment, so a values override or a not-yet-rolled pod
    // still answers off — and that deployment would render controls that can only fail. Read at
    // request time rather than cached, so a flag flip does not need a redeploy of this process to
    // take effect on the next list.
    //
    // `demandGenEnabled` rides along for the same reason and is read the same way: the create
    // route refuses `demand-gen` unless its own flag is on, and nothing in the create request
    // tells the client that in advance.
    return {
      campaigns,
      possiblyStale: campaigns.length === 0,
      statusToggleEnabled: isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceStatusToggle),
      demandGenEnabled: canCreateDemandGen(),
    };
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
   *
   * ## Scoped to the project that owns the job
   *
   * `projectSlug` is a REQUIRED parameter rather than a module constant, and that change is the
   * other half of the creation cutover rather than a tidy-up. The constant was `'tlf'`, and its
   * comment said exactly why it was survivable: `isCampaignServiceJobId` only routes UUIDs here,
   * and no UUID job could exist until creation went through campaign-service. Creating through
   * campaign-service is precisely what makes UUID jobs real, so a CNCF user's poll would have
   * been issued under TLF's scope — and `GetJob` joins `b.project_id = $2` with an EXACT
   * comparison, so it would answer `not_found` for a job that exists and is running.
   *
   * `not_found` is TERMINAL for the poller, so that would be reported to the user as a lost
   * campaign. Hence both halves in one change (LFXV2-3195).
   *
   * Still a SLUG on the wire, never a uid: `campaign_briefs.project_id` stores the slug the
   * create was made with, and the poll's join is an exact string comparison.
   */
  public async getJobStatus(req: Request, jobId: string, projectSlug: string): Promise<CampaignJobStatus> {
    try {
      const response = await this.microserviceProxy.proxyRequest<CampaignServiceJobPollResponse>(
        req,
        'LFX_V2_CAMPAIGN_SERVICE',
        `/projects/${encodeURIComponent(projectSlug)}/jobs/${encodeURIComponent(jobId)}`,
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
   * A 409 from `create-brief` is NOT retried as a replace either, for a reason that is easy to
   * get backwards. Two saves of the same event can both find 404 and both POST; the one that
   * collides is whichever POST landed second, and that is not the one that STARTED second. A
   * retry would make the collision's loser the final writer unconditionally, so a slow earlier
   * save would overwrite a newer brief that had already succeeded — after the UI had shown the
   * user "Brief saved." Nothing on this side of the connection can order the two. The conflict
   * is reported instead, and the concurrency it comes from is removed where it is actually
   * knowable: `campaigns.component.ts` runs a session's saves strictly one at a time, so the
   * second save finds the first one's brief and takes the replace path — which it is entitled
   * to, because the first save recorded the created id and the second sends it back as proof of
   * ownership. Without that hand-back the guard below would refuse a user re-proceeding on their
   * own brief.
   *
   * `projectSlug` is the foundation the user has selected, NOT a constant. `/foundation/campaigns`
   * is reachable by an ED of any foundation (`campaignAccessGuard` gates on persona, and
   * `projectQueryParamGuard` seeds the context from `?project=`), while campaign-service scopes
   * and authorises every brief on its project. Hard-coding `tlf` would either 403 a CNCF ED or —
   * for an LF staffer who also holds TLF access — file their CNCF work in TLF's brief table,
   * where the partial unique index on `(project_id, event_slug)` then collides it with unrelated
   * TLF work for the same event.
   */
  public async saveBrief(
    req: Request,
    brief: CampaignBriefOutput,
    eventSlug: string,
    projectSlug: string,
    knownBriefId: string | null = null,
    knownEtag: string | null = null,
    allowEtagFallback = false
  ): Promise<CampaignBriefPersistResult> {
    const basePath = `/projects/${encodeURIComponent(projectSlug)}/briefs`;
    const envelope: CampaignServiceBriefEnvelope = { brief: toBriefInput(brief, eventSlug) };
    const existing = await this.findBrief(req, basePath, eventSlug);

    // A row exists that the caller cannot prove it owns: REFUSE rather than replace.
    //
    // This is the guard for LFXV2-3200. Without it the update branch below is reachable by a
    // caller that never saw the stored brief, and it overwrites content the user was never
    // shown. Two routes lead there and only one involves a slug mismatch:
    //
    // `knownBriefId` defaults to null, and there are two ways a caller comes to hold one.
    //
    // In THIS phase: by having created the brief itself. `CampaignsComponent` records the id a
    // successful save returns, so the second Proceed of a session sends it and takes the ordinary
    // replace path. An earlier version of this comment said the parameter "is always null in this
    // phase" — that was true when it was written and my own later change to record the created id
    // falsified it, which is exactly the kind of claim a comment should not make about the
    // future.
    //
    // What is still missing is the RELOAD path: a fresh session, a second tab, or a reload cannot
    // learn the id of a brief it did not write, so those callers arrive with null and are refused.
    // LFXV2-3108 adds the read that closes that half.
    //
    //   1. The lookup's slug (last path segment of the pasted URL) and the save's slug
    //      (`brief.eventDetails.slug`, from the scrape) diverge, so the Restore offer never
    //      appears, the user regenerates, and THIS find hits the row the offer missed.
    //   2. No divergence at all — a reload, or a second tab. The page holds no brief id
    //      because nothing loaded one, the slugs match perfectly, and the save still replaces
    //      a brief whose contents the caller never read.
    //
    // Route 2 is why normalising the two slug derivations is not the fix: it would close route
    // 1 and leave route 2 wide open. Ownership is the property that actually distinguishes
    // "the user is editing the brief they are looking at" from "a fresh session happens to
    // collide on the same event", and `knownBriefId` is how the caller asserts it — it comes
    // from `loadBrief`, so it exists only when the brief on screen came out of storage.
    if (existing !== null && knownBriefId !== existing.brief.id) {
      // The id is deliberately WITHHELD on this refusal. Returning it told a caller the id of a
      // brief it was just told it does not own — and `etag_fallback` then let it replay that id
      // as proof of ownership, overwriting content it had never opened. Omit the id and the
      // replay has nothing to replay.
      //
      // Nothing needs it: the UI renders only the message for this conflict, never the id, and a
      // caller that legitimately owns the brief already holds its id from the save that created
      // or loaded it.
      return {
        enabled: true,
        briefId: '',
        etag: null,
        created: false,
        approved: false,
        conflict: 'unowned-brief-exists',
      };
    }

    if (existing === null) {
      let created;
      try {
        created = await this.microserviceProxy.proxyRequestWithResponse<CampaignServiceBrief>(
          req,
          'LFX_V2_CAMPAIGN_SERVICE',
          basePath,
          'POST',
          undefined,
          envelope
        );
      } catch (error) {
        // An INDETERMINATE create is the one failure this phase cannot walk away from. If the
        // POST committed but its response was lost — a timeout, a reset, a gateway 5xx — the
        // caller never learns the id, and with no read path every later save finds that row with
        // no id to name it and is refused as `unowned-brief-exists`. The user's work is stranded
        // behind a row they created seconds earlier.
        //
        // campaign-service declares no idempotency key on the brief endpoints, so the only
        // reconciliation available is to look again.
        const reconciled = await this.reconcileLostCreate(req, basePath, eventSlug, envelope, error);
        if (reconciled === null) {
          throw error;
        }
        created = reconciled;
      }
      return this.approveBrief(req, basePath, created, true);
    }

    return this.replaceBrief(req, basePath, envelope, existing, knownEtag, allowEtagFallback, eventSlug);
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
   *
   * `projectSlug` is the selected foundation, and it has to be the SAME one `saveBrief` filed
   * under or the two halves of persistence disagree about which brief belongs to this event.
   * A constant here would be worse than on the write side: reading TLF's table for a CNCF ED
   * either finds nothing — a blank Planning tab for an event that already has an approved brief,
   * whose next save is an UPDATE that replaces it — or finds TLF's brief and offers to restore
   * another foundation's work into theirs.
   */
  public async loadBrief(req: Request, eventSlug: string, projectSlug: string): Promise<CampaignBriefLoadResult> {
    const basePath = `/projects/${encodeURIComponent(projectSlug)}/briefs`;
    const found = await this.findBrief(req, basePath, eventSlug);

    if (found === null) {
      return { status: 'none', briefId: null, brief: null, etag: null, approved: false };
    }

    // `found.etag` is CARRIED, and the reason is the hazard it closes (LFXV2-3204).
    //
    // An earlier revision dropped it, reasoning that this read hands its result to a component
    // which may sit on it for minutes, so the validator would usually be stale by the time it
    // was used — and `replaceBrief` re-reads the current one anyway. The second half is what
    // made dropping it unsafe: re-reading means the PUT carries whatever version is current at
    // SAVE time, not the one the user was shown. That find runs inside the save, so its
    // validator always matches and the precondition can never fire. A concurrent editor's change
    // was therefore overwritten rather than rejected — last-write-wins between two people
    // editing the same brief.
    //
    // Staleness was never the failure mode to design against: a validator that is stale because
    // someone else moved the row is exactly the case that SHOULD 412. `replaceBrief` prefers a
    // caller-supplied ETag over its own read for this reason, and the restore path now supplies
    // this one, so the first save after a restore is refused as `stale-brief` instead of
    // silently replacing the other writer's content.
    //
    // This remains NARROWER than the hazard LFXV2-3200 closes. That ownership guard stops a
    // caller replacing a brief it never saw at all — the case a reload or a second tab reaches
    // with no coordination. This one needs two editors who have both deliberately loaded the
    // same brief, and layers on top of that guard rather than replacing it.
    const brief = fromBriefResponse(found.brief);
    // Only the exact `approved` token counts. A brief left in `draft` by a failed approve step is
    // stored but unusable -- `build-audience` and campaign creation both gate on `approved` -- and
    // restoring it suppresses the save that would otherwise retry. Any other or unreadable value
    // is treated as NOT approved so the restore path re-approves; claiming approval we cannot see
    // is the one answer that silently strands the brief.
    const approved = found.brief.status === 'approved';
    return brief === null
      ? { status: 'unreadable', briefId: found.brief.id, brief: null, etag: found.etag, approved }
      : { status: 'loaded', briefId: found.brief.id, brief, etag: found.etag, approved };
  }

  /**
   * Generate email copy for a brief through campaign-service.
   *
   * A THIN PROXY, not a second generator. campaign-service owns this (LFXV2-2775, merged): it
   * composes the prompt from the brief's own persisted event details and calls the same LiteLLM
   * proxy this app would have. Generating here as well would mean two prompts producing two
   * shapes for one feature, and the architecture's "AI generation eventually moves to this
   * service" has already happened for email copy.
   *
   * Takes no body: `project_id` and `brief_id` are the whole input, and the brief supplies the
   * event facts. Upstream does NOT persist the result — regenerating is safe and cheap.
   *
   * A 503 is a deployment state, not a bug: the AI model is optional upstream, and a service
   * without one configured refuses rather than inventing copy.
   */
  public async generateEmailCopy(req: Request, projectSlug: string, briefId: string): Promise<GenerateEmailCopyResult> {
    if (!isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceBriefs)) {
      return { enabled: false };
    }

    const path = `/projects/${encodeURIComponent(projectSlug)}/briefs/${encodeURIComponent(briefId)}/email-copy`;
    try {
      // Fifth argument is `query`, sixth is `data` — this call has neither.
      const response = await this.microserviceProxy.proxyRequestWithResponse<CampaignServiceEmailCopy>(
        req,
        'LFX_V2_CAMPAIGN_SERVICE',
        path,
        'POST',
        undefined,
        undefined
      );

      const copy = response.data;
      if (!copy?.subject) {
        return { enabled: true, error: 'The generator returned no email copy.' };
      }

      return {
        enabled: true,
        copy: { subject: copy.subject, preheader: copy.preheader, body: copy.body, cta: copy.cta },
      };
    } catch (error) {
      logger.warning(req, 'generate_email_copy', 'Email copy generation failed, returning an error result', { err: error });
      return { enabled: true, error: 'The email copy could not be generated. Try again.' };
    }
  }

  /**
   * Build a brief's send audience in campaign-service.
   *
   * Takes NO body: the service derives the audience from the brief's own event details, so the
   * only inputs are the two path segments. Sending a list from here would be the divergent second
   * source of truth `hubspot.go:293` exists to avoid — it resolves the BUILT audience by brief id
   * and never reads one off a request.
   *
   * Answers 202, not 200: the build calls Snowflake and several HubSpot creates, so it is
   * accepted-and-recorded rather than a promise that every platform-side list is confirmed.
   */
  public async buildAudience(req: Request, projectSlug: string, briefId: string): Promise<BuildAudienceResult> {
    if (!isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceBriefs)) {
      // Same steady state as saveBrief: the flag being off is not a failure.
      return { enabled: false };
    }

    const path = `/projects/${encodeURIComponent(projectSlug)}/briefs/${encodeURIComponent(briefId)}/audiences/build`;
    try {
      // Fifth argument is `query`, sixth is `data` — this call has neither. Passing anything
      // fifth would serialise it into the query string and send no body.
      const response = await this.microserviceProxy.proxyRequestWithResponse<CampaignServiceAudience>(
        req,
        'LFX_V2_CAMPAIGN_SERVICE',
        path,
        'POST',
        undefined,
        undefined
      );

      const built = response.data;
      if (!built?.id) {
        return { enabled: true, error: 'The audience build was accepted but returned nothing to track.' };
      }

      return {
        enabled: true,
        audience: {
          id: built.id,
          projectId: built.project_id,
          briefId: built.brief_id,
          platform: built.platform,
          platformMasterListId: built.platform_master_list_id,
          suppressionListIds: built.suppression_list_ids,
          inclusionSummary: built.inclusion_summary,
          status: built.status,
          version: built.version,
          etag: built.etag,
        },
      };
    } catch (error) {
      logger.warning(req, 'build_audience', 'Audience build failed, returning an error result', { err: error });
      return { enabled: true, error: 'The audience could not be built. Check the HubSpot connection and try again.' };
    }
  }

  /**
   * Ask campaign-service to create campaigns for a brief it already stores.
   *
   * Returns the job id and NOTHING else, because that is all a 202 carries. The legacy path
   * inline-waits up to 45s and can hand back a finished `result`; this one cannot, and pretending
   * otherwise would mean waiting on a dispatcher the request has no relationship with.
   *
   * `briefId` is REQUIRED and comes from the save that preceded this call. The route is
   * `/projects/{slug}/briefs/{brief_id}/campaigns` — there is no create-without-a-brief path, by
   * design: the brief is what the dispatcher reads the copy and targeting from, so a campaign
   * with no stored brief would have nothing to dispatch.
   *
   * `projectSlug` must be the SLUG, never a UUID. The design says why in two places at once: the
   * project id is stamped into the campaign name upstream, and it is the exact-match key for the
   * dispatch connection lookup. A UUID produces a campaign named after a UUID AND fails to find
   * the project's ad-platform credentials, so the failure is both cosmetic and total.
   */
  public async createCampaigns(
    req: Request,
    briefId: string,
    projectSlug: string,
    platforms: string[],
    config: Record<string, unknown>,
    // Named-optional rather than a sixth positional string[], which would sit next to `platforms`
    // and be silently swappable with it — both are string arrays, so a transposition would type-
    // check and only surface as a wrong refusal. Read only for the Demand Gen check below.
    opts: { campaignTypes?: string[] } = {}
  ): Promise<CampaignServiceCreateResult> {
    const campaignTypes = opts.campaignTypes;
    // CREATE has TWO prerequisites, and neither is an independent switch. Treating them as
    // independent is the difference between a dark cutover and a broken page, because a
    // half-set pair answers `enabled: true` — the one result the controller may NOT fall
    // through on — so creation stops working rather than quietly staying on the legacy path.
    //
    // BRIEFS, because creation posts to `/briefs/{id}/campaigns` and only that flag stores a
    // brief to post against; without it there is never a brief id and every request takes the
    // refusal below.
    //
    // JOBS, because creation mints a UUID job id and only that flag routes UUIDs to
    // campaign-service. With JOBS off the poll takes the in-process branch, which holds no such
    // job, so the user is told the campaign is lost while it is in fact running and spending —
    // strictly worse than not cutting over. There is no id-shape backstop in that direction:
    // the shape check tells a UUID from a `job_...` id, it cannot conjure the flag.
    //
    // Reporting either as `enabled: false` keeps a partial flag set equivalent to "cutover off".
    const enabled =
      isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceCreate) &&
      isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceBriefs) &&
      isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceJobs);
    if (!enabled) {
      return { enabled: false, jobId: null, error: null };
    }
    // Both are the caller's to get right, but a missing one must not reach the wire as an empty
    // path segment: `/projects//briefs//campaigns` is a DIFFERENT route that would 404 from the
    // gateway, and a gateway 404 is not the service saying "no such brief".
    if (briefId === '' || projectSlug === '') {
      return { enabled: true, jobId: null, error: 'This campaign could not be created because its brief has not been saved yet.' };
    }
    if (platforms.length === 0) {
      return { enabled: true, jobId: null, error: 'Select at least one platform before creating campaigns.' };
    }

    // A selected platform with no config in the envelope is refused, rather than dispatched.
    //
    // Not a cosmetic omission upstream: `unmarshalPlatformConfig` in campaign-service returns nil
    // for an absent key — "no per-platform config supplied; zero value is fine" — so the
    // dispatcher would proceed with a ZERO-VALUE config and call Google Ads with budget 0 and no
    // headlines. Nothing upstream refuses it; I read the dispatcher rather than assuming.
    //
    // The reachable case is google-ads selected with NEITHER supported campaign type: the
    // builder returns null only when it can name no channel at all. Demand-Gen-only no longer
    // reaches it — since LFXV2-3257 `buildGoogleAdsConfig` returns a full-budget
    // `{budget, channel: 'demand-gen'}` config for that selection.
    //
    // This check belongs HERE and not in the controller. It tests for a campaign-service envelope
    // key, so it must only apply once the cutover is on — the legacy path needs no
    // `googleAdsConfig` at all (its `includeGoogle` gates on platform membership alone) and
    // creates demand-gen campaigns perfectly well. An earlier revision put it in the controller
    // above this call, where it ran with the flags OFF and broke that legacy capability.
    //
    // Refusing the whole create rather than filtering the platform out: a silent partial success
    // is the same class of bug this cutover exists to prevent — the user asked for Google, would
    // get no Google, and nothing would say so. Returning `enabled: true` with an error also blocks
    // the controller's legacy fall-through, so a refusal cannot become a duplicate create.
    const unconfigured = platforms.filter((p) => !hasPlatformConfig(p, config));
    if (unconfigured.length > 0) {
      return {
        enabled: true,
        jobId: null,
        error: `No configuration was built for: ${unconfigured.join(', ')}. Check the campaign types selected for each platform.`,
      };
    }

    // Search + Demand Gen TOGETHER is refused. Demand Gen alone is not — that changed with
    // LFXV2-3257, which ported the legacy `createDemandGenCampaign` into campaign-service and
    // gave `googleAdsConfig` a `channel` field to select it.
    //
    // What still cannot be served is BOTH in one create, and the reason is THIS SERVICE, not
    // the schema. campaign-service #130 widened the slot key to
    // `(brief_id, platform, variant)`, so a brief CAN hold a Search row and a Demand Gen row
    // simultaneously — the database no longer forbids the pair.
    //
    // The limit is here: `buildGoogleAdsConfig` emits ONE `googleAdsConfig` with ONE `channel`,
    // so a create carrying both types would dispatch a single campaign and silently drop the
    // other. Stating the real constraint matters — someone reading the old rationale after the
    // migration landed would remove this guard as obsolete and reintroduce the silent partial
    // create. Serving the pair needs this BFF to send two configs, not a schema change.
    //
    // Letting the pair through is the dangerous option, because it LOOKS like success: the
    // config carries one channel, so the create would succeed having silently dropped half of
    // what the user asked for and half their budget. Refusing keeps them on a path that can
    // actually serve the request until this BFF can send both channels in one envelope.
    //
    // Gated on google-ads being SELECTED, not on `campaignTypes` alone. `campaignTypes` is a
    // Google concept but the Implementation tab sends it unconditionally (implementation-tab
    // :1327-1338), and nothing clears it when Google is deselected. The form now defaults
    // `includeDemandGen` to false, so this is no longer the untouched-form case — it is RETAINED
    // state: a user who ticks Demand Gen and then deselects Google, or a saved draft restoring
    // the old default through `:1611`. Either way a LinkedIn-only create arrives carrying
    // `demand-gen`, and refusing on the type alone rejected creates that have no Google campaign
    // in them at all.
    if (platforms.includes('google-ads') && campaignTypes?.includes('demand-gen') && campaignTypes.includes('search')) {
      return {
        enabled: true,
        jobId: null,
        // Names BOTH escapes now, because either one works: Search alone and Demand Gen alone
        // are each servable, and only the pair is not. The previous wording said "Deselect
        // Demand Gen", which was the only option when Demand Gen could not be created at all
        // and would now send a user who wants Demand Gen to the one channel they did not ask
        // for. No internal vocabulary — "campaign-service" and "the cutover" name controls the
        // reader does not have.
        // Does NOT promise that creating them one after another works, which an earlier
        // wording did. Whether a second Google campaign can be added to the same brief
        // depends on the campaign-service version deployed: the widened
        // (brief_id, platform, variant) slot key ships with LFXV2-3257, and against an older
        // deployment the second create is refused by the narrower (brief_id, platform)
        // uniqueness AFTER the first has already spent budget. Telling a user to retry into
        // that is worse than telling them nothing.
        error: 'Search and Demand Gen cannot be created together. Deselect one and create it; adding the second to the same brief may not be supported yet.',
      };
    }

    // Demand Gen requires a campaign-service that understands `googleAdsConfig.channel`
    // (LFXV2-3257). Against an older deployment the field is silently DROPPED — Go's decoder
    // ignores unknown keys — and the dispatcher builds its default SEARCH campaign instead:
    // real budget, no keywords, and per `googleAdsConfig.Keywords` it "can never serve".
    //
    // That is the worst outcome available here. It is not a visible failure the user can
    // react to; it is a paid campaign created under the wrong channel with the wrong budget,
    // reported as success. Refusing costs a user one create; the alternative costs money and
    // is discovered later in Google Ads.
    //
    // Gated on the CAPABILITY flag rather than a version probe: the service exposes no
    // version endpoint, and inferring support from a successful create is exactly the
    // ambiguity that makes the silent-Search case dangerous.
    if (platforms.includes('google-ads') && campaignTypes?.includes('demand-gen') && !isServerFeatureEnabled(ServerFeatureFlag.CampaignServiceDemandGen)) {
      return {
        enabled: true,
        jobId: null,
        error: 'Demand Gen campaigns are not available yet. Select Search instead, or ask an administrator to enable Demand Gen support.',
      };
    }

    const path = `/projects/${encodeURIComponent(projectSlug)}/briefs/${encodeURIComponent(briefId)}/campaigns`;
    try {
      // `undefined` for the fifth argument, NOT the envelope: `proxyRequestWithResponse` takes
      // `query` fifth and `data` sixth. Passing the envelope fifth serialises it into the query
      // string and sends NO body, which campaign-service rejects — every create would fail
      // before a job existed. `saveBrief` above has the same shape; keep the two aligned.
      const response = await this.microserviceProxy.proxyRequestWithResponse<CampaignServiceJobCreateResponse>(
        req,
        'LFX_V2_CAMPAIGN_SERVICE',
        path,
        'POST',
        undefined,
        { input: { platforms, config } }
      );
      const jobId = response.data?.job_id ?? '';
      if (jobId === '') {
        // A 202 with no job id is unusable: the caller has no way to poll, and reporting success
        // would leave a dispatch running that nothing can observe. Say so rather than returning
        // an empty id the poller would treat as a legacy in-process job.
        return { enabled: true, jobId: null, error: 'Campaign creation was accepted but returned no job to track. Check the ad platforms before retrying.' };
      }
      return { enabled: true, jobId, error: null };
    } catch (error: unknown) {
      logger.warning(req, 'campaign_service_create', 'campaign-service refused the campaign-create request', {
        briefId,
        projectSlug,
        error: error instanceof Error ? error.message : String(error),
      });
      // Deliberately generic about the CAUSE. The upstream message can name a connection, an
      // account id or a platform error body, none of which the user can act on and some of which
      // should not be rendered at all.
      //
      // But it must NOT be generic about whether retrying is safe. This endpoint answers 202 and
      // dispatches work the request does not wait for, and neither it nor `/campaigns` declares
      // an idempotency key — the same reason `saveBrief` reconciles instead of retrying. So on an
      // indeterminate failure the POST may already have committed and real ad spend may already
      // be running. Telling the user to "try again" there is an instruction to double-spend,
      // which is the exact outcome this cutover exists to prevent.
      //
      // Same predicate as `reconcileLostWrite`, deliberately: a 4xx that is not 408 is a definite
      // refusal — campaign-service decided, nothing was committed, and retrying is safe. Anything
      // else (5xx, connection reset, and the 408 the client synthesises for a timeout) is
      // indeterminate, and gets the non-retry wording the 202-no-job branch above already uses.
      //
      // Wording rather than reconciliation: a reconcile needs a lookup keyed by brief that would
      // tell us whether a job exists, and the create endpoints expose no such route today. That
      // is the better fix and belongs with an idempotency key on the service side; this stops the
      // active harm of instructing the retry.
      // A request that never left this process is definite too — see `requestNeverLeft`. Without
      // it, campaign-service simply being unreachable answered "it may have started, check the ad
      // platforms", which is the retry-inducing wording this branch exists to avoid.
      if (requestNeverLeft(error)) {
        return {
          enabled: true,
          jobId: null,
          error: 'Could not reach the campaign service, so nothing was created. Please try again.',
        };
      }
      const definitelyRejected = error instanceof MicroserviceError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408;
      if (definitelyRejected) {
        return { enabled: true, jobId: null, error: 'Campaign creation was rejected and nothing was created. Please try again.' };
      }
      return {
        enabled: true,
        jobId: null,
        error: 'Campaign creation could not be confirmed. It may have started — check the ad platforms before retrying.',
      };
    }
  }

  /**
   * Pause or resume a campaign on its ad platform, then persist the confirmed state.
   *
   * This is a DISPATCHING write, not a row update: campaign-service calls the platform first and
   * writes the row only once the platform confirms, so a 200 here means the ad platform actually
   * changed state. That is the whole value of routing through the service — the legacy BFF path
   * this replaces called the Meta and Reddit SDKs directly and could only ever reach those two,
   * while six dispatchers implement the toggle UPSTREAM (Google Ads, LinkedIn, Meta, Reddit,
   * Microsoft, X). That six is campaign-service's capability, NOT this app's reach: the caller
   * is gated on `CAMPAIGN_SERVICE_STATUS_PLATFORMS`, which admits only the platforms this app
   * offers. HubSpot is absent from both and always will be: an email send has no run state.
   *
   * `If-Match` is REQUIRED, not optional — `toggle-campaign-status` answers a missing header with
   * 428, so an omitted etag is a guaranteed failure rather than a lenient write. Passing the
   * caller's etag is what makes a pause safe against a concurrent editor: a 412 means the row
   * moved since the caller last read it, and the toggle is REFUSED rather than applied to a
   * campaign whose platform or id the caller may no longer be looking at. Since this dispatches
   * money-affecting state to an ad platform, refusing is the only correct answer.
   *
   * `created_degraded` is the one case where a 200 does NOT carry a changed status. Pausing such a
   * campaign pauses it upstream and returns the status and ETag UNCHANGED, because that status
   * records that the campaign's wiring was never verified and the schema has one status column —
   * writing 'paused' would spend the reconciliation marker to record a run state the platform
   * already holds. The caller must therefore read the pause's effect from the ad platform, not
   * from this result. Resuming a degraded campaign is refused outright with 409.
   */
  public async toggleCampaignStatus(
    req: Request,
    params: { projectSlug: string; briefId: string; campaignId: string; status: CampaignToggleStatus; etag: string }
  ): Promise<CampaignServiceCampaign> {
    const path =
      `/projects/${encodeURIComponent(params.projectSlug)}` +
      `/briefs/${encodeURIComponent(params.briefId)}` +
      `/campaigns/${encodeURIComponent(params.campaignId)}/status`;

    // The upstream enum is lowercase ('active' | 'paused'); the shared client type is uppercase.
    // Converting here rather than at the caller keeps the wire spelling in the one file that owns
    // the wire contract — a caller that had to know it would be a second place to get it wrong.
    const response = await this.microserviceProxy.proxyRequestWithResponse<CampaignServiceCampaign>(
      req,
      'LFX_V2_CAMPAIGN_SERVICE',
      path,
      'PATCH',
      // `query` is the FIFTH argument and `data` the SIXTH. A body passed one position early is
      // sent as a query string with NO body and no type error, which upstream reads as a missing
      // required `status` — so the explicit `undefined` here is load-bearing, not noise.
      undefined,
      { status: params.status.toLowerCase() },
      { 'If-Match': params.etag }
    );
    // The HEADER is the authoritative validator for the NEXT toggle, and it must not be dropped:
    // `etag` is an attribute on the upstream `Campaign` type but is NOT in its `Required` list, so
    // the body may legitimately carry none while `Response(StatusOK, Header("etag:ETag"))` always
    // does. Discarding it breaks precisely the interaction this feature enables — pause, then
    // resume — because after a successful toggle the caller's own etag is stale, and a stale
    // If-Match is answered with 412. Preferring the header over the body is deliberate for the
    // same reason: where both exist they mirror the same version, and where they disagree the
    // header is the one the response contract guarantees.
    return { ...response.data, etag: readEtag(response) ?? response.data.etag };
  }

  /**
   * Search the project's HubSpot marketing emails, so a user can pick the template to clone.
   *
   * This read is what makes the email channel usable at all: `hubspotConfig.sourceEmailId` is
   * REQUIRED with no default, and staging clones a template, so a user who cannot choose one
   * cannot stage anything.
   *
   * A SEARCH rather than a dropdown, deliberately. campaign-service caps an unfiltered listing at
   * 500 and the wire result has no pagination field, so a portal with more would show a truncated
   * list indistinguishable from a complete one — the exact shape of falsehood a picker must not
   * have. `possiblyTruncated` below is how the caller can tell.
   *
   * `q` does NOT reach HubSpot. Its list endpoint cannot be queried by name or subject, so
   * campaign-service walks every page and matches in-process. Do not describe this as server-side
   * search: the service's own design warns that reading it that way invites optimising the walk
   * away, reintroducing the false absence the cap exists to prevent.
   *
   * The filtered walk is COMPLETE-OR-ERROR, not unbounded — an earlier version of this comment
   * said unbounded and was wrong. `SearchEmails` (campaign-service
   * `internal/platform/hubspot/email.go`) caps at `maxListPages = 200` and, on exhausting it,
   * returns "exceeded 200 pages; refusing to page unbounded" rather than a partial list. So a
   * filtered search either sees every page or fails; it never quietly returns a subset. That is
   * why `possiblyTruncated` is only meaningful for the EMPTY query — the capped screen is the one
   * case where a partial result is returned as if complete.
   *
   * `enabled: false` for a project with no usable HubSpot connection, matching `saveBrief` and
   * `createCampaigns`: an absent connection is the steady state everywhere the channel is not set
   * up, so it must not surface as an error. The caller renders "connect HubSpot" for it.
   */
  public async searchHubSpotEmails(req: Request, projectSlug: string, query: string): Promise<HubSpotEmailSearchResult> {
    if (projectSlug === '') {
      // Refused rather than defaulted, for the reason `loadBrief` refuses: `/projects//…` is a
      // DIFFERENT route that 404s at the gateway, and a gateway 404 is not the service saying
      // "no such project".
      return { enabled: true, emails: [], error: 'A HubSpot template search requires the project it is scoped to.', possiblyTruncated: false };
    }

    const path = `/projects/${encodeURIComponent(projectSlug)}/connection-hubspot/emails`;
    try {
      // Query params go in the FIFTH argument. `proxyRequestWithResponse(req, service, path,
      // method, query, data)` — passing them sixth would send them as a body, which a GET
      // discards, and the search would silently return the unfiltered list.
      const response = await this.microserviceProxy.proxyRequestWithResponse<{ emails?: CampaignServiceMarketingEmail[] }>(
        req,
        'LFX_V2_CAMPAIGN_SERVICE',
        path,
        'GET',
        query === '' ? undefined : { q: query }
      );
      // Rows without an id are DROPPED, not mapped to `id: ''`. This is the value the staging
      // config's required `sourceEmailId` takes, so an id-less row is a choice the user cannot
      // make — rendering it would offer a template that fails on submit.
      // A 200 with no `emails` ARRAY is malformed, not an empty portal, and the difference is the
      // whole point of this component. `?? []` reported it as `enabled: true` with zero templates
      // — indistinguishable from a portal that genuinely has none, which is the false absence this
      // search exists to avoid. campaign-service draws the same line one layer up: `SearchEmails`
      // treats a nil results array as a decode error precisely because a genuinely empty portal
      // returns `[]`, not nothing. Thrown so the catch below reports a read failure.
      const wire = response.data?.emails;
      if (!Array.isArray(wire)) {
        throw new Error('campaign-service returned a 2xx with no emails array');
      }

      // The WIRE count, taken BEFORE the id filter below. Truncation is a property of what
      // campaign-service sent, not of what survived our filtering: a genuinely capped 500 carrying
      // one id-less row filters to 499, and `499 >= 500` would report a truncated listing as
      // complete — the precise falsehood this flag exists to prevent.
      const wireCount = wire.length;
      const emails = wire.filter((email) => typeof email.id === 'string' && email.id !== '').map(fromMarketingEmail);
      // Derived here because the wire cannot express it: a capped 500 and a complete 500 are the
      // same bytes. Only an EMPTY query is capped, so a filtered search is never flagged.
      return { enabled: true, emails, error: null, possiblyTruncated: query === '' && wireCount >= UNFILTERED_EMAIL_CAP };
    } catch (error) {
      // A missing connection is not a failure of this request: campaign-service answers its own
      // typed 404 — "no HubSpot connection configured for this project" — which is exactly the
      // state the picker should render as "connect HubSpot".
      //
      // The BODY is checked, not just the status, and that is the same distinction `findBrief`
      // draws: a gateway 404 is not the service's 404. `/projects//connection-hubspot/emails`
      // with an empty slug, a routing change, or an ingress miss all produce a bare 404 too, and
      // reporting those as "no connection" would tell the user to connect something that is
      // already connected while hiding a real outage.
      if (error instanceof MicroserviceError && error.statusCode === 404 && isCampaignServiceNotFound(error.errorBody)) {
        return { enabled: false, emails: [], error: null, possiblyTruncated: false };
      }
      logger.warning(req, 'hubspot_email_search', 'campaign-service refused the HubSpot template search', {
        projectSlug,
        err: error instanceof Error ? error.message : String(error),
      });
      return {
        enabled: true,
        emails: [],
        error: 'HubSpot templates could not be loaded. Try again, or check the HubSpot connection.',
        possiblyTruncated: false,
      };
    }
  }

  /**
   * Read live metrics for EVERY campaign on a brief, in one request.
   *
   * This is the read that makes campaign-service's `action_items` reachable at all. Until now
   * nothing in this app called it: the Optimize tab derives its action items from FOUR separate
   * rule engines in this BFF (`campaign-metrics.service.ts`, `linkedin-ads.service.ts`,
   * `reddit-ads.service.ts`, `meta-ads.service.ts`), which disagree with each other and with
   * campaign-service on the low-CTR threshold, the impression floor beneath which CTR is not
   * judged, and whether a paused campaign raises anything at all.
   *
   * Nothing is cut over here. This adds the read; the tab keeps its existing source until a
   * caller is wired, because the two are not equivalent in SCOPE — see below.
   *
   * ## Brief-scoped, where the existing engines are account-scoped
   *
   * The BFF engines query each ad platform directly and report on every campaign in the ad
   * account. This reports on the campaigns campaign-service has adopted onto ONE brief. Swapping
   * one for the other narrows what an operator sees, so a consumer must pass the brief it means
   * — there is no "all campaigns" call here, and constructing one by fanning out over briefs
   * needs the brief ids from the Query Service, which owns brief lists (rule 3).
   *
   * ## Failures are per-row, and are not measurements
   *
   * A brief spans several platforms and each read can fail independently, so one campaign's
   * failure must not fail the request. Every campaign gets a row; only `status === 'ok'` carries
   * `metrics`, and a failed row omits it rather than zero-filling. Callers MUST NOT default a
   * missing `metrics` to zeroes — that is precisely the substitution that renders an outage as a
   * performance result, and it is the defect this row shape exists to prevent.
   *
   * For the same reason `ok_count` travels alongside `rows`: an empty `action_items` is not an
   * all-clear if half the rows could not be read.
   *
   * ## The window is a QUERY parameter
   *
   * Passed as the proxy's fifth argument, which is `query` — the sixth is the request body. A
   * window sent in the body position would reach the wire as no window at all, with no type
   * error, and campaign-service would silently apply per-platform defaults instead.
   *
   * Omitted when the caller does not specify one, rather than defaulted here, because upstream
   * resolves the default PER ROW: `defaultMetricsWindowFor` runs inside the fan-out and gives
   * X Ads `last_7_days` (its stats endpoint caps a query at 7 days) and everything else
   * `last_30_days`. An explicit window overrides that for every row.
   *
   * Defaulting here would therefore DISCARD the per-platform fallback rather than fail: an X row
   * that would have been served at 7 days comes back `unsupported`, and the other rows report
   * normally. The lost row is quiet, which is why the default belongs upstream.
   */
  public async getBriefMetrics(req: Request, projectSlug: string, briefId: string, window?: CampaignMetricsWindow): Promise<BriefMetrics> {
    if (projectSlug === '' || briefId === '') {
      // Refused rather than sent, for the reason `loadBrief` and `searchHubSpotEmails` refuse: an
      // empty segment makes `/projects//briefs//metrics`, a DIFFERENT route that 404s at the
      // gateway. A gateway 404 is not campaign-service saying the brief does not exist, and a
      // caller cannot tell the two apart from the status code alone.
      throw new Error('A brief metrics read requires both the project and the brief it is scoped to.');
    }
    return this.microserviceProxy.proxyRequest<BriefMetrics>(
      req,
      'LFX_V2_CAMPAIGN_SERVICE',
      `/projects/${encodeURIComponent(projectSlug)}/briefs/${encodeURIComponent(briefId)}/metrics`,
      'GET',
      window ? { window } : undefined
    );
  }

  /**
   * After an ambiguous create failure, find out whether the POST actually committed.
   *
   * Returns the row when it is provably THIS request's, and `null` when the create did not happen
   * or the row cannot be claimed — in which case the caller rethrows the original error, which is
   * the honest outcome for a save whose fate is unknown.
   *
   * Two conditions have to hold before adopting a row, and both matter:
   *
   * - `version === 1`. A higher version means the row has been written more than once, so it is
   *   not the untouched product of this POST, and adopting it would hand this session ownership
   *   of edits it never made.
   * - the stored payload matches what this request sent. Without it, a row another writer created
   *   in the same window would be adopted, and the next save would replace THEIR brief under this
   *   caller's id — the precise overwrite the ownership guard exists to prevent.
   *
   * A 4xx is never reconciled: it is a refusal, so nothing committed and the original error is
   * the accurate answer. Only genuinely indeterminate failures reach the lookup.
   */
  private async reconcileLostCreate(
    req: Request,
    basePath: string,
    eventSlug: string,
    envelope: CampaignServiceBriefEnvelope,
    error: unknown
  ): Promise<ApiResponse<CampaignServiceBrief> | null> {
    // version === 1: the row must be the untouched product of THIS POST. A higher version carries
    // edits this request never made, so adopting it would claim someone else's work.
    return this.reconcileLostWrite(req, basePath, eventSlug, envelope, error, (version) => version === 1);
  }

  /**
   * After an ambiguous write failure, find out whether it actually committed.
   *
   * Shared by the create and replace paths, which differ only in what version the row may carry.
   * A create must find version 1 — anything higher is not its own row. A replace has no such
   * bound: it does not know what version its PUT produced, and the payload comparison is what
   * establishes the row is the one it wrote.
   *
   * Returns the row when it is provably THIS request's, and `null` when the write did not happen
   * or the row cannot be claimed, in which case the caller rethrows the original error.
   */
  private async reconcileLostWrite(
    req: Request,
    basePath: string,
    eventSlug: string,
    envelope: CampaignServiceBriefEnvelope,
    error: unknown,
    versionIsAcceptable: (version: number) => boolean
  ): Promise<ApiResponse<CampaignServiceBrief> | null> {
    // A request that never left this process cannot have committed, so there is nothing to
    // reconcile — skip the reads rather than spending them proving a negative. Same class as the
    // `definitelyRejected` case below; see `requestNeverLeft`.
    if (requestNeverLeft(error)) {
      return null;
    }
    const definitelyRejected = error instanceof MicroserviceError && error.statusCode >= 400 && error.statusCode < 500 && error.statusCode !== 408;
    if (definitelyRejected) {
      return null;
    }

    // Read more than once, with a delay between attempts, because a single immediate GET does not
    // settle an ambiguous POST. Aborting our local fetch does not stop campaign-service: the
    // request may still be in flight upstream, so the first read can legitimately 404 and the
    // commit land a moment later. Returning on that 404 would leave the caller without the id and
    // every later save refused as unowned — the exact stranding this function exists to prevent,
    // just moved to a narrower window.
    //
    // BOUNDED by attempts AND by wall clock. This runs inside a request that has already spent
    // part of its own budget on the POST that failed, and each read here carries the client's own
    // 30s timeout that this layer cannot shorten — so counting only the sleeps, as an earlier
    // revision did, understated the worst case by an order of magnitude. Two extra reads a second
    // apart cover a commit that lands just after the abort; a read that hangs instead consumes
    // the budget and stops the loop rather than being followed by two more.
    let found: ApiResponse<CampaignServiceBrief> | null = null;
    const startedAt = Date.now();
    for (let attempt = 0; attempt < this.reconcileReadAttempts; attempt++) {
      if (attempt > 0) {
        // Checked BEFORE the sleep and again AFTER it. Before, because a read that hung for the
        // client's full 30s has already outlived any window a late commit was going to land in.
        // After, because the sleep itself can carry the loop past the budget: an attempt passing
        // the first check at 4.5s would otherwise wake at 5.5s and still launch a fresh 30s read,
        // which is exactly the amplification the budget exists to stop.
        if (Date.now() - startedAt >= this.reconcileReadBudgetMs) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, this.reconcileReadDelayMs));
        if (Date.now() - startedAt >= this.reconcileReadBudgetMs) {
          break;
        }
      }
      try {
        const read = await this.microserviceProxy.proxyRequestWithResponse<CampaignServiceBrief>(req, 'LFX_V2_CAMPAIGN_SERVICE', basePath, 'GET', {
          event_slug: eventSlug,
        });
        found = read ?? null;
        // A successful read is not the same as a settled write, and this is where create and
        // replace differ. A create has no row until it commits, so any 200 answers the question.
        // A REPLACE always has a row: the first read can return 200 carrying the PRE-PUT payload
        // while the timed-out write is still in flight, and breaking there rethrows the timeout
        // moments before the PUT lands — leaving the client holding a stale ETag for a row that
        // did change.
        //
        // So stop only once the row LOOKS LIKE this request's write. If it never does, the loop
        // runs out of attempts or budget and the original error is reported, which is the same
        // honest answer as before.
        if (read?.data !== undefined && versionIsAcceptable(read.data.version) && storedBriefMatches(read.data, envelope.brief)) {
          break;
        }
      } catch (readError) {
        // A 404 is "not there YET" on this path, not "not there": the write may still be in
        // flight upstream. Any other read failure says nothing at all. Both are worth another
        // look while attempts remain; when they run out, report the ORIGINAL failure rather than
        // one describing the recovery attempt.
        void readError;
      }
    }
    if (found === null) {
      return null;
    }
    if (found.data === undefined || !versionIsAcceptable(found.data.version) || !storedBriefMatches(found.data, envelope.brief)) {
      return null;
    }
    // "write", not "create": this helper now serves the replace path too, and labelling a
    // recovered PUT as a create points production diagnostics at the wrong operation.
    logger.warning(req, 'campaign_persist_brief_reconciled', 'a write whose response was lost had in fact committed', {
      briefId: found.data.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return found;
  }

  /**
   * Replace an existing brief and approve the result.
   *
   * `update-brief` declares `PreconditionRequired` (428) for a missing `If-Match`, and the
   * version number is NOT a substitute: the design says the ETag "mirrors" the version, which
   * fixes the correspondence but not the serialisation — quoting, weak-validator prefix and
   * all. Synthesising one would be a guess that either 428s or, worse, matches the wrong
   * revision. Fail loudly instead.
   */
  private async replaceBrief(
    req: Request,
    basePath: string,
    envelope: CampaignServiceBriefEnvelope,
    existing: { brief: CampaignServiceBrief; etag: string | null },
    knownEtag: string | null,
    allowEtagFallback: boolean,
    eventSlug: string
  ): Promise<CampaignBriefPersistResult> {
    if (existing.etag === null) {
      throw new Error(`campaign-service returned brief ${existing.brief.id} with no ETag; cannot safely replace it`);
    }

    // The caller's LAST-SEEN validator when it has one, and only the freshly-read one as a
    // fallback. Using the find's ETag unconditionally made this header ceremonial: that find runs
    // inside this very save, so its validator always matches and the 412 can never fire. It looks
    // like optimistic concurrency and provides none — if another writer updated the row after
    // this tab last saw it, the PUT would re-fetch THEIR validator and silently overwrite their
    // content.
    //
    // The fallback is now conditional, and the earlier reasoning for making it unconditional was
    // wrong: it said refusing a validator-less save "would be worse than a race it cannot yet
    // detect", which is true for one of the two reasons a validator can be missing and false for
    // the other.
    //
    // `allowEtagFallback` — the caller has no validator BY CHOICE, and taking the freshly read
    // one is exactly what that choice means. Two client paths set it: the user proceeded past a
    // stale-brief warning, or they restored a brief whose read carried no ETag. This layer does
    // not distinguish them, and must not start to: both assert that stored content was displayed
    // and acted on, which is the whole of what the flag claims.
    //
    // Without it, the absence is UNKNOWN: the write returned no ETag, or its approval outcome was
    // indeterminate. Nobody was warned and nothing was decided, so substituting a validator this
    // request read itself would bypass the precondition silently and could overwrite an
    // intervening writer with no conflict ever shown. Refuse instead — the caller can retry, and
    // a retry that is refused again is visible, which a silent overwrite is not.
    if (knownEtag === null && !allowEtagFallback) {
      return { enabled: true, briefId: existing.brief.id, etag: null, created: false, approved: false, conflict: 'unverified-validator' };
    }
    const validator = knownEtag ?? existing.etag;

    let updated;
    try {
      updated = await this.microserviceProxy.proxyRequestWithResponse<CampaignServiceBrief>(
        req,
        'LFX_V2_CAMPAIGN_SERVICE',
        `${basePath}/${encodeURIComponent(existing.brief.id)}`,
        'PUT',
        undefined,
        envelope,
        { 'If-Match': validator }
      );
    } catch (error) {
      // A 412 is the validator doing its job: this caller owns the brief but another writer moved
      // it since the caller last saw it. Reported as a conflict rather than an error because the
      // save was REFUSED, not failed — nothing was overwritten, which is the outcome the header
      // exists to produce. It is a distinct value from `unowned-brief-exists` because the remedy
      // differs: this caller may replace the brief once it has seen the newer version.
      //
      // Only when the caller supplied its own validator. With the fallback, the ETag came from
      // the find inside this same save, so a 412 means something changed in the microseconds
      // between the two calls — indistinguishable to the user from an ordinary failure, and not
      // a stale-view story worth telling.
      if (knownEtag !== null && error instanceof MicroserviceError && error.statusCode === 412) {
        return { enabled: true, briefId: existing.brief.id, etag: null, created: false, approved: false, conflict: 'stale-brief' };
      }

      // A non-412 failure is not necessarily a failed WRITE. A timeout, a reset, or a gateway 5xx
      // can all follow a replacement that committed — the same ambiguity the create path
      // reconciles and the approval path reasons about, and this one was left rethrowing.
      //
      // The cost of getting it wrong is worse here than on create, because it is silent: the
      // client is told the brief "could not be saved" while the new payload is durable, keeps its
      // now-stale ETag, and the next attempt is deterministically refused as `stale-brief`. The
      // user sees a failure, retries, and is told someone else changed their brief — when the
      // someone else was them.
      // Any version: unlike a create, a replace does not know which version its PUT produced.
      // The payload comparison is what establishes the row is the one this request wrote.
      // NEWER than the version the find observed, not merely "any version". A save whose content
      // is unchanged — re-proceeding without editing — looks identical before and after the PUT,
      // so a payload match alone accepts the PRE-PUT row as proof the write landed. The code then
      // approves that old version while the real PUT may still commit afterwards and reset it to
      // `draft`, having already reported `approved: true`.
      //
      // A committed replace always bumps the version, so `> existing.brief.version` is what
      // actually distinguishes "the write landed" from "the row never changed".
      const reconciled = await this.reconcileLostWrite(req, basePath, eventSlug, envelope, error, (version) => version > existing.brief.version);
      if (reconciled === null) {
        throw error;
      }
      updated = reconciled;
    }
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
      // Whether the write's ETag is still the current one depends on whether the approval
      // definitely did NOT happen, and only a 4xx says that. A 4xx is a refusal: something that
      // understood the request declined it, so no version was bumped and `writeEtag` still
      // describes the brief in the database.
      //
      // 412 is the exception, and it is the exception for the opposite reason to the 5xx below.
      // The approval carries `If-Match: writeEtag`, so a 412 is the server saying that validator
      // does NOT match what it holds — the brief moved between the write and the approval. The
      // approval did not commit, but `writeEtag` is still known-stale, which is the one thing a
      // returned validator must never be.
      //
      // Everything else is indeterminate, and reporting `writeEtag` for it would be a guess
      // dressed as a fact. A local timeout (surfaced as 408, see below), a connection reset, or
      // a 5xx from the gateway can all follow a commit whose response was lost —
      // `approve-brief` does `version = version + 1`,
      // so if it did commit, the validator being returned here is one version stale. Report no
      // validator at all rather than a wrong one; `null` already means "none available" on this
      // result (see the no-ETag branch above), and the read path re-reads the ETag from the
      // server before every write, so nothing downstream is left without one.
      // 408 is EXCLUDED even though it is a 4xx. `ApiClientService` turns a local `AbortError`
      // into `MicroserviceError(408, 'TIMEOUT')` (`api-client.service.ts:122` and `:306`), so a
      // 408 here is our own deadline firing, not campaign-service refusing anything — the
      // request may well have committed upstream with its response lost, which is precisely the
      // indeterminate case this branch exists to keep out of `writeEtag`. A 408 that genuinely
      // came from the gateway is indistinguishable at this boundary and means the same thing:
      // the request may or may not have been processed.
      // A TYPED 404 means campaign-service itself says the row is gone — deleted or archived
      // between the write and the approval — not that a gateway lost the request. Left in
      // `definitelyRejected` it returned the write ETag with no conflict, so the component
      // rendered "Brief saved." for a brief that no longer exists.
      //
      // It joins 412 as `superseded-after-write` rather than getting its own value: to the user
      // the situation is the same one that message already describes — the write landed, and what
      // is stored now may not be theirs. The distinction between "someone replaced it" and
      // "someone removed it" changes nothing they can act on.
      const removedAfterWrite = error instanceof MicroserviceError && error.statusCode === 404 && isCampaignServiceNotFound(error.errorBody);
      // Deliberately NOT widened with `requestNeverLeft` the way the create path is. The two
      // look alike and are not: this arm runs after the write already SUCCEEDED, on the
      // follow-up approve. `ECONNRESET` here means the approve was sent and its reply was lost —
      // campaign-service may have committed it and bumped the version — so the outcome is
      // genuinely unknown, which is what the sibling test at "reports no validator when the
      // approval outcome is unknown" pins. `requestNeverLeft` answers "did the bytes leave", and
      // only a connect-time failure makes that a proof; a mid-flight reset does not.
      const definitelyRejected =
        error instanceof MicroserviceError &&
        error.statusCode >= 400 &&
        error.statusCode < 500 &&
        error.statusCode !== 412 &&
        error.statusCode !== 408 &&
        !removedAfterWrite;
      logger.warning(
        req,
        'campaign_persist_brief_approve',
        definitelyRejected ? 'brief was saved but the approval was rejected' : 'brief was saved but the approval outcome is unknown',
        { briefId, error: error instanceof Error ? error.message : String(error) }
      );
      // `approved: false` in BOTH cases, and it is not a claim that the brief is in draft — it is
      // the absence of a confirmation. It only ever costs a re-approval, which Phase 3 has to be
      // able to do regardless: it re-checks approval at a version, since anyone may have edited
      // the brief in between.
      // A 412 is reported as a CONFLICT, not merely as an unapproved save. Same premise as the
      // validator reasoning above, followed through to what it means for the user: the brief
      // moved between the write and the approval, so another writer replaced it after this save
      // committed. The write is durable, but the row may no longer HOLD it — and the component
      // renders any non-conflict result as "Brief saved.", which would confirm durability for
      // content that is no longer there. That is the one thing this banner must never say.
      //
      // Distinct from `stale-brief`, which is a refusal BEFORE anything was written. Here the
      // write did land, so the honest message is that it may have been overwritten since rather
      // than that it was not saved.
      const supersededAfterWrite = (error instanceof MicroserviceError && error.statusCode === 412) || removedAfterWrite;
      return {
        ...saved,
        etag: definitelyRejected ? writeEtag : null,
        approved: false,
        ...(supersededAfterWrite ? { conflict: 'superseded-after-write' as const } : {}),
      };
    }
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
 * Whether a stored brief is the one this request sent.
 *
 * Compares the WHOLE payload, opaque blobs included. Two rounds of review narrowed this: first
 * only `program_type` and `event_slug`, then `url` and `platforms` as well. Both times I excluded
 * the four `Any` fields on the reasoning that the service round-trips them without interpreting,
 * so key order and whitespace might not survive and a mismatch would reject a row that really is
 * ours — stranding the user, which this reconciliation exists to prevent.
 *
 * That reasoning was wrong, and checkably so: the columns are `JSONB`
 * (`000002_create_brief_campaign_tables.up.sql`), which normalises key order and strips
 * whitespace on storage. A STRUCTURAL comparison — parsed values, not serialised text — is
 * therefore stable across the round trip, and the hazard I kept citing does not exist.
 *
 * It matters because the first-class columns alone do not discriminate: two briefs for the same
 * event normally share program, slug, url AND platform selection, differing only in the generated
 * copy. Without the blobs, a lost create could adopt another writer's row, approve it, and report
 * this caller's unsaved content as saved.
 */
function storedBriefMatches(stored: CampaignServiceBrief, sent: CampaignServiceBriefInput): boolean {
  const storedPlatforms = stored.platforms ?? [];
  const sentPlatforms = sent.platforms ?? [];
  const samePlatforms = storedPlatforms.length === sentPlatforms.length && storedPlatforms.every((p, i) => p === sentPlatforms[i]);
  return (
    stored.program_type === sent.program_type &&
    stored.event_slug === sent.event_slug &&
    (stored.url ?? '') === (sent.url ?? '') &&
    samePlatforms &&
    deepEqual(stored.event_details, sent.event_details) &&
    deepEqual(stored.copy, sent.copy) &&
    deepEqual(stored.keywords, sent.keywords) &&
    deepEqual(stored.targeting, sent.targeting)
  );
}

/**
 * Structural equality over parsed JSON values.
 *
 * Key ORDER is deliberately ignored — that is the whole point, since it is the property the
 * round trip does not preserve and the reason a text comparison would be wrong. Arrays stay
 * order-SENSITIVE: a reordered platform or keyword list is a different payload, not the same one
 * written differently.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  // `null` and `undefined` both mean "absent" here: `toBriefInput` omits a field the UI left
  // empty, and the service stores SQL NULL for it, so the two sides spell the same absence
  // differently on a row that really is ours.
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a ?? null) === (b ?? null);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  // The UNION of keys, not a length match. `toBriefInput` builds fields like `url` and
  // `event_details` as `undefined` when the brief omits them; `JSON.stringify` drops those keys
  // on the way out, so the stored row comes back with FEWER keys than the in-memory payload. A
  // length check therefore rejects this request's own write and strands the row the
  // reconciliation exists to recover.
  //
  // Comparing the union defers to the null/undefined rule above, which already treats an absent
  // key and an explicit undefined as the same absence.
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  return [...keys].every((k) => deepEqual(ao[k], bo[k]));
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
  // The top-level `event_slug` participates in the identity check, not only in constructing the
  // result below. It is the REQUIRED, authoritative key — the one this row was retrieved by — so
  // a blob carrying neither name nor slug is still identifiable when the column has one. Checking
  // the blob alone reported `{ event_slug: 'event-a', event_details: { city: 'Paris' } }` as
  // unreadable, discarding a brief the Implementation tab could name perfectly well.
  const eventDetails = asEventDetails(found.event_details, asText(found.event_slug));
  if (eventDetails === null) {
    return null;
  }

  // The top-level `url` wins over the one inside the opaque `event_details` blob, mirroring the
  // write: `toBriefInput` sends `url: brief.eventDetails?.registrationUrl`, so the first-class
  // field is the one campaign-service is guaranteed to hold. `event_details` is opaque JSON the
  // service stores without interpreting, so a brief written by any other client may carry the
  // destination ONLY in `url` — reading just the blob would drop the registration URL from an
  // otherwise valid brief, and the Implementation tab would restore a campaign pointing nowhere.
  const registrationUrl = asText(found.url) || eventDetails.registrationUrl;

  // Same precedence for the slug, and here the first-class field is not merely guaranteed —
  // it is the REQUIRED key this brief was found by (`Brief` declares event_slug required;
  // find-brief matches on it). The copy inside the opaque `event_details` blob is whatever
  // the writing client happened to nest there, so a brief written by anything other than
  // this adapter may carry the authoritative slug ONLY at the top level. Preferring the blob
  // would rebuild a brief whose slug disagrees with the key it was just retrieved with.
  const eventSlug = asText(found.event_slug) || eventDetails.slug;

  if (found.program_type !== 'events' && found.program_type !== 'education') {
    return null;
  }

  const copy = asRecord(found.copy) ?? {};
  const targeting = asRecord(found.targeting) ?? {};

  // Narrowed against the union rather than passed through: an unknown platform id reaches a
  // template that indexes icon and label maps by it, and renders blank rather than erroring.
  //
  // Narrowed to `CampaignPlatform`, NOT `CampaignAnyPlatform`, deliberately: this feeds the PAID
  // planner's channel selection, and `hubspot` is not one of its channels. That means a stored
  // email brief's `hubspot` is filtered out here and — because of the guard below — would read as
  // UNREADABLE rather than as an email brief.
  //
  // No client sends such a brief TODAY (the email planner omits `platforms`), but that is a client
  // guarantee and this is a server reading whatever campaign-service stored, so it does not bound
  // what can arrive — the same reasoning `campaign-proxy.service.ts` applies to its own inputs.
  // The case is deferred rather than dismissed: restoring an email brief needs a different shape,
  // not a wider filter here, and widening this one would hand `hubspot` to a paid channel picker
  // that has no such channel. That is LFXV2-3224's to solve deliberately.
  const selectedPlatforms = (found.platforms ?? []).filter((p): p is CampaignPlatform => CAMPAIGN_PLATFORMS.some((o) => o.id === p));

  // A stored brief that names platforms, none of which this build recognises, is UNREADABLE —
  // not a brief with no platforms. `populateFromBrief` applies the selection only when it is
  // non-empty (`if (brief.selectedPlatforms?.length)`), so an empty array leaves its default of
  // `google-ads` standing: a Reddit-only brief would restore as a Google Ads campaign, with the
  // user's real choice silently replaced by one they never made. Reporting it unreadable puts
  // that in front of them instead.
  //
  // Only when platforms were STORED. A brief that genuinely lists none is a different case and
  // stays readable — nothing is being contradicted, and the default is then the ordinary one.
  if ((found.platforms ?? []).length > 0 && selectedPlatforms.length === 0) {
    return null;
  }

  return {
    eventDetails: { ...eventDetails, slug: eventSlug, registrationUrl },
    programType: found.program_type as CampaignProgramType,
    selectedPlatforms,
    structuredCopy: asStructuredCopy(copy['structured']),
    // Each platform requires exactly the string fields ITS variant interface declares, because
    // those are the ones consumers dereference without checking:
    //   LinkedIn — `variant.introText.length` (implementation-tab.component.html:338)
    //   Meta     — `v.primaryText.trim()` and `v.headline.trim()` (…component.ts:238)
    // Requiring only the shared `headline` was not enough, and a per-platform list that is not
    // the interface's own field set is a claim that goes stale the moment a field is added.
    linkedInCopy: asVariantCopy<LinkedInBriefCopy>(copy['linkedIn'], LINKEDIN_VARIANT_FIELDS),
    redditCopy: asVariantCopy<RedditBriefCopy>(copy['reddit'], REDDIT_VARIANT_FIELDS),
    metaCopy: asVariantCopy<MetaBriefCopy>(copy['meta'], META_VARIANT_FIELDS),
    keywords: asKeywords(found.keywords),
    campaignGoal: CAMPAIGN_GOALS.some((o) => o.id === targeting['campaignGoal']) ? (targeting['campaignGoal'] as CampaignGoal) : null,
    totalBudget: typeof targeting['totalBudget'] === 'number' && Number.isFinite(targeting['totalBudget']) ? targeting['totalBudget'] : null,
    hsUtm: typeof targeting['hsUtm'] === 'string' ? targeting['hsUtm'] : null,
    driveFolderUrl: typeof targeting['driveFolderUrl'] === 'string' ? targeting['driveFolderUrl'] : '',
  };
}

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
function asEventDetails(value: unknown, topLevelSlug: string): CampaignEventDetails | null {
  const details = asRecord(value);
  if (details === null) {
    return null;
  }

  const name = asText(details['name']);
  const slug = asText(details['slug']);
  // The top-level slug counts as identity: it is the required column this row was found by, so a
  // blob with neither name nor slug is unidentifiable only when that column is empty too.
  if (name.trim().length === 0 && slug.trim().length === 0 && topLevelSlug.trim().length === 0) {
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
 * shape is mostly not validated — restating the generator's schema here would put it in a second
 * place — but every ARRAY field is coerced, because those are not merely rendered. An earlier
 * version of this comment claimed a missing field is "a blank line rather than a crash"; that
 * holds for text, and does not hold for a field a consumer calls `.map()` or `.length` on.
 * `populateFromBrief` assigns `recommendedGeoTargets` straight into a signal whose type says
 * `LinkedInGeoTarget[]`, and `canSubmit` then maps over it — so a stored block without that key
 * throws on Restore rather than showing a gap.
 *
 * Coercing to `[]` rather than rejecting the block: an absent array is a brief saved before that
 * field existed, which is ordinary, and an empty list renders as "none selected" — the truthful
 * answer. Rejecting would turn a readable brief into `unreadable` over a field the user may not
 * even use.
 *
 * `undefined` and not `null`: all three are optional on `CampaignBriefOutput`, and absent is
 * exactly what a brief generated for a different platform set looks like.
 */
/**
 * Keep only the ELEMENTS whose type the consumers actually dereference.
 *
 * Checking that a field is an array is not enough to make it safe to cast. These blocks come out
 * of campaign-service's opaque `Any` columns, which nothing validates on the way in, so an older
 * or hand-edited row can hold `[null]` as easily as objects — and the Implementation tab
 * dereferences elements directly (`v.primaryText.trim()` at implementation-tab.component.ts:238,
 * `g.urn` at :243), so one bad element crashes Restore rather than degrading it.
 *
 * The element type differs BY FIELD and getting that backwards is its own bug: `variants` and
 * `recommendedGeoTargets` hold objects, while the other seven recommendation fields are
 * `string[]`. Filtering the string fields for objects would silently empty every restored
 * keyword, skill and subreddit — a worse outcome than the crash, because it looks like success.
 *
 * Bad elements are DROPPED rather than failing the whole block: one unusable element carries no
 * recoverable content while the rest of the brief still does, and an empty array is what an
 * absent field already produces and what the consumers already handle
 * (`variants().length === 0` disables submit).
 */
/**
 * The snake_case per-platform blocks the Implementation tab actually restores from.
 *
 * This is the path this app's OWN round-trip takes, and it was the one left unhardened. Planning's
 * Proceed emits `structuredCopy` and never sets `metaCopy`/`redditCopy`, and
 * `populateFromBrief` reads `structuredCopy['meta_ads']` FIRST and only falls back to the
 * camelCase blocks — so every element guard added to `asVariantCopy` sat on a branch that this
 * app's own briefs never reach.
 *
 * The dereferences are the same shape as the camelCase side, on differently-named fields:
 * `v.primary_text` (implementation-tab.component.ts:578) on Meta variants, and Reddit variants
 * cast straight into a typed signal the template then reads. A `null` element throws.
 *
 * Unknown keys are preserved untouched: this blob is opaque and another client may store blocks
 * this build does not render, so dropping them would lose content the next writer still owns.
 */
function asStructuredCopy(value: unknown): Record<string, unknown> | null {
  const structured = asRecord(value);
  if (structured === null) {
    return null;
  }
  const cleaned: Record<string, unknown> = { ...structured };
  for (const [key, required] of STRUCTURED_VARIANT_BLOCKS) {
    const block = asRecord(cleaned[key]);
    if (block === null) {
      continue;
    }
    cleaned[key] = { ...block, variants: objectElementsWith(block['variants'], required) };
  }
  for (const [key, fields] of STRUCTURED_STRING_LISTS) {
    const block = asRecord(cleaned[key]);
    if (block === null) {
      continue;
    }
    const coerced: Record<string, unknown> = { ...block };
    for (const field of fields) {
      if (field in coerced) {
        coerced[field] = stringElements(coerced[field]);
      }
    }
    cleaned[key] = coerced;
  }
  return cleaned;
}

/**
 * Which snake_case block carries variants, and the fields its consumer dereferences.
 *
 * `google_search` is absent deliberately: it has no variants array, only `headlines` and
 * `descriptions`, which are string lists handled below.
 */
const STRUCTURED_VARIANT_BLOCKS: readonly (readonly [string, readonly string[]])[] = [
  ['meta_ads', ['primary_text', 'headline']],
  ['reddit_promoted', ['headline']],
];

/**
 * The string-list fields inside structured blocks, by block.
 *
 * `google_search.headlines` reaches a `for...of` in `populateFromBrief`
 * (implementation-tab.component.ts:527), so a stored `42` throws "is not iterable" rather than
 * degrading — a different failure from the variant case, and one the variant filter does not
 * touch. The others are cast straight into typed signals the template iterates.
 */
const STRUCTURED_STRING_LISTS: readonly (readonly [string, readonly string[]])[] = [
  ['google_search', ['headlines', 'descriptions']],
  ['meta_ads', ['recommended_geos']],
  ['reddit_promoted', ['recommended_subreddits', 'recommended_interests', 'recommended_keywords', 'recommended_geos']],
];

/**
 * The required string fields of each platform's variant interface.
 *
 * Typed as `(keyof X)[]` so adding a required string to the interface without adding it here is a
 * COMPILE error rather than a crash on someone's Restore — the failure mode the first version of
 * this filter had, where object-ness alone let `{}` through and `v.primaryText.trim()` threw.
 */
const LINKEDIN_VARIANT_FIELDS: readonly (keyof LinkedInCreativeVariant)[] = ['introText', 'headline'];
const REDDIT_VARIANT_FIELDS: readonly (keyof RedditAdVariant)[] = ['headline'];
const META_VARIANT_FIELDS: readonly (keyof MetaAdVariant)[] = ['primaryText', 'headline'];

function objectElements(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((el): el is Record<string, unknown> => asRecord(el) !== null) : [];
}

/**
 * Object elements that actually carry the string fields the consumers dereference.
 *
 * Object-ness alone is not enough, which the first version of this filter got wrong: a stored
 * `{}` is a plain object, survives `objectElements`, and is then cast to `MetaAdVariant` — where
 * `canSubmit` calls `v.primaryText.trim()` (implementation-tab.component.ts:238) and throws. The
 * same holds for a geo target with no `urn` (`:243`).
 *
 * Requiring the fields the consumer READS is the check that matches the hazard. An element
 * missing them cannot be rendered or submitted, so dropping it loses nothing recoverable.
 */
function objectElementsWith(value: unknown, required: readonly string[]): Record<string, unknown>[] {
  return objectElements(value).filter((el) => required.every((k) => typeof el[k] === 'string'));
}

function stringElements(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((el): el is string => typeof el === 'string') : [];
}

function asVariantCopy<T>(value: unknown, variantRequiredFields: readonly string[]): T | undefined {
  const block = asRecord(value);
  if (block === null || !Array.isArray(block['variants'])) {
    return undefined;
  }
  const coerced: Record<string, unknown> = { ...block };
  // `variants` is NOT in VARIANT_COPY_ARRAY_FIELDS — that list is the RECOMMENDATION fields — so
  // it is filtered explicitly here. It is also the field the crash reports named.
  // Which fields are required depends on the PLATFORM, because the dereferences do. `canSubmit`
  // reads `v.primaryText.trim()` on Meta variants (implementation-tab.component.ts:238), so a
  // Meta variant carrying only `headline` still throws — requiring the shared field alone was not
  // enough, and reasoning that such a variant "has nothing to submit anyway" missed that the
  // dereference happens BEFORE any such judgement.
  coerced['variants'] = objectElementsWith(coerced['variants'], variantRequiredFields);
  for (const key of VARIANT_COPY_ARRAY_FIELDS) {
    coerced[key] = key === 'recommendedGeoTargets' ? objectElementsWith(coerced[key], ['urn']) : stringElements(coerced[key]);
  }
  return coerced as T;
}

/**
 * The array-valued fields across the three per-platform copy blocks.
 *
 * Listed rather than derived, because the type system cannot enumerate keys of an interface at
 * runtime — but the list must be COMPLETE, and the first version of it was not: it named four
 * fields and missed `recommendedGeos`, `recommendedGroups`, `recommendedJobFunctions` and
 * `recommendedSkills`, each of which is a `string[]` a consumer iterates. A partial list here
 * is worse than none, because it reads as exhaustive.
 *
 * Kept honest by `TestVariantCopyArrayFieldsCoversEveryArrayField`-style coverage in the spec,
 * which asserts every one of these coerces — add a field to either brief-copy interface and the
 * grep that finds `recommended*: string[]` should find it here too. Grouped by owning platform
 * so a new field lands beside its siblings; a key absent from a given platform's block is simply
 * coerced to `[]` there and never read.
 */
const VARIANT_COPY_ARRAY_FIELDS = [
  // LinkedIn (`LinkedInBriefCopy`)
  'recommendedGeoTargets',
  'recommendedJobFunctions',
  'recommendedSkills',
  'recommendedGroups',
  // Reddit (`RedditBriefCopy`)
  'recommendedSubreddits',
  'recommendedInterests',
  'recommendedKeywords',
  'recommendedGeos',
] as const;

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
