// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { OverviewEventSnapshotComponent } from './overview-event-snapshot.component';

import type { HealthMetricsEventsSnapshot } from '@lfx-one/shared/interfaces';

const SNAPSHOT: HealthMetricsEventsSnapshot = {
  today: '2026-11-05',
  weeks: [
    {
      weekStartDate: '2026-10-19',
      weekEndDate: '2026-10-25',
      registrations: 5759,
      registrationsDelta: 575,
      registrationRevenueUsd: 3945365.68,
      registrationRevenueDeltaUsd: 295124.83,
      inPeriod: { '7d': false, '30d': true, '90d': true },
    },
    {
      weekStartDate: '2026-10-26',
      weekEndDate: '2026-11-01',
      registrations: 6969,
      registrationsDelta: 713,
      registrationRevenueUsd: 4575877.26,
      registrationRevenueDeltaUsd: 630511.58,
      inPeriod: { '7d': true, '30d': true, '90d': true },
    },
  ],
  packages: [{ tier: 'Gold', sold: 37, soldInPeriod: { '7d': 0, '30d': 2, '90d': 5 }, revenueUsd: 2952895 }],
  sponsorshipRevenueUsd: 2952895,
  sponsorshipRevenueInPeriodUsd: { '7d': 0, '30d': 160000, '90d': 446040 },
};

describe('OverviewEventSnapshotComponent', () => {
  let fixture: ComponentFixture<OverviewEventSnapshotComponent>;
  let read: ReturnType<typeof vi.fn>;

  async function render(response: HealthMetricsEventsSnapshot | Error = SNAPSHOT): Promise<void> {
    read = vi.fn().mockReturnValue(response instanceof Error ? throwError(() => response) : of(response));
    await TestBed.configureTestingModule({
      imports: [OverviewEventSnapshotComponent],
      providers: [
        { provide: AnalyticsService, useValue: { getEventsSnapshot: read } },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OverviewEventSnapshotComponent);
    fixture.componentRef.setInput('eventId', 'e1');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(testId: string, root: ParentNode = fixture.nativeElement): HTMLElement | null {
    return root.querySelector(`[data-testid="${testId}"]`);
  }

  function cells(testId: string): string[] {
    return [...(query(testId)?.querySelectorAll('[role="rowheader"], [role="cell"]') ?? [])].map((cell) => cell.textContent?.trim() ?? '');
  }

  it('reads the event for the foundation and shows the last 7 days of registrations, ending yesterday as today', async () => {
    await render();

    expect(read).toHaveBeenCalledWith({ foundationSlug: 'acme', eventId: 'e1' });
    const registration = query('overview-snapshot-registration')!;
    expect(query('overview-snapshot-start', registration)?.textContent?.trim()).toBe('Oct 25, 2026');
    expect(query('overview-snapshot-end', registration)?.textContent?.trim()).toBe('Nov 4, 2026 (today)');
    expect(cells('overview-snapshot-row-registrations')).toEqual(['Registrations', '5,759', '6,969', '+1,210 (21%)']);
    expect(query('overview-snapshot-change-registrations')?.className).toContain('text-ui-success-700');
  });

  it('switches every table to the chosen period', async () => {
    await render();

    query('overview-snapshot-period')?.querySelector<HTMLInputElement>('input[value="30d"]')?.click();
    fixture.detectChanges();

    expect(cells('overview-snapshot-row-package-Gold')).toEqual(['Gold', '35', '37', '+2 (6%)']);
    expect(query('overview-snapshot-start', query('overview-snapshot-sponsorship')!)?.textContent?.trim()).toBe('Oct 6, 2026');
  });

  it('sets the Totals row apart and names the revenue rows with a tip', async () => {
    await render();

    expect(query('overview-snapshot-row-totals')?.className).toContain('-mt-px');
    expect(query('overview-snapshot-row-sponsorship-revenue')?.querySelector('[role="img"]')?.getAttribute('aria-label')).toContain(
      'Signed sponsorship contracts'
    );
    expect(query('overview-snapshot-empty')).toBeNull();
  });

  it('says when no package has sold', async () => {
    await render({ ...SNAPSHOT, packages: [] });

    expect(query('overview-snapshot-empty')?.textContent?.trim()).toBe('No sponsorship packages sold yet.');
    expect(query('overview-snapshot-row-totals')).toBeNull();
  });

  it('says so when the snapshot cannot be read', async () => {
    await render(new Error('down'));

    expect(query('overview-snapshot-error')).not.toBeNull();
    expect(query('overview-snapshot-registration')).toBeNull();
  });
});
