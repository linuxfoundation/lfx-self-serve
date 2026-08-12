// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

/**
 * Server-side feature flags.
 *
 * The existing `feature-flag.service.ts` is the OpenFeature **Web** SDK: it runs in the
 * browser and returns Angular `Signal<T>`, so it cannot gate an Express handler. This
 * helper covers the server side only, and deliberately stays small. It was added so the
 * campaign-service cutover could move one endpoint at a time and roll a bad one back by
 * changing an environment variable, without shipping code; it now also gates a feature that
 * is not part of that cutover (`WeeklyBriefSlack`), so read it as "server-side flags"
 * generally rather than as cutover machinery.
 *
 * Be precise about what that buys, because "env var" reads as "instant" and it is not. The
 * chart injects these as container environment variables, so changing one edits the Deployment
 * pod template and reaches a process only through a rolling restart. What is avoided is a code
 * change, a build and an image promotion — not a rollout. Plan for the rollout: with the
 * default three replicas and a RollingUpdate, flag-on and flag-off pods overlap for its
 * duration. Whether that overlap is harmless is a PER-FLAG question, not a property of this
 * helper — each flag's own doc below states its answer:
 *
 * - `CampaignServiceJobs` — harmless, because routing also depends on the job id's shape
 *   (`isCampaignServiceJobId`): a `job_` id goes to the in-process map on every pod regardless
 *   of the flag, and a UUID cannot exist until creation is cut over.
 * - `CampaignServiceBriefs` — harmless while persistence is write-only; the flag's doc says
 *   exactly when that expires.
 * - `WeeklyBriefSlack` — gates access to a feature rather than routing between two
 *   implementations, so overlap means some pods refuse a request others serve.
 *
 * A flag whose two paths can BOTH claim the same request needs a no-overlap rollout, or a
 * runtime configuration source every replica observes at once.
 *
 * Env vars are read on EVERY call rather than captured at module load. This buys NOTHING
 * operationally and the reason is worth stating, because per-request reads look like they
 * should: a running process's environment cannot be changed from outside. `kubectl set env`
 * patches the Deployment template and replaces pods; it does not reach into a live container.
 * So a per-call read and a module-load read behave identically in the cluster. The reason to
 * read per call is testability — a value frozen at import time cannot be varied across cases
 * without module-registry surgery — plus keeping the door open for a future dynamic source
 * that mutates `process.env` in-process. The cost is a map lookup per request, which is
 * nothing next to the HTTP call it gates.
 */

/** Every server-side flag, and what turning it ON does. */
export enum ServerFeatureFlag {
  /**
   * Serve `GET /api/campaigns/jobs/:jobId` from lfx-v2-campaign-service instead of the
   * in-process job map in `campaign-proxy.service.ts`. OFF keeps the current behaviour
   * byte-for-byte.
   */
  CampaignServiceJobs = 'LFX_CUTOVER_CAMPAIGN_SERVICE_JOBS',

  /**
   * Persist the generated brief to lfx-v2-campaign-service when the user leaves the Planning
   * tab. OFF keeps the brief where it lives today — a signal in `CampaignsComponent`, lost on
   * reload — and `POST /api/campaigns/brief/persist` answers `{ enabled: false }` without
   * calling anything.
   *
   * Unlike `CampaignServiceJobs` this flag has no id-shape backstop, because there is nothing
   * to disambiguate on the WRITE: persistence is additive.
   *
   * The paragraph that used to sit here said "nothing reads a brief id yet — campaign creation is
   * still the legacy path". Both halves have since stopped being true, and the safety argument
   * that rested on them went with it. The read-back (`loadBrief`, the Planning restore offer)
   * lives behind THIS flag, deliberately: a pod that read while the write flag was off would
   * report an empty brief for one sitting in front of the user. Read and write flip together.
   *
   * `CampaignServiceCreate` then consumes the brief ID this flag produces, which is why it is
   * checked second and is a no-op without this one.
   */
  CampaignServiceBriefs = 'LFX_CUTOVER_CAMPAIGN_SERVICE_BRIEFS',

  /**
   * Route campaign CREATION to lfx-v2-campaign-service instead of the per-platform Express
   * services in `campaign-proxy.service.ts`. OFF keeps the legacy path byte-for-byte.
   *
   * Depends on `CampaignServiceBriefs` and is checked AFTER it, because the create route is
   * `/projects/{slug}/briefs/{brief_id}/campaigns` — there is no create-without-a-brief path.
   * Turning this on while briefs are off yields no brief id and every create falls back to the
   * legacy path, which is safe but silently pointless; the create path says so in its log line
   * rather than failing.
   *
   * It inherits the id-shape backstop the jobs flag introduced, which is what makes an
   * overlapping rollout safe: campaign-service mints UUID job ids and the legacy path mints
   * `job_...`, so a poll is answered by whichever system actually owns that job regardless of
   * which pod serves it. A flag-on pod creating and a flag-off pod polling still works.
   *
   * What it does NOT survive is a create that lands flag-on while the ad-platform connection for
   * that project is unconfigured: campaign-service reads credentials from its own connection
   * tables, never from this application's GADS_ / LINKEDIN_ environment variables. Provision the connection
   * per project slug before turning this on, or every dispatch fails on a missing connection.
   */
  CampaignServiceCreate = 'LFX_CUTOVER_CAMPAIGN_SERVICE_CREATE',

  /**
   * Gates `committee.service.ts`'s `updateCommittee` (the `chat_webhook_url` write) and
   * `weekly-brief.service.ts`'s `shareToSlack` (the Slack send) server-side. `WG_WEEKLY_BRIEF_SLACK_FLAG`
   * (`wg-weekly-brief-slack`, an OpenFeature/GrowthBook flag) only gates the Angular UI — the
   * OpenFeature Web SDK it's evaluated through doesn't run server-side, so without this, a direct
   * API caller with ordinary project-writer access could configure or use Slack sharing while the
   * UI still hides it. OFF by default, same as the UI flag, so both must be turned on for the
   * feature to actually be reachable.
   */
  WeeklyBriefSlack = 'LFX_WEEKLY_BRIEF_SLACK_ENABLED',
}

/**
 * True only for an explicit affirmative value. Everything else — unset, empty, `0`,
 * `false`, or a typo — is OFF.
 *
 * Default-deny is the whole safety property here. If an unrecognised value defaulted to ON,
 * `LFX_CUTOVER_CAMPAIGN_SERVICE_JOBS=flase` would silently route production traffic at a
 * service the operator believed was still dark, and the misspelling is invisible in a
 * values.yaml diff. A typo must fail towards the path that is already known to work.
 */
export function isServerFeatureEnabled(flag: ServerFeatureFlag): boolean {
  const raw = process.env[flag];
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}
