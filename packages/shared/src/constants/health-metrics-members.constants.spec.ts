// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_TABS } from './health-metrics-engagement.constants';
import { HEALTH_METRICS_MEMBERS_DATA_SECTIONS, HEALTH_METRICS_MEMBERS_SECTIONS } from './health-metrics-members.constants';

describe('HEALTH_METRICS_MEMBERS_SECTIONS', () => {
  it('keys the eight sections uniquely, in the design order', () => {
    expect(HEALTH_METRICS_MEMBERS_SECTIONS.map((section) => section.key)).toEqual(['growth', 'breakdown', 'list', 'risk', 'renewals', 'board', 'nps', 'churn']);
  });

  it('holds a deep link for every section that reads data', () => {
    expect(HEALTH_METRICS_MEMBERS_DATA_SECTIONS).toEqual(['growth', 'breakdown', 'list', 'risk', 'renewals', 'board', 'nps', 'churn']);
  });

  // Plain footnotes are gone; the renewals caution stays as a warning note, keeping its bold lead.
  it('keeps a caution note on renewals only', () => {
    const noted = HEALTH_METRICS_MEMBERS_SECTIONS.filter((section) => 'note' in section);

    expect(noted.map((section) => [section.key, section.note.tone])).toEqual([['renewals', 'caution']]);
    expect(noted[0].note.parts[0]).toEqual({ text: 'Organization, tier, dues and renewal date', bold: true });
  });
});

describe('HEALTH_METRICS_TABS', () => {
  it('routes the Members tab', () => {
    expect(HEALTH_METRICS_TABS.find((tab) => tab.key === 'members')?.route).toBe('members');
  });
});
