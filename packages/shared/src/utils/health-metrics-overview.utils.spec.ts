// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { buildHealthMetricsOverviewPccUrl } from './health-metrics-overview.utils';

describe('buildHealthMetricsOverviewPccUrl', () => {
  it('builds a PCC report URL for a known link target', () => {
    expect(buildHealthMetricsOverviewPccUrl('https://pcc.lfx.dev', 'proj-1', 'eng.groups')).toBe(
      'https://pcc.lfx.dev/project/proj-1/reports/health-metrics/meetings#committees'
    );
  });

  it('strips a trailing slash from the base URL before joining', () => {
    expect(buildHealthMetricsOverviewPccUrl('https://pcc.lfx.dev/', 'proj-1', 'eng.groups')).toBe(
      'https://pcc.lfx.dev/project/proj-1/reports/health-metrics/meetings#committees'
    );
  });

  it('encodes the project id in the URL path', () => {
    expect(buildHealthMetricsOverviewPccUrl('https://pcc.lfx.dev', 'proj 1/two', 'eng.groups')).toBe(
      'https://pcc.lfx.dev/project/proj%201%2Ftwo/reports/health-metrics/meetings#committees'
    );
  });

  it('returns undefined for an unrecognized link target (e.g. code.insights, which opens externally instead)', () => {
    expect(buildHealthMetricsOverviewPccUrl('https://pcc.lfx.dev', 'proj-1', 'code.insights')).toBeUndefined();
  });

  it('returns undefined for a missing project id', () => {
    expect(buildHealthMetricsOverviewPccUrl('https://pcc.lfx.dev', '', 'eng.groups')).toBeUndefined();
  });
});
