// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CDP_CONFIG } from '@lfx-one/shared/constants';
import {
  CdpAdvisory,
  CdpPackageDetail,
  CdpPackagesListResponse,
  CdpStewardshipSummary,
  OsspreyAdvisory,
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
      const token = await this.cdpService.generateToken(req).catch((err: unknown) => {
        throw new MicroserviceError('Failed to generate CDP token', 401, 'CDP_AUTH_FAILED', {
          operation: 'get_ossprey_packages',
          service: 'ossprey_service',
          originalMessage: err instanceof Error ? err.message : String(err),
        });
      });
      const url = new URL(`${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.PACKAGES_LIST}`);

      if (params.page) url.searchParams.set('page', String(params.page));
      if (params.pageSize) url.searchParams.set('pageSize', String(params.pageSize));
      if (params.ecosystem) url.searchParams.set('ecosystem', params.ecosystem);
      if (params.lifecycle) url.searchParams.set('lifecycle', params.lifecycle);
      if (params.busFactor1Only) url.searchParams.set('busFactor1Only', 'true');
      if (params.staleOnly) url.searchParams.set('staleOnly', 'true');
      if (params.unstewardedOnly) url.searchParams.set('unstewardedOnly', 'true');
      if (params.sortBy) url.searchParams.set('sortBy', params.sortBy);
      if (params.sortDir) url.searchParams.set('sortDir', params.sortDir);

      logger.debug(req, 'get_ossprey_packages', 'Fetching packages from CDP', {
        url: url.toString(),
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
        const errorText = await response.text().catch(() => '[unreadable error body]');
        throw new MicroserviceError(`CDP packages list request failed: ${response.statusText}`, response.status, 'CDP_PACKAGES_LIST_ERROR', {
          operation: 'get_ossprey_packages',
          service: 'ossprey_service',
          errorBody: errorText,
        });
      }

      const data = (await response.json()) as CdpPackagesListResponse;

      logger.debug(req, 'get_ossprey_packages', 'Fetched packages from CDP', {
        count: data.packages?.length ?? 0,
        total: data.total,
      });

      return {
        packages: (data.packages ?? []).map((item) => this.mapListItem(item)),
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
      const token = await this.cdpService.generateToken(req).catch((err: unknown) => {
        throw new MicroserviceError('Failed to generate CDP token', 401, 'CDP_AUTH_FAILED', {
          operation: 'get_ossprey_package',
          service: 'ossprey_service',
          originalMessage: err instanceof Error ? err.message : String(err),
        });
      });
      const url = new URL(`${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.PACKAGE_DETAIL}`);
      url.searchParams.set('purl', purl);

      logger.debug(req, 'get_ossprey_package', 'Fetching package detail from CDP', {
        purl,
        url: url.toString(),
        request_id: requestId,
      });

      const response = await fetch(url.toString(), {
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
        const errorText = await response.text().catch(() => '[unreadable error body]');
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
    const vulns = item.openVulns;
    const vulnCount = vulns ? vulns.low + vulns.medium + vulns.high + vulns.critical : 0;
    const vulnSeverity = this.worstSeverityFromCounts(vulns);

    return {
      id: item.purl,
      name: item.name,
      purl: item.purl,
      ecosystem: (item.ecosystem as OsspreyPackage['ecosystem']) || 'npm',
      lifecycle: (item.lifecycle as OsspreyPackage['lifecycle']) || null,
      healthScore: item.health ?? null,
      impactScore: item.impact ?? null,
      busFactor: item.maintainerBusFactor ?? null,
      monthsStale: null,
      vulnCount,
      vulnSeverity,
      status: (item.stewardship as OsspreyPackage['status']) || 'unassigned',
      stewardIds: [],
      lastActivityLabel: '—',
      lastActivityTime: '',
      downloadsLastMonth: null,
      dependentPackages: null,
      dependentRepos: null,
      scoreCardScore: null,
      lastRelease: null,
      lastCommit: null,
      repoUrl: null,
      mappingConfidence: null,
      supplyChainMapping: null,
      provenance: null,
      pvrEnabled: null,
      criticalVulnFlag: null,
      hasSecurityMd: null,
      ecosystemReach: null,
      contactGroup: null,
      healthBreakdown: ['—', '—', '—'],
      advisories: [],
      history: [],
      assessment: null,
    };
  }

  private mapPackageDetail(detail: CdpPackageDetail): OsspreyPackage {
    const advisories = this.mapAdvisories(detail.security?.advisories ?? []);
    const vulnSeverity = this.getHighestVulnSeverity(advisories);

    const hs = detail.general?.healthScore;
    // Fixed positional slots — the drawer labels them Maintainer health /
    // Security & supply chain / Development activity, so missing scores keep
    // their position instead of shifting the rest.
    const healthBreakdown: string[] = hs
      ? [
          hs.maintainerHealth != null ? `${Math.round(hs.maintainerHealth)} / 40` : '—',
          hs.securitySupplyChain != null ? `${Math.round(hs.securitySupplyChain)} / 35` : '—',
          hs.developmentActivity != null ? `${Math.round(hs.developmentActivity)} / 25` : '—',
        ]
      : ['—', '—', '—'];

    const repo = detail.provenance?.repositoryMapping;
    const impact = detail.general?.impact;
    const risk = detail.general?.riskSignals;
    const cvd = detail.security?.cvd;
    const integrity = detail.provenance?.supplyChainIntegrity;

    return {
      id: detail.purl,
      name: detail.name,
      purl: detail.purl,
      ecosystem: (detail.ecosystem as OsspreyPackage['ecosystem']) || 'npm',
      lifecycle: (risk?.lifecycle as OsspreyPackage['lifecycle']) || null,
      healthScore: hs?.total ?? null,
      impactScore: impact?.impactScore ?? null,
      busFactor: risk?.maintainerBusFactor ?? null,
      monthsStale: this.calculateMonthsStale(repo?.lastCommitAt),
      vulnCount: advisories.length,
      vulnSeverity,
      status: 'unassigned',
      stewardIds: [],
      lastActivityLabel: '—',
      lastActivityTime: '',
      downloadsLastMonth: impact?.downloadsLastMonth != null ? this.formatNumber(impact.downloadsLastMonth) : null,
      dependentPackages: impact?.dependentPackages != null ? this.formatNumber(impact.dependentPackages) : null,
      dependentRepos: impact?.dependentRepos != null ? this.formatNumber(impact.dependentRepos) : null,
      scoreCardScore: risk?.openSSFScorecard != null ? `${risk.openSSFScorecard.toFixed(1)} / 10` : null,
      lastRelease: this.formatDate(risk?.lastRelease),
      lastCommit: this.formatDate(repo?.lastCommitAt),
      repoUrl: this.stripProtocol(repo?.declaredRepo),
      mappingConfidence: repo?.mappingConfidence ?? null,
      supplyChainMapping: this.mapConfidenceBand(repo?.mappingConfidence),
      provenance: this.mapProvenance(integrity),
      pvrEnabled: cvd?.isPvrEnabled ?? null,
      criticalVulnFlag: cvd?.criticalVulnerabilityFlag ?? null,
      hasSecurityMd: risk?.hasSecurityFile ?? null,
      ecosystemReach: impact?.transitiveReach ?? null,
      contactGroup: null,
      healthBreakdown,
      advisories,
      history: [],
      assessment: null,
    };
  }

  private mapConfidenceBand(confidence?: number | null): OsspreyPackage['supplyChainMapping'] {
    if (confidence == null) return null;
    if (confidence >= 0.9) return 'High';
    if (confidence >= 0.7) return 'Medium';
    return 'Low';
  }

  private mapProvenance(integrity?: { buildProvenance: unknown | null; signedReleases: unknown | null } | null): OsspreyPackage['provenance'] {
    if (!integrity) return null;
    const hasBuild = Boolean(integrity.buildProvenance);
    const hasSigned = Boolean(integrity.signedReleases);
    if (hasBuild && hasSigned) return 'Full';
    if (hasBuild || hasSigned) return 'Partial';
    return 'None';
  }

  private worstSeverityFromCounts(vulns: { low: number; medium: number; high: number; critical: number } | null): OspreySeverity | null {
    if (!vulns) return null;
    if (vulns.critical > 0) return 'critical';
    if (vulns.high > 0) return 'high';
    if (vulns.medium > 0) return 'medium';
    if (vulns.low > 0) return 'low';
    return null;
  }

  private getHighestVulnSeverity(advisories: OsspreyAdvisory[]): OspreySeverity | null {
    if (!advisories.length) return null;
    const order: OspreySeverity[] = ['critical', 'high', 'medium', 'low'];
    for (const sev of order) {
      if (advisories.some((a) => a.severity === sev)) return sev;
    }
    return null;
  }

  private mapAdvisories(advisories: CdpAdvisory[]): OsspreyAdvisory[] {
    return advisories.map((adv) => ({
      id: adv.osvId,
      severity: adv.severity,
      description: adv.resolution ?? adv.osvId,
      state: 'Open' as const,
      cvss: null,
      publishedAt: null,
      affectedVersionRange: null,
    }));
  }

  private calculateMonthsStale(lastCommitAt?: string | null): number | null {
    if (!lastCommitAt) return null;
    try {
      return Math.floor((Date.now() - new Date(lastCommitAt).getTime()) / (1000 * 60 * 60 * 24 * 30));
    } catch {
      return null;
    }
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
}
