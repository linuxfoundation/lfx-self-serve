// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { CDP_CONFIG } from '@lfx-one/shared/constants';
import {
  CdpActivityResponse,
  CdpActivityRow,
  CdpAdvisory,
  CdpPackageDetail,
  CdpPackagesListResponse,
  CdpPackagesMetricsResponse,
  CdpScatterResponse,
  CdpStewardSummary,
  CdpStewardshipSummary,
  AkritesActivityResponse,
  AkritesAdvisory,
  AkritesAssignStewardRequest,
  AkritesAssignStewardResponse,
  AkritesEscalateRequest,
  AkritesHistoryEntry,
  AkritesListParams,
  AkritesMetrics,
  AkritesPackage,
  AkritesPackagesResponse,
  AkritesScatterResponse,
  AkritesStatus,
  AkritesSteward,
  AkritesStewardRole,
  AkritesStewardshipResponse,
  AkritesUpdateStatusRequest,
  AkritesSeverity,
} from '@lfx-one/shared/interfaces';
import { randomUUID } from 'crypto';
import { Request } from 'express';

import { MicroserviceError } from '../errors';
import { CdpService } from './cdp.service';
import { logger } from './logger.service';

export class AkritesServerService {
  private readonly cdpService = new CdpService();

  private _cdpApiUrl: string | undefined;

  private get cdpApiUrl(): string {
    return (this._cdpApiUrl ??= (process.env['CDP_API_URL'] || CDP_CONFIG.DEFAULT_STAGING_URL).replace(/\/+$/, ''));
  }

  public async getPackages(req: Request, params: AkritesListParams): Promise<AkritesPackagesResponse> {
    const requestId = randomUUID();

    try {
      const token = await this.cdpService.generateToken(req).catch((err: unknown) => {
        throw new MicroserviceError('Failed to generate CDP token', 401, 'CDP_AUTH_FAILED', {
          operation: 'get_akrites_packages',
          service: 'akrites_service',
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
      if (params.search) url.searchParams.set('name', params.search);
      if (params.status && params.status !== 'all') url.searchParams.set('status', params.status);
      if (params.healthBand) url.searchParams.set('healthBand', params.healthBand);
      if (params.vulnFilter) url.searchParams.set('vulnSeverity', params.vulnFilter);
      const cdpSortMap: Record<string, string> = { impact: 'impact', health: 'health', vulns: 'openVulns', name: 'name', risk: 'risk' };
      const cdpSortDirMap: Record<string, string> = { impact: 'desc', health: 'asc', vulns: 'desc', name: 'asc', risk: 'desc' };
      if (params.sortBy) {
        const cdpSort = cdpSortMap[params.sortBy];
        if (cdpSort) {
          url.searchParams.set('sortBy', cdpSort);
          url.searchParams.set('sortDir', cdpSortDirMap[params.sortBy] ?? 'asc');
        }
      }

      logger.debug(req, 'get_akrites_packages', 'Fetching packages from CDP', {
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
          operation: 'get_akrites_packages',
          service: 'akrites_service',
          errorBody: errorText,
        });
      }

      const data = (await response.json()) as CdpPackagesListResponse;

      logger.debug(req, 'get_akrites_packages', 'Fetched packages from CDP', {
        count: data.rows?.length ?? 0,
        total: data.total,
      });

      const packages = (data.rows ?? []).map((item) => this.mapListItem(item));

      return { packages, total: data.total, statusCounts: data.statusCounts };
    } catch (error) {
      if (error instanceof MicroserviceError) throw error;

      throw new MicroserviceError('Failed to fetch Akrites packages', 502, 'AKRITES_FETCH_ERROR', {
        operation: 'get_akrites_packages',
        service: 'akrites_service',
      });
    }
  }

  public async getMetrics(req: Request): Promise<AkritesMetrics> {
    const requestId = randomUUID();

    try {
      const token = await this.cdpService.generateToken(req).catch((err: unknown) => {
        throw new MicroserviceError('Failed to generate CDP token', 401, 'CDP_AUTH_FAILED', {
          operation: 'get_akrites_metrics',
          service: 'akrites_service',
          originalMessage: err instanceof Error ? err.message : String(err),
        });
      });
      const url = new URL(`${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.PACKAGES_METRICS}`);

      logger.debug(req, 'get_akrites_metrics', 'Fetching package metrics from CDP', {
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

      if (!response.ok) {
        const errorText = await response.text().catch(() => '[unreadable error body]');
        throw new MicroserviceError(`CDP metrics request failed: ${response.statusText}`, response.status, 'CDP_METRICS_ERROR', {
          operation: 'get_akrites_metrics',
          service: 'akrites_service',
          errorBody: errorText,
        });
      }

      const data = (await response.json()) as CdpPackagesMetricsResponse;

      return {
        totalPackages: data.totalPackages ?? 0,
        criticalPackages: data.criticalPackages ?? 0,
        coveragePercent: data.coveragePercent ?? 0,
        coverageTrend: data.coverageTrend ?? null,
        activeStewards: data.activeStewards ?? 0,
        unassignedCritical: data.unassignedCritical ?? 0,
        needsAttention: data.needsAttention ?? 0,
        escalated: data.escalated ?? 0,
      };
    } catch (error) {
      if (error instanceof MicroserviceError) throw error;

      throw new MicroserviceError('Failed to fetch Akrites metrics', 502, 'AKRITES_METRICS_ERROR', {
        operation: 'get_akrites_metrics',
        service: 'akrites_service',
      });
    }
  }

  public async getActivityFeed(req: Request, page: number, pageSize: number): Promise<AkritesActivityResponse> {
    const requestId = randomUUID();

    try {
      const token = await this.cdpService.generateToken(req).catch((err: unknown) => {
        throw new MicroserviceError('Failed to generate CDP token', 401, 'CDP_AUTH_FAILED', {
          operation: 'get_akrites_activity',
          service: 'akrites_service',
          originalMessage: err instanceof Error ? err.message : String(err),
        });
      });
      const url = new URL(`${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.ACTIVITY}`);
      url.searchParams.set('page', String(page));
      url.searchParams.set('pageSize', String(pageSize));

      logger.debug(req, 'get_akrites_activity', 'Fetching activity feed from CDP', {
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

      if (!response.ok) {
        const errorText = await response.text().catch(() => '[unreadable error body]');
        throw new MicroserviceError(`CDP activity feed request failed: ${response.statusText}`, response.status, 'CDP_ACTIVITY_ERROR', {
          operation: 'get_akrites_activity',
          service: 'akrites_service',
          errorBody: errorText,
        });
      }

      return (await response.json()) as AkritesActivityResponse;
    } catch (error) {
      if (error instanceof MicroserviceError) throw error;

      throw new MicroserviceError('Failed to fetch Akrites activity feed', 502, 'AKRITES_ACTIVITY_ERROR', {
        operation: 'get_akrites_activity',
        service: 'akrites_service',
      });
    }
  }

  public async getPackage(req: Request, purl: string): Promise<AkritesPackage | null> {
    const requestId = randomUUID();

    try {
      const token = await this.cdpService.generateToken(req).catch((err: unknown) => {
        throw new MicroserviceError('Failed to generate CDP token', 401, 'CDP_AUTH_FAILED', {
          operation: 'get_akrites_package',
          service: 'akrites_service',
          originalMessage: err instanceof Error ? err.message : String(err),
        });
      });
      const url = new URL(`${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.PACKAGE_DETAIL}`);
      url.searchParams.set('purl', purl);

      logger.debug(req, 'get_akrites_package', 'Fetching package detail from CDP', {
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
        logger.warning(req, 'get_akrites_package', 'Package not found in CDP', { purl });
        return null;
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => '[unreadable error body]');
        throw new MicroserviceError(`CDP package detail request failed: ${response.statusText}`, response.status, 'CDP_PACKAGE_DETAIL_ERROR', {
          operation: 'get_akrites_package',
          service: 'akrites_service',
          errorBody: errorText,
        });
      }

      const [detail, activityRows] = await Promise.all([response.json() as Promise<CdpPackageDetail>, this.fetchActivityForPackage(req, token, purl)]);

      logger.debug(req, 'get_akrites_package', 'Fetched package detail from CDP', { purl });

      return this.mapPackageDetail(detail, activityRows);
    } catch (error) {
      if (error instanceof MicroserviceError && error.statusCode === 404) return null;
      if (error instanceof MicroserviceError) throw error;

      throw new MicroserviceError('Failed to fetch Akrites package', 502, 'AKRITES_FETCH_ERROR', {
        operation: 'get_akrites_package',
        service: 'akrites_service',
      });
    }
  }

  /**
   * Open a package for stewardship (creates the stewardship row if absent).
   * Returns the stewardship record, including the integer `id` used by the other admin actions.
   */
  public async openStewardship(req: Request, purl: string): Promise<AkritesStewardshipResponse> {
    return this.cdpWrite<AkritesStewardshipResponse>(req, 'open_akrites_stewardship', 'POST', CDP_CONFIG.ENDPOINTS.STEWARDSHIPS_OPEN, { purl });
  }

  /** Assign (or re-assign) a steward to a stewardship, optionally moving it to `assessing`. */
  public async assignSteward(req: Request, id: number, body: AkritesAssignStewardRequest): Promise<AkritesAssignStewardResponse> {
    return this.cdpWrite<AkritesAssignStewardResponse>(req, 'assign_akrites_steward', 'POST', CDP_CONFIG.ENDPOINTS.STEWARDSHIP_ASSIGN(id), body);
  }

  /** Escalate a stewardship with the chosen resolution path. */
  public async escalateStewardship(req: Request, id: number, body: AkritesEscalateRequest): Promise<AkritesStewardshipResponse> {
    return this.cdpWrite<AkritesStewardshipResponse>(req, 'escalate_akrites_stewardship', 'POST', CDP_CONFIG.ENDPOINTS.STEWARDSHIP_ESCALATE(id), body);
  }

  /** Update a stewardship's status (e.g. assessing/active/needs_attention/blocked/inactive). */
  public async updateStewardshipStatus(req: Request, id: number, body: AkritesUpdateStatusRequest): Promise<AkritesStewardshipResponse> {
    return this.cdpWrite<AkritesStewardshipResponse>(req, 'update_akrites_stewardship_status', 'PATCH', CDP_CONFIG.ENDPOINTS.STEWARDSHIP_STATUS(id), body);
  }

  public async getScatterData(req: Request): Promise<AkritesScatterResponse> {
    const requestId = randomUUID();

    try {
      const token = await this.cdpService.generateToken(req).catch((err: unknown) => {
        throw new MicroserviceError('Failed to generate CDP token', 401, 'CDP_AUTH_FAILED', {
          operation: 'get_akrites_scatter',
          service: 'akrites_service',
          originalMessage: err instanceof Error ? err.message : String(err),
        });
      });
      const url = new URL(`${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.PACKAGES_SCATTER}`);
      const statusFilter = req.query['status'] as string | undefined;
      if (statusFilter) {
        url.searchParams.set('status', statusFilter);
      }

      logger.debug(req, 'get_akrites_scatter', 'Fetching scatter data from CDP', {
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

      if (!response.ok) {
        const errorText = await response.text().catch(() => '[unreadable error body]');
        throw new MicroserviceError(`CDP scatter request failed: ${response.statusText}`, response.status, 'CDP_SCATTER_ERROR', {
          operation: 'get_akrites_scatter',
          service: 'akrites_service',
          errorBody: errorText,
        });
      }

      const data = (await response.json()) as CdpScatterResponse;

      const validStatuses: AkritesStatus[] = ['unassigned', 'open', 'assessing', 'active', 'needs_attention', 'escalated', 'blocked', 'inactive'];
      const points = (data.points ?? []).map((p) => {
        const status = validStatuses.includes(p.stewardshipStatus as AkritesStatus) ? (p.stewardshipStatus as AkritesStatus) : 'unassigned';
        const parsed = p.stewardshipId ? Number.parseInt(p.stewardshipId, 10) : null;
        const stewardshipId = parsed !== null && !Number.isNaN(parsed) ? parsed : null;

        return {
          purl: p.purl,
          name: p.name,
          impactScore: p.criticalityScore ?? null,
          healthScore: p.healthScore ?? null,
          status,
          stewardshipId,
          openVulns: p.openVulns ?? 0,
        };
      });

      logger.debug(req, 'get_akrites_scatter', 'Fetched scatter data from CDP', { point_count: points.length });

      return { points, total: data.total ?? points.length };
    } catch (error) {
      if (error instanceof MicroserviceError) throw error;

      throw new MicroserviceError('Failed to fetch Akrites scatter data', 502, 'AKRITES_SCATTER_ERROR', {
        operation: 'get_akrites_scatter',
        service: 'akrites_service',
      });
    }
  }

  public mapListItem(item: CdpStewardshipSummary): AkritesPackage {
    const vulnCount = item.openVulns ?? 0;
    const vulnSeverity = (item.maxVulnSeverity as AkritesPackage['vulnSeverity']) ?? null;

    return {
      id: item.purl,
      name: item.name,
      purl: item.purl,
      ecosystem: (item.ecosystem as AkritesPackage['ecosystem']) || 'npm',
      lifecycle: null,
      healthScore: null,
      impactScore: null,
      busFactor: item.maintainerCount ?? null,
      monthsStale: null,
      vulnCount,
      vulnSeverity,
      status: (item.stewardshipStatus as AkritesPackage['status']) || 'unassigned',
      stewardshipId: item.stewardshipId ? parseInt(item.stewardshipId, 10) : null,
      stewards: (item.stewards ?? []).map((s) => ({
        userId: s.userId,
        role: s.role as AkritesStewardRole,
        assignedAt: s.assignedAt,
        name: null,
        avatarUrl: null,
      })),
      lastActivityLabel: item.lastActivity ? item.lastActivity.content || this.formatActivityLabel(item.lastActivity.type) : '—',
      lastActivityTime: item.lastActivity ? this.formatRelativeTime(item.lastActivity.at) : '',
      downloadsLastMonth: null,
      dependentPackages: null,
      dependentRepos: null,
      scoreCardScore: item.scorecardScore != null ? `${Number(item.scorecardScore).toFixed(1)} / 10` : null,
      lastRelease: this.formatDate(item.latestReleaseAt),
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

  private mapPackageDetail(detail: CdpPackageDetail, activityRows: CdpActivityRow[] = []): AkritesPackage {
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
    const stewardship = detail.stewardship;

    return {
      id: detail.purl,
      name: detail.name,
      purl: detail.purl,
      ecosystem: (detail.ecosystem as AkritesPackage['ecosystem']) || 'npm',
      lifecycle: (risk?.lifecycle as AkritesPackage['lifecycle']) || null,
      healthScore: hs?.total ?? null,
      impactScore: impact?.impactScore ?? null,
      busFactor: risk?.maintainerBusFactor ?? null,
      monthsStale: this.calculateMonthsStale(repo?.lastCommitAt),
      vulnCount: advisories.length,
      vulnSeverity,
      status: stewardship?.status ?? 'unassigned',
      stewardshipId: stewardship?.id ?? null,
      stewards: this.mapStewards(stewardship?.stewards ?? null),
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
      history: this.mapActivityRows(activityRows),
      assessment: null,
    };
  }

  /**
   * Shared helper for the stewardship write endpoints: generates a CDP token, issues the
   * authenticated JSON request, and normalizes failures into MicroserviceError.
   */
  private async cdpWrite<T>(req: Request, operation: string, method: 'POST' | 'PATCH', endpoint: string, body: unknown): Promise<T> {
    const requestId = randomUUID();

    try {
      const token = await this.cdpService.generateToken(req).catch((err: unknown) => {
        throw new MicroserviceError('Failed to generate CDP token', 401, 'CDP_AUTH_FAILED', {
          operation,
          service: 'akrites_service',
          originalMessage: err instanceof Error ? err.message : String(err),
        });
      });
      const url = `${this.cdpApiUrl}${endpoint}`;

      logger.debug(req, operation, 'Sending stewardship write to CDP', { url, method, request_id: requestId });

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'X-LFX-Request-ID': requestId,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '[unreadable error body]');
        throw new MicroserviceError(`CDP stewardship request failed: ${response.statusText}`, response.status, 'CDP_STEWARDSHIP_WRITE_ERROR', {
          operation,
          service: 'akrites_service',
          errorBody: errorText,
        });
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof MicroserviceError) throw error;

      throw new MicroserviceError('Failed to perform Akrites stewardship action', 502, 'AKRITES_STEWARDSHIP_ERROR', {
        operation,
        service: 'akrites_service',
      });
    }
  }

  /** Map CDP steward rows to the UI shape. Name/avatar stay null until the roster endpoint exists. */
  private mapStewards(stewards: CdpStewardSummary[] | null): AkritesSteward[] {
    if (!stewards) return [];
    return stewards.map((s) => ({
      userId: s.userId,
      role: s.role,
      assignedAt: s.assignedAt,
      name: null,
      avatarUrl: null,
    }));
  }

  private mapConfidenceBand(confidence?: number | null): AkritesPackage['supplyChainMapping'] {
    if (confidence == null) return null;
    if (confidence >= 0.9) return 'High';
    if (confidence >= 0.7) return 'Medium';
    return 'Low';
  }

  private mapProvenance(integrity?: { buildProvenance: unknown | null; signedReleases: unknown | null } | null): AkritesPackage['provenance'] {
    if (!integrity) return null;
    const hasBuild = Boolean(integrity.buildProvenance);
    const hasSigned = Boolean(integrity.signedReleases);
    if (hasBuild && hasSigned) return 'Full';
    if (hasBuild || hasSigned) return 'Partial';
    return 'None';
  }

  private getHighestVulnSeverity(advisories: AkritesAdvisory[]): AkritesSeverity | null {
    if (!advisories.length) return null;
    const order: AkritesSeverity[] = ['critical', 'high', 'medium', 'low'];
    for (const sev of order) {
      if (advisories.some((a) => a.severity === sev)) return sev;
    }
    return null;
  }

  private mapAdvisories(advisories: CdpAdvisory[]): AkritesAdvisory[] {
    return advisories.map((adv) => ({
      id: adv.osvId,
      severity: adv.severity,
      description: adv.resolution ?? adv.osvId,
      state: adv.resolution != null ? ('Patched' as const) : ('Open' as const),
      cvss: null,
      publishedAt: null,
      affectedVersionRange: null,
    }));
  }

  private calculateMonthsStale(lastCommitAt?: string | null): number | null {
    if (!lastCommitAt) return null;
    const parsed = new Date(lastCommitAt).getTime();
    if (Number.isNaN(parsed)) return null;
    return Math.floor((Date.now() - parsed) / (1000 * 60 * 60 * 24 * 30));
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

  private async fetchActivityForPackage(req: Request, token: string, purl: string): Promise<CdpActivityRow[]> {
    try {
      const url = new URL(`${this.cdpApiUrl}${CDP_CONFIG.ENDPOINTS.ACTIVITY}`);
      url.searchParams.set('pageSize', '100');
      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return [];
      const data = (await response.json()) as CdpActivityResponse;
      return (data.rows ?? []).filter((r) => r.packagePurl === purl);
    } catch {
      logger.warning(req, 'fetch_activity', 'Failed to fetch activity feed, skipping', { purl });
      return [];
    }
  }

  private mapActivityRows(rows: CdpActivityRow[]): AkritesHistoryEntry[] {
    return rows.map((row) => ({
      label: row.content || this.formatActivityLabel(row.activityType),
      timeAgo: this.formatRelativeTime(row.createdAt),
      type: this.getActivityDotType(row.stewardshipStatus),
    }));
  }

  private getActivityDotType(status: string): 'danger' | 'success' | undefined {
    if (status === 'escalated' || status === 'blocked' || status === 'inactive') return 'danger';
    if (status === 'active') return 'success';
    return undefined;
  }

  private formatRelativeTime(isoDate?: string | null): string {
    if (!isoDate) return '';
    const ms = Date.now() - new Date(isoDate).getTime();
    if (Number.isNaN(ms)) return '';
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;
    const hours = Math.floor(ms / 3_600_000);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(ms / 86_400_000);
    if (days < 60) return `${days}d ago`;
    return new Date(isoDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  private formatActivityLabel(type: string): string {
    const labels: Record<string, string> = {
      escalation: 'Escalated',
      state_changed: 'Status changed',
      steward_assigned: 'Steward assigned',
      steward_removed: 'Steward removed',
      stewardship_opened: 'Opened for stewardship',
      package_synced: 'Package synced',
      advisory_detected: 'New security advisory detected',
      advisory_resolved: 'Security advisory resolved',
      status_inactive: 'Marked inactive',
      quarterly_update: 'Quarterly status update posted',
      remediation_logged: 'Remediation progress logged',
      assessment_started: 'Security assessment started',
      blocker_resolved: 'Blocker resolved',
      reactivated: 'Reactivated',
    };
    return labels[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
}
