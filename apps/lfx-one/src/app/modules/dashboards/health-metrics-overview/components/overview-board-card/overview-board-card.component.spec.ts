// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UserService } from '@services/user.service';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { HealthMetricsChromeService } from '../../../health-metrics-gate/health-metrics-chrome.service';

import { OverviewBoardCardComponent } from './overview-board-card.component';

import type { HealthMetricsOverviewBoard, HealthMetricsOverviewBoardMember } from '@lfx-one/shared/interfaces';

function member(key: string, name: string, attended: number, invited = 3): HealthMetricsOverviewBoardMember {
  return {
    key,
    name,
    jobTitle: null,
    organization: 'Acme Corp',
    logoUrl: null,
    lastAttendedDate: null,
    attendance: { YTD: { invited, attended, attendancePct: attended / invited } },
  };
}

const PERIOD = { meetings: 3, meetingsChangePct: 0.25, avgAttendancePct: 0.38, avgAttendanceChangePct: -0.1 };
const BOARD: HealthMetricsOverviewBoard = {
  periods: { YTD: PERIOD, COMPLETED_YEAR: null, COMPLETED_YEAR_2: PERIOD, COMPLETED_YEAR_3: PERIOD },
  members: [member('k1', 'Pat Doe', 3), member('k2', 'Sam Roe', 0), member('k3', 'Alex Moe', 1)],
};

describe('OverviewBoardCardComponent', () => {
  let fixture: ComponentFixture<OverviewBoardCardComponent>;

  async function render(sfid: string | null = 'a0941000002acme'): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [OverviewBoardCardComponent],
      providers: [
        HealthMetricsChromeService,
        { provide: AnalyticsService, useValue: { getOverviewBoard: vi.fn().mockReturnValue(of(BOARD)) } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }), selectedFoundationSfid: signal(sfid) } },
        { provide: UserService, useValue: { impersonating: signal(false) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OverviewBoardCardComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function names(): string[] {
    return [...fixture.nativeElement.querySelectorAll('[data-testid="overview-board-name"]')].map((cell: Element) => cell.textContent?.trim() ?? '');
  }

  it('opens on the lowest attendance first, sorted ascending by Attended', async () => {
    await render();

    expect(names()).toEqual(['Sam Roe', 'Alex Moe', 'Pat Doe']);
    expect(query('overview-board-sort-attended')?.parentElement?.getAttribute('aria-sort')).toBe('ascending');
  });

  it('lets the keyboard reach the full organization behind its truncation', async () => {
    await render();

    const organization = [...(query('overview-board-row-k1')?.querySelectorAll('[role="cell"] span') ?? [])].find(
      (span) => span.textContent?.trim() === 'Acme Corp'
    );
    expect(organization?.getAttribute('tabindex')).toBe('0');
  });

  it('flips a column on each click and switches columns', async () => {
    await render();

    query('overview-board-sort-attended')?.click();
    fixture.detectChanges();
    expect(names()).toEqual(['Pat Doe', 'Alex Moe', 'Sam Roe']);

    query('overview-board-sort-name')?.click();
    fixture.detectChanges();
    expect(names()).toEqual(['Alex Moe', 'Pat Doe', 'Sam Roe']);
    expect(query('overview-board-sort-name')?.parentElement?.getAttribute('aria-sort')).toBe('ascending');
    expect(query('overview-board-sort-attended')?.parentElement?.getAttribute('aria-sort')).toBe('none');
  });

  it("links to PCC's add-past-meeting page by the foundation's Salesforce id", async () => {
    await render();

    expect(query('overview-board-add-meeting')?.querySelector('a')?.getAttribute('href')).toContain(
      '/project/a0941000002acme/collaboration/meetings/manage-meeting?isPast=true'
    );
  });

  it('hides the link until the Salesforce id resolves', async () => {
    await render(null);

    expect(query('overview-board-add-meeting')).toBeNull();
  });

  it('offers to add a past meeting from its empty state', async () => {
    await render();

    TestBed.inject(HealthMetricsChromeService).selectedRange.set('COMPLETED_YEAR');
    fixture.detectChanges();

    expect(query('overview-board-empty')?.textContent).toContain('No board meetings recorded yet');
    expect(query('overview-board-empty-add-meeting')).not.toBeNull();
  });
});
