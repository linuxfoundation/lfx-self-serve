// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { ORG_LENS_ROI_CACHE_KEY, ORG_LENS_ROI_COVERAGE_REASONS, ORG_LENS_ROI_METHODS, VALKEY_CACHE } from '@lfx-one/shared/constants';
import type {
  OrgLensRoiAnnual,
  OrgLensRoiAnnualRow,
  OrgLensRoiAnnualWarehouseRow,
  OrgLensRoiCategoryRow,
  OrgLensRoiContributionType,
  OrgLensRoiCoverage,
  OrgLensRoiCoverageWarehouseRow,
  OrgLensRoiInvestmentBreakdown,
  OrgLensRoiInvestmentBreakdownWarehouseRow,
  OrgLensRoiMethod,
  OrgLensRoiProjectAnnual,
  OrgLensRoiProjectAnnualWarehouseRow,
  OrgLensRoiProjectDetail,
  OrgLensRoiProjectDetailWarehouseRow,
  OrgLensRoiProjectRow,
  OrgLensRoiProjects,
  OrgLensRoiProjectWarehouseRow,
  OrgLensRoiSummary,
  OrgLensRoiSummaryWarehouseRow,
} from '@lfx-one/shared/interfaces';
import type { Request } from 'express';

import { resolveLfxOnePlatinumSchema } from '../helpers/snowflake-schema.helper';

import { logger } from './logger.service';
import { SnowflakeService } from './snowflake.service';
import { buildOrgCacheKey, valkeyService, withOrgCache } from './valkey.service';

export class OrgLensRoiService {
  /**
   * Floating-point slack when re-checking that category rows still sum to their stated total. The
   * warehouse residual measured across all covered accounts is ~6e-08 on a $145M base, so a cent is
   * several orders of magnitude of headroom while still catching a genuinely wrong total.
   */
  private static readonly reconciliationEpsilonUsd = 0.01;

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

  /**
   * Investment by contribution category.
   *
   * The cache key carries **no method suffix**, and unlike `/coverage` that is a property of the
   * source rather than an assumption about it: `ORG_LENS_ROI_INVESTMENT_BREAKDOWN` has no
   * `MARKUP_METHOD` column at all, because the levels table it derives from has none. The markup
   * method scales return, not spend. `/coverage` looked similar but was only method-invariant in
   * practice, so it was made method-scoped anyway; this one cannot vary by construction.
   *
   * `total` is summed from the same rows the client renders, so the figure under the donut and the
   * slices in it can never disagree. It reconciles with `/summary.totalExpenditure` in the
   * warehouse, asserted by a dbt singular test — never reconciled here.
   */
  public async getInvestmentBreakdown(req: Request, accountId: string): Promise<OrgLensRoiInvestmentBreakdown> {
    return withOrgCache(
      accountId,
      ORG_LENS_ROI_CACHE_KEY.investmentBreakdown,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => {
        logger.debug(req, 'get_org_lens_roi_investment_breakdown', 'Cache miss; querying Snowflake', { account_id: accountId });
        const sql = `
        SELECT
          CONTRIBUTION_TYPE,
          CONTRIBUTION_LABEL,
          EXPENDITURE
        FROM ${this.investmentBreakdownTable()}
        WHERE ACCOUNT_ID = ?
        ORDER BY DISPLAY_ORDER
      `;
        const result = await this.snowflakeService.execute<OrgLensRoiInvestmentBreakdownWarehouseRow>(sql, [accountId]);
        const rows = result.rows.map((row) => this.mapCategoryRow(row.CONTRIBUTION_TYPE, row.CONTRIBUTION_LABEL, row.EXPENDITURE));
        return { rows, total: rows.reduce((sum, row) => sum + row.expenditure, 0) };
      },
      OrgLensRoiService.isInvestmentBreakdown
    );
  }

  /**
   * The complete, uncapped project set with each project's category breakdown in one payload.
   * Measured against production, the largest organization serializes to ~241 KB against the 1 MiB
   * `VALKEY_CACHE.MAX_VALUE_BYTES` ceiling, so every organization caches.
   *
   * One round-trip, not two: the projects and their breakdown are a single consistent fact, and
   * fetching them separately would let the pair drift between calls — the same reasoning that made
   * `/coverage` one query. The join fans out to one row per project × category (~1,200 rows at the
   * largest), regrouped below.
   */
  public async getProjects(req: Request, accountId: string, method: OrgLensRoiMethod): Promise<OrgLensRoiProjects> {
    return withOrgCache(
      accountId,
      `${ORG_LENS_ROI_CACHE_KEY.projects}:${method}`,
      VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS,
      async () => {
        logger.debug(req, 'get_org_lens_roi_projects', 'Cache miss; querying Snowflake', { account_id: accountId, method });
        // The breakdown table carries no MARKUP_METHOD — category spend is method-invariant, so it
        // joins on the project alone. PROFIT_SIGN_CHECK is deliberately left out: it is an internal
        // model-consistency flag, not a figure any surface renders, and a loss-making project is a
        // legitimate result already conveyed by its net return — filtering on it would hide real
        // outcomes from the viewer.
        const sql = `
        SELECT
          p.PROJECT_ID,
          p.PROJECT_SLUG,
          p.PROJECT_NAME,
          p.TOTAL_EXPENDITURE,
          p.TOTAL_RETURN,
          p.PROFIT,
          p.ROI,
          p.BCR,
          p.BREAKEVEN_MARKUP,
          b.CONTRIBUTION_TYPE,
          b.CONTRIBUTION_LABEL,
          b.EXPENDITURE AS CATEGORY_EXPENDITURE
        FROM ${this.projectsTable()} p
        LEFT JOIN ${this.projectsBreakdownTable()} b
          ON b.ACCOUNT_ID = p.ACCOUNT_ID AND b.PROJECT_ID = p.PROJECT_ID
        WHERE p.ACCOUNT_ID = ? AND p.MARKUP_METHOD = ?
        -- PROJECT_ID keeps a project's category rows contiguous and makes ties deterministic;
        -- DISPLAY_ORDER fixes category order within a project. TOTAL_RETURN DESC is the payload's
        -- default ranking: the donut re-sorts by the selected measure, but the forthcoming projects
        -- table will page the set in this order and needs it stable across requests.
        ORDER BY p.TOTAL_RETURN DESC, p.PROJECT_ID, b.DISPLAY_ORDER
      `;
        const result = await this.snowflakeService.execute<OrgLensRoiProjectWarehouseRow>(sql, [accountId, method]);
        return { method, rows: this.groupProjectRows(result.rows) };
      },
      OrgLensRoiService.isProjects
    );
  }

  /**
   * One project's ROI figures, or null when the slug names no project of **this** organization.
   *
   * Null becomes a 404 rather than an empty payload: a slug belonging to some other organization
   * must not read as "this project has no data", which would invite the viewer to conclude
   * something about a project their organization has no measured relationship with.
   *
   * The onward-link target is resolved in the same round-trip. `/org/projects/{slug}` is served
   * from `ORG_LENS_PROJECTS`, and a measured 32.4% of ROI organization-project pairs have no row
   * there, so whether the link resolves is a fact about the data and is answered here rather than
   * guessed at in the template or discovered by the viewer hitting a dead page.
   */
  public async getProjectDetail(req: Request, accountId: string, projectSlug: string, method: OrgLensRoiMethod): Promise<OrgLensRoiProjectDetail | null> {
    return this.withNullableOrgCache(
      accountId,
      `${ORG_LENS_ROI_CACHE_KEY.projectDetail}:${method}:${encodeURIComponent(projectSlug)}`,
      OrgLensRoiService.isProjectDetail,
      async () => {
        logger.debug(req, 'get_org_lens_roi_project_detail', 'Cache miss; querying Snowflake', {
          account_id: accountId,
          project_slug: projectSlug,
          method,
        });
        const sql = `
        SELECT
          p.PROJECT_ID,
          p.PROJECT_SLUG,
          p.PROJECT_NAME,
          p.TOTAL_EXPENDITURE,
          p.TOTAL_RETURN,
          p.PROFIT,
          p.ROI,
          p.BCR,
          p.BREAKEVEN_MARKUP,
          b.CONTRIBUTION_TYPE,
          b.CONTRIBUTION_LABEL,
          b.EXPENDITURE AS CATEGORY_EXPENDITURE,
          (
            SELECT COUNT(*)
            FROM ${this.orgLensProjectsTable()} c
            WHERE c.ACCOUNT_ID = p.ACCOUNT_ID AND c.PROJECT_SLUG = p.PROJECT_SLUG
          ) AS CATALOG_ROWS
        FROM ${this.projectsTable()} p
        LEFT JOIN ${this.projectsBreakdownTable()} b
          ON b.ACCOUNT_ID = p.ACCOUNT_ID AND b.PROJECT_ID = p.PROJECT_ID
        WHERE p.ACCOUNT_ID = ? AND p.PROJECT_SLUG = ? AND p.MARKUP_METHOD = ?
        -- PROJECT_ID leads for the same reason it does in the set read: it keeps a project's
        -- category rows contiguous, and if a slug ever mapped to two project ids it decides which
        -- one this endpoint answers with, rather than leaving that to the warehouse's row order.
        ORDER BY p.PROJECT_ID, b.DISPLAY_ORDER
      `;
        const result = await this.snowflakeService.execute<OrgLensRoiProjectDetailWarehouseRow>(sql, [accountId, projectSlug, method]);
        const projects = this.groupProjectRows(result.rows);
        if (projects.length > 1) {
          logger.warning(req, 'get_org_lens_roi_project_detail', 'Expected at most one project for the slug', {
            account_id: accountId,
            project_slug: projectSlug,
            method,
            projects: projects.length,
          });
        }
        const project = projects.at(0) ?? null;
        if (project === null) return null;
        return {
          orgUid: accountId,
          method,
          project,
          hasOrgLensProject: this.toCount(result.rows.at(0)?.CATALOG_ROWS) > 0,
        };
      }
    );
  }

  /**
   * One project's investment distribution across years, or null when the slug names no project of
   * this organization.
   *
   * Driven from the projects table rather than straight from the annual one, so "not your project"
   * and "your project, no yearly breakdown" stay distinguishable. Reading the annual table alone
   * would collapse both into zero rows, and the first must be a 404 while the second is a 200 with
   * an empty distribution. The unmatched side of the join carries a null YEAR and is dropped.
   */
  public async getProjectAnnual(req: Request, accountId: string, projectSlug: string, method: OrgLensRoiMethod): Promise<OrgLensRoiProjectAnnual | null> {
    return this.withNullableOrgCache(
      accountId,
      `${ORG_LENS_ROI_CACHE_KEY.projectAnnual}:${method}:${encodeURIComponent(projectSlug)}`,
      OrgLensRoiService.isProjectAnnual,
      async () => {
        logger.debug(req, 'get_org_lens_roi_project_annual', 'Cache miss; querying Snowflake', {
          account_id: accountId,
          project_slug: projectSlug,
          method,
        });
        const sql = `
        SELECT
          a.YEAR,
          a.TOTAL_RETURN,
          a.EXPENDITURE,
          a.PROFIT,
          a.ROI,
          a.BCR
        FROM ${this.projectsTable()} p
        LEFT JOIN ${this.projectAnnualTable()} a
          ON a.ACCOUNT_ID = p.ACCOUNT_ID AND a.PROJECT_ID = p.PROJECT_ID AND a.MARKUP_METHOD = p.MARKUP_METHOD
        WHERE p.ACCOUNT_ID = ? AND p.PROJECT_SLUG = ? AND p.MARKUP_METHOD = ?
        ORDER BY a.YEAR
      `;
        const result = await this.snowflakeService.execute<OrgLensRoiProjectAnnualWarehouseRow>(sql, [accountId, projectSlug, method]);
        if (result.rows.length === 0) return null;
        return {
          method,
          projectSlug,
          rows: result.rows
            .filter((row): row is OrgLensRoiAnnualWarehouseRow => row.YEAR !== null && row.YEAR !== undefined)
            .map((row) => this.mapAnnualRow(row)),
          apportioned: true,
          // Constant by construction, not measured: the apportionment share cancels out of both
          // ratios. Carried in the payload so the client's disclosure is driven by the contract.
          efficiencyConstant: true,
        };
      }
    );
  }

  /**
   * Read-through cache for the two per-slug reads, which `withOrgCache` cannot serve.
   *
   * That helper treats a `null` fetch result as a value and writes it, and `getJson` then reads it
   * back as a miss — so every unmatched slug would re-query the warehouse *and* leave a permanently
   * useless entry behind, at a cardinality any authorized caller controls. Skipping the write on a
   * miss follows `org-lens-project-detail.service.ts`, the repo's existing per-slug org-scoped read.
   *
   * A null key means the account id is not filter-safe, which `buildOrgCacheKey` fails closed on;
   * the fetch still runs, uncached.
   */
  private async withNullableOrgCache<T>(
    accountId: string,
    subResource: string,
    accept: (value: unknown) => boolean,
    fetcher: () => Promise<T | null>
  ): Promise<T | null> {
    const key = buildOrgCacheKey(accountId, subResource);
    if (key !== null) {
      const cached = await valkeyService.getJson<T>(key, accept);
      if (cached !== null) return cached;
    }

    const result = await fetcher();
    if (result !== null && key !== null) {
      await valkeyService.setJson(key, result, VALKEY_CACHE.ORG_LENS_SNOWFLAKE_TTL_SECONDS);
    }
    return result;
  }

  /** Collapses the fanned-out join back to one entry per project, preserving the SQL ordering. */
  private groupProjectRows(rows: OrgLensRoiProjectWarehouseRow[]): OrgLensRoiProjectRow[] {
    const byProject = new Map<string, OrgLensRoiProjectRow>();
    for (const row of rows) {
      let project = byProject.get(row.PROJECT_ID);
      if (project === undefined) {
        project = {
          projectId: row.PROJECT_ID,
          projectSlug: this.toNullableLabel(row.PROJECT_SLUG) ?? '',
          // Falls back rather than emptying: the name is what every surface labels a project with,
          // and a blank legend entry is worse than an unlovely slug.
          projectName: this.toNullableLabel(row.PROJECT_NAME) ?? this.toNullableLabel(row.PROJECT_SLUG) ?? row.PROJECT_ID,
          totalExpenditure: this.toFiniteNumber(row.TOTAL_EXPENDITURE),
          totalReturn: this.toFiniteNumber(row.TOTAL_RETURN),
          profit: this.toFiniteNumber(row.PROFIT),
          roi: this.toNullableNumber(row.ROI),
          bcr: this.toNullableNumber(row.BCR),
          breakevenMarkup: this.toNullableNumber(row.BREAKEVEN_MARKUP),
          categories: [],
        };
        byProject.set(row.PROJECT_ID, project);
      }
      // Null for a project the breakdown has no rows for — the LEFT JOIN's unmatched side.
      if (row.CONTRIBUTION_TYPE !== null && row.CONTRIBUTION_TYPE !== undefined) {
        project.categories.push(this.mapCategoryRow(row.CONTRIBUTION_TYPE, row.CONTRIBUTION_LABEL, row.CATEGORY_EXPENDITURE));
      }
    }
    return [...byProject.values()];
  }

  private mapCategoryRow(type: string, label: string | null, expenditure: unknown): OrgLensRoiCategoryRow {
    return {
      type: type as OrgLensRoiContributionType,
      label: this.toNullableLabel(label) ?? type,
      expenditure: this.toFiniteNumber(expenditure),
    };
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

  /**
   * A key that is absent is not the same as one holding null, and the difference reaches the UI: a
   * nullable measure renders as the no-value indicator, while an absent one used to reach
   * `toFixed()`. So these check presence explicitly rather than accepting `undefined` as null.
   */
  private static isNullableNumber(record: Record<string, unknown>, key: string): boolean {
    if (!(key in record)) return false;
    const value = record[key];
    return value === null || (typeof value === 'number' && Number.isFinite(value));
  }

  private static isNullableString(record: Record<string, unknown>, key: string): boolean {
    if (!(key in record)) return false;
    const value = record[key];
    return value === null || typeof value === 'string';
  }

  private static isSummary(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const summary = value as Record<string, unknown>;
    if (typeof summary['hasData'] !== 'boolean') return false;
    if (typeof summary['nProjects'] !== 'number') return false;
    if (!(ORG_LENS_ROI_METHODS as readonly string[]).includes(summary['method'] as string)) return false;
    const nullableNumbers = ['totalExpenditure', 'totalReturn', 'profit', 'roi', 'bcr', 'yearMin', 'yearMax'];
    if (!nullableNumbers.every((key) => OrgLensRoiService.isNullableNumber(summary, key))) return false;
    return ['dateMin', 'dateMax'].every((key) => OrgLensRoiService.isNullableString(summary, key));
  }

  private static isCoverage(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const coverage = value as Record<string, unknown>;
    if (typeof coverage['hasData'] !== 'boolean') return false;
    return (ORG_LENS_ROI_COVERAGE_REASONS as readonly string[]).includes(coverage['coverageReason'] as string);
  }

  private static isAnnual(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const annual = value as Record<string, unknown>;
    if (typeof annual['apportioned'] !== 'boolean') return false;
    if (!(ORG_LENS_ROI_METHODS as readonly string[]).includes(annual['method'] as string)) return false;
    if (!Array.isArray(annual['rows'])) return false;
    // Rows are what the chart maps over, so a malformed one is as bad as a malformed envelope.
    return annual['rows'].every((row) => {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) return false;
      const entry = row as Record<string, unknown>;
      if (typeof entry['year'] !== 'number') return false;
      const required = ['totalReturn', 'expenditure', 'profit'];
      if (!required.every((key) => typeof entry[key] === 'number' && Number.isFinite(entry[key] as number))) return false;
      return ['roi', 'bcr'].every((key) => OrgLensRoiService.isNullableNumber(entry, key));
    });
  }

  private static isFiniteNumber(value: unknown): boolean {
    return typeof value === 'number' && Number.isFinite(value);
  }

  /**
   * Per-row, not just per-envelope: the donut maps over these, so one malformed entry is enough to
   * break a render.
   *
   * `type` is checked for shape, deliberately **not** against
   * `ORG_LENS_ROI_CONTRIBUTION_TYPES`. The vocabulary is already enforced upstream by an
   * `accepted_values` dbt test, and enforcing it again here would only create a write/read
   * asymmetry: the mapper writes whatever the warehouse returns, so a seed that gained a ninth
   * contribution type before this constant did would write entries this guard then rejected on
   * every read — permanently defeating the cache for that organization and re-running the
   * ~1,200-row join on every request. Dropping the unknown row instead would be worse still: the
   * category total would silently stop reconciling with the KPI figure.
   */
  private static isCategoryRows(value: unknown): boolean {
    if (!Array.isArray(value)) return false;
    return value.every((row) => {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) return false;
      const entry = row as Record<string, unknown>;
      if (typeof entry['type'] !== 'string' || entry['type'].length === 0) return false;
      if (typeof entry['label'] !== 'string') return false;
      return OrgLensRoiService.isFiniteNumber(entry['expenditure']);
    });
  }

  private static isInvestmentBreakdown(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const breakdown = value as Record<string, unknown>;
    if (!OrgLensRoiService.isFiniteNumber(breakdown['total'])) return false;
    if (!OrgLensRoiService.isCategoryRows(breakdown['rows'])) return false;

    // The write path sums `total` from these same rows, so the two agree by construction. The read
    // path had no such guarantee: any finite `total` was accepted alongside any rows, letting a
    // corrupt or stale entry render a headline investment figure that contradicts the slices under
    // it — the misleading-money outcome the reconciliation invariant exists to prevent.
    const rows = breakdown['rows'] as { expenditure: number }[];
    const summed = rows.reduce((sum, row) => sum + row.expenditure, 0);
    return Math.abs(summed - (breakdown['total'] as number)) <= OrgLensRoiService.reconciliationEpsilonUsd;
  }

  private static isProjects(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const projects = value as Record<string, unknown>;
    if (!(ORG_LENS_ROI_METHODS as readonly string[]).includes(projects['method'] as string)) return false;
    if (!Array.isArray(projects['rows'])) return false;
    return projects['rows'].every((row) => {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) return false;
      const entry = row as Record<string, unknown>;
      if (!['projectId', 'projectSlug', 'projectName'].every((key) => typeof entry[key] === 'string')) return false;
      if (!['totalExpenditure', 'totalReturn', 'profit'].every((key) => OrgLensRoiService.isFiniteNumber(entry[key]))) return false;
      if (!['roi', 'bcr', 'breakevenMarkup'].every((key) => OrgLensRoiService.isNullableNumber(entry, key))) return false;
      if (!OrgLensRoiService.isCategoryRows(entry['categories'])) return false;

      // Same reconciliation the breakdown guard applies, per project: a project's categories sum to
      // its own expenditure by warehouse construction, so an entry where they don't is corrupt.
      // Measured across all 32,890 production project rows: none is off by more than 1.9e-09.
      //
      // Enforced only when categories are present. The read is a LEFT JOIN, so a project the
      // breakdown has no rows for legitimately arrives empty; failing on that would reject the
      // whole payload on every read and leave the organization permanently uncacheable.
      const categories = entry['categories'] as { expenditure: number }[];
      if (categories.length === 0) return true;
      const summed = categories.reduce((sum, category) => sum + category.expenditure, 0);
      return Math.abs(summed - (entry['totalExpenditure'] as number)) <= OrgLensRoiService.reconciliationEpsilonUsd;
    });
  }

  /**
   * Reuses the projects guard on a one-element array, so the single-project payload is held to
   * exactly the same per-row checks — including the category reconciliation — as the set it is
   * drawn from. Two hand-written guards over one row shape would be free to drift.
   */
  private static isProjectDetail(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const detail = value as Record<string, unknown>;
    if (typeof detail['orgUid'] !== 'string' || detail['orgUid'].length === 0) return false;
    if (typeof detail['hasOrgLensProject'] !== 'boolean') return false;
    return OrgLensRoiService.isProjects({ method: detail['method'], rows: [detail['project']] });
  }

  private static isProjectAnnual(value: unknown): boolean {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const annual = value as Record<string, unknown>;
    if (typeof annual['projectSlug'] !== 'string' || annual['projectSlug'].length === 0) return false;
    // Always true on the write path, so a stored `false` is a corrupt entry rather than a variant —
    // and one that would suppress the disclosure the constancy requires.
    if (annual['efficiencyConstant'] !== true) return false;
    return OrgLensRoiService.isAnnual(annual);
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

  private investmentBreakdownTable(): string {
    return `${resolveLfxOnePlatinumSchema()}.ORG_LENS_ROI_INVESTMENT_BREAKDOWN`;
  }

  private projectsTable(): string {
    return `${resolveLfxOnePlatinumSchema()}.ORG_LENS_ROI_PROJECTS`;
  }

  private projectsBreakdownTable(): string {
    return `${resolveLfxOnePlatinumSchema()}.ORG_LENS_ROI_PROJECTS_BREAKDOWN`;
  }

  private projectAnnualTable(): string {
    return `${resolveLfxOnePlatinumSchema()}.ORG_LENS_ROI_PROJECT_ANNUAL`;
  }

  /** The Org Lens projects catalog — read only to learn whether the onward link has a target. */
  private orgLensProjectsTable(): string {
    return `${resolveLfxOnePlatinumSchema()}.ORG_LENS_PROJECTS`;
  }

  private mappingTable(): string {
    return `${resolveLfxOnePlatinumSchema()}.ACCOUNT_TO_CDEV_ORG_MAPPING`;
  }
}
