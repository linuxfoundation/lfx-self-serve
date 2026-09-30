// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ProjectTableRow } from '@lfx-one/shared/interfaces';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectHealthScoresDrawerComponent } from './project-health-scores-drawer.component';

/**
 * Covers the category pill label (IN-1390): the band word, with an asterisk glued to it for a partial
 * score and never for an unscored row.
 *
 * The component is instantiated directly rather than rendered: the assertion is about one method, and
 * the template pulls in the drawer overlay and the chart.
 */
describe('ProjectHealthScoresDrawerComponent — categoryLabelFor', () => {
  const row = (overrides: Partial<ProjectTableRow>): ProjectTableRow => ({
    id: 'project-1',
    projectId: 'project-1',
    projectName: 'Project Alpha',
    projectSlug: 'alpha',
    lifecycleStage: null,
    activeContributors: 0,
    commitsLast90Days: 0,
    maintainers: 0,
    stars: 0,
    lastUpdated: null,
    healthScoreCategory: 'fair',
    healthCoveredCategoryCount: 3,
    ...overrides,
  });

  const createComponent = (): ProjectHealthScoresDrawerComponent => TestBed.runInInjectionContext(() => new ProjectHealthScoresDrawerComponent());

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: ProjectContextService, useValue: { activeContext: signal(null), isFoundationContext: signal(false), selectedFoundation: signal(null) } },
        { provide: AnalyticsService, useValue: { getFoundationProjectsDetail: vi.fn() } },
      ],
    });
  });

  it.each([
    { case: 'glues an asterisk to a partial Concerning score', healthScoreCategory: 'concerning', healthCoveredCategoryCount: 2, label: 'Concerning*' },
    { case: 'glues an asterisk to a partial Excellent score', healthScoreCategory: 'excellent', healthCoveredCategoryCount: 2, label: 'Excellent*' },
    { case: 'leaves a full score as the bare band', healthScoreCategory: 'fair', healthCoveredCategoryCount: 3, label: 'Fair' },
    { case: 'leaves a score without a covered count as the bare band', healthScoreCategory: 'healthy', healthCoveredCategoryCount: null, label: 'Healthy' },
    { case: 'gives an unscored row no label, even with a covered count of 2', healthScoreCategory: null, healthCoveredCategoryCount: 2, label: '' },
  ] as const)('$case', ({ healthScoreCategory, healthCoveredCategoryCount, label }) => {
    const component = createComponent();

    expect(component['categoryLabelFor'](row({ healthScoreCategory, healthCoveredCategoryCount }))).toBe(label);
  });
});
