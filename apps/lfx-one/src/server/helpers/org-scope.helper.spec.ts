// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withOrgCache, cached } = vi.hoisted(() => ({
  withOrgCache: vi.fn(),
  cached: new Map<string, unknown>(),
}));

// The shared barrels pull Angular into this plain-Node run; the real modules the helper uses stand in for them
// (vi.mock factories are hoisted above static imports, so they can only load the modules via import()).
vi.mock('@lfx-one/shared/constants', async () => ({
  ...(await import('../../../../../packages/shared/src/constants/valkey-cache.constants')),
}));
vi.mock('@lfx-one/shared/utils', async () => ({
  ...(await import('../../../../../packages/shared/src/utils/org-scope.utils')),
}));
vi.mock('../services/valkey.service', () => ({ withOrgCache }));

import type { SnowflakeService } from '../services/snowflake.service';
import { orgScopeColumn, orgScopeFlagPredicate, orgScopeRowPredicate, readOrgLensOrgScope, resolveOrgScope } from './org-scope.helper';

const ACCOUNT = 'account-one';
const execute = vi.fn();
const snowflake = { execute } as unknown as SnowflakeService;

const ROW = {
  INSIGHTS_ORG_ID: 'insights-org-1',
  INSIGHTS_ORG_NAME: 'Example Org',
  RELATED_ORG_COUNT: 4,
  HAS_INSIGHTS_ORG: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  cached.clear();
  // A per-account, per-key read-through, guarded like Valkey: a stored value the guard rejects is a miss.
  withOrgCache.mockImplementation(async (account: string, key: string, _ttl: number, fetcher: () => Promise<unknown>, accept?: (value: unknown) => boolean) => {
    const cacheKey = `${account}:${key}`;
    if (cached.has(cacheKey) && (!accept || accept(cached.get(cacheKey)))) return cached.get(cacheKey);
    const fresh = await fetcher();
    cached.set(cacheKey, fresh);
    return fresh;
  });
  execute.mockResolvedValue({ rows: [ROW] });
});

describe('readOrgLensOrgScope', () => {
  it("maps the account's ORG_LENS_ORG_SCOPE row, binding only the account", async () => {
    expect(await readOrgLensOrgScope(snowflake, ACCOUNT)).toEqual({
      accountId: ACCOUNT,
      hasInsightsOrg: true,
      insightsOrgId: 'insights-org-1',
      insightsOrgName: 'Example Org',
      relatedOrgCount: 4,
    });
    const [sql, binds] = execute.mock.calls[0];
    expect(sql).toContain('FROM ANALYTICS.PLATINUM_LFX_ONE.ORG_LENS_ORG_SCOPE');
    expect(sql).toContain('WHERE ACCOUNT_ID = ?');
    expect(binds).toEqual([ACCOUNT]);
  });

  it('offers no Insights organization to an account with no row', async () => {
    execute.mockResolvedValue({ rows: [] });

    expect(await readOrgLensOrgScope(snowflake, ACCOUNT)).toEqual({
      accountId: ACCOUNT,
      hasInsightsOrg: false,
      insightsOrgId: null,
      insightsOrgName: null,
      relatedOrgCount: 0,
    });
  });

  it('offers no Insights organization when the row flags one but carries no organization id', async () => {
    execute.mockResolvedValue({ rows: [{ ...ROW, INSIGHTS_ORG_ID: null }] });

    expect((await readOrgLensOrgScope(snowflake, ACCOUNT)).hasInsightsOrg).toBe(false);
  });

  it('offers no Insights organization when the row does not flag one', async () => {
    execute.mockResolvedValue({ rows: [{ ...ROW, HAS_INSIGHTS_ORG: null, RELATED_ORG_COUNT: null }] });

    const scope = await readOrgLensOrgScope(snowflake, ACCOUNT);
    expect(scope.hasInsightsOrg).toBe(false);
    expect(scope.relatedOrgCount).toBe(0);
  });

  it('reads once per account under org-scope:v1, and rejects a malformed stored value as a miss', async () => {
    await readOrgLensOrgScope(snowflake, ACCOUNT);
    await readOrgLensOrgScope(snowflake, ACCOUNT);
    await readOrgLensOrgScope(snowflake, 'account-two');

    expect(execute).toHaveBeenCalledTimes(2);
    expect(withOrgCache.mock.calls.map((call) => [call[0], call[1]])).toEqual([
      [ACCOUNT, 'org-scope:v1'],
      [ACCOUNT, 'org-scope:v1'],
      ['account-two', 'org-scope:v1'],
    ]);

    cached.set(`${ACCOUNT}:org-scope:v1`, { accountId: ACCOUNT, hasInsightsOrg: 'yes', relatedOrgCount: 4 });
    expect((await readOrgLensOrgScope(snowflake, ACCOUNT)).hasInsightsOrg).toBe(true);
    expect(execute).toHaveBeenCalledTimes(3);
  });
});

describe('resolveOrgScope', () => {
  it('serves all as asked, without reading the account scope', async () => {
    expect(await resolveOrgScope(snowflake, ACCOUNT, 'all')).toBe('all');
    expect(execute).not.toHaveBeenCalled();
    expect(withOrgCache).not.toHaveBeenCalled();
  });

  it('serves insights only for an account with an Insights organization', async () => {
    expect(await resolveOrgScope(snowflake, ACCOUNT, 'insights')).toBe('insights');
  });

  it.each([
    ['no row', []],
    ['no Insights organization', [{ ...ROW, HAS_INSIGHTS_ORG: false }]],
    ['a flag without an organization id', [{ ...ROW, INSIGHTS_ORG_ID: null }]],
  ])('falls back to all for an account with %s', async (_label, rows) => {
    execute.mockResolvedValue({ rows });

    expect(await resolveOrgScope(snowflake, ACCOUNT, 'insights')).toBe('all');
  });

  it("reuses the account's cached scope across reads", async () => {
    await resolveOrgScope(snowflake, ACCOUNT, 'insights');
    await resolveOrgScope(snowflake, ACCOUNT, 'insights');

    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('scope SQL fragments', () => {
  it('reads a column as is under all and its insights_ twin, in the column’s case, under insights', () => {
    expect(orgScopeColumn('all', 'code_activities')).toBe('code_activities');
    expect(orgScopeColumn('insights', 'code_activities')).toBe('insights_code_activities');
    expect(orgScopeColumn('insights', 'UNIQUE_CONTRIBUTORS')).toBe('INSIGHTS_UNIQUE_CONTRIBUTORS');
  });

  it('gates rows on an Insights-scoped count only under insights', () => {
    expect(orgScopeRowPredicate('all', 'insights_code_activities')).toBe('');
    expect(orgScopeRowPredicate('insights', 'insights_code_activities')).toBe('AND insights_code_activities > 0');
  });

  it('keeps only rows flagged in scope only under insights, on is_insights_scope unless told otherwise', () => {
    expect(orgScopeFlagPredicate('all')).toBe('');
    expect(orgScopeFlagPredicate('insights')).toBe('AND COALESCE(is_insights_scope, FALSE)');
    expect(orgScopeFlagPredicate('insights', 'c.is_insights_scope')).toBe('AND COALESCE(c.is_insights_scope, FALSE)');
  });
});
