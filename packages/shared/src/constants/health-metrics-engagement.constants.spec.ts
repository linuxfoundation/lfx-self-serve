// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import {
  HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_FILTERS,
  HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABEL_VALUES,
  HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS,
  HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GOVERNANCE_GROUPS,
  HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GROUP_ORDER,
  HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GROUP_VALUES,
} from './health-metrics-engagement.constants';

describe('HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS', () => {
  // These become a SQL `group_type_label IN (...)`, so a label the view never emits silently
  // returns an empty cut rather than failing — this is the only place that catches a typo.
  it('lists only labels the view emits', () => {
    const emitted = new Set(HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABEL_VALUES);
    const unbacked = Object.values(HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS)
      .flatMap((labels) => labels ?? [])
      .filter((label) => !emitted.has(label));

    expect(unbacked).toEqual([]);
  });

  // The design gives `Other` no cut, so it is the one emitted label with no home.
  it('leaves only Other uncut', () => {
    const cut = new Set(Object.values(HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS).flatMap((labels) => labels ?? []));

    expect(HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABEL_VALUES.filter((label) => !cut.has(label))).toEqual(['Other']);
  });

  // `all` drops the predicate instead of listing every label, so it must stay absent.
  it('covers every filter cut except all-types, and nothing else', () => {
    const cuts = HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_FILTERS.map((filter) => filter.key).filter((key) => key !== 'all');

    expect(Object.keys(HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS).sort()).toEqual([...cuts].sort());
  });
});

describe('HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GROUP_VALUES', () => {
  // A group named here but never emitted sorts rows that cannot exist; one emitted but missing
  // falls to the end of the table silently. Both are the failure the label pinning above catches.
  it('orders exactly the groups the view emits', () => {
    expect([...HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GROUP_ORDER].sort()).toEqual([...HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GROUP_VALUES].sort());
  });

  it('marks only emitted groups as governance', () => {
    const emitted = new Set(HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GROUP_VALUES);

    expect(HEALTH_METRICS_ENGAGEMENT_PARTICIPATION_GOVERNANCE_GROUPS.filter((group) => !emitted.has(group))).toEqual([]);
  });
});
