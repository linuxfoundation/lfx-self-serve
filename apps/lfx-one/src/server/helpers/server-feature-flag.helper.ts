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
   * That id-shape distinction is what makes an overlapping rollout safe FOR JOB POLLING, and only
   * for that: campaign-service mints UUID job ids and the legacy path mints `job_...`, so a poll
   * is answered by whichever system actually owns that job regardless of which pod serves it. A
   * CREATE-flag-on pod creating and a CREATE-flag-off pod polling still works.
   *
   * It says NOTHING about the rest of a campaign's life. The same overlap mints a UUID campaign
   * that a pod without `CampaignServiceStatusToggle` refuses to pause — see that flag's doc below.
   * Do not read this paragraph as "an overlapping CREATE rollout is safe"; it covers the poll and
   * nothing else.
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
   * Gates whether a Performance Max, Video or Display Google campaign may be OFFERED at all.
   *
   * Offering is not unlocking. On, this permits a Performance Max or Display create and lets the
   * Video box render disabled-with-a-reason instead of vanishing; no value of it permits a Video
   * CREATE, which `GOOGLE_VIDEO_CREATE_SUPPORTED` refuses unconditionally one layer up.
   *
   * The same question `CampaignServiceDemandGen` asks, about a later set of channels: does the
   * DEPLOYED campaign-service understand `googleAdsConfig.channel` values beyond `search` and
   * `demand-gen`? Those three ship with linuxfoundation/lfx-v2-campaign-service#272.
   *
   * The failure it prevents depends on HOW old that service is, and the two cases differ:
   *
   *   - Before LFXV2-3257 there is no `channel` field to decode. Go's JSON decoder drops the
   *     unknown key, the dispatcher builds its default SEARCH campaign — real budget, no
   *     keywords, and per its own `googleAdsConfig.Keywords` doc it "can never serve" — and the
   *     job reports SUCCESS. The wrong campaign is found later in Google Ads, money spent. This
   *     silent case is the one `CampaignServiceDemandGen` was written for.
   *   - From LFXV2-3257 the field exists and an unrecognised value is REFUSED by name
   *     (`unsupported channel "performance-max" (want "search" or "demand-gen")`) before Google
   *     is contacted, so nothing is created and nothing is charged. Noisy, not silent.
   *
   * Default-deny covers both, because nothing on this side can tell the two apart: there is no
   * version endpoint, and a successful create proves nothing about WHICH channel it created.
   *
   * SEPARATE from the Demand Gen flag rather than widened into it. A deployment running
   * LFXV2-3257 has had Demand Gen for months and its flag is on; folding these three into that
   * same flag would turn them on everywhere Demand Gen already is, which is precisely the
   * guess this mechanism exists to avoid. OFF by default.
   */
  CampaignServiceGoogleChannels = 'LFX_CUTOVER_CAMPAIGN_SERVICE_GOOGLE_CHANNELS',

  /**
   * Gates the per-platform Bidding control in the create flow (#3299): Automatic or Manual with a
   * max CPC bid, sent as `bidding` on `linkedInConfig`, `metaConfig`, `microsoftConfig` and
   * `redditConfig`. Not Google Ads, which has its own bidding plan.
   *
   * A CAPABILITY flag, like `CampaignServiceDemandGen`: it says the DEPLOYED campaign-service
   * understands `bidding` (linuxfoundation/lfx-v2-campaign-service#332). An older one drops the
   * unknown key — Go's decoder ignores it — and creates every campaign on automatic bidding, so a
   * Manual choice would be silently lost and the job would report success. Turn it on only once
   * #332 is deployed in the target environment.
   *
   * Only meaningful while the create cutover is on (`cutoverOwnsCreate`): the legacy creator does
   * not read `bidding` either, which is why the capability the client sees
   * (`CampaignListResult.biddingEnabled`) needs both. With it off the control is hidden and the
   * create route refuses a request that carries `bidding` rather than dropping it.
   *
   * Turning it back off strands nothing: campaigns already created keep the bidding they were
   * created with, and new creates are automatic again. OFF by default. Same accepted values as the
   * flags above.
   */
  CampaignServiceBidding = 'LFX_CUTOVER_CAMPAIGN_SERVICE_BIDDING',

  /**
   * Applies the create flow's flight dates to Microsoft Ads, sent as `startDate` and `endDate`
   * (`"YYYY-MM-DD"`) on `microsoftConfig` — the same keys and format `metaConfig` carries.
   *
   * A CAPABILITY flag, like `CampaignServiceBidding`: it says the DEPLOYED campaign-service
   * understands the two keys and sets them on the Microsoft ad group
   * (linuxfoundation/lfx-v2-campaign-service#409). An older one drops the unknown keys — Go's
   * decoder ignores them — and creates the campaign with no flight, so the dates would be silently
   * lost and the job would report success. Turn it on only once #409 is deployed in the target
   * environment.
   *
   * Only meaningful while the create cutover is on (`cutoverOwnsCreate`): the legacy creator does
   * not read Microsoft dates either, which is why the capability the client sees
   * (`CampaignListResult.microsoftScheduleEnabled`) needs both. With it off the form sends no
   * Microsoft dates and keeps its "ignores the flight dates" warning, and the create route refuses
   * a request that carries either key rather than dropping it.
   *
   * Turning it back off strands nothing: campaigns already created keep their flight, and new
   * creates have none again. OFF by default. Same accepted values as the flags above.
   */
  CampaignServiceMicrosoftSchedule = 'LFX_CUTOVER_CAMPAIGN_SERVICE_MICROSOFT_SCHEDULE',

  /**
   * Offers X (`twitter-ads`) in the create flow: the Plan picker lets it be chosen and the
   * Implement tab builds a `twitterConfig` (budget, flight dates, an authored promoted-only tweet,
   * an optional tweet image and, with `CampaignServiceBidding`, a bidding choice).
   *
   * A PRODUCT switch more than a capability one: every campaign-service from v1.0.21 dispatches an
   * X create (`TwitterDispatcher`), so turning it on is a decision to let operators create X
   * campaigns, not a wait for a release. Two things it does not change, and both are deliberate:
   * the static `disabled: true` on X in `CAMPAIGN_PLATFORMS`, which stays the default every client
   * falls back to, and the Monitor tab, which offers X on `monitorable` whatever this says.
   *
   * Only meaningful while the create cutover is on (`cutoverOwnsCreate`): the legacy creator has no
   * X path at all, so the capability the client sees (`CampaignListResult.twitterCreateEnabled`)
   * needs both. With it off X stays "Coming soon" in the picker, and the create route refuses a
   * request carrying `twitterConfig` or selecting `twitter-ads` with a 400 naming the field.
   *
   * Turning it back off strands nothing: X campaigns already created stay where they are, paused
   * or live, and are still listed, monitored and pausable. OFF by default. Same accepted values as
   * the flags above.
   */
  CampaignServiceTwitterCreate = 'LFX_CUTOVER_CAMPAIGN_SERVICE_TWITTER_CREATE',

  /**
   * Offers an image UPLOAD in the Reddit section of the create flow, sent as
   * `redditConfig.imageAssetId` instead of a pasted `imageUrl` (decision D3).
   *
   * A CAPABILITY flag, like `CampaignServiceBidding`: it says the DEPLOYED campaign-service has
   * creative-asset URL signing configured (`CREATIVE_ASSET_URL_SIGNING_KEY` and
   * `CREATIVE_ASSET_PUBLIC_BASE_URL`, LFXV2-2665). Without them campaign-service refuses every
   * `imageAssetId` with a 400, because Reddit can only fetch an image from a public URL and the
   * signed URL is how a stored asset becomes one. Turn it on only once both are set.
   *
   * Only meaningful while the create cutover is on (`cutoverOwnsCreate`): the legacy creator never
   * reads `imageAssetId`, so the capability the client sees
   * (`CampaignListResult.redditAssetUploadEnabled`) needs both. With it off the upload control is
   * hidden, the upload route refuses, and the create route refuses a request carrying
   * `redditConfig.imageAssetId` rather than dropping it. The pasted image URL is unaffected either
   * way. OFF by default. Same accepted values as the flags above.
   */
  CampaignServiceRedditAssets = 'LFX_CUTOVER_CAMPAIGN_SERVICE_REDDIT_ASSETS',

  /**
   * Offers a stored-image LIBRARY in each Google creative image slot — upload an image into the
   * brief's library, or pick a stored one that fits the slot — sent as `{ imageAssetId }` entries in
   * the slot's own array beside any pasted image URLs (`demandGenCreative.logoImages`,
   * `performanceMaxCreative.marketingImages` and the rest).
   *
   * A CAPABILITY flag like `CampaignServiceRedditAssets`, but it asserts something DIFFERENT, and
   * the difference matters enough to state rather than inherit. It does NOT say URL signing is
   * configured: Google's dispatch path reads the stored bytes and POSTs them base64-encoded to
   * `assets:mutate`, so no URL ever leaves the service and the signing settings are irrelevant to
   * it (`internal/dispatch/googleads_creative_assets.go` and `googleads_image_ref.go` hold no signer
   * reference; the only signing gate in the repo is Reddit's `checkRedditAssetChoice`). What it says
   * is that the DEPLOYED campaign-service resolves Google creative asset ids, which every release
   * from v1.0.21 does (lfx-v2-campaign-service#394). An older one types those arrays as strings and
   * cannot decode an object entry, so its Google create fails rather than launching without the image.
   *
   * It is a SIBLING of the Reddit flag rather than a widening of it so the two can ship
   * independently: they assert different upstream capabilities, and one flag would mean Reddit asset
   * upload could never be enabled without Google's, or the reverse.
   *
   * Only meaningful while the create cutover is on (`cutoverOwnsCreate`): the legacy creator reads
   * no creative key at all, so the capability the client sees
   * (`CampaignListResult.googleAssetUploadEnabled`) needs both. With it off the Google library
   * controls are hidden, Create is blocked while a stored image is still held, and the create route
   * refuses a request carrying a Google `imageAssetId` rather than dropping it; the upload route
   * still admits an upload on any other asset flag's authority. It does NOT gate the brief's asset
   * list, get, plan and delete routes: those are addressed by a campaign-service brief and gate on
   * `CampaignServiceBriefs` like every other brief route, so a deployment running Reddit uploads
   * alone can still read and prune the same library. The pasted image URL is unaffected either way.
   * ON in the chart, like the Meta sibling, because nothing has to be configured on campaign-service
   * first; same accepted values as the flags above.
   */
  CampaignServiceGoogleAssets = 'LFX_CUTOVER_CAMPAIGN_SERVICE_GOOGLE_ASSETS',

  /**
   * Offers an image UPLOAD in the Meta section of the create flow, sent as
   * `metaConfig.variants[].imageAssetId` instead of a pasted image URL.
   *
   * A CAPABILITY flag like `CampaignServiceGoogleAssets`, and it asserts the same kind of thing: no
   * URL signing is involved, because Meta's dispatch path reads the stored bytes and uploads them to
   * the ad account's image library (`internal/dispatch/meta.go`, `resolveVariantAssets`). What it
   * says is that the DEPLOYED campaign-service resolves Meta asset ids, which every release from
   * v1.0.21 does. It is its own flag so Meta uploads can be switched off without touching Reddit's
   * or Google's.
   *
   * Only meaningful while the create cutover is on (`cutoverOwnsCreate`): the legacy creator reads
   * no Meta image at all, so the capability the client sees
   * (`CampaignListResult.metaAssetUploadEnabled`) needs both. With it off the Meta upload control is
   * hidden and the create route refuses a request carrying a Meta `imageAssetId` rather than
   * dropping it; the upload route still admits an upload on either sibling flag's authority. The
   * pasted image URL is unaffected either way. ON in the chart; same accepted values as the flags
   * above.
   */
  CampaignServiceMetaAssets = 'LFX_CUTOVER_CAMPAIGN_SERVICE_META_ASSETS',

  /**
   * Offers an image UPLOAD in the LinkedIn section of the create flow, sent as
   * `linkedInConfig.variants[].imageAssetId` (the same image on every variant).
   *
   * A CAPABILITY flag of the Meta kind: no URL signing is involved, because LinkedIn's dispatch path
   * reads the stored bytes and uploads them once through LinkedIn's Images API, then uses the image
   * URN as each dark post's article thumbnail (`internal/dispatch/linkedin_creative.go`,
   * `resolveLinkedInImages`). What it says is that the DEPLOYED campaign-service resolves LinkedIn
   * asset ids, which every release from v1.0.21 does. Its own flag so LinkedIn uploads can be
   * switched off without touching the other platforms'.
   *
   * Only meaningful while the create cutover is on (`cutoverOwnsCreate`): the legacy creator reads
   * no `imageAssetId`, so the capability the client sees
   * (`CampaignListResult.linkedInAssetUploadEnabled`) needs both. With it off the LinkedIn upload
   * control is hidden and the create route refuses a request carrying a LinkedIn `imageAssetId`
   * rather than dropping it; the upload route still admits an upload on any sibling flag's
   * authority. ON in the chart; same accepted values as the flags above.
   */
  CampaignServiceLinkedInAssets = 'LFX_CUTOVER_CAMPAIGN_SERVICE_LINKEDIN_ASSETS',

  /**
   * Serve `PATCH /api/campaigns/:campaignId/status` from lfx-v2-campaign-service instead of the
   * per-platform SDK calls in `campaign-proxy.service.ts`. OFF keeps the current behaviour
   * byte-for-byte.
   *
   * This flag buys REACH, not just a different backend. The legacy path is a `switch` over
   * `meta-ads` and `reddit-ads` whose `default` arm throws, so pause is unavailable for every
   * other platform no matter what the allowlist says. Turning this on is what makes Google Ads
   * and LinkedIn pausable at all — and pause is the primary cost-control lever on a mis-targeted
   * campaign.
   *
   * REACHES THE UI as of LFXV2-3224. This previously said the flag exposed the server path only,
   * because no component could call `CampaignService.updateCampaignStatus` without a campaign
   * UUID, brief id and ETag. The Optimize tab now obtains all three from `listBriefCampaigns` and
   * renders a per-row Pause/Resume control (`optimization-tab.component.ts`), so turning this on
   * is user-visible: it is what makes those buttons live rather than `Unavailable`. The flag is
   * read into `statusToggleEnabled` on the list response and gates the control itself, so a
   * flag-off deployment renders the rows with a stated reason instead of a doomed button.
   * Said here as well as in the chart because this doc is what a reader reaches from the code.
   *
   * Two SETS live here and conflating them invites deleting a guard that is doing its job:
   * campaign-service implements a toggle dispatcher for every paid platform upstream, but what
   * this flag exposes is the shared `TOGGLEABLE_CAMPAIGN_PLATFORMS` (create-enabled plus
   * adoptable platforms) — a platform can be dispatchable upstream and not reachable here.
   * Deliberately not stated as a count: the roster changes as platforms are enabled or become
   * adoptable, and a number here goes stale silently. See `CAMPAIGN_SERVICE_STATUS_PLATFORMS`
   * for why the narrowing is deliberate.
   *
   * MISROUTING IS IMPOSSIBLE HERE, unlike `CampaignServiceJobs`, and the reason is worth stating
   * because that flag's hazard looks identical. Routing depends on the campaign id's SHAPE as
   * well as the flag, and the two id spaces are disjoint: campaign-service keys campaigns by
   * UUID, while the legacy path's ids are the ad platform's own numeric ids (`NUMERIC_ID_RE`).
   * A numeric id therefore cannot address a campaign-service row, and a UUID cannot address a
   * platform one — so no request can be claimed by BOTH paths, which is the condition this
   * file's header names as requiring a no-overlap rollout. A flag-off pod receiving a UUID
   * refuses with a clear error instead of dispatching to the wrong backend; it does not answer
   * a confident falsehood the way an off-pod job poll did.
   *
   * That is NARROWER than "an overlapping rollout is safe", which an earlier revision of this
   * comment claimed. A refusal is well-formed and still a failure: the pod returns 400 from
   * `campaign.controller.ts`, and pause is the primary cost-control lever on a spending
   * campaign. So this flag must not share a rollout with `CampaignServiceCreate`.
   *
   * The dependency that makes the ordering free: a campaign only has a UUID if it was created
   * through campaign-service, so this flag is INERT until `CampaignServiceCreate` has produced
   * rows. Enabling it first therefore changes nothing observable, which is exactly why it ships
   * first — and why the reverse order is the one that costs.
   *
   * IT DOES NOT COME BACK OFF. Once UUID campaigns exist the inertness above is spent: a UUID is
   * permanent, and `campaign.controller.ts` refuses a pause for any UUID while this flag is off.
   * Disabling CREATE stops NEW campaign-service campaigns but does nothing about the existing
   * ones, so unlike `CampaignServiceJobs` there is no drain condition to wait out — turning this
   * off removes the primary cost-control lever from campaigns that may still be spending.
   */
  CampaignServiceStatusToggle = 'LFX_CUTOVER_CAMPAIGN_SERVICE_STATUS_TOGGLE',

  /**
   * Gates the Google Ads keyword and audience READS (`getKeywords`, `getAudience` in
   * `campaign.controller.ts`) on campaign-service instead of this BFF's own Google Ads calls.
   *
   * Unlike every other cutover flag, this one changes the NUMBERS rather than only the backend.
   * The legacy queries in `campaign-metrics.service.ts` carry no campaign filter at all, so they
   * report the whole shared Google Ads customer — every foundation's keywords and demographics,
   * to whichever project happens to be on screen. Campaign-service scopes the identical reads to
   * the project's own campaigns (`campaignScopePredicate`). Turning this on therefore makes the
   * tables SMALLER, and that is the fix, not a regression: the larger figures were other
   * foundations' spend. Say so when enabling it, because a reader who is not told will file the
   * drop as a bug.
   *
   * The legacy arm is ROOT-only (writer or `global_marketing_ops`, lfx-self-serve-ops#54),
   * independently of the monitor cutover. Non-root callers receive the shared-account restriction
   * instead of keywords or demographics; enabling this flag retains their project-scoped reads.
   *
   * A project with no campaign-service campaigns reads EMPTY rather than falling back, and that
   * is deliberate. The fallback would be the account-wide read, which is the cross-tenant leak
   * this flag exists to close — so an empty table is the honest answer for a project whose
   * campaigns were never created through campaign-service.
   *
   * NOTHING IS STRANDED BY TURNING THIS OFF. Both routes are reads with no persisted state and
   * no UUID-shaped id space, so flipping back strands no work — the opposite of
   * `CampaignServiceStatusToggle`, where only one backend can address the id space.
   *
   * That is not the same as "off works". Where the `GADS_*` variables were deactivated, the
   * legacy arm calls `getGadsClient()`, which throws before any read. In those environments
   * flipping back does not restore the previous behaviour; it breaks the keywords and audience
   * reads outright.
   *
   * This is a property of the GADS_* credentials, not of this flag — every legacy path that
   * reaches `getGadsClient()` shares it. Do not read any flag's note as a promise that the
   * others roll back cleanly; check the mechanism each one names.
   *
   * Does NOT gate `executeKeywordActions`. That route MUTATES live keywords, so it has its own
   * flag — `CampaignServiceKeywordActions`, defined just below — because a write needs a
   * rollback story a read does not. The two are independent: enabling this one leaves keyword
   * actions wherever their own flag puts them.
   */
  CampaignServiceInsights = 'LFX_CUTOVER_CAMPAIGN_SERVICE_INSIGHTS',

  /**
   * Routes keyword pause/remove through campaign-service instead of this BFF's own Google Ads
   * mutate calls.
   *
   * SEPARATE from `CampaignServiceInsights`, which covers the two keyword/audience READS, and
   * the split is deliberate: this one MUTATES live paid campaigns, so it needs a rollback story
   * a read does not. Flipping the reads back STRANDS nothing -- they persist no state, so there
   * is nothing left behind either way (whether the legacy read still functions is a separate
   * question, answered on `CampaignServiceInsights` itself). A REMOVE cannot be undone: Google
   * cannot re-enable a removed criterion, only create a new one with a new id.
   *
   * THE GRANULARITY OF FAILURE CHANGES. The legacy path issues one Google call per keyword, so
   * each succeeds or fails alone. campaign-service takes one atomic batch per campaign, so a
   * request spanning several campaigns becomes atomic PER CAMPAIGN and not overall: one
   * campaign's keywords can pause while another's do not. The response still reports every
   * keyword individually, and a campaign-level failure marks all of that campaign's keywords
   * failed rather than leaving anyone to guess which half applied.
   *
   * The fan-out lives in the BFF because `api-catalog.md` rule 5 forbids a bulk cross-campaign
   * mutation endpoint upstream — each call the BFF makes is one permission-evaluated target.
   *
   * The legacy path is ALREADY BROKEN in every environment where the `GADS_*` variables were
   * deactivated: `getGadsClient()` throws before any mutate is attempted. So "off" is not a
   * working fallback here — it is the state in which keyword actions do not work at all. Nor is
   * it one for the INSIGHTS reads, whose legacy arm calls the same `getGadsClient()`; the
   * difference is when the breakage SURFACES: a read fails as soon as the tab is opened, while a
   * write fails only once an operator attempts an action -- at which point it is announced, not
   * silent (`announceKeywordOutcome` on both error arms). Same accepted values as the flags above.
   */
  CampaignServiceKeywordActions = 'LFX_CUTOVER_CAMPAIGN_SERVICE_KEYWORD_ACTIONS',

  /**
   * Serves the Optimize-tab read not yet verified against a published campaign-service endpoint:
   * `GET /api/campaigns/linkedin/campaign-ref`. OFF answers 404, as if the route did not exist, so no
   * deployment calls an upstream route that campaign-service does not serve. LinkedIn's campaign-ref
   * was published after it was gated here and its wire type is still to be re-checked before the
   * flag is turned on.
   *
   * Not a cutover flag: there is no legacy arm. It gates ONLY this route. The other
   * campaign-service-only Optimize routes (Meta/X/Microsoft/LinkedIn/Reddit audience,
   * Meta/Reddit/X/Microsoft campaign-ref, the Reddit keyword read, campaign settings, Meta ad sets, keyword
   * targeting, adopt) are ungated, following the precedent of the Microsoft keyword read and the
   * budget/bid levers: their upstream endpoints exist, and campaign-service answers 400 itself where
   * a platform's metrics are switched off.
   *
   * Turn it on only once campaign-service serves it in the target environment. Turning it back off
   * strands nothing: it is a read. Same accepted values as the flags above.
   */
  CampaignServiceOptimizeReads = 'LFX_CAMPAIGN_SERVICE_OPTIMIZE_READS',

  /**
   * Routes the HubSpot campaign UTM lookup and create through campaign-service instead of this
   * BFF's own HubSpot calls.
   *
   * FOUR BEHAVIOURS CHANGE ON BOTH PATHS, INCLUDING WITH THIS FLAG OFF. This flag switches the
   * BACKEND; it does not gate either of them.
   *
   * 1. The legacy path fabricated a utm token (`id-name`) whenever HubSpot had none, so a
   *    campaign with no configured token still appeared tokenised — and links tagged with that
   *    invented value attribute traffic to a campaign HubSpot cannot report on. BOTH paths now
   *    report a missing token as missing, which the UI already models (`hs_utm` is
   *    `string | null`). Expect fewer apparent tokens, and expect that to be the correct answer.
   *    Deliberately not gated: holding it behind a default-off flag keeps a known-wrong value
   *    in production.
   * 2. The legacy search limit rose from 10 to HubSpot's per-request maximum, and both paths
   *    report whether a match may be hidden. The two go together — that signal is what
   *    suppresses the create offer, and at a limit of 10 nearly every search on a busy portal
   *    would report inconclusive, leaving an operator unable to create anything.
   * 3. Neither path auto-applies a token when the top two candidates SCORE THE SAME. This became
   *    reachable in this PR: the shared scorer now compares normalised names, so campaigns
   *    differing only by case or whitespace tie where one previously won outright, and `sort` is
   *    stable — so the winner would have been whichever row HubSpot returned first. Also not
   *    gated, and for the same reason as (1): a default-off flag would leave a coin-flip
   *    deciding which campaign's UTM goes into an event's links.
   * 4. Neither path auto-applies a LONE WEAK match any more. A single candidate sharing one
   *    long word with the event name used to win by default; an exact NORMALISED name match is
   *    now required before either path reports `found`. Ungated for the same reason as (1) and
   *    (3): auto-applying a weak match writes the wrong campaign's UTM into an event's links,
   *    and holding the correction behind a default-off flag keeps the wrong answer shipping.
   *
   * The create path writes into a PORTAL-WIDE namespace — visible to everyone working in the
   * HubSpot account the project is connected to, which is not necessarily the LF's own, since
   * connections are per project with their own token and portal_id — and performs no duplicate
   * check, which is why the UI warns before offering it.
   *
   * NOT SAFE TO TURN OFF, which an earlier version of this line got backwards. "Off" selects the
   * legacy backend, and that path calls `hsHeaders()` — which throws whenever
   * `HUBSPOT_ACCESS_TOKEN` is absent, and it is absent by design, since the credential moved into
   * campaign-service's encrypted connection store. Flipping this off therefore does not roll back
   * to working behaviour: it breaks BOTH UTM routes outright. An operator reaching for it during
   * an incident would disable the lookup and the create rather than restore them (Copilot).
   *
   * It is also not a full rollback even where the legacy path can run: flipping back restores the
   * previous BACKEND, not the previous BEHAVIOUR. Fabricated tokens, the old search limit, the
   * tie refusal and the weak-match refusal all changed on both paths and are ungated.
   */
  CampaignServiceHubSpotUtm = 'LFX_CUTOVER_CAMPAIGN_SERVICE_HUBSPOT_UTM',

  /**
   * Serves the account monitors from campaign-service's `account-monitor` endpoints (#2519):
   * `/api/campaigns/linkedin/monitor`, `/meta/monitor` and `/reddit/monitor` switch backend, and the campaign-service-only
   * `/microsoft/monitor`, `/twitter/monitor` and `/hubspot/monitor` answer at all (a 404 while OFF —
   * they have no legacy path to fall back to). Google (`/monitor`) has no campaign-service arm, but
   * `/google/accounts` — campaign-service account discovery for the project's Google Ads connection,
   * listed on the Monitor tab's Google panel — is campaign-service-only too, and root-only.
   *
   * THE FLAG DOES NOT ISOLATE SHARED ACCOUNTS. Google Ads, Meta, Reddit and X run ONE ad account
   * shared by every foundation, and campaign-service's `account-monitor` is account-scoped, so either
   * arm returns every foundation's campaigns. Those monitors (`/monitor`, `/meta/monitor`,
   * `/reddit/monitor`, `/twitter/monitor`) are therefore root-only whatever this flag says — a ROOT
   * writer or ROOT `global_marketing_ops` holder; everyone else gets a 403
   * `MONITOR_SHARED_ACCOUNT_RESTRICTED` before any upstream call (lfx-self-serve-ops#54). LinkedIn
   * runs one account per foundation, so only its campaign-service arm is project-isolated: its legacy
   * (flag OFF) arm reads LF's shared allowlist account and is root-only too. Microsoft and HubSpot
   * are not gated.
   *
   * IT CHANGES WHOSE CREDENTIAL READS THE ACCOUNT. The legacy LinkedIn/Meta/Reddit paths read the LF ad
   * account with this app's own environment credentials. Campaign-service resolves the PROJECT'S
   * OWN connection only — never the LF system fallback — and refuses an account that connection
   * is not bound to. So on, the Monitor tab's account pickers are filled from those connections
   * (`/api/campaigns/monitor/connections`) instead of the configured allowlists, and the monitor
   * routes check the account id's SHAPE rather than allowlist membership. A project with no
   * connection of its own for a platform, or whose connection has no account bound, sees that
   * stated in the panel rather than an error. Verify the foundations that use these tabs have
   * connections before turning this on.
   *
   * IT ALSO CHANGES THE NUMBERS, deliberately: campaign-service fixed the rule-engine bugs the
   * legacy LinkedIn and Reddit paths still have (#3018-#3022): MED items now sort between HIGH
   * and LOW on LinkedIn (#3018), and Reddit totals become the sum
   * of the rows, Reddit conversions become "not measured" instead of a fabricated 0 (still rendered
   * as 0 — see `conversionsMeasured`), and the always-firing "not converting" item disappears.
   * LinkedIn loses its creative breakdown and the "no ad creatives" item: campaign-service does not
   * read LinkedIn creative analytics.
   *
   * A MIXED ROLLOUT IS SAFE. The flag is read per pod, and the tab's account picker
   * (`/monitor/connections`) and its monitor read are separate, load-balanced requests, so during a
   * rolling change the read can land on a pod whose flag differs from the one that chose the account.
   * A read whose account came from the connection path carries `accountSource=connection`; a pod
   * with the flag OFF refuses it with a 409 `MONITOR_CUTOVER_MISMATCH` ("The monitor is switching
   * data sources; refresh in a moment.") instead of serving it from the legacy path — which would
   * show LinkedIn's default account under the picked one's name, or refuse Reddit's or Meta's — and
   * the tab's Retry re-checks the data source. An unmarked (legacy-picker) read reaching a pod with
   * the flag ON is served as before; allowlist ids pass the shape check.
   *
   * Reads only, no persisted state and no id space of their own, so flipping it back strands
   * nothing. Same accepted values as the flags above.
   */
  CampaignServiceMonitor = 'LFX_CUTOVER_CAMPAIGN_SERVICE_MONITOR',

  /**
   * Gates `committee.service.ts`'s `updateCommittee` (the `chat_webhook_url` write) and
   * `weekly-brief.service.ts`'s `shareToSlack` (the Slack send) server-side. `WG_WEEKLY_BRIEF_SLACK_FLAG`
   * (`wg-weekly-brief-slack`, an OpenFeature/GrowthBook flag) only gates the Angular UI — the
   * OpenFeature Web SDK it's evaluated through doesn't run server-side, so without this, a direct
   * API caller with ordinary project-writer access could configure or use Slack sharing while the
   * UI still hides it. OFF by default, same as the UI flag, so both must be turned on for the
   * feature to actually be reachable.
   *
   * DO NOT ENABLE until lfx-v2-committee-service escapes Slack mrkdwn control characters
   * (`&`, `<`, `>`) in `brief_text` before sending — as of this writing (LFXV2-3080's
   * backend-send-ownership migration) it does not: `internal/infrastructure/slack/webhook_sender.go`
   * posts `brief.BriefText` to Slack verbatim. This BFF used to escape it before every send
   * (`escapeSlackMrkdwn`, removed when the send moved server-side) specifically because
   * AI-generated brief text is sourced from meeting/document titles — content editable by a
   * broader set of users than project writers — so an unescaped `<!channel>`/`<!here>` would page
   * the entire channel, and `<https://evil.example|label>` would render as a deceptive hyperlink.
   * That mitigation has no server-side equivalent today. File/track the upstream fix before
   * flipping this on in any environment that isn't fully trusted content end-to-end.
   */
  WeeklyBriefSlack = 'LFX_WEEKLY_BRIEF_SLACK_ENABLED',

  /**
   * Gates FGA-based (`marketing_auditor` / `campaign_manager`) authorization on the marketing
   * analytics routes (`analytics.route.ts`) and campaigns routes (`campaigns.route.ts`).
   * OFF establishes an `executive_director`-only baseline: analytics routes that were already
   * gated by LFXV2-3294 preserve their prior behavior exactly, while campaigns routes that
   * previously had no authorization middleware are intentionally tightened to ED-only. Every
   * non-ED request is denied when the flag is off, but this is not a no-op rollback for
   * campaigns — it is a new, stricter default. Operators should expect this tightening.
   *
   * Deliberately independent from any client-side OpenFeature flag: the Web SDK never runs
   * server-side, so without this, a direct API caller with a `marketing_auditor` or
   * `campaign_manager` FGA relation could not reach these routes even after the UI flag turns
   * on the corresponding client guards. Both must be enabled for the feature to actually work.
   *
   * OFF by default per the LFXV2-2231 gap-analysis design requirement: the reverted PR #1112
   * caused a total lockout for all users when its UI guards shipped without a kill switch. This
   * flag exists so a bad rollout can be reverted with an env var, not a revert PR.
   */
  MarketingOpsFga = 'LFX_MARKETING_OPS_FGA_ENABLED',

  /**
   * The master kill switch for the embedded Gatewaze admin pilot (`GwModuleOutletComponent`,
   * mounted under every prefix in `GW_EMBED_ROUTE_PREFIXES`) on the server. OFF answers every
   * `/api/gatewaze/*` request (`gatewaze.route.ts`) with an identical neutral 404 `not_found`,
   * whether or not the caller is authenticated — the point is that an unauthenticated probe cannot
   * distinguish "flag off" from "no such route" from "not authenticated". The embed needs this AND
   * `GatewazeHostSession`; see that flag for why the two stay separate.
   *
   * Deliberately paired with, and independent of, the client-side `gatewaze-embed-enabled`
   * OpenFeature flag (`gatewaze-embed-enabled.guard.ts`). The Web SDK never runs server-side, so
   * the client flag hides the route and nav but leaves the BFF reachable by direct call — this
   * flag is what makes the dark launch a real kill switch.
   *
   * This is a boolean, all-or-nothing gate — it carries no cohort of its own. Tenant scoping is
   * a separate control, and it is **client-side only**: `GW_EMBED_ALLOWED_PROJECT_SLUGS` plus
   * `gwEmbedTenantGuard` keep the embed out of the wrong foundation's chrome, which is a
   * UI-correctness concern rather than a rollout cohort. It deliberately is not a flag.
   *
   * Do not read that allowlist as a boundary on the BFF. It runs in the browser; anyone who can
   * reach `/api/gatewaze/*` bypasses it entirely, and `requireGwEmbedAccess` admits a writer grant
   * on ANY foundation or project by design, because a proxied request names a Gatewaze path rather
   * than an LFX project. What actually bounds the data is `requireGwEmbedAccess` for reachability
   * plus the upstream's own Supabase auth and RLS for authorization — the Gatewaze session is the
   * caller's own, so LFX confers no data access it did not already have.
   *
   * OFF by default. No overlap hazard during a rolling update: every route this gates is
   * read/write-through to the upstream Gatewaze service, so a request either reaches a flag-on pod
   * and proxies, or a flag-off pod and 404s — never a partial write.
   */
  GatewazeEmbedEnabled = 'LFX_GATEWAZE_EMBED_ENABLED',

  /**
   * Gatewaze host-session mode (#2738): LFX One gets the Gatewaze (GoTrue) session server-to-server
   * with GoTrue's `id_token` grant and keeps it in Valkey, so the browser never holds a Gatewaze
   * token. It is the embed's only mode: with it off, `/api/gatewaze` answers the uniform 404 and the
   * outlet shows its not-configured panel.
   *
   * Requires `GatewazeEmbedEnabled`, the session store (`SESSION_STORE_ENABLED` with `VALKEY_URL`),
   * `GW_SUPABASE_URL`, a publishable `GW_SUPABASE_ANON_KEY` and `PCC_AUTH0_SECRET`.
   * `resolveGatewazeHostSessionConfig` (`gatewaze-session.service.ts`) checks them all together; with
   * any missing, host-session mode is off however this flag is set.
   *
   * Kept separate from `GatewazeEmbedEnabled` rather than folded into it plus config presence. Folding
   * it would turn the embed on in any environment that already has the embed flag and the Supabase
   * config but has never run host-session mode, and it would take away the switch that turns off
   * only the server-held sessions. Two flags cost one extra env var.
   *
   * Rolling-update overlap is harmless. A page served by a flag-on pod whose calls land on a
   * flag-off pod gets the uniform 404, which the embed reads as `unavailable` and retries. Nothing
   * is half-written: a stored session is only ever read by a flag-on pod, and it expires on its own
   * TTL if the flag goes off.
   *
   * OFF by default.
   */
  GatewazeHostSession = 'LFX_GATEWAZE_HOST_SESSION',

  /**
   * Mint the EasyCLA corporate-signing `return_url` as `/org/{orgUid}/easycla/{claGroupId}?signed=1`
   * (`orgEasyclaReturnPath`, spec 050 address scheme, lfx-self-serve#2743) instead of the leftover
   * `/org/easycla/{claGroupId}?org={orgUid}&signed=1` (`legacyOrgEasyclaReturnPath`).
   *
   * OFF by default, and the overlap hazard is the whole reason it exists: a `return_url` is fixed
   * when the DocuSign session opens and is served by *whichever* replica takes the return, minutes
   * or days later. During a rolling deploy, or after a rollback, that can be a release that only
   * routes the leftover shape — a new-shape return there is an in-shell not-found. So the release
   * carrying the twin `/org/:orgSegment/easycla` route ships with this OFF, and the flag flips (a
   * chart values change, dev first) once that release is the rollback floor. Every release reads
   * the leftover shape, which is what makes OFF safe in any overlap.
   *
   * The leftover mount and its `?org=` reader are removed (#2743 item 4) one release after this
   * has been ON for a full signing-session lifetime — not one release after the twin route deploys.
   * Removing the knob is part of that same step.
   */
  OrgEasyclaReturnInPath = 'ORG_EASYCLA_RETURN_IN_PATH',
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
