// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const ORG_LENS_ENABLED_FLAG = 'org-lens-enabled';
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
 * Gates Org Lens UI that currently renders demo/placeholder data pending a real backend source —
 * person-detail-drawer company emails (GH-1655) and the leaderboard row score-breakdown drawer
 * (LFXV2-2934). Remove each gate as its real-data backend lands; retire this flag once both are
 * unguarded.
 *
 * **UI-only** — evaluated through `FeatureFlagService.getBooleanFlag`; gates no endpoint.
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
 * `localStorage` key holding a `Record<string, boolean>` of locally-forced flag values, read by
 * `FeatureFlagService.getBooleanFlag` in **non-production builds only**.
 *
 * This is the supported way to pin a flag in an e2e run. Flag-gated routes are otherwise untestable
 * — the SDK evaluates against an anonymous context before the authenticated one, so a flag targeted
 * at named users reads false in that window and a route guard can redirect before the real value
 * lands.
 */
export const FEATURE_FLAG_OVERRIDE_STORAGE_KEY = 'lfx-feature-flag-overrides';
