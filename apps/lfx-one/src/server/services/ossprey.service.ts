// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CDP_CONFIG } from '@lfx-one/shared/constants';
import {
  CdpAdvisory,
  CdpHealthBreakdown,
  CdpPackageDetail,
  CdpPackagesListResponse,
  CdpProvenanceMapping,
  CdpStewardshipActivity,
  CdpStewardshipSummary,
  OsspreyAdvisory,
  OsspreyHistoryEntry,
  OsspreyListParams,
  OsspreyPackage,
  OsspreyPackagesResponse,
  OspreySeverity,
} from '@lfx-one/shared/interfaces';
import { randomUUID } from 'crypto';
import { Request } from 'express';

import { MicroserviceError } from '../errors';
import { CdpService } from './cdp.service';
import { logger } from './logger.service';

export class OsspreyServerService {
  private readonly cdpService = new CdpService();

  private _cdpApiUrl: string | undefined;

  private get cdpApiUrl(): string {
    return (this._cdpApiUrl ??= (process.env['CDP_API_URL'] || CDP_CONFIG.DEFAULT_STAGING_URL).replace(/\/+$/, ''));
  }

  public async getPackages(req: Request, params: OsspreyListParams): Promise<OsspreyPackagesResponse> {
    const requestId = randomUUID();

    try {
      const token = await this.cdpService.generateToken(req);
      const url = new URL(`${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.PACKAGES_LIST}`);

      if (params.sort) url.searchParams.set('sort', params.sort);
      if (params.status) url.searchParams.set('status', params.status);
      if (params.ecosystem) url.searchParams.set('ecosystem', params.ecosystem);
      if (params.lifecycle) url.searchParams.set('lifecycle', params.lifecycle);
      if (params.healthBand) url.searchParams.set('healthBand', params.healthBand);
      if (params.vulnFilter) url.searchParams.set('vulnFilter', params.vulnFilter);
      if (params.search) url.searchParams.set('search', params.search);
      if (params.cursor) url.searchParams.set('cursor', params.cursor);
      if (params.limit) url.searchParams.set('limit', String(params.limit));

      logger.debug(req, 'get_ossprey_packages', 'Fetching packages from CDP', {
        params,
        request_id: requestId,
      });

      const response = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-LFX-Request-ID': requestId,
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new MicroserviceError(`CDP packages list request failed: ${response.statusText}`, response.status, 'CDP_PACKAGES_LIST_ERROR', {
          operation: 'get_ossprey_packages',
          service: 'ossprey_service',
          errorBody: errorText,
        });
      }

      const data = (await response.json()) as CdpPackagesListResponse;

      logger.debug(req, 'get_ossprey_packages', 'Fetched packages from CDP', {
        count: data.packages?.length ?? 0,
      });

      return {
        packages: (data.packages ?? []).map((item) => this.mapListItem(item)),
        nextCursor: data.nextCursor,
        total: data.total,
      };
    } catch (error) {
      if (error instanceof MicroserviceError) throw error;

      throw new MicroserviceError('Failed to fetch OSSPREY packages', 502, 'OSSPREY_FETCH_ERROR', {
        operation: 'get_ossprey_packages',
        service: 'ossprey_service',
      });
    }
  }

  public async getPackage(req: Request, purl: string): Promise<OsspreyPackage | null> {
    const requestId = randomUUID();

    try {
      const token = await this.cdpService.generateToken(req);
      const detailUrl = `${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.PACKAGE_DETAIL(purl)}`;

      logger.debug(req, 'get_ossprey_package', 'Fetching package detail from CDP', {
        purl,
        request_id: requestId,
      });

      const response = await fetch(detailUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-LFX-Request-ID': requestId,
        },
        signal: AbortSignal.timeout(15000),
      });

      if (response.status === 404) {
        logger.warning(req, 'get_ossprey_package', 'Package not found in CDP', { purl });
        return null;
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new MicroserviceError(`CDP package detail request failed: ${response.statusText}`, response.status, 'CDP_PACKAGE_DETAIL_ERROR', {
          operation: 'get_ossprey_package',
          service: 'ossprey_service',
          errorBody: errorText,
        });
      }

      const detail = (await response.json()) as CdpPackageDetail;

      logger.debug(req, 'get_ossprey_package', 'Fetched package detail from CDP', { purl });

      return this.mapPackageDetail(detail);
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 404) return null;
      if (error instanceof MicroserviceError) throw error;

      throw new MicroserviceError('Failed to fetch OSSPREY package', 502, 'OSSPREY_FETCH_ERROR', {
        operation: 'get_ossprey_package',
        service: 'ossprey_service',
      });
    }
  }

  public mapListItem(item: CdpStewardshipSummary): OsspreyPackage {
    return {
      id: item.purl ?? item.name,
      name: item.name,
      purl: item.purl ?? item.name,
      ecosystem: (item.ecosystem as any) || 'npm',
      lifecycle: (item.lifecycle as any) || null,
      healthScore: item.health ?? null,
      impactScore: item.impact ?? null,
      busFactor: null,
      monthsStale: null,
      vulnCount: item.openVulns?.count ?? 0,
      vulnSeverity: item.openVulns?.severity ?? null,
      status: item.status,
      stewardIds: item.stewards.map((s) => s.userId),
      lastActivityLabel: item.lastActivityDescription ?? '',
      lastActivityTime: item.lastActivityAt ?? '',
      weeklyDownloads: null,
      dependentCount: null,
      directDependentCount: null,
      scoreCardScore: null,
      lastRelease: null,
      lastCommit: null,
      repoUrl: null,
      supplyChainMapping: null,
      provenance: null,
      hasSecurityMd: null,
      ecosystemReach: null,
      contactGroup: null,
      healthBreakdown: [],
      advisories: [],
      history: [],
      assessment: null,
    };
  }

  private mapPackageDetail(detail: CdpPackageDetail): OsspreyPackage {
    return {
      id: detail.purl,
      name: detail.name,
      purl: detail.purl,
      ecosystem: (detail.ecosystem as any) || 'npm',
      lifecycle: (detail.lifecycle as any) || null,
      healthScore: detail.healthBreakdown ? this.calculateHealthScore(detail.healthBreakdown) : null,
      impactScore: null,
      busFactor: null,
      monthsStale: this.calculateMonthsStale(detail.repository?.lastCommitAt),
      vulnCount: detail.advisories?.length ?? 0,
      vulnSeverity: this.getHighestVulnSeverity(detail.advisories),
      status: detail.stewardship.status,
      stewardIds: detail.stewardship.stewards.map((s) => s.userId),
      lastActivityLabel: detail.stewardship.lastActivityDescription ?? '',
      lastActivityTime: detail.stewardship.lastActivityAt ?? '',
      weeklyDownloads: detail.downloads != null ? this.formatNumber(detail.downloads) : null,
      dependentCount: detail.dependentPackagesCount != null ? this.formatNumber(detail.dependentPackagesCount) : null,
      directDependentCount: detail.dependentReposCount != null ? this.formatNumber(detail.dependentReposCount) : null,
      scoreCardScore: detail.repository?.scorecardScore != null ? `${detail.repository.scorecardScore.toFixed(1)} / 10` : null,
      lastRelease: this.formatDate(detail.latestReleaseAt),
      lastCommit: this.formatDate(detail.repository?.lastCommitAt),
      repoUrl: this.stripProtocol(detail.repository?.url),
      supplyChainMapping: null,
      provenance: this.deriveProvenance(detail.provenanceMappings),
      hasSecurityMd: detail.disclosureReadiness.securityMdPresent,
      ecosystemReach: detail.transitiveReach ?? null,
      contactGroup: null,
      healthBreakdown: this.formatHealthBreakdown(detail.healthBreakdown),
      advisories: this.mapAdvisories(detail.advisories),
      history: this.mapHistory(detail.stewardship.activity),
      assessment: null,
    };
  }

  private calculateHealthScore(breakdown: CdpHealthBreakdown): number {
    return Math.round((breakdown.maintainerHealth ?? 0) + (breakdown.securityAndSupplyChain ?? 0) + (breakdown.developmentActivity ?? 0));
  }

  private calculateMonthsStale(lastCommitAt?: string | null): number | null {
    if (!lastCommitAt) return null;
    try {
      const diffMs = Date.now() - new Date(lastCommitAt).getTime();
      return Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30));
    } catch {
      return null;
    }
  }

  private getHighestVulnSeverity(advisories: CdpAdvisory[]): OspreySeverity | null {
    if (!advisories?.length) return null;
    const severities: OspreySeverity[] = ['critical', 'high', 'medium', 'low'];
    for (const sev of severities) {
      if (advisories.some((a) => a.status === 'open' && a.severity === sev)) return sev;
    }
    return null;
  }

  private formatNumber(num: number): string {
    return num.toLocaleString('en-US');
  }

  private formatDate(isoDate?: string | null): string | null {
    if (!isoDate) return null;
    try {
      return new Date(isoDate).toISOString().split('T')[0];
    } catch {
      return null;
    }
  }

  private stripProtocol(url?: string | null): string | null {
    return url ? url.replace(/^https?:\/\//, '') : null;
  }

  private deriveProvenance(mappings: CdpProvenanceMapping[]): 'Full' | 'Partial' | 'None' | null {
    if (!mappings?.length) return 'None';
    return mappings.some((m) => m.confidence >= 0.9 && m.verified) ? 'Full' : 'Partial';
  }

  private formatHealthBreakdown(breakdown?: CdpHealthBreakdown | null): string[] {
    if (!breakdown) return [];
    const result: string[] = [];
    if (breakdown.maintainerHealth != null) result.push(`${Math.round(breakdown.maintainerHealth)} / 40`);
    if (breakdown.securityAndSupplyChain != null) result.push(`${Math.round(breakdown.securityAndSupplyChain)} / 35`);
    if (breakdown.developmentActivity != null) result.push(`${Math.round(breakdown.developmentActivity)} / 25`);
    return result;
  }

  private mapAdvisories(advisories: CdpAdvisory[]): OsspreyAdvisory[] {
    return advisories.map((adv) => ({
      id: adv.id,
      severity: adv.severity,
      description: adv.summary ?? '',
      state: adv.status === 'open' ? 'Open' : 'Patched',
      cvss: adv.cvss ?? null,
      publishedAt: adv.publishedAt ?? null,
      affectedVersionRange: adv.affectedVersionRange ?? null,
    }));
  }

  private mapHistory(activities: CdpStewardshipActivity[]): OsspreyHistoryEntry[] {
    return activities.map((act) => {
      const label = act.content ?? act.activityType;
      const timeAgo = this.formatRelativeTime(act.createdAt);
      let type: 'danger' | 'success' | undefined;
      if (['escalation', 'blocker_added'].includes(act.activityType)) type = 'danger';
      else if (['escalation_resolved', 'blocker_resolved', 'assessment_completed', 'remediation_logged'].includes(act.activityType)) type = 'success';
      return { label, timeAgo, type };
    });
  }

  private formatRelativeTime(isoDate: string): string {
    try {
      const diffMs = Date.now() - new Date(isoDate).getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMs / 3600000);
      const diffDays = Math.floor(diffMs / 86400000);
      if (diffMins < 60) return `${diffMins}m ago`;
      if (diffHours < 24) return `${diffHours}h ago`;
      if (diffDays < 30) return `${diffDays}d ago`;
      return `${Math.floor(diffDays / 30)}mo ago`;
    } catch {
      return '';
    }
  }
}
