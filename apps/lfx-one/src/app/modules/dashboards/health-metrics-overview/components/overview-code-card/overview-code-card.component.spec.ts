// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { OverviewCodeCardComponent } from './overview-code-card.component';

import type { HealthMetricsOverviewCode } from '@lfx-one/shared/interfaces';

const PERIOD = { contributors: 46200, newContributors: 28700 };
const CODE: HealthMetricsOverviewCode = {
  measured: true,
  periods: { YTD: PERIOD, COMPLETED_YEAR: PERIOD, COMPLETED_YEAR_2: PERIOD, COMPLETED_YEAR_3: PERIOD },
  committers: 95688,
  maintainers: 34855,
  reviewers: 74117,
};

describe('OverviewCodeCardComponent', () => {
  let fixture: ComponentFixture<OverviewCodeCardComponent>;

  async function render(payload: HealthMetricsOverviewCode): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [OverviewCodeCardComponent],
      providers: [
        provideRouter([]),
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getOverviewCode: vi.fn().mockReturnValue(of(payload)) } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }) } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OverviewCodeCardComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  it('reads contributors and the all-time roles, and hands off to LFX Insights', async () => {
    await render(CODE);

    expect(query('overview-code-kpis-total-value')?.textContent?.trim()).toBe('46.2K');
    expect(query('overview-code-role-maintainers')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Maintainers 34,855');
    const link = query('overview-code-insights');
    expect(link?.getAttribute('href')).toContain('/collection/details/acme');
    expect(link?.getAttribute('target')).toBe('_blank');
  });

  it('offers LFX Insights from its empty state', async () => {
    await render({ ...CODE, measured: false });

    expect(query('overview-code-empty-title')?.textContent).toBe('No contributions tracked');
    expect(query('overview-code-empty-insights')?.textContent?.trim()).toContain('LFX Insights');
  });
});
