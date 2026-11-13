// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const AKRITES_ENABLED_FLAG = 'akrites-enabled';
export const MKTG_OS_AGENTS_ENABLED_FLAG = 'mktg-os-agents-enabled';
export const WG_ENGAGEMENT_METRICS_FLAG = 'wg-engagement-metrics';
/**
 * Dark-launch gate for the Org Lens Crowdfunding Donations page (lfx-crowdfunding#415): the route (`cfOrgDonationsGuard`,
 * fail closed) and its sidebar entry. Default false. **UI-only**: the BFF stays open, and CF's auditor check on the
 * b2b_org is the authorization boundary.
 */
export const CF_ORG_DONATIONS_FLAG = 'cf-org-donations';
/**
 * Dark-launch gate for the Projects and Foundation lens **Mentorship Programs** sidebar entries (lfx-mentorship#398).
 * Default false. **Sidebar only**: the `/project/mentorship` and `/foundation/mentorship` routes stay reachable by URL, the
 * BFF stays open, and the gateway's `mentorship_program_creator` check on the project (its writers, or its mentorship
 * program admins) is the authorization boundary.
 *
 * **Reused key.** `mentorship-enabled` once gated the whole Mentorship module; #4882 removed that gate when Mentorship went
 * on for everyone in prod, and planned to delete the LaunchDarkly flag afterwards. This gate takes the key over, so before
 * this ships the flag must be retargeted to what these entries should show (off, or the rollout audience), and it must not
 * be deleted while this constant exists: a missing flag reads as `false` and hides both entries.
 */
export const MENTORSHIP_ENABLED_FLAG = 'mentorship-enabled';
/**
 * Dark-launch gate for Slack-webhook sharing (LFXV2-3080) — the settings card
 * (committee-settings-tab) and the "Share to Slack" action (weekly-brief-card) both check this
 * directly. Not a strict child of 'wg-weekly-brief': weekly-brief-card does render under that
 * parent flag (committee-overview.component.ts), but committee-settings-tab does not sit behind
 * it at all (rendered unconditionally from the Settings tab in committee-view.component.html) —
 * so flipping this flag alone is sufficient to expose the settings card. Default false: this is a
 * dark launch, gating rollout independently of when the code itself ships.
 *
 * **UI-only** — this is an OpenFeature/GrowthBook flag evaluated through the OpenFeature Web SDK,
 * which never runs server-side, so it cannot gate an Express handler. The actual write
 * (`committee.service.ts`'s `updateCommittee`) and send (`weekly-brief.service.ts`'s
 * `shareToSlack`) paths are gated independently, server-side, by
 * `ServerFeatureFlag.WeeklyBriefSlack` (`server-feature-flag.helper.ts`) — an env-var kill switch
 * that also defaults off. Both must be enabled for the feature to actually be reachable; flipping
 * only this one hides/shows the UI without changing what a direct API caller can do.
 */
export const WG_WEEKLY_BRIEF_SLACK_FLAG = 'wg-weekly-brief-slack';

/**
 * Dark-launch gate for the committee ↔ mailing-list sync UI across #4022's frontend surfaces:
 * the ON/OFF toggle and direction selector on the mailing list view page (#4024) and the
 * **Sync Now** entry point on the committee Settings tab (#4027). Default false: an unflagged
 * evaluation hides all of them so the feature ships dark ahead of #4022's full rollout. A new
 * consumer (e.g. #4025's committee Auto Sync drawer) reads this same constant rather than
 * defining a duplicate.
 *
 * **UI-only** — this is an OpenFeature/GrowthBook flag evaluated through
 * `FeatureFlagService.getBooleanFlag`, which never runs server-side, so it cannot gate an Express
 * handler. The actual `sync_mode` write (via `MailingListService.updateMailingList`) and the
 * sync-diff/sync-apply BFF endpoints stay reachable by a direct API caller while this is off — the
 * real-time auto-sync execution kill switch is tracked separately as a server-side env-var flag in
 * #4878. Both would need to be enabled for the feature to be fully reachable; this flag alone only
 * controls whether Self Serve renders the Sync Settings UI.
 */
export const MAILING_LIST_COMMITTEE_SYNC_ENABLED_FLAG = 'mailing-list-committee-sync-enabled';

/**
 * **No remaining consumers — nothing in this repo reads this flag.** It gated Org Lens surfaces
 * restricted to internal audiences while their real-data backends were built, and both gates are
 * gone: Org Profile logo upload was ungated in #1887, and person-detail-drawer company emails in
 * #4373 once #1705 → #1830 → #2402 had landed the data behind them.
 *
 * Setting it in LaunchDarkly now changes nothing. The constant is kept only so the retirement is a
 * deliberate step — deleting the key from LaunchDarkly as well as this line — rather than a silent
 * drop. Do not add a new gate to it; a new surface should get its own flag with its own rollout.
 */
export const ORG_LENS_PRIVATE_RELEASE_FLAG = 'org-lens-private-release';

/**
 * Dark-launch gate for the Org Lens family roll-up (#4132): the All Organizations rows in the
 * organization selector and every `/org/family-{top account id}/…` address. Default false. The
 * per-page roll-up views ship behind this same flag, so the public release is one flip once the
 * last page lands.
 *
 * Read through `OrgRollUpFlagService`, which separates "off" from "not known yet": LaunchDarkly
 * answers for an anonymous context before the signed-in one, and a roll-up restored from the
 * cookie or an address must ride that window out rather than be demoted by it.
 *
 * **UI-only** — evaluated through the OpenFeature Web SDK, which never runs server-side, so it
 * cannot gate an Express handler: `/api/orgs/me/roll-up-set` and every other BFF route answer the same
 * with the flag off. This flag only controls whether Self Serve offers and renders the roll-up.
 */
export const ORG_LENS_ROLLUP_ENABLED_FLAG = 'org-lens-rollup-enabled';

/**
 * Dark-launch gate for FGA-based (`marketing_auditor` / `campaign_manager`) Marketing Impact and
 * Campaigns access (LFXV2-2235/LFXV2-2236). Default false: the reverted PR #1112 caused a total
 * lockout for all users when these guards shipped without a kill switch (see the LFXV2-2231
 * gap-analysis post-mortem). Staged rollout required — do not flip to targeting "all users" in
 * one step.
 *
 * **UI-only** — evaluated through the OpenFeature Web SDK, which never runs server-side, so it
 * cannot gate an Express handler. The actual authorization on the marketing analytics
 * (`analytics.route.ts`) and campaigns (`campaigns.route.ts`) routes is gated independently,
 * server-side, by `ServerFeatureFlag.MarketingOpsFga` (`server-feature-flag.helper.ts`) — an
 * env-var kill switch that also defaults off. Both must be enabled for the feature to actually
 * be reachable.
 */
export const MARKETING_OPS_FGA_ENABLED_FLAG = 'marketing-ops-fga-enabled';

/**
 * Dark-launch gate for the LFXV2-3365 Health Metrics Overview replacement page (tiles + findings
 * list). Default false: `foundation/health-metrics` keeps rendering the existing card-based page
 * until this is on. **UI-only**, evaluated through `FeatureFlagService.getBooleanFlag` inside
 * `HealthMetricsGateComponent`'s template `@if` — on SSR no OpenFeature provider is ever
 * registered (it initializes in the browser only), and on the client `getBooleanFlag` keeps
 * returning the default until `FeatureFlagService.initialize(user)` applies the user context and
 * the provider re-identifies, both of which land after the first render — so SSR and first client
 * render both see the `false` default and agree on the legacy page; the swap to the overview page,
 * if any, happens client-side after hydration.
 */
export const HEALTH_METRICS_OVERVIEW_ENABLED_FLAG = 'health-metrics-overview-enabled';

/**
 * Dark-launch gate for the embedded Gatewaze admin pilot — the route trees (see
 * GW_EMBED_ROUTE_PREFIXES) that
 * mounts the `@gatewaze/admin-embed` React app natively (no iframe) inside LFX One. Default false:
 * this is a pilot for a small cohort, and the route guard fails closed like `akritesEnabledGuard`
 * rather than open, since the embed is not ready for general users.
 *
 * **UI-only** — evaluated through `FeatureFlagService.getBooleanFlag`, which is the OpenFeature Web
 * SDK and never runs server-side, so it cannot gate an Express handler. The BFF routes
 * (`/api/gatewaze/*`) are gated independently, server-side, by `ServerFeatureFlag.GatewazeEmbedEnabled`
 * and `ServerFeatureFlag.GatewazeHostSession` (`server-feature-flag.helper.ts`), env-var kill
 * switches that also default off. All three must be enabled for the pilot to actually be reachable.
 */
export const GATEWAZE_EMBED_ENABLED_FLAG = 'gatewaze-embed-enabled';

/**
 * `localStorage` key holding a `Record<string, boolean>` of locally-forced flag values, read by
 * `FeatureFlagService.getBooleanFlag` in **non-production builds only**.
 *
 * This is the supported way to pin a flag in an e2e run. Flag-gated routes are otherwise untestable
 * — the SDK evaluates against an anonymous context before the authenticated one, so a flag targeted
 * at named users reads false in that window and a route guard can redirect before the real value
 * lands.
 */
export const FEATURE_FLAG_OVERRIDE_STORAGE_KEY = 'lfx-feature-flag-overrides';

/**
 * Default budget `FeatureFlagService.waitForReady()` gives the OpenFeature provider to reach
 * READY before a flag-gated guard falls back to its no-ready path (fail-closed for the
 * dark-launch guards). Doubled from the original 5s
 * (GH-1351 follow-up) after DEV/PROD reproductions showed LaunchDarkly occasionally taking longer
 * than 5s to stream READY, which the fail-closed guards were surfacing as a user-visible redirect
 * even though LD wasn't actually down — just slow. Also drives
 * `initializeOpenFeature()`'s LaunchDarkly `initializationTimeout` (in seconds) so the bootstrap
 * wait and the guard-level wait share one tunable budget instead of two independent magic numbers.
 */
export const FEATURE_FLAG_READY_TIMEOUT_MS = 10_000;

/**
 * The shorter readiness budget for a guard whose route renders correctly without the flag and only
 * *redirects* when it is on (`formationOverviewRedirectGuard`, #2754). The page under it is already
 * settled and interactive while the guard waits, so a slow provider must not be allowed to yank it
 * from under the user ten seconds in: past this budget the guard fails open and the page stays.
 * `waitForReady` still answers immediately when the provider is already ready or in ERROR, so this
 * only bounds the tail.
 */
export const FEATURE_FLAG_REDIRECT_READY_TIMEOUT_MS = 3_000;

/**
 * Gates the Formation Checklist Epic 1 surfaces (GH-1955/1958/1959/1962) — the project dashboard's
 * Formation badge/subtitle/sidebar card, the project selector's Formation tag, the Formation
 * checklist section, and the Formations queue (epic #1965). It also gates the project lens's
 * formation-stage sidebar (Formation, Meetings, Mailing Lists, Groups — #3059) and the
 * `/project/overview` → `/project/formation` landing redirect for a project in a Formation stage
 * (#2754; `SidebarNavService` and `formationOverviewRedirectGuard`, both on `isFormationStageGate`),
 * and "Propose a project" (#3037): the My Formations CTA, the `/formations/propose` intake page, the
 * Submitted proposals tab, and the foundation queue's Project proposals tab. Staged targeting (named
 * users, then LF Staff, then all), same rule as MARKETING_OPS_FGA_ENABLED_FLAG — never "all users"
 * in one step. Default false so an unflagged evaluation renders the pre-Formation UI. The checklist
 * and queue now read the real `lfx-v2-formation-service` backend; this flag is the sole rollout gate
 * for the UI.
 *
 * **UI-only** — evaluated through `FeatureFlagService.getBooleanFlag`. Does not gate the BFF or any
 * endpoint: the underlying `stage`/formation fields on `/api/projects/:slugOrUid` are already
 * visible to anyone authorized to view the project regardless of this flag, and the formation
 * endpoints read/write the real `lfx-v2-formation-service` record — this flag only controls
 * whether Self Serve *renders* Formation-specific UI around already-reachable data. The same holds for
 * `/api/project-applications` (#3037): it requires a session and refuses impersonated writes, and the
 * formation-service gateway authorizes every write, but the flag itself is not evaluated server-side.
 */
export const FORMATION_ENABLED_FLAG = 'formation-enabled';

/**
 * Gates the Meetings v2 surfaces (epic #1451) — the in-context meeting composer that replaces the
 * pre-v2 create/edit wizard at every entry point it is wired into. Both implementations ship
 * together and live side by side: this flag decides which one a given user renders, so the pre-v2
 * wizard stays fully functional and is what everyone sees until the flag is turned on for them.
 *
 * Scoped to meetings v2 rather than to the composer specifically — later meetings-v2 work is
 * expected to sit behind the same gate.
 *
 * Default false so an unevaluated flag renders the pre-v2 wizard. This is the deliberate exception
 * to "default to current behavior": the DEFAULT here *is* current behavior, because v2 is the new
 * surface and false is what keeps it dark. LaunchDarkly targeting is the rollout switch, never the
 * code default; the fallback lives in {@link MEETING_V2_ENABLED_DEFAULT}. The deep links
 * (`/meetings/create`, `/meetings/:id/edit`) follow the flag too, through `meetingsV2Guard`.
 *
 * **UI-only** — evaluated through `FeatureFlagService.getBooleanFlag`. Does not gate the BFF or any
 * endpoint: both paths write the same already-authorized `/api/meetings` surface behind the same
 * `writerGuard`, so this flag only controls which UI renders, never what a user may do.
 *
 * {@link MEETINGS_REDESIGN_FLAG} also enables v2: the UI reads both through `meetingsV2EnabledSignal`.
 */
export const MEETING_V2_ENABLED_FLAG = 'meeting-v2-enabled';
/**
 * What {@link MEETING_V2_ENABLED_FLAG} reads as in the browser when LaunchDarkly has not answered (unready
 * or unreachable). Every read of the flag — components and `meetingsV2Guard` — uses this one value, so
 * moving the fallback from the pre-v2 wizard to v2 is a single-line change here.
 */
export const MEETING_V2_ENABLED_DEFAULT = false;
/**
 * Lets a user start new newsletters in the block composer, on top of the project gate in
 * `NEWSLETTER_BLOCKS_PROJECT_SLUGS`. Off keeps the basic editor. A draft that already has a layout
 * stays in the composer either way, because the basic editor can't edit it safely.
 *
 * **UI-only** — it does not gate the BFF or any endpoint.
 */
export const NEWSLETTER_ENHANCED_EDITOR_FLAG = 'newsletter-enhanced-editor';
/** What {@link NEWSLETTER_ENHANCED_EDITOR_FLAG} reads as when LaunchDarkly has not answered. */
export const NEWSLETTER_ENHANCED_EDITOR_DEFAULT = false;
/**
 * Dark-launch gate for the redesigned Home / Me lens Meetings page (epic #4468, #4470). Default false: a
 * missing LaunchDarkly flag keeps everyone on the existing meetings dashboard. It only affects the flat
 * `/meetings` route in the Me lens; `/foundation/meetings`, `/project/meetings` and the org lens stay on
 * the existing page whatever this reads. It also turns on the v2 composer at every entry point (see
 * {@link MEETING_V2_ENABLED_FLAG}).
 *
 * **UI-only** — evaluated through `FeatureFlagService` in the browser, so the server renders a loading
 * state and the browser picks the page. A provider that is not ready within `FEATURE_FLAG_READY_TIMEOUT_MS` means
 * the existing dashboard. It gates no endpoint: both pages read the same `/api/meetings` surface.
 *
 * It also picks the `/meetings/:id` page (`meetingPageRedesignGuard`). There the server evaluates it too
 * (`resolveSsrFlags`, with the browser's user context), so SSR and hydration render the same page.
 */
export const MEETINGS_REDESIGN_FLAG = 'meetings-redesign';
/**
 * Dark-launch gate for the LFX Insights API Tokens group in Developer Settings (IN-1233). Default
 * false: the group stays hidden until LaunchDarkly targeting turns it on.
 *
 * **Visibility only** — evaluated in the browser (`FeatureFlagService.getBooleanFlag`). It grants no
 * access: widening its targeting to launch the group never widens who may use the token endpoints.
 * Access is `INSIGHTS_PUBLIC_API_TOKEN_ACCESS_FLAG`; launch flips both.
 */
export const INSIGHTS_PUBLIC_API_FLAG = 'insights-public-api';
/**
 * The access gate for LFX Insights API tokens, and the only one. Default false. Evaluated on the
 * server only (`LaunchDarklyServerService`) for `/api/profile/insights-tokens`: off means only the
 * LFIDs it targets individually can list, create and revoke tokens; serving it on to everyone opens
 * tokens to every LFID holder. There is no membership check behind it. Users also need
 * `INSIGHTS_PUBLIC_API_FLAG` to see the group.
 */
export const INSIGHTS_PUBLIC_API_TOKEN_ACCESS_FLAG = 'insights-public-api-token-access';

/**
 * How long the server's LaunchDarkly SDK may take to connect on first use, in seconds. The request
 * that triggers initialization waits at most this long, then falls back to the flag's default
 * (fail closed) and the SDK keeps connecting in the background.
 */
export const LAUNCHDARKLY_SERVER_INIT_TIMEOUT_SECONDS = 3;

/**
 * Dark-launch gate for the Foundation Lens Participating Companies page (#5697): the route
 * (`foundation/participating-orgs`) and its nav item. The page reads the lf-dbt participating-orgs
 * table (#5707); the flag stays off until it is rolled out.
 * Paired with the server flag `LFX_FOUNDATION_PARTICIPATING_ORGS_ENABLED`, which is the real kill
 * switch for the BFF; the Web SDK never runs server-side.
 */
export const FOUNDATION_PARTICIPATING_ORGS_ENABLED_FLAG = 'foundation-participating-orgs-enabled';
