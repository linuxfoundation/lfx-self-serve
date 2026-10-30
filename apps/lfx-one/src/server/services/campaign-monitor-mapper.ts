// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import {
  ACCOUNT_MONITOR_CONFLICT_REASONS,
  ACCOUNT_MONITOR_CURRENCY_PATTERN,
  ACCOUNT_MONITOR_METRICS_DISABLED_CODE,
  ACCOUNT_MONITOR_NO_CONNECTION_CODE,
  ACCOUNT_MONITOR_UNSUPPORTED_UPSTREAM_MESSAGE,
  ERROR_CODES,
  META_ADS_MONITOR_ACCOUNT_ID_PATTERN,
  parseCampaignName,
  VALID_CAMPAIGN_STATUSES,
} from '@lfx-one/shared/constants';
import type {
  AccountMonitorConflictReason,
  CampaignActionItem,
  CampaignMetrics,
  CampaignMonitorResponse,
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
  MonitorConnectionState,
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
 * campaign-service's Google Ads account monitor as the Google Monitor panel and the Optimize tab
 * consume it (`CampaignMonitorResponse`, the shape the legacy BFF read of the shared account builds).
 *
 * What the legacy read derived from the campaign name is derived the same way here
 * (`parseCampaignName`): `shortName`, `eventName`, `adFormat` and `targeting`. Google reports no
 * flight dates, so `startDate`/`endDate` are the read window, as on the legacy path, ending on the
 * day of `pulledAt`. `avgCpc` is computed from spend and clicks as the legacy path computes it.
 * The amounts are the connected account's, unconverted, and campaign-service names no currency for
 * Google, so the response says so (`amountsInAccountCurrency`) and the Monitor tab prints them
 * without a `$`, as it does a connection's Meta amounts.
 *
 * A row campaign-service could not read or pace keeps its `fetchFailed` / `pacingUnknown` flags, and
 * its `pacingPct` is 0 rather than a figure nobody measured. `pacingLabel` is required by the legacy
 * shape, so such a row carries `normal`; the flags are what the panel reads, never the label.
 *
 * Action items are campaign-service's own, one per finding. The legacy shape groups by event and
 * carries the campaign's figures, so each item takes them from the campaign it names; an
 * account-wide finding names none and carries zeros. Upstream still raises items for a campaign it
 * could not pace (a $0 daily budget, for one), so an item's `pacingUnknown` marks a pacing figure
 * that is a placeholder, as the row's own flags do.
 */
export function toGoogleMonitorResponse(payload: CampaignServiceAccountMonitor, pulledAt: string): CampaignMonitorResponse {
  const days = payload.days;
  const endDate = pulledAt.slice(0, 10);
  const start = new Date(`${endDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const startDate = start.toISOString().slice(0, 10);

  const campaigns = (payload.campaigns ?? []).map((row): CampaignMetrics => {
    const parsed = parseCampaignName(row.name);
    const status = row.status.toLowerCase() as CampaignMetrics['status'];
    const conversionsMeasured = typeof row.conversions === 'number';
    const pacingTrusted = !row.pacing_unknown && !row.fetch_failed;
    return {
      name: row.name,
      shortName: parsed.baseName || row.name,
      eventName: parsed.baseName,
      // A name outside the convention carries no ad format; campaign-service says whether it is Search,
      // which is what the Optimize tab and the legacy rules read the format for.
      adFormat: parsed.adFormat || (row.is_search_channel ? 'Search' : ''),
      targeting: parsed.targeting,
      status: VALID_CAMPAIGN_STATUSES.has(status) ? status : 'unknown',
      startDate,
      endDate,
      budgetDay: row.budget_day,
      // The legacy path's figure: the daily budget over the window, which is what pacing is measured against.
      totalBudget: row.budget_day * days,
      spend: row.spend,
      impressions: row.impressions,
      clicks: row.clicks,
      ctr: row.ctr,
      avgCpc: row.clicks > 0 ? row.spend / row.clicks : 0,
      conversions: conversionsMeasured ? (row.conversions as number) : 0,
      pacingPct: pacingTrusted ? Math.round(row.pacing_pct) : 0,
      pacingLabel: pacingTrusted ? row.pacing_label : 'normal',
      campaignId: row.platform_campaign_id,
      googleAdsUrl: row.campaign_url ?? '',
      pacingUnknown: row.pacing_unknown,
      fetchFailed: row.fetch_failed,
      conversionsMeasured,
    };
  });

  const byId = new Map(campaigns.map((campaign) => [campaign.campaignId, campaign]));
  const actionItems = (payload.action_items ?? []).map((item): CampaignActionItem => {
    const campaign = item.campaign_id ? byId.get(item.campaign_id) : undefined;
    if (campaign) {
      return {
        eventName: campaign.eventName,
        campaigns: [campaign.shortName],
        campaignUrls: campaign.googleAdsUrl ? { [campaign.shortName]: campaign.googleAdsUrl } : {},
        priority: item.priority,
        issue: item.issue,
        action: item.action,
        metrics: {
          spend: campaign.spend,
          budget: campaign.budgetDay,
          pacingPct: campaign.pacingPct,
          impressions: campaign.impressions,
          clicks: campaign.clicks,
          conversions: campaign.conversions,
          pacingUnknown: campaign.pacingUnknown === true || campaign.fetchFailed === true,
        },
      };
    }
    const named = item.campaign_name ? parseCampaignName(item.campaign_name).baseName || item.campaign_name : '';
    return {
      eventName: named,
      campaigns: item.campaign_name ? [item.campaign_name] : [],
      campaignUrls: {},
      priority: item.priority,
      issue: item.issue,
      action: item.action,
      metrics: { spend: 0, budget: 0, pacingPct: 0, impressions: 0, clicks: 0, conversions: 0, pacingUnknown: true },
    };
  });

  return {
    pulledAt,
    dateRange: { mode: `last_${days}_days` },
    campaigns,
    accountTotals: {
      budgetDay: campaigns.reduce((sum, campaign) => sum + campaign.budgetDay, 0),
      spend: payload.totals.spend,
      impressions: payload.totals.impressions,
      clicks: payload.totals.clicks,
      conversions: typeof payload.totals.conversions === 'number' ? payload.totals.conversions : 0,
      conversionsMeasured: typeof payload.totals.conversions === 'number',
    },
    actionItems,
    amountsInAccountCurrency: true,
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
 * Why the Google Ads monitor cannot read through this project's own connection (#4526), as the error
 * its panel shows. The Google panel has no account picker, so the route resolves the account from the
 * connection itself and has no connection notice to fall back on: each state becomes a sentence the
 * panel prints.
 *
 * - `no_connection` is the same 404 and `connection_not_found` code an upstream "no connection"
 *   answer gets in `toAccountMonitorClientError`, so both ways of learning it read alike.
 * - `no_account` is a 409: the connection exists, but there is no account to read until one is bound.
 * - `unavailable` is a 503 `SERVICE_ADVISORY`, the one 5xx code whose text the panel shows, so the
 *   operator sees a retry prompt rather than the generic heading repeated.
 */
export function toGoogleMonitorConnectionError(state: Exclude<MonitorConnectionState, 'connected'>, operation: string): MicroserviceError {
  const context = { operation, service: 'campaign_controller' };
  switch (state) {
    case 'no_connection':
      return new MicroserviceError('This project has no Google Ads connection of its own to read the account with.', 404, getCodeForStatus(404), {
        ...context,
        errorBody: { error: ACCOUNT_MONITOR_NO_CONNECTION_CODE },
      });
    case 'no_account':
      return new MicroserviceError(
        "This project's Google Ads connection has no ad account bound to it, so there is nothing to monitor. Ask an LFX administrator to choose the ad account on the connection.",
        409,
        getCodeForStatus(409),
        context
      );
    default:
      return new MicroserviceError(
        "This project's Google Ads connection could not be read just now. Please try again shortly.",
        503,
        ERROR_CODES.SERVICE_ADVISORY,
        context
      );
  }
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
