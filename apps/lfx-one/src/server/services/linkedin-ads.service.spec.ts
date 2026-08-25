// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors meta-ads.service.spec.ts: the `@lfx-one/shared/*` alias isn't wired into this app's
// vitest config with Angular-free resolution, so the shared constants are re-exported through the
// mock from their real source module. That matters here specifically — this spec asserts that the
// LinkedIn pacing bands ARE the shared thresholds, so it must read the real ones rather than a
// stand-in that could drift from them.
vi.mock('@lfx-one/shared/interfaces', () => ({}));
vi.mock('@lfx-one/shared/constants', async () => {
  const constants = await vi.importActual('../../../../../packages/shared/src/constants/campaign.constants');
  return constants;
});
vi.mock('./logger.service', () => ({
  logger: { startOperation: vi.fn(() => 0), success: vi.fn(), error: vi.fn(), warning: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

import { CAMPAIGN_PACING_THRESHOLDS } from '@lfx-one/shared/constants';

import { getLinkedInAnalytics } from './linkedin-ads.service';

const ACCOUNT_ID = '5551234';
const CAMPAIGN_ID = 9001;

/**
 * Drive `getLinkedInAnalytics` against a single ACTIVE campaign whose spend is `spendPct` of the
 * budget it should have spent by now.
 *
 * The flight is pinned fully in the past (a closed 10-day window) so `pacingPct` is deterministic:
 * with the whole flight elapsed, expected spend is the entire budget, so pacingPct === spendPct.
 * A flight straddling `now` would make the expectation depend on the clock.
 */
async function pacingFor(spendPct: number, opts: { withCreatives?: boolean } = {}) {
  const withCreatives = opts.withCreatives ?? true;
  const day = 86_400_000;
  const end = Date.now() - 2 * day;
  const start = end - 10 * day;
  const totalBudget = 1000;

  // The return type is annotated rather than inferred: the three arms below each return an object
  // literal containing `text`, and TS otherwise reports TS7023 ("'text' implicitly has return type
  // 'any'") because the arms are mutually referenced while inferring.
  interface FetchResult {
    ok: boolean;
    status: number;
    json: () => Promise<unknown>;
    text: () => Promise<string>;
  }

  const fetchMock = vi.fn(async (url: string): Promise<FetchResult> => {
    const u = String(url);
    if (u.includes('/adCampaigns')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          elements: [
            {
              id: CAMPAIGN_ID,
              name: 'OSS 2026 — Registrations',
              status: 'ACTIVE',
              totalBudget: { amount: String(totalBudget) },
              runSchedule: { start, end },
            },
          ],
        }),
        text: async () => '',
      };
    }
    if (u.includes('pivot=CAMPAIGN')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          elements: [
            {
              adEntities: [{ value: { campaign: `urn:li:sponsoredCampaign:${CAMPAIGN_ID}` } }],
              impressions: 10_000,
              clicks: 500,
              costInLocalCurrency: String((totalBudget * spendPct) / 100),
              externalWebsiteConversions: 25,
            },
          ],
        }),
        text: async () => '',
      };
    }
    // pivot=CREATIVE — an empty element list yields zero creatives, which is what the
    // "no ad creatives" rule keys off.
    return {
      ok: true,
      status: 200,
      json: async () => ({
        elements: withCreatives
          ? [{ adEntities: [{ value: { creative: 'urn:li:sponsoredCreative:77' } }], impressions: 10_000, clicks: 500, costInLocalCurrency: '100' }]
          : [],
      }),
      text: async () => '',
    };
  });
  vi.stubGlobal('fetch', fetchMock);

  return getLinkedInAnalytics(undefined, ACCOUNT_ID, 14);
}

describe('getLinkedInAnalytics pacing rules', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env['LINKEDIN_ACCESS_TOKEN'] = 'test-token';
  });

  // The regression this pins: LinkedIn hardcoded `pacingPct < 40` for "underspending" while the
  // pacing BAR (PacingClassPipe) coloured the same campaign off CAMPAIGN_PACING_THRESHOLDS
  // (50). A campaign at 45% therefore rendered a red "underspending" bar next to a "normal"
  // label, and no action item was raised. Restoring the literal 40 makes this case go green.
  it('flags a campaign pacing between the old literal (40) and the shared threshold (50) as underspending', async () => {
    expect(CAMPAIGN_PACING_THRESHOLDS.underspending).toBe(50);

    const result = await pacingFor(45);

    expect(result.campaigns[0].pacingPct).toBeGreaterThanOrEqual(40);
    expect(result.campaigns[0].pacingPct).toBeLessThan(CAMPAIGN_PACING_THRESHOLDS.underspending);
    expect(result.campaigns[0].pacingLabel).toBe('underspending');

    const underspend = result.actionItems.find((i) => i.issue.startsWith('Underspending'));
    expect(underspend).toBeDefined();
  });

  // Pins the copy to the threshold it actually uses. The shipped message said "below 40%" while
  // the rule is driven by the shared 50 — an operator was told a number the rule does not use.
  it('states the shared underspending threshold in the action-item copy', async () => {
    const result = await pacingFor(20);

    const underspend = result.actionItems.find((i) => i.issue.startsWith('Underspending'));
    expect(underspend?.issue).toBe(`Underspending — pacing below ${CAMPAIGN_PACING_THRESHOLDS.underspending}%`);
    expect(underspend?.issue).not.toContain('40%');
  });

  it('treats a campaign above the shared underspending threshold as normal', async () => {
    const result = await pacingFor(70);

    expect(result.campaigns[0].pacingLabel).toBe('normal');
    expect(result.actionItems.some((i) => i.issue.startsWith('Underspending'))).toBe(false);
  });

  // The constrained band's upper bound was a local 105 while the shared constant is 100. At 102%
  // the old code said "constrained"; the shared bands say "overspending".
  it('uses the shared constrained bound so 102% reads as overspending', async () => {
    const result = await pacingFor(102);

    expect(CAMPAIGN_PACING_THRESHOLDS.constrained).toBe(100);
    expect(result.campaigns[0].pacingLabel).toBe('overspending');

    const constrained = result.actionItems.find((i) => i.issue.startsWith('Budget constrained'));
    expect(constrained?.issue).toBe(`Budget constrained — pacing above ${CAMPAIGN_PACING_THRESHOLDS.normal}%`);
  });

  // Guards the LinkedIn-only rule that this ticket must NOT drop: campaign-service's rule set has
  // no equivalent, so it has to keep firing from the BFF.
  it('still raises the LinkedIn-only "no ad creatives" rule ahead of pacing', async () => {
    const result = await pacingFor(20, { withCreatives: false });

    const noCreatives = result.actionItems.find((i) => i.issue.startsWith('No ad creatives'));
    expect(noCreatives).toBeDefined();
    expect(noCreatives?.priority).toBe('HIGH');
  });
});
