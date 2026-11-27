// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CampaignServiceAccountMonitorCampaign, CampaignServiceMonitorScope, MonitorSystemAccountRead } from '../interfaces/campaign.interface';

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
 * The project an account-wide row is managed under when that is NOT the selected project, else `null` (#6209).
 * Such a row's levers (pause/resume, budget, bid) resolve the campaign within the SELECTED project and would offer to
 * adopt a campaign LFX already manages, so the tab withholds them and says where it is managed. A row created outside
 * LFX (`null`) keeps them, adoption included, and a project-scoped row (`undefined`) is unchanged.
 */
export function campaignMonitorManagedElsewhere(recordedProjectId: string | null | undefined, selectedProject: string): string | null {
  return typeof recordedProjectId === 'string' && recordedProjectId !== selectedProject ? recordedProjectId : null;
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

/**
 * A system-account read (#5889) that was account-wide: its empty state and note must stop saying only the project's
 * campaigns are shown. A response with no `systemAccountRead` is returned as is.
 */
export function withAccountWideSystemAccountRead<T extends { systemAccountRead?: MonitorSystemAccountRead }>(response: T): T {
  if (!response.systemAccountRead) {
    return response;
  }
  return { ...response, systemAccountRead: { ...response.systemAccountRead, accountWide: true, emptyMessage: 'No active campaigns found on this account.' } };
}

/**
 * The note under a panel read through the LF system account (#5889): which ad account was read and which campaigns
 * are shown. `null` when the read named no account (nothing recorded yet) or did not go through the system account.
 */
export function campaignMonitorSystemAccountNote(label: string, read: MonitorSystemAccountRead | undefined): string | null {
  if (!read?.accountId) {
    return null;
  }
  const shown = read.accountWide
    ? 'Every campaign on the account is shown, tagged with the project that created it or as created outside LFX.'
    : `This project has no ${label} account bound of its own, so only the campaigns created for it are shown.`;
  return `Read from ${label} account ${read.accountId} through the LF system account. ${shown}`;
}
