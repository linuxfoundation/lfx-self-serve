// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_ENGAGEMENT_SECTION_ID_PREFIX, HEALTH_METRICS_ENGAGEMENT_SECTIONS } from '../constants/health-metrics-engagement.constants';
import { HEALTH_METRICS_EVENTS_BLANK, HEALTH_METRICS_EVENTS_SECTIONS } from '../constants/health-metrics-events.constants';
import { HEALTH_METRICS_L2_BLANK_PAST, HEALTH_METRICS_L2_EMPTY_SOURCES } from '../constants/health-metrics-l2.constants';
import { HEALTH_METRICS_MEMBERS_BLANK, HEALTH_METRICS_MEMBERS_SECTIONS } from '../constants/health-metrics-members.constants';
import { HEALTH_METRICS_NON_MEMBERS_SECTIONS } from '../constants/health-metrics-non-members.constants';
import { HEALTH_METRICS_TRAINING_SECTIONS } from '../constants/health-metrics-training.constants';
import {
  buildHealthMetricsL2BlankView,
  buildHealthMetricsL2EmptyCopy,
  buildHealthMetricsL2SectionId,
  buildHealthMetricsL2SectionViews,
  isHealthMetricsL2SectionKey,
} from './health-metrics-l2.utils';

describe('buildHealthMetricsL2SectionId', () => {
  it('prefixes the key so the DOM id never collides with the bare URL fragment', () => {
    expect(buildHealthMetricsL2SectionId(HEALTH_METRICS_ENGAGEMENT_SECTION_ID_PREFIX, 'committees')).toBe('sec-eng-committees');
  });
});

describe('buildHealthMetricsL2SectionViews', () => {
  it('resolves the anchor and heading id for every section, keeping its copy', () => {
    const views = buildHealthMetricsL2SectionViews(HEALTH_METRICS_ENGAGEMENT_SECTIONS, HEALTH_METRICS_ENGAGEMENT_SECTION_ID_PREFIX);

    expect(views).toHaveLength(HEALTH_METRICS_ENGAGEMENT_SECTIONS.length);
    expect(views[0]).toEqual({
      ...HEALTH_METRICS_ENGAGEMENT_SECTIONS[0],
      id: `sec-eng-${HEALTH_METRICS_ENGAGEMENT_SECTIONS[0].key}`,
      headingId: `sec-eng-${HEALTH_METRICS_ENGAGEMENT_SECTIONS[0].key}-heading`,
    });
  });
});

describe('isHealthMetricsL2SectionKey', () => {
  it('accepts every shipped section key', () => {
    for (const section of HEALTH_METRICS_ENGAGEMENT_SECTIONS) {
      expect(isHealthMetricsL2SectionKey(HEALTH_METRICS_ENGAGEMENT_SECTIONS, section.key)).toBe(true);
    }
  });

  it('rejects anything else, including the prefixed DOM id and an absent fragment', () => {
    expect(isHealthMetricsL2SectionKey(HEALTH_METRICS_ENGAGEMENT_SECTIONS, 'sec-eng-committees')).toBe(false);
    expect(isHealthMetricsL2SectionKey(HEALTH_METRICS_ENGAGEMENT_SECTIONS, 'groups')).toBe(false);
    expect(isHealthMetricsL2SectionKey(HEALTH_METRICS_ENGAGEMENT_SECTIONS, null)).toBe(false);
    expect(isHealthMetricsL2SectionKey(HEALTH_METRICS_ENGAGEMENT_SECTIONS, undefined)).toBe(false);
  });
});

describe('buildHealthMetricsL2EmptyCopy', () => {
  const empty = { icon: 'fa-light fa-ticket', source: HEALTH_METRICS_L2_EMPTY_SOURCES.event };

  it('says nothing is recorded yet for YTD, and where the section fills in from', () => {
    expect(buildHealthMetricsL2EmptyCopy(empty, null)).toEqual({
      icon: 'fa-light fa-ticket',
      title: 'Nothing recorded yet',
      text: 'This fills in once the foundation has an event on the calendar. Updates can take 24–48 hours to appear.',
    });
  });

  it('keeps today’s wording in a past year for a section that shows today’s figures whatever the period', () => {
    expect(buildHealthMetricsL2EmptyCopy({ ...empty, snapshot: true }, 2024).title).toBe('Nothing recorded yet');
  });

  it('names a past year, with the same sentence for every section', () => {
    expect(buildHealthMetricsL2EmptyCopy(empty, 2024)).toEqual({
      icon: 'fa-light fa-ticket',
      title: 'Nothing in 2024',
      text: 'Nothing was recorded this year. Activity tracked outside LFX or under another foundation isn’t included.',
    });
  });
});

describe('buildHealthMetricsL2BlankView', () => {
  it('words a tab with no data yet, on its one icon tile', () => {
    expect(buildHealthMetricsL2BlankView(HEALTH_METRICS_EVENTS_BLANK, null)).toEqual({
      tile: { icon: 'fa-light fa-ticket', transform: 'none', iconSizePx: 24 },
      copy: { title: 'No event data yet', lead: HEALTH_METRICS_EVENTS_BLANK.lead, reasons: HEALTH_METRICS_EVENTS_BLANK.reasons },
    });
  });

  it('names the past year and the tab’s activity, with the shared past-year reasons', () => {
    expect(buildHealthMetricsL2BlankView(HEALTH_METRICS_MEMBERS_BLANK, 2023).copy).toEqual({
      title: 'No member data for 2023',
      lead: 'No membership was recorded for the foundation in 2023.',
      reasons: HEALTH_METRICS_L2_BLANK_PAST.reasons,
    });
  });
});

describe('Level 2 section empty states', () => {
  it.each([
    ['engagement', HEALTH_METRICS_ENGAGEMENT_SECTIONS],
    ['events', HEALTH_METRICS_EVENTS_SECTIONS],
    ['members', HEALTH_METRICS_MEMBERS_SECTIONS],
    ['non-members', HEALTH_METRICS_NON_MEMBERS_SECTIONS],
    ['training', HEALTH_METRICS_TRAINING_SECTIONS],
  ])('gives every %s section an icon and one of the design’s sources', (_tab, sections) => {
    const sources: readonly string[] = Object.values(HEALTH_METRICS_L2_EMPTY_SOURCES);
    for (const section of sections) {
      expect(section.empty.icon).toMatch(/^fa-light fa-/);
      expect(sources).toContain(section.empty.source);
    }
  });
});
