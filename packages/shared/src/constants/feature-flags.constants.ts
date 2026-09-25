// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const AKRITES_ENABLED_FLAG = 'akrites-enabled';
export const MKTG_OS_AGENTS_ENABLED_FLAG = 'mktg-os-agents-enabled';
export const MY_CLAS_ENABLED_FLAG = 'my-clas-enabled';
/**
 * Dark-launch gate for the M2 My CLAs overlay (#1738) — Sign CLA, Status column,
 * kebab/actions, and Signed as. The M1 list (project / type / signed / document) stays
 * when this is off. Default false: LaunchDarkly targeting (DEV on for everyone,
 * PROD team-only until testing) is the rollout switch, not the code default.
 *
 * **UI-only** — evaluated through `FeatureFlagService.getBooleanFlag`. Does not
 * gate the BFF; hiding Sign CLA is how the write path stays unreachable from
 * this page.
 */
export const MY_CLAS_M2_ENABLED_FLAG = 'my-clas-m2-enabled';
export const WG_ENGAGEMENT_METRICS_FLAG = 'wg-engagement-metrics';
/** Browser-only flag for the Org Lens ROI page — it gates no endpoint. */
export const ORG_LENS_ROI_ENABLED_FLAG = 'org-lens-roi-enabled';
/**
 * Dark-launch gate for the M3 Organization Lens CLA module (#1982) — the EasyCLA
 * route and sidebar entry. The org-lens prefix keeps it in the lens family alongside
 * `ORG_LENS_ROI_ENABLED_FLAG`; the `m3` suffix follows the `MY_CLAS_M2_ENABLED_FLAG`
 * milestone-gate precedent. Default false: a missing LaunchDarkly flag keeps the
 * module invisible. The route guard fails closed (unlike `myClasEnabledGuard`).
 *
 * Evaluated through `FeatureFlagService.getBooleanFlag`, which is the Web SDK and never runs
 * server-side, so this hides the route and nav without closing the BFF. **Turning this flag off
 * therefore stops the UI reaching the module; it does not stop a direct call to the BFF.** It is
 * not a kill switch, and it is not an authorization boundary — the routes are protected by the
 * Org Lens grant, by `blockDuringImpersonation` on the write, and by the CLA service's own
 * signing-authority and trade-compliance checks.
 *
 * The first M3 write path has now landed on these routes: corporate CLA signing (#1983), which
 * creates a signature record and a DocuSign envelope. A server-side gate was reconsidered at that
 * point, as the note here previously said it should be, and still not added — the same corporate
 * signature is requestable by the same caller through the ACS-authorized EasyCLA v4 API and the
 * Corporate CLA Console, so a gate withholds no capability while costing a GitOps round-trip and
 * a pod roll per rollout. What changed is that this is now written down as a decision about a
 * write, rather than resting on the reads being harmless.
 */
export const ORG_LENS_CLA_M3_ENABLED_FLAG = 'org-lens-cla-m3-enabled';
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
 * Gates Org Lens surfaces still restricted to internal audiences — person-detail-drawer company
 * emails (GH-1655) and the Company Logo Upload control on the Org Profile edit page (LFXV2-3288).
 * Remove each gate as its real-data backend lands; retire this flag once all are unguarded.
 *
 * For logo upload specifically, default false means a general Org Lens viewer sees the logo preview
 * but not the upload affordance.
 *
 * **UI-only** — evaluated through `FeatureFlagService.getBooleanFlag`. Does not gate the BFF or the
 * downstream member-service upload endpoint; server-side authorization (writer/admin) remains the
 * source of truth for whether an upload actually succeeds.
 */
export const ORG_LENS_PRIVATE_RELEASE_FLAG = 'org-lens-private-release';

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
 * Dark-launch gate for the Mentorship module — the `/mentorship` route tree (admin list and the
 * enroll-a-program wizard) and its Me Lens sidebar section. Default false: a missing LaunchDarkly
 * flag keeps the module invisible, and the route guard fails closed like `akritesEnabledGuard`
 * rather than open like `myClasEnabledGuard`, because nothing here has shipped to users yet.
 *
 * **UI-only** — evaluated through `FeatureFlagService.getBooleanFlag`, which is the OpenFeature Web
 * SDK and never runs server-side, so it cannot gate an Express handler. The mentorship BFF routes
 * stay reachable by a direct API caller while this is off; add a `ServerFeatureFlag` counterpart if
 * the write paths ever need a kill switch of their own.
 */
export const MENTORSHIP_ENABLED_FLAG = 'mentorship-enabled';

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
 * and `mentorshipEnabledGuard` rather than open, since the embed is not ready for general users.
 *
 * **UI-only** — evaluated through `FeatureFlagService.getBooleanFlag`, which is the OpenFeature Web
 * SDK and never runs server-side, so it cannot gate an Express handler. The BFF proxy
 * (`/api/gw/*`) is gated independently, server-side, by `ServerFeatureFlag.GatewazeEmbedEnabled`
 * (`server-feature-flag.helper.ts`) — an env-var kill switch that also defaults off. Both must be
 * enabled for the pilot to actually be reachable.
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
 * READY before a flag-gated guard falls back to its no-ready path (fail-open for
 * `myClasEnabledGuard`, fail-closed for the dark-launch guards). Doubled from the original 5s
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
 * Formation-only sidebar and the `/project/overview` → `/project/formation` landing redirect for a
 * project in a Formation stage (#2754; `SidebarNavService` and `formationOverviewRedirectGuard`,
 * both on `isFormationStageGate`). Staged targeting (named users, then LF Staff, then
 * all), same rule as MARKETING_OPS_FGA_ENABLED_FLAG — never "all users" in one step. Default false
 * so an unflagged evaluation renders the pre-Formation UI. The checklist and queue now read the
 * real `lfx-v2-formation-service` backend; this flag is the sole rollout gate for the UI.
 *
 * **UI-only** — evaluated through `FeatureFlagService.getBooleanFlag`. Does not gate the BFF or any
 * endpoint: the underlying `stage`/formation fields on `/api/projects/:slugOrUid` are already
 * visible to anyone authorized to view the project regardless of this flag, and the formation
 * endpoints read/write the real `lfx-v2-formation-service` record — this flag only controls
 * whether Self Serve *renders* Formation-specific UI around already-reachable data.
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
 * surface and false is what keeps it dark. LaunchDarkly targeting (a named tester list, dev and
 * prod configured identically) is the rollout switch, never the code default — flipping this
 * constant would ship v2 to everyone.
 *
 * **UI-only** — evaluated through `FeatureFlagService.getBooleanFlag`. Does not gate the BFF or any
 * endpoint: both paths write the same already-authorized `/api/meetings` surface behind the same
 * `writerGuard`, so this flag only controls which UI renders, never what a user may do.
 */
export const MEETING_V2_ENABLED_FLAG = 'meeting-v2-enabled';
/**
 * Dark-launch gate for the LFX Insights API Tokens group in Developer Settings (IN-1233). Default
 * false: the group stays hidden until LaunchDarkly targeting turns it on, which also keeps it dark
 * while `lfx-v2-pat-service` and the member-service tier endpoint roll out.
 *
 * **UI-only** — evaluated through `FeatureFlagService.getBooleanFlag`. Does not gate the BFF: the
 * `/api/profile/insights-tokens` routes stay authenticated and re-check Key Contact eligibility on
 * create, so this flag controls visibility, never what a user may do.
 */
export const INSIGHTS_PUBLIC_API_FLAG = 'insights-public-api';
