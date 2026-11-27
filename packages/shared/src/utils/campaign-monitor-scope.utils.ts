// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CampaignServiceAccountMonitorCampaign, CampaignServiceMonitorScope } from '../interfaces/campaign.interface';

/**
 * Which scope to ask for (#6209): `account` only while `LFX_CUTOVER_CAMPAIGN_SERVICE_MONITOR_ACCOUNT_SCOPE`
 * is on, the request opted in (the Monitor tab's `accountWide=true`; the Optimize tab never does), AND the
 * caller's project `global_marketing_ops` check came back granted. Anything else — flag off, no opt-in, a
 * denial, or a check that could not be made — keeps the project-scoped read, the narrower view.
 */
export function campaignMonitorScope(flagOn: boolean, requested: boolean, marketingOps: 'granted' | 'denied' | 'unverified'): CampaignServiceMonitorScope {
  return flagOn && requested && marketingOps === 'granted' ? 'account' : undefined;
}

/**
 * Stamps each mapped row of an account-wide read with the project campaign-service records it for,
 * joined on the platform campaign id: the project id, or `null` when no project records it (it was
 * created outside LFX). A project-scoped read is never passed here, so its rows keep the field absent.
 */
export function withRecordedProjects<R extends { campaignId: string; recordedProjectId?: string | null }, T extends { campaigns: R[] }>(
  response: T,
  payload: { campaigns?: Pick<CampaignServiceAccountMonitorCampaign, 'platform_campaign_id' | 'recorded_project_id'>[] }
): T {
  const owners = new Map((payload.campaigns ?? []).map((row) => [row.platform_campaign_id, row.recorded_project_id]));
  return {
    ...response,
    campaigns: response.campaigns.map((campaign) => {
      const owner = owners.get(campaign.campaignId);
      return { ...campaign, recordedProjectId: typeof owner === 'string' && owner.trim() !== '' ? owner : null };
    }),
  };
}

/**
 * The Monitor row's provenance tag: `null` on a project-scoped row (no tag), "Created outside LFX"
 * when no project records it, otherwise the project it was created or adopted under.
 */
export function campaignMonitorProvenance(recordedProjectId: string | null | undefined): string | null {
  if (recordedProjectId === undefined) {
    return null;
  }
  return recordedProjectId === null ? 'Created outside LFX' : `LFX: ${recordedProjectId}`;
}
