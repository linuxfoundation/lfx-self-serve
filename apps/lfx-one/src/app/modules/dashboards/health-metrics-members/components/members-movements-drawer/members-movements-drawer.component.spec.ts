// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { AnalyticsService } from '@services/analytics.service';
import { of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MembersMovementsDrawerComponent } from './members-movements-drawer.component';

import type { HealthMetricsMembersMovement, HealthMetricsMembersMovements } from '@lfx-one/shared/interfaces';

function movement(index: number, dues = 50_000): HealthMetricsMembersMovement {
  return {
    accountId: `0014100000Acme${String(index).padStart(4, '0')}`,
    accountName: `Acme Unit ${index}`,
    membershipTier: 'Silver',
    duesImpactUsd: dues,
    movementDate: '2026-03-05',
    lastEngagedDate: null,
  };
}

describe('MembersMovementsDrawerComponent', () => {
  let fixture: ComponentFixture<MembersMovementsDrawerComponent>;
  let getMembersMovements: ReturnType<typeof vi.fn>;

  async function render(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [MembersMovementsDrawerComponent],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations(), { provide: AnalyticsService, useValue: { getMembersMovements } }],
    }).compileComponents();

    fixture = TestBed.createComponent(MembersMovementsDrawerComponent);
    fixture.componentRef.setInput('listType', 'downgrade');
    fixture.componentRef.setInput('year', 2026);
    fixture.componentRef.setInput('foundationSlug', 'acme');
    fixture.componentRef.setInput('barCount', 2);
    await settle();
  }

  async function open(): Promise<void> {
    fixture.componentRef.setInput('visible', true);
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(testId: string): HTMLElement | null {
    return document.body.querySelector(`[data-testid="${testId}"]`);
  }

  function text(testId: string): string {
    return query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function rows(): HTMLElement[] {
    return [...document.body.querySelectorAll<HTMLElement>('[data-testid="members-movements-drawer-row"]')];
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    // The title reads "this year" only for the running year, so pin the clock to the fixtures' year.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-29T12:00:00Z'));
    document.body.innerHTML = '';
    getMembersMovements = vi.fn().mockReturnValue(of<HealthMetricsMembersMovements>({ rows: [movement(1, -89_000), movement(2, -40_000)], totalRecords: 2 }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads nothing until it opens, then reads the bar it was opened for', async () => {
    await render();
    expect(getMembersMovements).not.toHaveBeenCalled();

    await open();

    expect(getMembersMovements).toHaveBeenCalledWith({ foundationSlug: 'acme', year: 2026, movementType: 'downgrade', offset: 0, pageSize: 25 });
    expect(text('members-movements-drawer-header')).toContain('Moved down a tier');
    expect(rows()).toHaveLength(2);
    expect(rows()[0].textContent).toContain('Silver · moved down Mar 5, 2026');
    expect(text('members-movements-drawer-row-dues')).toBe('−$89K');
    expect(query('members-movements-drawer-row-dues')?.className).toContain('text-red-600');
    expect(query('members-movements-drawer-count-note')).toBeNull();
    expect(query('members-movements-drawer-more')).toBeNull();
    expect(text('members-movements-drawer-note')).toContain('highest-value save opportunities');
  });

  it('notes a list that differs from its bar', async () => {
    await render();
    fixture.componentRef.setInput('barCount', 3);
    await open();

    expect(text('members-movements-drawer-count-note')).toContain('2 organizations listed, while the bar counts 3');
  });

  it('still notes the bar when the list comes back empty', async () => {
    getMembersMovements.mockReturnValue(of<HealthMetricsMembersMovements>({ rows: [], totalRecords: 0 }));
    await render();
    fixture.componentRef.setInput('barCount', 3);
    await open();

    expect(query('members-movements-drawer-empty')).not.toBeNull();
    expect(text('members-movements-drawer-count-note')).toContain('0 organizations listed, while the bar counts 3');
  });

  it('appends the next page on "Show more" until the list is complete', async () => {
    getMembersMovements
      .mockReturnValueOnce(of({ rows: Array.from({ length: 25 }, (_, index) => movement(index)), totalRecords: 26 }))
      .mockReturnValueOnce(of({ rows: [movement(25)], totalRecords: 26 }));
    await render();
    await open();

    expect(rows()).toHaveLength(25);
    query('members-movements-drawer-more')?.querySelector('button')?.click();
    await settle();

    expect(getMembersMovements).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25 }));
    expect(rows()).toHaveLength(26);
    expect(query('members-movements-drawer-more')).toBeNull();
  });

  it('holds a second "Show more" while a page is in flight', async () => {
    const page = new Subject<HealthMetricsMembersMovements>();
    getMembersMovements.mockReturnValueOnce(of({ rows: [movement(1)], totalRecords: 3 })).mockReturnValueOnce(page);
    await render();
    await open();

    const more = query('members-movements-drawer-more')?.querySelector('button');
    more?.click();
    more?.click();
    page.next({ rows: [movement(2)], totalRecords: 3 });
    page.complete();
    await settle();

    expect(getMembersMovements).toHaveBeenCalledTimes(2);
    expect(rows()).toHaveLength(2);
  });

  it('shows the error state when the first page fails', async () => {
    getMembersMovements.mockReturnValue(throwError(() => new Error('boom')));
    await render();
    await open();

    expect(query('members-movements-drawer-error')).not.toBeNull();
    expect(rows()).toHaveLength(0);
  });

  it('reads afresh when reopened for another bar', async () => {
    await render();
    await open();
    fixture.componentRef.setInput('visible', false);
    fixture.componentRef.setInput('listType', 'new');
    await settle();
    await open();

    expect(getMembersMovements).toHaveBeenCalledTimes(2);
    expect(getMembersMovements).toHaveBeenLastCalledWith(expect.objectContaining({ movementType: 'new', offset: 0 }));
    expect(text('members-movements-drawer-header')).toContain('Joined this year');
  });
});
