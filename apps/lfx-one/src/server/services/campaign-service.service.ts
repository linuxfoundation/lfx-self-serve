// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { CampaignJobStatus, CampaignPlatformResult } from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { MicroserviceError } from '../errors';
import { MicroserviceProxyService } from './microservice-proxy.service';
import { ProjectService } from './project.service';

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
 * resolving one fixed slug, and this is it. Not 'the-linux-foundation' — 'tlf' is the
 * canonical form; the longer spelling resolves to nothing.
 */
const LF_PROJECT_SLUG = 'tlf';

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
  private readonly projectService: ProjectService;

  /**
   * Memoised LF project uid. A slug→uid mapping is immutable for the life of a project, so
   * caching it avoids a NATS round-trip on every campaign request.
   *
   * Only a SUCCESSFUL resolution is ever cached. `getProjectIdBySlug` converts a NATS
   * timeout or a 503 no-responder into `exists: false` — indistinguishable, at this layer,
   * from "there is no such project" — so caching a negative would turn one blip in the NATS
   * connection into a permanently broken campaigns page for the lifetime of the pod, fixable
   * only by a restart. An uncached negative costs one retry per request instead, which is
   * the correct trade.
   */
  private lfProjectUid: string | null = null;

  public constructor(microserviceProxy?: MicroserviceProxyService, projectService?: ProjectService) {
    this.microserviceProxy = microserviceProxy ?? new MicroserviceProxyService();
    this.projectService = projectService ?? new ProjectService();
  }

  /**
   * Resolve the LF project uid that scopes every campaign-service path.
   *
   * Throws rather than returning a sentinel when resolution fails. The caller's alternative
   * would be to fall back to the vendor-direct path, and a SILENT fallback is the worst
   * available outcome: the page keeps working, so nobody investigates, and the cutover is
   * reported as verified while every request is still being served by the code it was
   * supposed to replace. A loud failure is recoverable by turning the flag off.
   */
  public async resolveLfProjectUid(req: Request): Promise<string> {
    if (this.lfProjectUid) {
      return this.lfProjectUid;
    }

    const result = await this.projectService.getProjectIdBySlug(req, LF_PROJECT_SLUG);
    if (!result.exists || !result.uid) {
      // 503, not 404. `getProjectIdBySlug` reports `exists: false` for BOTH "no such project"
      // and "the query timed out / no NATS responder", and the two are indistinguishable from
      // here. A 404 would tell the operator the LF project is missing — it is not — and would
      // read as a permanent, client-side condition on a fault that is transient and ours.
      throw new MicroserviceError(`could not resolve the '${LF_PROJECT_SLUG}' project needed to reach campaign-service`, 503, 'SERVICE_UNAVAILABLE', {
        operation: 'resolve_lf_project_uid',
        service: 'campaign_service_client',
      });
    }

    this.lfProjectUid = result.uid;
    return result.uid;
  }

  /**
   * Read a campaign-creation job's status.
   *
   * The path this replaces keeps jobs in an in-process `Map`
   * (`campaign-proxy.service.ts`), which only works while every poll happens to land on the
   * pod that started the job — the code already logs that symptom by name. campaign-service
   * persists jobs, so this survives a replica switch.
   */
  public async getJobStatus(req: Request, jobId: string): Promise<CampaignJobStatus> {
    const projectUid = await this.resolveLfProjectUid(req);
    const response = await this.microserviceProxy.proxyRequest<CampaignServiceJobPollResponse>(
      req,
      'LFX_V2_CAMPAIGN_SERVICE',
      `/projects/${encodeURIComponent(projectUid)}/jobs/${encodeURIComponent(jobId)}`,
      'GET'
    );
    return adaptJobPollResponse(response);
  }
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
 *   - `succeeded` forwarded raw is likewise not `'running'`, so it would never terminate the
 *     poll either; the page would spin to the 300s cap on a job that finished immediately.
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
