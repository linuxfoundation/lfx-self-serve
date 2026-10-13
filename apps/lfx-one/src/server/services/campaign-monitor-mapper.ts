// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ACCOUNT_MONITOR_CONFLICT_REASONS } from '@lfx-one/shared/constants';
import type {
  AccountMonitorConflictReason,
  CampaignServiceAccountMonitor,
  CampaignServiceAccountMonitorCampaign,
  LinkedInMonitorResponse,
  MetaMonitorResponse,
  RedditMonitorResponse,
} from '@lfx-one/shared/interfaces';

import { MicroserviceError } from '../errors/microservice.error';
import { getCodeForStatus, getDefaultMessageForStatus } from '../helpers/http-status.helper';

// ---------------------------------------------------------------------------
// campaign-service account monitor → the Monitor/Optimize tabs' legacy shapes (#2519)
//
// The Meta and Reddit panels were built against `MetaMonitorResponse` / `RedditMonitorResponse`,
// which the legacy BFF rule engines produce. With `LFX_CUTOVER_CAMPAIGN_SERVICE_MONITOR` on, the
// same routes answer from campaign-service's `account-monitor` endpoints instead, and this module
// converts that answer so the UI renders it unchanged. Pure functions, so the part of the cutover
// that can be wrong while everything still compiles is directly testable.
//
// What the legacy shape cannot carry is kept, not dropped, in optional fields the legacy path never
// sets: `pacingUnknown`, `fetchFailed` and `conversionsMeasured`. The numbers those flags qualify
// are 0 placeholders, because the panels render them as numbers.
// ---------------------------------------------------------------------------

/** The rows, totals and action items of one platform's monitor, in the legacy shape both platforms share. */
type LegacyMonitorBody = Pick<RedditMonitorResponse, 'campaigns' | 'accountTotals' | 'actionItems' | 'dateRange'>;

function toLegacyCampaign(row: CampaignServiceAccountMonitorCampaign): RedditMonitorResponse['campaigns'][number] {
  const conversionsMeasured = typeof row.conversions === 'number';
  // A row campaign-service could not pace or could not read carries a meaningless pacing_pct and a
  // placeholder label. 0 is what the legacy path showed for an unpaceable campaign, so the panel's
  // bar stays empty rather than drawing a figure nobody measured.
  const pacingTrusted = !row.pacing_unknown && !row.fetch_failed;
  return {
    campaignId: row.platform_campaign_id,
    campaignName: row.name,
    status: row.status,
    totalBudget: row.total_budget,
    dailyBudget: row.budget_day,
    spend: row.spend,
    impressions: row.impressions,
    clicks: row.clicks,
    ctr: row.ctr,
    conversions: conversionsMeasured ? (row.conversions as number) : 0,
    // Rounded as the legacy engines rounded it; the panels print it with `toFixed(0)` anyway.
    pacingPct: pacingTrusted ? Math.round(row.pacing_pct) : 0,
    // campaign-service's label on such a row is a placeholder (`normal`); passing it on would put
    // "normal" next to a pacing figure nobody measured, so the label is left out instead.
    pacingLabel: pacingTrusted ? row.pacing_label : undefined,
    startDate: row.start_date,
    endDate: row.end_date,
    pacingUnknown: row.pacing_unknown,
    fetchFailed: row.fetch_failed,
    conversionsMeasured,
  };
}

function toLegacyMonitorBody(payload: CampaignServiceAccountMonitor): LegacyMonitorBody {
  const totalsConversionsMeasured = typeof payload.totals.conversions === 'number';
  return {
    // `days` is the requested window echoed back, which the live-read platforms cover exactly.
    dateRange: { mode: `last_${payload.days}_days` },
    campaigns: (payload.campaigns ?? []).map(toLegacyCampaign),
    accountTotals: {
      spend: payload.totals.spend,
      impressions: payload.totals.impressions,
      clicks: payload.totals.clicks,
      conversions: totalsConversionsMeasured ? (payload.totals.conversions as number) : 0,
      campaignCount: payload.totals.campaign_count,
      conversionsMeasured: totalsConversionsMeasured,
    },
    actionItems: (payload.action_items ?? []).map((item) => ({
      priority: item.priority,
      // Empty for an account-wide finding, which the legacy engines never produced.
      campaignName: item.campaign_name ?? '',
      issue: item.issue,
      action: item.action,
    })),
  };
}

/** campaign-service's Reddit account monitor as the Reddit Monitor/Optimize panels consume it. */
export function toRedditMonitorResponse(payload: CampaignServiceAccountMonitor, accountLabel: string, pulledAt: string): RedditMonitorResponse {
  return { accountLabel, pulledAt, ...toLegacyMonitorBody(payload) };
}

/** campaign-service's Meta account monitor as the Meta Monitor/Optimize panels consume it. */
export function toMetaMonitorResponse(payload: CampaignServiceAccountMonitor, accountLabel: string, pulledAt: string): MetaMonitorResponse {
  return { accountLabel, pulledAt, ...toLegacyMonitorBody(payload) };
}

/**
 * campaign-service's LinkedIn account monitor as the LinkedIn Monitor/Optimize panels consume it.
 *
 * Three LinkedIn-only differences from the Meta/Reddit mapping:
 * - `pacingPct` is NOT rounded. The legacy LinkedIn engine never rounded it, and campaign-service
 *   keeps it unrounded deliberately (its `monitor_linkedin.go`), so rounding here would move a
 *   campaign at 90.4% across the band the label already reports.
 * - `eventName` is derived from the campaign name exactly as the legacy engine derived it (the
 *   second ` | ` segment, else the whole name), because the panel shows it as the row title.
 * - `creatives` is always EMPTY: campaign-service does not read LinkedIn creative analytics, so the
 *   panel's creative count reads 0 and the legacy HIGH "no ad creatives" item is never produced.
 */
export function toLinkedInMonitorResponse(payload: CampaignServiceAccountMonitor, accountLabel: string, pulledAt: string): LinkedInMonitorResponse {
  const body = toLegacyMonitorBody(payload);
  // Positional: `body.campaigns[i]` IS `payload.campaigns[i]` mapped, so no join on an id is needed.
  const rows = payload.campaigns ?? [];
  return {
    accountLabel,
    pulledAt,
    ...body,
    campaigns: body.campaigns.map((campaign, i) => {
      const row = rows[i];
      const pacingTrusted = !row.pacing_unknown && !row.fetch_failed;
      return {
        ...campaign,
        eventName: campaign.campaignName.split(' | ')[1] ?? campaign.campaignName,
        pacingPct: pacingTrusted ? row.pacing_pct : 0,
        creatives: [],
      };
    }),
  };
}

function isConflictReason(value: unknown): value is AccountMonitorConflictReason {
  return typeof value === 'string' && (ACCOUNT_MONITOR_CONFLICT_REASONS as readonly string[]).includes(value);
}

function monitorErrorMessage(statusCode: number, platformLabel: string): string {
  switch (statusCode) {
    case 400:
      return `campaign-service could not read this ${platformLabel} account for this project: the project's own ${platformLabel} connection is unusable, is not bound to this account, or ${platformLabel} metrics are not enabled.`;
    case 404:
      return `This project has no ${platformLabel} connection of its own to read the account with.`;
    case 409:
      return `This ${platformLabel} account cannot be monitored as it stands.`;
    case 500:
      return `campaign-service failed to read the ${platformLabel} monitor.`;
    case 503:
      return `${platformLabel} metrics are temporarily unavailable. Please try again shortly.`;
    default:
      return getDefaultMessageForStatus(statusCode);
  }
}

/**
 * Re-raise a campaign-service account-monitor failure with this app's own wording.
 *
 * `MicroserviceError.fromMicroserviceResponse` puts the upstream body's `message` into the client
 * response, and the account-monitor's messages name connection rows, sentinels and platform error
 * text. So an HTTP failure keeps its STATUS — which is what the panels and the error middleware act
 * on — and loses its text: a fixed message per status, with the upstream error kept as
 * `originalError` for the log. A 409's `reason` is forwarded as `upstreamCode` only when it is one of
 * the two values upstream's closed enum allows.
 *
 * A transport failure, or any non-`MicroserviceError`, passes through unchanged: those are raised by
 * this app with fixed text already (`api-client.service.ts`).
 */
export function toAccountMonitorClientError(error: unknown, platformLabel: string, operation: string): unknown {
  if (!(error instanceof MicroserviceError) || error.transportFailure) {
    return error;
  }
  const statusCode = error.statusCode;
  const reason = statusCode === 409 ? (error.errorBody as { reason?: unknown } | undefined)?.reason : undefined;
  return new MicroserviceError(monitorErrorMessage(statusCode, platformLabel), statusCode, getCodeForStatus(statusCode), {
    operation,
    service: 'campaign_controller',
    originalError: error,
    errorBody: isConflictReason(reason) ? { error: reason } : undefined,
  });
}
