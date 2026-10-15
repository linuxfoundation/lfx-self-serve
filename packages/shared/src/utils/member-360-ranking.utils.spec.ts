// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';
import type { Member360RankingRow } from '../interfaces/member-360.interface';
import { rankMember360Rows } from './member-360-ranking.utils';

function member(name: string, score: number, days: number | null): Member360RankingRow {
  return {
    rank: 1,
    member_organization: name,
    membership_tier: 'General',
    annual_value: null,
    renewal_date: null,
    days_to_renewal: days,
    engagement_score: score,
    engagement_tier: score >= 80 ? 'Champion' : 'At Risk',
    trend: null,
    committees_score: null,
    events_score: null,
    speaking_score: null,
    content_score: null,
    community_programs_score: null,
    marketing_social_score: null,
    last_meaningful_engagement: null,
    engaged_contacts: 0,
    key_contact: null,
    top_gaps: [],
    recommended_next_action: 'Synthetic action',
    action_owner: 'Sales',
    priority: score >= 80 ? 'Low' : 'High',
  };
}
// Mirror synthetic-org.mock.ts identities by value because shared cannot import apps.
describe('Member 360 ranking policy', () => {
  const rows = [member('Acme Motors', 38, null), member('Beta Coastal, Inc.', 92, 120)];
  it('defaults to descending score without mutating the stored rows', () => {
    expect(rankMember360Rows(rows)[0].engagement_score).toBe(92);
    expect(rows[0].engagement_score).toBe(38);
  });
  it('combines filters and uses semantic priority order', () => {
    expect(rankMember360Rows(rows, { tier: 'At Risk', owner: 'Sales', search: 'ACME' })).toHaveLength(1);
    expect(rankMember360Rows(rows, undefined, 'priority', 'ascending')[0].priority).toBe('High');
  });
  it.each(['ascending', 'descending'] as const)('keeps unknown renewals last when %s', (direction) => {
    expect(rankMember360Rows(rows, undefined, 'days_to_renewal', direction)[1].days_to_renewal).toBeNull();
  });
});
