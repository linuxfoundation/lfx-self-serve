// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { JOB_LOST_MESSAGE } from '@lfx-one/shared/constants';
import type { CampaignJobStatus, CampaignPlatformResult } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { MicroserviceError } from '../errors/microservice.error';
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
 * The canonical slug for The Linux Foundation's own project row.
 *
 * `/foundation/campaigns` is a fixed route with no project or slug segment — it is
 * LF-scoped by construction, gated by `executiveDirectorGuard` rather than by a per-project
 * permission. lfx-v2-campaign-service, by contrast, is `/projects/{projectId}/…` scoped
 * throughout and authorises on `campaign_manager` for that project. Bridging the two means
 * one fixed slug, and this is it. Not 'the-linux-foundation' — 'tlf' is the canonical form;
 * the longer spelling resolves to nothing.
 *
 * This value goes on the wire AS THE SLUG, deliberately un-resolved. campaign-service's
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
