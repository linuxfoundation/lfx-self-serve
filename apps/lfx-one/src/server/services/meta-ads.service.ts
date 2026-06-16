// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { MetaActionItem, MetaAccountTotals, MetaCampaignMetrics, MetaMonitorResponse, MetaPacingLabel } from '@lfx-one/shared/interfaces';

import type { Request } from 'express';

import { META_ACCOUNTS, META_BASE_URL, META_REQUEST_TIMEOUT_MS } from '../constants';
import { logger } from './logger.service';

// ---------------------------------------------------------------------------
// Meta Graph API helpers
// ---------------------------------------------------------------------------

async function metaRequest<T>(path: string): Promise<T> {
  const token = process.env['META_ACCESS_TOKEN'] ?? '';
  if (!token) throw new Error('META_ACCESS_TOKEN is not configured');

  const url = `${META_BASE_URL}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), META_REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Meta API ${resp.status}: ${body.slice(0, 200)}`);
    }
    return (await resp.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Campaign metrics builder
// ---------------------------------------------------------------------------

interface MetaInsightRow {
  impressions?: string;
  clicks?: string;
  spend?: string;
  ctr?: string;
  actions?: { action_type: string; value: string }[];
}

interface MetaCampaignRow {
  id: string;
  name: string;
  status: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
  insights?: { data?: MetaInsightRow[] };
}

function buildCampaignMetrics(camp: MetaCampaignRow, days: number): MetaCampaignMetrics {
  const insight = camp.insights?.data?.[0];

  const impressions = parseInt(insight?.impressions ?? '0', 10);
  const clicks = parseInt(insight?.clicks ?? '0', 10);
  const spend = parseFloat(insight?.spend ?? '0');
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;

  const conversions = (insight?.actions ?? [])
    .filter((a) => a.action_type === 'purchase' || a.action_type === 'lead')
    .reduce((sum, a) => sum + parseInt(a.value, 10), 0);

  const dailyBudget = parseFloat(camp.daily_budget ?? '0') / 100;
  const lifetimeBudget = parseFloat(camp.lifetime_budget ?? '0') / 100;
  const totalBudget = lifetimeBudget > 0 ? lifetimeBudget : dailyBudget * days;

  const expectedSpend = dailyBudget > 0 ? dailyBudget * days : totalBudget;
  const pacingPct = expectedSpend > 0 ? Math.round((spend / expectedSpend) * 100) : 0;

  let pacingLabel: MetaPacingLabel = 'normal';
  if (pacingPct < 50) pacingLabel = 'underspending';
  else if (pacingPct > 100) pacingLabel = 'overspending';
  else if (pacingPct > 90) pacingLabel = 'constrained';

  return {
    campaignId: camp.id,
    campaignName: camp.name,
    status: camp.status,
    totalBudget,
    dailyBudget,
    spend,
    impressions,
    clicks,
    ctr,
    conversions,
    pacingPct,
    pacingLabel,
    startDate: camp.start_time?.slice(0, 10) ?? '',
    endDate: camp.stop_time?.slice(0, 10) ?? '',
  };
}

// ---------------------------------------------------------------------------
// Action items
// ---------------------------------------------------------------------------

function buildMetaActionItems(campaigns: MetaCampaignMetrics[]): MetaActionItem[] {
  const items: MetaActionItem[] = [];

  for (const c of campaigns) {
    if (c.status === 'ACTIVE' && c.impressions === 0 && c.spend === 0) {
      items.push({
        priority: 'HIGH',
        campaignName: c.campaignName,
        issue: 'Campaign active but no delivery — 0 impressions and $0 spent',
        action: 'Check ad set targeting, budget, and creative approval status in Meta Ads Manager',
      });
    }
    if (c.ctr < 0.5 && c.impressions > 500) {
      items.push({
        priority: 'MED',
        campaignName: c.campaignName,
        issue: `Low CTR: ${c.ctr.toFixed(2)}% across ${c.impressions.toLocaleString()} impressions`,
        action: 'Refresh creative assets, test new ad formats, or narrow audience targeting',
      });
    }
    if (c.clicks > 20 && c.conversions === 0) {
      items.push({
        priority: 'MED',
        campaignName: c.campaignName,
        issue: `${c.clicks} clicks ($${c.spend.toFixed(2)} spent) but 0 conversions`,
        action: 'Verify Meta Pixel / Conversions API is firing; check landing page and CTA alignment',
      });
    }
    if (c.pacingLabel === 'underspending' && c.status === 'ACTIVE') {
      items.push({
        priority: 'MED',
        campaignName: c.campaignName,
        issue: `Underspending: ${c.pacingPct}% of budget used ($${c.spend.toFixed(2)} of $${c.totalBudget.toFixed(2)})`,
        action: 'Broaden audience targeting or increase bid cap to improve delivery',
      });
    }
    if ((c.pacingLabel === 'constrained' || c.pacingLabel === 'overspending') && c.status === 'ACTIVE') {
      items.push({
        priority: 'MED',
        campaignName: c.campaignName,
        issue: `Budget ${c.pacingLabel}: ${c.pacingPct}% of budget used`,
        action: 'Increase daily budget or narrow targeting to focus spend on highest-value audiences',
      });
    }
  }

  const priorityOrder: Record<string, number> = { HIGH: 0, MED: 1, LOW: 2 };
  items.sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3));
  return items;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

interface MetaCampaignsApiResponse {
  data: MetaCampaignRow[];
  paging?: { next?: string };
}

export async function getMetaAnalytics(req: Request, accountId: string, days: number): Promise<MetaMonitorResponse> {
  const account = META_ACCOUNTS.find((a) => a.accountId === accountId);
  const accountLabel = account?.label ?? accountId;

  logger.debug(req, 'meta_analytics', 'Fetching Meta campaign analytics', { accountId, days });

  const dateEnd = new Date();
  const dateStart = new Date();
  dateStart.setUTCDate(dateStart.getUTCDate() - (days - 1));
  const since = dateStart.toISOString().slice(0, 10);
  const until = dateEnd.toISOString().slice(0, 10);

  const fields = 'id,name,status,daily_budget,lifetime_budget,start_time,stop_time';
  const insightFields = 'impressions,clicks,spend,ctr,actions';
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));

  const path = `/${accountId}/campaigns?fields=${fields},insights.fields(${insightFields}).time_range(${timeRange})&limit=100`;
  const response = await metaRequest<MetaCampaignsApiResponse>(path);

  const allCampaigns = response.data ?? [];
  const campaigns = allCampaigns.map((c) => buildCampaignMetrics(c, days)).filter((c) => c.impressions > 0 || c.status === 'ACTIVE');

  const accountTotals: MetaAccountTotals = {
    spend: campaigns.reduce((s, c) => s + c.spend, 0),
    impressions: campaigns.reduce((s, c) => s + c.impressions, 0),
    clicks: campaigns.reduce((s, c) => s + c.clicks, 0),
    conversions: campaigns.reduce((s, c) => s + c.conversions, 0),
    campaignCount: campaigns.length,
  };

  const actionItems = buildMetaActionItems(campaigns);

  return {
    accountLabel,
    pulledAt: new Date().toISOString(),
    dateRange: { mode: `last_${days}_days` },
    campaigns,
    accountTotals,
    actionItems,
  };
}
