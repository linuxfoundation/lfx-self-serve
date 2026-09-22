// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { COMMITTEE_CATEGORIES } from './committees.constants';
import { HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_FILTERS, HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS } from './health-metrics-engagement.constants';

/** The one label with no `COMMITTEE_CATEGORIES` entry, listed speculatively until the view confirms it. */
const SPECULATIVE_LABELS = new Set(['Technical Advisory Group']);

describe('HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS', () => {
  // These become a SQL `group_type_label IN (...)`, so a label that matches no committee category
  // silently returns an empty cut rather than failing — this is the only place that catches a typo.
  it('lists only committee categories, apart from the documented speculative one', () => {
    const categories = new Set(COMMITTEE_CATEGORIES.map((category) => category.value));
    const unbacked = Object.values(HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS)
      .flatMap((labels) => labels ?? [])
      .filter((label) => !categories.has(label) && !SPECULATIVE_LABELS.has(label));

    expect(unbacked).toEqual([]);
  });

  it('keeps the speculative label speculative — once the category exists, drop it from this spec', () => {
    const categories = new Set(COMMITTEE_CATEGORIES.map((category) => category.value));

    expect([...SPECULATIVE_LABELS].filter((label) => categories.has(label))).toEqual([]);
  });

  // `all` drops the predicate instead of listing every label, so it must stay absent.
  it('covers every filter cut except all-types, and nothing else', () => {
    const cuts = HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_FILTERS.map((filter) => filter.key).filter((key) => key !== 'all');

    expect(Object.keys(HEALTH_METRICS_ENGAGEMENT_GROUP_TYPE_LABELS).sort()).toEqual([...cuts].sort());
  });
});
