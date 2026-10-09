// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'vitest';

import { HEALTH_METRICS_ENGAGEMENT_SECTION_ID_PREFIX, HEALTH_METRICS_ENGAGEMENT_SECTIONS } from '../constants/health-metrics-engagement.constants';
import {
  buildHealthMetricsL2SectionId,
  buildHealthMetricsL2SectionViews,
  buildHealthMetricsProjectInitials,
  buildHealthMetricsProjectOptions,
  isHealthMetricsL2SectionKey,
  parseHealthMetricsProjectSlug,
} from './health-metrics-l2.utils';

import type { FoundationProjectsDetailGroup, ProjectTableRow } from '../interfaces';

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

describe('buildHealthMetricsProjectOptions', () => {
  const project = (projectSlug: string, projectName: string): ProjectTableRow => ({ projectSlug, projectName }) as ProjectTableRow;
  const group = (projects: ProjectTableRow[]): FoundationProjectsDetailGroup => ({ foundationSlug: 'f', foundationName: 'F', foundationUid: 'u', projects });

  it('flattens every group into one entry per slug, sorted by name', () => {
    const options = buildHealthMetricsProjectOptions([
      group([project('zeta-mesh', 'Zeta Mesh'), project('alpha', 'Alpha')]),
      group([project('alpha', 'Alpha (sub-foundation copy)'), project('kube-tools', 'kube tools')]),
    ]);

    expect(options.map((option) => option.slug)).toEqual(['alpha', 'kube-tools', 'zeta-mesh']);
    expect(options[0].name).toBe('Alpha');
    expect(options[2]).toEqual({ slug: 'zeta-mesh', name: 'Zeta Mesh', initials: 'ZM', colorClass: expect.stringMatching(/^bg-/) });
  });

  it('drops a malformed slug and names a nameless project by its slug', () => {
    const options = buildHealthMetricsProjectOptions([group([project('Bad Slug', 'Bad'), project('plain', '  ')])]);

    expect(options).toEqual([{ slug: 'plain', name: 'plain', initials: 'PL', colorClass: expect.stringMatching(/^bg-/) }]);
  });

  it('keeps a project on the same color across reads', () => {
    const [first] = buildHealthMetricsProjectOptions([group([project('alpha', 'Alpha')])]);
    const [second] = buildHealthMetricsProjectOptions([group([project('beta', 'Beta'), project('alpha', 'Alpha')])]);

    expect(second.colorClass).toBe(first.colorClass);
  });
});

describe('buildHealthMetricsProjectInitials', () => {
  it('takes two words, else two characters of one', () => {
    expect(buildHealthMetricsProjectInitials('open telemetry')).toBe('OT');
    expect(buildHealthMetricsProjectInitials('Envoy')).toBe('EN');
    expect(buildHealthMetricsProjectInitials('---')).toBe('');
  });
});

describe('parseHealthMetricsProjectSlug', () => {
  it('keeps a well-formed slug and falls back to all projects otherwise', () => {
    expect(parseHealthMetricsProjectSlug('kube-tools')).toBe('kube-tools');
    expect(parseHealthMetricsProjectSlug('Bad Slug')).toBeNull();
    expect(parseHealthMetricsProjectSlug('')).toBeNull();
    expect(parseHealthMetricsProjectSlug(null)).toBeNull();
  });
});
