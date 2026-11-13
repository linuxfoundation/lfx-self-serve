// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { execute, withCache } = vi.hoisted(() => ({
  execute: vi.fn(),
  // Pass-through: these tests cover the reads; the key only has to separate every query that reads different rows.
  withCache: vi.fn((_slug: string, _resource: string, _discriminator: unknown[], fetcher: () => Promise<unknown>) => fetcher()),
}));

vi.mock('./snowflake.service', () => ({
  SnowflakeService: class {
    public static getInstance() {
      return { execute };
    }
  },
}));
vi.mock('./valkey.service', () => ({ withProjectParticipatingOrgsCache: withCache }));
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getFoundation', () => {
    it('reads the foundation project rows and the project list in two bound queries, for the range', async () => {
      execute.mockResolvedValueOnce({ rows: [companyRow()] });
      execute.mockResolvedValueOnce({ rows: [{ PROJECT_SLUG: 'busy', PROJECT_NAME: ' Busy ', COMMITS: 400 }] });

      const foundation = await source.getFoundation('synthetic-foundation', '90d');

      expect(execute).toHaveBeenCalledTimes(2);
      const [companiesSql, companiesBinds] = execute.mock.calls[0];
      expect(companiesBinds).toEqual(['synthetic-foundation', '90d', 'synthetic-foundation', '90d']);
      expect(placeholders(companiesSql)).toBe(4);
      expect(companiesSql).toContain('project_id = foundation_id');
      expect(companiesSql).toContain('PROJECT_PARTICIPATING_ORGS');
      const [projectsSql, projectsBinds] = execute.mock.calls[1];
      expect(projectsBinds).toEqual(['synthetic-foundation', '90d']);
      expect(placeholders(projectsSql)).toBe(2);
      expect(projectsSql).toContain('project_id <> foundation_id');

      expect(withCache).toHaveBeenCalledWith('synthetic-foundation', 'foundation-lens', ['90d'], expect.any(Function), expect.any(Function));
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
      await source.getFoundation('synthetic-foundation', '12mo');
      for (const [sql] of execute.mock.calls) {
        expect(sql).not.toMatch(/person_key|member_id/i);
        expect(sql).not.toMatch(/SUM\(\s*contributors/i);
      }
    });

    it('gives a non-member no tier even if the row carries one', async () => {
      execute.mockResolvedValueOnce({ rows: [companyRow({ IS_MEMBER: false, MEMBERSHIP_TIER_CLASS: 'Gold' })] });
      execute.mockResolvedValueOnce({ rows: [] });
      expect((await source.getFoundation('synthetic-foundation', '12mo'))?.companies[0]).toMatchObject({ isMember: false, tier: null });
    });

    it('is null when the warehouse has nothing for the slug', async () => {
      execute.mockResolvedValue({ rows: [] });
      expect(await source.getFoundation('unknown', '12mo')).toBeNull();
    });

    it('falls back to the slug when the foundation has no name, and to the key when a company has none', async () => {
      execute.mockResolvedValueOnce({ rows: [companyRow({ FOUNDATION_NAME: null, PARTICIPANT_NAME: null })] });
      execute.mockResolvedValueOnce({ rows: [] });
      const foundation = await source.getFoundation('synthetic-foundation', '12mo');
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
      const lines = await source.getProjectLines('synthetic-foundation', '12mo', filter);
      const [sql, binds] = execute.mock.calls[0];
      expect(binds).toEqual(expectedBinds);
      expect(placeholders(sql)).toBe(binds.length);
      expect(sql).not.toMatch(/person_key|member_id/i);
      expect(withCache).toHaveBeenCalledTimes(1);
      expect(lines).toEqual([
        { companyKey: '001SYNTHALPHA', projectSlug: 'busy', commits: 250, commitsChange: 0.4, contributors: 6, contributorsChange: null },
      ]);
    });

    it('reads every line for the export in one bounded, uncached query', async () => {
      execute.mockResolvedValueOnce({ rows: [lineRow(), lineRow({ PARTICIPANT_KEY: null })] });
      const lines = await source.getProjectLines('synthetic-foundation', '12mo', { limit: 51 });
      const [sql, binds] = execute.mock.calls[0];
      expect(binds).toEqual(['synthetic-foundation', '12mo']);
      expect(sql).toContain('LIMIT 51');
      expect(withCache).not.toHaveBeenCalled();
      expect(lines).toHaveLength(1);
    });

    it('clamps a limit to the export cap plus one', async () => {
      execute.mockResolvedValueOnce({ rows: [] });
      await source.getProjectLines('synthetic-foundation', '12mo', { limit: 10 ** 9 });
      expect(execute.mock.calls[0][0]).toContain(`LIMIT ${FOUNDATION_PARTICIPATING_ORGS_EXPORT_MAX_ROWS + 1}`);
    });
  });
});
