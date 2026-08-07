// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_LENS_ROI_CACHE_KEY, VALKEY_CACHE } from '@lfx-one/shared/constants';
import type {
  OrgLensRoiAnnual,
  OrgLensRoiAnnualRow,
  OrgLensRoiAnnualWarehouseRow,
  OrgLensRoiCoverage,
  OrgLensRoiCoverageWarehouseRow,
  OrgLensRoiMethod,
  OrgLensRoiSummary,
  OrgLensRoiSummaryWarehouseRow,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { resolveLfxOnePlatinumSchema } from '../helpers/snowflake-schema.helper';

import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';
import { withOrgCache } from './valkey.service';

export class OrgLensRoiService {
  private readonly snowflakeService = SnowflakeService.getInstance();

  public async getSummary(req: Request, accountId: string, method: OrgLensRoiMethod): Promise<OrgLensRoiSummary> {
    return withOrgCache(
      accountId,
      `${ORG_LENS_ROI_CACHE_KEY.summary}:${method}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => {
        logger.debug(req, 'get_org_lens_roi_summary', 'Cache miss; querying Snowflake', { account_id: accountId, method });
        const sql = `
        SELECT
          N_PROJECTS,
          TOTAL_EXPENDITURE,
          TOTAL_RETURN,
          PROFIT,
          ROI,
          BCR,
          YEAR_MIN,
          YEAR_MAX,
          DATE_MIN,
          DATE_MAX
        FROM ${this.summaryTable()}
        WHERE ACCOUNT_ID = ? AND MARKUP_METHOD = ?
      `;
        const result = await this.snowflakeService.execute<OrgLensRoiSummaryWarehouseRow>(sql, [accountId, method]);
        if (result.rows.length > 1) {
          logger.warning(req, 'get_org_lens_roi_summary', 'Expected at most one summary row for the grain', {
            account_id: accountId,
            method,
            rows: result.rows.length,
          });
        }
        return this.mapSummary(accountId, method, result.rows.at(0) ?? null);
      },
      OrgLensRoiService.isSummary
    );
  }

  public async getCoverage(req: Request, accountId: string, method: OrgLensRoiMethod): Promise<OrgLensRoiCoverage> {
    return withOrgCache(
      accountId,
      `${ORG_LENS_ROI_CACHE_KEY.coverage}:${method}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => {
        logger.debug(req, 'get_org_lens_roi_coverage', 'Cache miss; querying Snowflake', { account_id: accountId, method });
        // HAS_ROI is scoped to the same method the summary read uses. Counting every method here
        // would report "covered" for a method that has no rows, and the page would then render an
        // empty state whose stated reason contradicts it.
        const sql = `
        SELECT
          (SELECT COUNT(*) FROM ${this.summaryTable()} WHERE ACCOUNT_ID = ? AND MARKUP_METHOD = ?) AS HAS_ROI,
          (SELECT COUNT(*) FROM ${this.mappingTable()} WHERE ACCOUNT_ID = ? AND CDEV_ORG_ID IS NOT NULL) AS IS_MAPPED
      `;
        const result = await this.snowflakeService.execute<OrgLensRoiCoverageWarehouseRow>(sql, [accountId, method, accountId]);
        return this.mapCoverage(accountId, result.rows.at(0) ?? null);
      },
      OrgLensRoiService.isCoverage
    );
  }

  public async getAnnual(req: Request, accountId: string, method: OrgLensRoiMethod): Promise<OrgLensRoiAnnual> {
    return withOrgCache(
      accountId,
      `${ORG_LENS_ROI_CACHE_KEY.annual}:${method}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => {
        logger.debug(req, 'get_org_lens_roi_annual', 'Cache miss; querying Snowflake', { account_id: accountId, method });
        const sql = `
        SELECT
          YEAR,
          TOTAL_RETURN,
          EXPENDITURE,
          PROFIT,
          ROI,
          BCR
        FROM ${this.annualTable()}
        WHERE ACCOUNT_ID = ? AND MARKUP_METHOD = ?
        ORDER BY YEAR
      `;
        const result = await this.snowflakeService.execute<OrgLensRoiAnnualWarehouseRow>(sql, [accountId, method]);
        return {
          method,
          rows: result.rows.map((row) => this.mapAnnualRow(row)),
          apportioned: true,
        };
      },
      OrgLensRoiService.isAnnual
    );
  }

  private mapSummary(accountId: string, method: OrgLensRoiMethod, row: OrgLensRoiSummaryWarehouseRow | null): OrgLensRoiSummary {
    if (row === null) {
      return {
        orgUid: accountId,
        method,
        hasData: false,
        nProjects: 0,
        totalExpenditure: null,
        totalReturn: null,
        profit: null,
        roi: null,
        bcr: null,
        yearMin: null,
        yearMax: null,
        dateMin: null,
        dateMax: null,
      };
    }
    return {
      orgUid: accountId,
      method,
      hasData: true,
      nProjects: this.toCount(row.N_PROJECTS),
      totalExpenditure: this.toNullableNumber(row.TOTAL_EXPENDITURE),
      totalReturn: this.toNullableNumber(row.TOTAL_RETURN),
      profit: this.toNullableNumber(row.PROFIT),
      roi: this.toNullableNumber(row.ROI),
      bcr: this.toNullableNumber(row.BCR),
      yearMin: this.toNullableCount(row.YEAR_MIN),
      yearMax: this.toNullableCount(row.YEAR_MAX),
      dateMin: this.toNullableLabel(row.DATE_MIN),
      dateMax: this.toNullableLabel(row.DATE_MAX),
    };
  }

  private mapCoverage(accountId: string, row: OrgLensRoiCoverageWarehouseRow | null): OrgLensRoiCoverage {
    const hasData = this.toCount(row?.HAS_ROI) > 0;
    if (hasData) {
      return { orgUid: accountId, hasData: true, coverageReason: 'covered' };
    }
    const isMapped = this.toCount(row?.IS_MAPPED) > 0;
    return { orgUid: accountId, hasData: false, coverageReason: isMapped ? 'not_estimated' : 'unmapped' };
  }

  private mapAnnualRow(row: OrgLensRoiAnnualWarehouseRow): OrgLensRoiAnnualRow {
    return {
      year: this.toCount(row.YEAR),
      totalReturn: this.toFiniteNumber(row.TOTAL_RETURN),
      expenditure: this.toFiniteNumber(row.EXPENDITURE),
      profit: this.toFiniteNumber(row.PROFIT),
      roi: this.toNullableNumber(row.ROI),
      bcr: this.toNullableNumber(row.BCR),
    };
  }

  private static isSummary(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const summary = value as Record<string, unknown>;
    return typeof summary['hasData'] === 'boolean' && typeof summary['nProjects'] === 'number' && typeof summary['method'] === 'string';
  }

  private static isCoverage(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const coverage = value as Record<string, unknown>;
    return typeof coverage['hasData'] === 'boolean' && typeof coverage['coverageReason'] === 'string';
  }

  private static isAnnual(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const annual = value as Record<string, unknown>;
    return Array.isArray(annual['rows']) && typeof annual['apportioned'] === 'boolean' && typeof annual['method'] === 'string';
  }

  private toFiniteNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private toCount(value: unknown): number {
    return Math.max(0, Math.round(this.toFiniteNumber(value)));
  }

  // Keep a warehouse NULL as null; coercing it to 0 would report "broke even" for no investment.
  private toNullableNumber(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toNullableCount(value: unknown): number | null {
    const parsed = this.toNullableNumber(value);
    return parsed === null ? null : Math.round(parsed);
  }

  private toNullableLabel(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private summaryTable(): string {
    return `${resolveLfxOnePlatinumSchema()}.ORG_LENS_ROI_SUMMARY`;
  }

  private annualTable(): string {
    return `${resolveLfxOnePlatinumSchema()}.ORG_LENS_ROI_ANNUAL`;
  }

  private mappingTable(): string {
    return `${resolveLfxOnePlatinumSchema()}.ACCOUNT_TO_CDEV_ORG_MAPPING`;
  }
}
