// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ACCOUNT_MONITOR_CONFLICT_REASONS,
  ACCOUNT_MONITOR_CURRENCY_PATTERN,
  ACCOUNT_MONITOR_METRICS_DISABLED_CODE,
  ACCOUNT_MONITOR_NO_CONNECTION_CODE,
  ACCOUNT_MONITOR_UNSUPPORTED_UPSTREAM_MESSAGE,
  META_ADS_MONITOR_ACCOUNT_ID_PATTERN,
} from '@lfx-one/shared/constants';
import type {
  AccountMonitorConflictReason,
  CampaignServiceAccountMonitor,
  CampaignServiceAccountMonitorCampaign,
  CampaignServiceConnection,
  CampaignServiceHubSpotEmailMonitor,
  CampaignServiceHubSpotEmailMonitorEmail,
  CampaignServiceHubSpotEmailMonitorTotals,
  CampaignServiceMonitorProvider,
  HubSpotEmailMonitorResponse,
  HubSpotEmailMonitorRow,
  HubSpotEmailMonitorTotals,
  LinkedInMonitorResponse,
  MetaMonitorResponse,
  MonitorConnectionAccount,
  RedditMonitorResponse,
  ReportBackedMonitorResponse,
} from '@lfx-one/shared/interfaces';

import { MicroserviceError } from '../errors/microservice.error';
import { getCodeForStatus, getDefaultMessageForStatus } from '../helpers/http-status.helper';
import { isCampaignServiceNotFound } from './campaign-service.service';

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
//
// The Microsoft Ads, X and HubSpot monitors have no legacy shape; they are mapped into this app's
// camelCase vocabulary here too (`ReportBackedMonitorResponse`, `HubSpotEmailMonitorResponse`), so
// every Monitor panel renders a BFF shape and none renders campaign-service's wire format.
// ---------------------------------------------------------------------------

/** The rows, totals and action items of one platform's monitor, in the legacy shape both platforms share. */
type LegacyMonitorBody = Pick<RedditMonitorResponse, 'campaigns' | 'accountTotals' | 'actionItems' | 'dateRange' | 'currency'>;

/**
 * campaign-service's optional `currency`, as `{ currency }` only when it is an ISO 4217-shaped code
 * (three uppercase letters) — otherwise `{}`, so the key is absent exactly as it is on the legacy
 * path and the panel stays currency-neutral. A lowercase or otherwise malformed value is dropped,
 * not repaired: the field is a statement about the account, and a guess would put a symbol on
 * amounts nobody vouched for.
 */
function accountCurrency(payload: CampaignServiceAccountMonitor): Pick<LegacyMonitorBody, 'currency'> {
  const currency: unknown = payload.currency;
  return typeof currency === 'string' && ACCOUNT_MONITOR_CURRENCY_PATTERN.test(currency) ? { currency } : {};
}

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
    ...accountCurrency(payload),
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
 * - `creatives` is always EMPTY: campaign-service does not read LinkedIn creative analytics. Each row
 *   therefore carries `creativesMeasured: false`, so the panel shows the count as not read rather than
 *   0, and the legacy HIGH "no ad creatives" item is never produced.
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
        creativesMeasured: false,
      };
    }),
  };
}

/**
 * campaign-service's Microsoft Ads or X account monitor as the Monitor tab's report-backed panel
 * renders it: the Reddit/Meta rows and totals, plus the report's freshness.
 *
 * The freshness fields are carried, never inferred. `metricsAsOf` absent means no report has
 * finished yet — every row is then `fetchFailed`, which the panel already renders as "Couldn't read"
 * — and `metricsPending` absent (a contract slip upstream) reads as "not building", since claiming
 * a report is on its way when nobody said so would send the operator to refresh for nothing.
 */
export function toReportBackedMonitorResponse(payload: CampaignServiceAccountMonitor, pulledAt: string): ReportBackedMonitorResponse {
  return {
    accountId: payload.account_id,
    pulledAt,
    ...toLegacyMonitorBody(payload),
    metricsAsOf: payload.metrics_as_of ?? null,
    metricsWindowStart: payload.metrics_window_start ?? null,
    metricsWindowEnd: payload.metrics_window_end ?? null,
    metricsPending: payload.metrics_pending === true,
  };
}

/** A rate campaign-service left out because its denominator was 0: unknown, so null — never 0. */
function rateOrNull(rate: number | undefined): number | null {
  return typeof rate === 'number' && Number.isFinite(rate) ? rate : null;
}

function toHubSpotRates(
  source: CampaignServiceHubSpotEmailMonitorEmail | CampaignServiceHubSpotEmailMonitorTotals
): Pick<HubSpotEmailMonitorRow, 'openRate' | 'clickRate' | 'bounceRate' | 'unsubscribeRate' | 'spamRate'> {
  return {
    openRate: rateOrNull(source.open_rate),
    clickRate: rateOrNull(source.click_rate),
    bounceRate: rateOrNull(source.bounce_rate),
    unsubscribeRate: rateOrNull(source.unsubscribe_rate),
    spamRate: rateOrNull(source.spam_rate),
  };
}

/** The counters `hubspot-email-monitor-totals` declares required. */
const HUBSPOT_REQUIRED_TOTALS = ['email_count', 'sent', 'delivered', 'opens', 'clicks', 'bounces', 'unsubscribes', 'spam_reports'] as const;

/**
 * `totals` exactly as the contract requires it, or a contract error. It is REQUIRED upstream, and
 * the tiles render it as measured counts: reading an absent or malformed one as zeros would put
 * "0 sent" on screen for a project that sent thousands. So the read fails instead, as a 502 —
 * campaign-service answered, but not with what it promised — which the controller reports with a
 * fixed message.
 */
function toHubSpotTotals(totals: CampaignServiceHubSpotEmailMonitorTotals | undefined): HubSpotEmailMonitorTotals {
  const t = totals as Partial<Record<string, unknown>> | undefined;
  if (typeof t !== 'object' || t === null || Array.isArray(t) || HUBSPOT_REQUIRED_TOTALS.some((k) => typeof t[k] !== 'number' || !Number.isFinite(t[k]))) {
    throw new MicroserviceError('campaign-service returned a HubSpot monitor without valid totals', 502, getCodeForStatus(502), {
      operation: 'hubspot_monitor',
      service: 'campaign_monitor_mapper',
    });
  }
  const valid = totals as CampaignServiceHubSpotEmailMonitorTotals;
  return {
    emailCount: valid.email_count,
    sent: valid.sent,
    delivered: valid.delivered,
    opens: valid.opens,
    clicks: valid.clicks,
    bounces: valid.bounces,
    unsubscribes: valid.unsubscribes,
    spamReports: valid.spam_reports,
    ...toHubSpotRates(valid),
  };
}

/**
 * campaign-service's HubSpot email monitor as the Monitor tab's email section renders it.
 *
 * Rates stay FRACTIONS and stay ABSENT-as-null: a rate over zero deliveries is unknown, and a 0
 * there would read as "nobody opened it". The counts behind them are passed through unchanged.
 */
export function toHubSpotEmailMonitorResponse(payload: CampaignServiceHubSpotEmailMonitor, pulledAt: string): HubSpotEmailMonitorResponse {
  return {
    pulledAt,
    days: payload.days,
    emails: (payload.emails ?? []).map((email) => ({
      campaignId: email.campaign_id,
      emailId: email.email_id,
      name: email.name,
      abVariant: email.ab_variant,
      deleted: email.deleted,
      sent: email.sent,
      delivered: email.delivered,
      opens: email.opens,
      clicks: email.clicks,
      bounces: email.bounces,
      unsubscribes: email.unsubscribes,
      spamReports: email.spam_reports,
      ...toHubSpotRates(email),
    })),
    totals: toHubSpotTotals(payload.totals),
    actionItems: (payload.action_items ?? []).map((item) => ({
      priority: item.priority,
      emailId: item.email_id || null,
      emailName: item.campaign_name ?? '',
      issue: item.issue,
      action: item.action,
    })),
    metricsAsOf: payload.metrics_as_of ?? null,
    metricsWindowStart: payload.metrics_window_start ?? null,
    metricsWindowEnd: payload.metrics_window_end ?? null,
    emailsChecked: payload.emails_checked,
    emailsNotSentInWindow: payload.emails_not_sent_in_window,
    emailsUnattributable: payload.emails_unattributable,
    emailsTruncated: payload.emails_truncated === true,
  };
}

/**
 * The project's own connection as the Monitor tab's account picker offers it.
 *
 * An empty or blank `account_id` is a connection with no account bound (Meta lets a connection be
 * created credentials-first): the picker has nothing to offer, and saying "connected" would send
 * the panel to read an account that does not exist. The id is trimmed only to decide that — a
 * non-blank id is offered as stored, since it is what campaign-service compares against.
 *
 * The one exception is a legacy Meta connection that stored the BARE numeric ad account id.
 * campaign-service's Meta monitor matches the connection in either form but takes the id only
 * `act_`-prefixed (`META_ADS_MONITOR_ACCOUNT_ID_PATTERN`), so a bare id offered verbatim would be
 * refused by the BFF's own shape check. A bare Meta id whose `act_<id>` form passes that same
 * pattern is therefore offered prefixed (an already-prefixed id cannot pass it twice);
 * every other provider's id, and any Meta id that is not purely numeric, is left exactly as stored.
 */
export function toMonitorConnectionAccount(connection: CampaignServiceConnection, provider: CampaignServiceMonitorProvider): MonitorConnectionAccount {
  const storedId = typeof connection.account_id === 'string' ? connection.account_id : '';
  if (storedId.trim() === '') {
    return { state: 'no_account', accountId: null, label: null };
  }
  const prefixed = `act_${storedId}`;
  const accountId = provider === 'meta-ads' && META_ADS_MONITOR_ACCOUNT_ID_PATTERN.test(prefixed) ? prefixed : storedId;
  const label = typeof connection.label === 'string' && connection.label.trim() !== '' ? connection.label.trim() : accountId;
  return { state: 'connected', accountId, label };
}

function isConflictReason(value: unknown): value is AccountMonitorConflictReason {
  return typeof value === 'string' && (ACCOUNT_MONITOR_CONFLICT_REASONS as readonly string[]).includes(value);
}

function monitorErrorMessage(statusCode: number, platformLabel: string): string {
  switch (statusCode) {
    case 400:
      return `campaign-service could not read this ${platformLabel} account for this project: the project's own ${platformLabel} connection is unusable or is not bound to this account.`;
    case 404:
      // Only reached for a 404 that is NOT campaign-service's typed not-found (a gateway or routing
      // miss): nothing says the connection is absent, so the text claims no such thing.
      return `The ${platformLabel} monitor could not be reached just now. Please try again shortly.`;
    case 409:
      return `This ${platformLabel} account cannot be monitored as it stands.`;
    case 502:
      return `campaign-service returned an unreadable ${platformLabel} monitor response.`;
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
 * the two values upstream's closed enum allows. A 404 is marked `connection_not_found` only when its
 * body is campaign-service's own typed not-found (as `readMonitorConnection` classifies it); a
 * gateway or routing 404 keeps its status but no marker, so no panel reads it as a missing connection.
 *
 * A transport failure, or any non-`MicroserviceError`, passes through unchanged: those are raised by
 * this app with fixed text already (`api-client.service.ts`).
 */
export function toAccountMonitorClientError(error: unknown, platformLabel: string, operation: string): unknown {
  if (!(error instanceof MicroserviceError) || error.transportFailure) {
    return error;
  }
  const statusCode = error.statusCode;
  if (statusCode === 400 && isMetricsDisabled(error.errorBody)) {
    return new MicroserviceError(
      `${platformLabel} metrics are not enabled in campaign-service for this environment yet.`,
      statusCode,
      getCodeForStatus(statusCode),
      { operation, service: 'campaign_controller', originalError: error, errorBody: { error: ACCOUNT_MONITOR_METRICS_DISABLED_CODE } }
    );
  }
  if (statusCode === 404 && isCampaignServiceNotFound(error.errorBody)) {
    return new MicroserviceError(
      `This project has no ${platformLabel} connection of its own to read the account with.`,
      statusCode,
      getCodeForStatus(statusCode),
      {
        operation,
        service: 'campaign_controller',
        originalError: error,
        errorBody: { error: ACCOUNT_MONITOR_NO_CONNECTION_CODE },
      }
    );
  }
  const reason = statusCode === 409 ? (error.errorBody as { reason?: unknown } | undefined)?.reason : undefined;
  return new MicroserviceError(monitorErrorMessage(statusCode, platformLabel), statusCode, getCodeForStatus(statusCode), {
    operation,
    service: 'campaign_controller',
    originalError: error,
    errorBody: isConflictReason(reason) ? { error: reason } : undefined,
  });
}

/**
 * Whether a 400 is campaign-service saying the platform's metrics are switched off, rather than
 * that this project's connection is wrong. Matched on the EXACT upstream message: the other 400s
 * this endpoint answers name a remedy on the connection, and folding them in would tell an operator
 * to wait for an enablement when the fix is theirs.
 */
function isMetricsDisabled(errorBody: unknown): boolean {
  return (errorBody as { message?: unknown } | undefined)?.message === ACCOUNT_MONITOR_UNSUPPORTED_UPSTREAM_MESSAGE;
}
