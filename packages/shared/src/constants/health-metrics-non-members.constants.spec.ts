// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_ENGAGEMENT_SECTIONS, HEALTH_METRICS_TABS } from './health-metrics-engagement.constants';
import {
  HEALTH_METRICS_NON_MEMBERS_DATA_SECTIONS,
  HEALTH_METRICS_NON_MEMBERS_ORGS_FILTER_OPTIONS,
  HEALTH_METRICS_NON_MEMBERS_ORGS_FILTERS,
  HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS,
  HEALTH_METRICS_NON_MEMBERS_SECTIONS,
  HEALTH_METRICS_NON_MEMBERS_SUB_NAV_CROSS_REFERENCE,
} from './health-metrics-non-members.constants';

describe('HEALTH_METRICS_NON_MEMBERS_SECTIONS', () => {
  it('keys the three sections uniquely, in the design order', () => {
    expect(HEALTH_METRICS_NON_MEMBERS_SECTIONS.map((section) => section.key)).toEqual(['orgs', 'people', 'conversion']);
  });

  it('waits on Company participation and People, the sections reading data', () => {
    expect(HEALTH_METRICS_NON_MEMBERS_DATA_SECTIONS).toEqual(['orgs', 'people']);
  });
});

describe('HEALTH_METRICS_TABS', () => {
  it('routes the Non-Members tab', () => {
    expect(HEALTH_METRICS_TABS.find((tab) => tab.key === 'non-members')?.route).toBe('non-members');
  });
});

describe('HEALTH_METRICS_NON_MEMBERS_SUB_NAV_CROSS_REFERENCE', () => {
  it('links to a routed tab and one of its sections', () => {
    const crossReference = HEALTH_METRICS_NON_MEMBERS_SUB_NAV_CROSS_REFERENCE;

    expect(HEALTH_METRICS_TABS.find((tab) => tab.label === crossReference.linkLabel)?.route).toBe(crossReference.route);
    expect(HEALTH_METRICS_ENGAGEMENT_SECTIONS.map((section) => section.key)).toContain(crossReference.fragment);
  });
});

describe('HEALTH_METRICS_NON_MEMBERS_ORGS_FILTER_OPTIONS', () => {
  it('offers every filter once, All first', () => {
    expect(HEALTH_METRICS_NON_MEMBERS_ORGS_FILTER_OPTIONS.map((option) => option.id)).toEqual([...HEALTH_METRICS_NON_MEMBERS_ORGS_FILTERS]);
  });
});

describe('HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS', () => {
  it('namespaces every param to the tab', () => {
    expect(Object.values(HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS).every((param) => param.startsWith('non'))).toBe(true);
  });

  it('gives every section its own params', () => {
    const params = Object.values(HEALTH_METRICS_NON_MEMBERS_QUERY_PARAMS);
    expect(new Set(params).size).toBe(params.length);
  });
});
