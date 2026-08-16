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
 * - `CampaignServiceJobs` — NO LONGER harmless to flip in any order, and this PR is what changed
 *   that. Routing depends on the job id's shape (`isCampaignServiceJobId`) as well as the flag, so
 *   a `job_` id goes to the in-process map on every pod regardless — but the premise that "a UUID
 *   cannot exist until creation is cut over" expired the moment `CampaignServiceCreate` shipped.
 *   A pod with JOBS off skips the shape check entirely and sends a UUID poll to its in-process
 *   map, answering terminal `not_found` for a campaign that is running and SPENDING. JOBS must be
 *   fully rolled out before CREATE and must stay on until outstanding UUID jobs drain; see its
 *   own doc below for the enable and rollback orders.
 * - `CampaignServiceBriefs` — the "harmless while persistence is write-only" argument has also
 *   expired: the read path (`loadBrief`, the Planning restore offer) is live behind this same
 *   flag, deliberately, so read and write flip together. Its doc says why.
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
   * Requires BOTH `CampaignServiceBriefs` AND `CampaignServiceJobs` to be on. `createCampaigns`
   * gates on all three together — with either prerequisite off it returns `enabled: false` and
   * every create silently stays on the legacy path.
   *
   * BRIEFS, because the create route is `/projects/{slug}/briefs/{brief_id}/campaigns` — there is
   * no create-without-a-brief path, so without it there is no brief id to create from.
   *
   * JOBS, because a campaign-service create returns a job the client must then POLL. Creating
   * through the new system while the poll route still assumes legacy `job_...` ids would strand
   * the job: it exists and is spending, and nothing can report on it. JOBS is not merely an
   * "id-shape backstop" here, which is what an earlier version of this doc called it — for CREATE
   * it is a hard prerequisite.
   *
   * That id-shape distinction is what makes an OVERLAPPING rollout safe: campaign-service mints
   * UUID job ids and the legacy path mints `job_...`, so a poll is answered by whichever system
   * actually owns that job regardless of which pod serves it. A CREATE-flag-on pod creating and a
   * CREATE-flag-off pod polling still works.
   *
   * That safety holds only while JOBS is on everywhere, and it is an ORDERING requirement, not
   * just a set of prerequisites: a pod with JOBS off does not apply the id-shape check at all and
   * sends the poll to its in-process map, where a UUID job does not exist. Enable JOBS first and
   * leave it on; disable CREATE first on the way back, and keep JOBS on until every outstanding
   * UUID job has drained. Otherwise a job that is real and SPENDING becomes unreportable.
   *
   * What it does NOT survive is a create that lands flag-on while the ad-platform connection for
   * that project is unconfigured: campaign-service reads credentials from its own connection
   * tables, never from this application's GADS_ / LINKEDIN_ environment variables.
   *
   * There IS a system-account fallback, and it is narrower than it sounds. `credsSource.resolve`
   * (campaign-service `internal/dispatch/creds.go`) falls back to the reserved system scope
   * (`model.SystemProjectID`) when the project has **no connection of its own** — so a create can
   * dispatch on the LF-owned ad account rather than failing. Three qualifications that matter
   * before relying on it:
   *
   *   - ONLY a genuine absence falls back. Any other failure — an unusable row, a decrypt error —
   *     means the project HAS a connection needing attention, and running its campaign on the LF
   *     account would spend LF money on a request the project believed was its own.
   *   - It is an AD-ACCOUNT fallback. HubSpot is deliberately excluded, because falling back there
   *     would write one tenant's contacts into the LF's own portal.
   *   - Spend lands on the LF account. Fine for an LF-run campaign; not what a foundation
   *     expects for theirs.
   *
   * So per-project connections are still the thing to provision before turning this on — created
   * with `POST /projects/{slug}/connection-{provider}` — and the fallback is a safety net for the
   * LF's own campaigns, not a substitute for them.
   */
  CampaignServiceCreate = 'LFX_CUTOVER_CAMPAIGN_SERVICE_CREATE',

  /**
   * Gates whether a Demand Gen Google campaign may be requested at all.
   *
   * SEPARATE from `CampaignServiceCreate` because it asks a different question: not "should
   * creates go through campaign-service?" but "does the DEPLOYED campaign-service understand
   * `googleAdsConfig.channel`?" That field ships with LFXV2-3257, and the two can be out of
   * step — the cutover flag may be on against a service that predates it.
   *
   * The failure it prevents is silent and expensive. Go's JSON decoder ignores unknown keys,
   * so an older campaign-service DROPS `channel` and builds its default SEARCH campaign
   * instead: real budget, no keywords, and per its own `googleAdsConfig.Keywords` doc it "can
   * never serve". Nothing reports an error — the job succeeds, and the wrong campaign is
   * discovered later in Google Ads.
   *
   * A capability flag rather than a version probe: campaign-service exposes no version
   * endpoint, and inferring support from a successful create is exactly the ambiguity that
   * makes the silent-Search case dangerous. OFF by default, so a deployment that has not
   * confirmed the upstream version refuses rather than guesses.
   */
  CampaignServiceDemandGen = 'LFX_CUTOVER_CAMPAIGN_SERVICE_DEMAND_GEN',

  /**
   * Serve `PATCH /api/campaigns/:campaignId/status` from lfx-v2-campaign-service instead of the
   * per-platform SDK calls in `campaign-proxy.service.ts`. OFF keeps the current behaviour
   * byte-for-byte.
   *
   * This flag buys REACH, not just a different backend. The legacy path is a `switch` over
   * `meta-ads` and `reddit-ads` whose `default` arm throws, so pause is unavailable for the
   * other four platforms no matter what the allowlist says. campaign-service wires six
   * dispatchers, so turning this on is what makes Google Ads and LinkedIn pausable at all —
   * and pause is the primary cost-control lever on a mis-targeted campaign.
   *
   * ROLLOUT OVERLAP IS SAFE HERE, unlike `CampaignServiceJobs`, and the reason is worth stating
   * because that flag's hazard looks identical. Routing depends on the campaign id's SHAPE as
   * well as the flag, and the two id spaces are disjoint: campaign-service keys campaigns by
   * UUID, while the legacy path's ids are the ad platform's own numeric ids (`NUMERIC_ID_RE`).
   * A numeric id therefore cannot address a campaign-service row, and a UUID cannot address a
   * platform one — so no request can be claimed by BOTH paths, which is the condition this
   * file's header names as requiring a no-overlap rollout. A flag-off pod receiving a UUID
   * refuses with a clear error instead of dispatching to the wrong backend; it does not answer
   * a confident falsehood the way an off-pod job poll did.
   *
   * The dependency that IS real: a campaign only has a UUID if it was created through
   * campaign-service, so this is only useful once `CampaignServiceCreate` has been on long
   * enough to produce rows. Enabling it earlier is harmless but inert.
   */
  CampaignServiceStatusToggle = 'LFX_CUTOVER_CAMPAIGN_SERVICE_STATUS_TOGGLE',

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
