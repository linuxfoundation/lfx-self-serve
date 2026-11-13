// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, withFoundationCache } = vi.hoisted(() => ({
  execute: vi.fn(),
  // Pass-through: these tests cover the reads; the key only has to separate every query that reads different rows.
  withFoundationCache: vi.fn((_slug: string, _resource: string, _discriminator: unknown[], fetcher: () => Promise<unknown>) => fetcher()),
}));

vi.mock('./snowflake.service', () => ({
  SnowflakeService: class {
    public static getInstance() {
      return { execute };
    }
  },
}));
vi.mock('./valkey.service', () => ({ withFoundationParticipatingOrgsCache: withFoundationCache }));
// The shared view-read helper logs a missing object and rewrites the client message; here it only has to reach the warehouse.
vi.mock('../helpers/snowflake-view-read.helper', () => ({
  executeSnowflakeViewRead: (_service: unknown, _req: unknown, sql: string, binds: unknown[]) => execute(sql, binds, { expectMissingObject: true }),
}));
// `validation.helper` reaches the same barrel; `clampInteger` is restated so the clamp is still exercised.
vi.mock('../helpers/validation.helper', () => ({
  clampInteger: (value: number, min: number, max: number, fallback: number) =>
    Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), min), max) : fallback,
}));
// `date-format.helper` reaches the `@lfx-one/shared/utils` barrel, which cannot load in this server-only runtime.
vi.mock('../helpers/date-format.helper', () => ({ toIsoDate: (value: unknown) => (value ? String(value).slice(0, 10) : null) }));

import { FOUNDATION_PARTICIPATING_ORGS_EXPORT_MAX_ROWS } from '@lfx-one/shared/constants';

import { FoundationParticipatingOrgsSnowflakeSource } from './foundation-participating-orgs.snowflake-source';

function placeholders(sql: string): number {
  return (sql.match(/\?/g) ?? []).length;
}

const companyRow = (overrides: Record<string, unknown> = {}) => ({
  FOUNDATION_NAME: ' Synthetic Foundation ',
  AS_OF_DATE: '2026-11-01',
  PARTICIPANT_KEY: '001SYNTHALPHA',
  ACCOUNT_ID: '001SYNTHALPHA',
  PARTICIPANT_NAME: ' Synthetic Alpha ',
  PARTICIPANT_LOGO_URL: null,
  IS_MEMBER: true,
  MEMBERSHIP_TIER_CLASS: 'Gold',
  PROJECTS_INVOLVED: 3,
  COMMITS: 120,
  COMMITS_CHANGE: '0.500000',
  CONTRIBUTORS: 9,
  CONTRIBUTORS_CHANGE: null,
  ...overrides,
});

describe('FoundationParticipatingOrgsSnowflakeSource', () => {
  const source = new FoundationParticipatingOrgsSnowflakeSource();
  const req = {} as Request;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getFoundation', () => {
    it('reads the foundation project rows and the project list in two bound queries, for the range', async () => {
      execute.mockResolvedValueOnce({ rows: [companyRow()] });
      execute.mockResolvedValueOnce({ rows: [{ PROJECT_SLUG: 'busy', PROJECT_NAME: ' Busy ', COMMITS: 400 }] });

      const foundation = await source.getFoundation(req, 'synthetic-foundation', '90d');

      expect(execute).toHaveBeenCalledTimes(2);
      const [companiesSql, companiesBinds] = execute.mock.calls[0];
      expect(companiesBinds).toEqual(['synthetic-foundation', '90d', 'synthetic-foundation', '90d']);
      expect(placeholders(companiesSql)).toBe(4);
      expect(companiesSql).toContain('project_id = foundation_id');
      // A project with contributors but no commits still counts as one the company is involved in, as the breakdown lists it.
      expect(companiesSql).toMatch(/project_id <> foundation_id\s+AND \(commits > 0 OR contributors > 0\)/);
      expect(companiesSql).toContain('PROJECT_PARTICIPATING_ORGS');
      const [projectsSql, projectsBinds] = execute.mock.calls[1];
      expect(projectsBinds).toEqual(['90d', 'synthetic-foundation']);
      expect(placeholders(projectsSql)).toBe(2);
      expect(projectsSql).toContain('project_id <> a.foundation_id');
      // Project identity comes from all-time activity, so a project quiet in the range is still a valid scope.
      expect(projectsSql).toContain("a.time_range = 'all'");
      expect(execute.mock.calls[0][2]).toEqual({ expectMissingObject: true });
      expect(execute.mock.calls[1][2]).toEqual({ expectMissingObject: true });

      expect(withFoundationCache).toHaveBeenCalledWith('synthetic-foundation', 'roster', ['90d'], expect.any(Function), expect.any(Function));
      expect(foundation).toEqual({
        slug: 'synthetic-foundation',
        name: 'Synthetic Foundation',
        asOfDate: '2026-11-01',
        projects: [{ slug: 'busy', name: 'Busy', maturity: null, commits: 400 }],
        companies: [
          {
            key: '001SYNTHALPHA',
            accountId: '001SYNTHALPHA',
            name: 'Synthetic Alpha',
            logoUrl: null,
            isMember: true,
            tier: 'Gold',
            otherMemberships: [],
            projectsInvolved: 3,
            commits: 120,
            commitsChange: 0.5,
            contributors: 9,
            contributorsChange: null,
          },
        ],
      });
    });

    it('never selects a person key, and counts contributors from the modelled column rather than summing', async () => {
      execute.mockResolvedValue({ rows: [companyRow()] });
      await source.getFoundation(req, 'synthetic-foundation', '12mo');
      for (const [sql] of execute.mock.calls) {
        expect(sql).not.toMatch(/person_key|member_id/i);
        expect(sql).not.toMatch(/SUM\(\s*contributors/i);
      }
    });

    it('gives a non-member no tier even if the row carries one', async () => {
      execute.mockResolvedValueOnce({ rows: [companyRow({ IS_MEMBER: false, MEMBERSHIP_TIER_CLASS: 'Gold' })] });
      execute.mockResolvedValueOnce({ rows: [] });
      expect((await source.getFoundation(req, 'synthetic-foundation', '12mo'))?.companies[0]).toMatchObject({ isMember: false, tier: null });
    });

    it('is null when the warehouse has nothing for the slug', async () => {
      execute.mockResolvedValue({ rows: [] });
      expect(await source.getFoundation(req, 'unknown', '12mo')).toBeNull();
    });

    it('falls back to the slug when the foundation has no name, and to the key when a company has none', async () => {
      execute.mockResolvedValueOnce({ rows: [companyRow({ FOUNDATION_NAME: null, PARTICIPANT_NAME: null })] });
      execute.mockResolvedValueOnce({ rows: [] });
      const foundation = await source.getFoundation(req, 'synthetic-foundation', '12mo');
      expect(foundation?.name).toBe('synthetic-foundation');
      expect(foundation?.companies[0].name).toBe('001SYNTHALPHA');
    });
  });

  describe('getProjectLines', () => {
    const lineRow = (overrides: Record<string, unknown> = {}) => ({
      PARTICIPANT_KEY: '001SYNTHALPHA',
      PROJECT_SLUG: 'busy',
      COMMITS: 250,
      COMMITS_CHANGE: '0.400000',
      CONTRIBUTORS: 6,
      CONTRIBUTORS_CHANGE: null,
      ...overrides,
    });

    it.each([
      ['a project', { projectSlug: 'busy' }, ['synthetic-foundation', '12mo', 'busy']],
      ['a company', { companyKey: '001SYNTHALPHA' }, ['synthetic-foundation', '12mo', '001SYNTHALPHA']],
    ])('binds one value per placeholder for %s, and caches the read', async (_label, filter, expectedBinds) => {
      execute.mockResolvedValueOnce({ rows: [lineRow()] });
      const lines = await source.getProjectLines(req, 'synthetic-foundation', '12mo', filter);
      const [sql, binds] = execute.mock.calls[0];
      expect(binds).toEqual(expectedBinds);
      expect(placeholders(sql)).toBe(binds.length);
      expect(sql).not.toMatch(/person_key|member_id/i);
      expect(withFoundationCache).toHaveBeenCalledTimes(1);
      expect(withFoundationCache.mock.calls[0][1]).toBe('lines');
      expect(lines).toEqual([
        { companyKey: '001SYNTHALPHA', projectSlug: 'busy', commits: 250, commitsChange: 0.4, contributors: 6, contributorsChange: null },
      ]);
    });

    it('reads every line for the export in one bounded, uncached query', async () => {
      execute.mockResolvedValueOnce({ rows: [lineRow(), lineRow({ PARTICIPANT_KEY: null })] });
      const lines = await source.getProjectLines(req, 'synthetic-foundation', '12mo', { limit: 51 });
      const [sql, binds] = execute.mock.calls[0];
      expect(binds).toEqual(['synthetic-foundation', '12mo']);
      expect(sql).toContain('LIMIT 51');
      expect(withFoundationCache).not.toHaveBeenCalled();
      expect(lines).toHaveLength(1);
    });

    it('reads only the given companies through one JSON bind, uncached', async () => {
      execute.mockResolvedValueOnce({ rows: [lineRow()] });
      await source.getProjectLines(req, 'synthetic-foundation', '12mo', { projectSlug: 'busy', companyKeys: ['a', 'b'], limit: 9 });
      const [sql, binds, options] = execute.mock.calls[0];
      expect(binds).toEqual(['["a","b"]', 'synthetic-foundation', '12mo', 'busy']);
      expect(placeholders(sql)).toBe(4);
      expect(options).toEqual({ expectMissingObject: true });
      expect(withFoundationCache).not.toHaveBeenCalled();
    });

    it("orders by the caller's company order, then commits, before the row limit, so a cap drops the lowest-ranked companies", async () => {
      execute.mockResolvedValueOnce({ rows: [] });
      await source.getProjectLines(req, 'synthetic-foundation', '12mo', { companyKeys: ['b', 'a'], limit: 9 });
      const sql: string = execute.mock.calls[0][0];
      expect(sql).toMatch(/JOIN TABLE\(FLATTEN\(input => PARSE_JSON\(\?\)\)\) k ON l\.participant_key = k\.value::varchar/);
      expect(sql).toMatch(/ORDER BY k\.index ASC, l\.commits DESC, l\.project_slug ASC\s+LIMIT 9/);
    });

    it('clamps a limit to the export cap plus one', async () => {
      execute.mockResolvedValueOnce({ rows: [] });
      await source.getProjectLines(req, 'synthetic-foundation', '12mo', { limit: 10 ** 9 });
      expect(execute.mock.calls[0][0]).toContain(`LIMIT ${FOUNDATION_PARTICIPATING_ORGS_EXPORT_MAX_ROWS + 1}`);
    });
  });
});
