// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

export const ORG_LENS_ENABLED_FLAG = 'org-lens-enabled';
export const AKRITES_ENABLED_FLAG = 'akrites-enabled';
export const MKTG_OS_AGENTS_ENABLED_FLAG = 'mktg-os-agents-enabled';
export const MY_CLAS_ENABLED_FLAG = 'my-clas-enabled';
export const WG_ENGAGEMENT_METRICS_FLAG = 'wg-engagement-metrics';
/** Browser-only flag for the Org Lens ROI page — it gates no endpoint. */
export const ORG_LENS_ROI_ENABLED_FLAG = 'org-lens-roi-enabled';
/**
 * Dark-launch gate for Slack-webhook sharing (LFXV2-3080) — the settings card (committee-settings-tab)
 * and the "Share to Slack" action (weekly-brief-card) both check this, separately from the
 * parent 'wg-weekly-brief' flag those two live under. Default false: the upstream
 * committee-service has no chat_webhook_url field yet, so every save would 409 today — see
 * committee.service.ts's updateCommittee/getSlackWebhookUrlStrict comments.
 */
export const WG_WEEKLY_BRIEF_SLACK_FLAG = 'wg-weekly-brief-slack';
