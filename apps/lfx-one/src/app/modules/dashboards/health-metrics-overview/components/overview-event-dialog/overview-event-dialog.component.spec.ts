// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { BreakpointObserver } from '@angular/cdk/layout';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HEALTH_METRICS_EVENTS_SNAPSHOT_UNMEASURED } from '@lfx-one/shared/constants';
import { AnalyticsService } from '@services/analytics.service';
import { ProjectContextService } from '@services/project-context.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OverviewEventDialogComponent } from './overview-event-dialog.component';

import type { HealthMetricsOverviewEvent, HealthMetricsOverviewEventDialogTab } from '@lfx-one/shared/interfaces';

const EVENT: HealthMetricsOverviewEvent = {
  eventId: 'e1',
  eventName: 'Acme Summit',
  startDate: '2026-12-08',
  endDate: '2026-12-10',
  city: 'Springfield',
  registrations: 328,
  registrationsGoal: 1000,
  compScore: 'medium',
  acceptedTalks: 0,
  totalProposals: 185,
  cfpStatus: 'Review Complete',
  ranges: [],
};
const HEADLINE = {
  eventId: 'e1',
  eventName: 'Acme Summit',
  eventStartDate: '2026-12-08',
  forecastAvg: 620,
  forecastLow: 560,
  forecastHigh: 680,
  registrationsNow: 330,
  priorYearSamePoint: 300,
  goal: 1000,
  daysLeft: 46,
  isNewEvent: false,
};
const CURVE = { eventId: 'e1', formats: [{ format: 'In Person', points: [] }] };

describe('OverviewEventDialogComponent', () => {
  let fixture: ComponentFixture<OverviewEventDialogComponent>;
  let close: ReturnType<typeof vi.fn>;
  let history: ReturnType<typeof vi.fn>;
  let snapshot: ReturnType<typeof vi.fn>;
  let toast: { show: ReturnType<typeof vi.fn> };
  const downloadCardAsImage = vi.fn();

  async function render(
    options: { event?: HealthMetricsOverviewEvent; isPast?: boolean; tab?: HealthMetricsOverviewEventDialogTab; trendFails?: boolean; phone?: boolean } = {}
  ): Promise<void> {
    close = vi.fn();
    history = vi.fn().mockReturnValue(options.trendFails ? throwError(() => new Error('down')) : of(CURVE));
    snapshot = vi.fn().mockReturnValue(of(HEALTH_METRICS_EVENTS_SNAPSHOT_UNMEASURED));
    toast = { show: vi.fn() };
    await TestBed.configureTestingModule({
      imports: [OverviewEventDialogComponent],
      providers: [
        {
          provide: AnalyticsService,
          useValue: {
            getEventsRegistrationForecast: vi.fn().mockReturnValue(of({ events: [HEADLINE] })),
            getEventsRegistrationForecastCurve: vi.fn().mockReturnValue(of(CURVE)),
            getEventsRegistrationHistory: history,
            getEventsSnapshot: snapshot,
          },
        },
        { provide: ProjectContextService, useValue: { selectedFoundation: signal({ slug: 'acme' }) } },
        { provide: UiToastService, useValue: toast },
        { provide: BreakpointObserver, useValue: { observe: () => of({ matches: options.phone ?? false, breakpoints: {} }) } },
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data: { event: options.event ?? EVENT, isPast: options.isPast ?? false, tab: options.tab ?? 'trend' } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(OverviewEventDialogComponent);
    Object.assign(fixture.componentInstance, { exportImage: downloadCardAsImage });
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  beforeEach(() => {
    downloadCardAsImage.mockReset();
  });

  it('titles itself with the event, under the heading the dialog is named by, and its city and start', async () => {
    await render();

    expect(fixture.nativeElement.querySelector(`#${OverviewEventDialogComponent.headingId}`)?.textContent?.trim()).toBe('Acme Summit');
    expect(query('overview-event-dialog-meta')?.textContent?.trim()).toBe('Springfield · Starts Dec 8, 2026');
    expect(document.activeElement?.id).toBe(OverviewEventDialogComponent.headingId);
  });

  it('badges the registration goal and the days left from the forecast', async () => {
    await render();

    expect(query('overview-event-dialog-goal')?.textContent?.trim()).toBe('Registration goal: 1,000');
    expect(query('overview-event-dialog-goal')?.className).toContain('text-ui-success-600');
    expect(query('overview-event-dialog-days')?.textContent?.trim()).toBe('46 days left');
  });

  it('badges a past event as held, with no goal set, reading its history', async () => {
    await render({ event: { ...EVENT, registrationsGoal: null }, isPast: true });

    expect(history).toHaveBeenCalledWith({ foundationSlug: 'acme', eventId: 'e1' });
    expect(query('overview-event-dialog-goal')?.textContent?.trim()).toBe('No registration goal');
    expect(query('overview-event-dialog-days')?.textContent?.trim()).toBe('Event held');
  });

  it('opens on the trend and reads the snapshot only once its tab is chosen, keeping it when switching back', async () => {
    await render();

    expect(query('overview-event-dialog-panel-trend')?.hidden).toBe(false);
    expect(query('overview-event-dialog-panel-snapshot')).toBeNull();
    expect(snapshot).not.toHaveBeenCalled();

    query('ui-tab-snapshot')?.click();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(query('overview-event-dialog-panel-trend')?.hidden).toBe(true);
    expect(query('overview-event-dialog-panel-snapshot')?.hidden).toBe(false);

    query('ui-tab-trend')?.click();
    query('ui-tab-snapshot')?.click();
    fixture.detectChanges();

    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(snapshot).toHaveBeenCalledWith({ foundationSlug: 'acme', eventId: 'e1' });
  });

  it('opens on the Snapshot tab when the card asks for it', async () => {
    await render({ tab: 'snapshot' });

    expect(query('ui-tab-snapshot')?.getAttribute('aria-selected')).toBe('true');
    expect(query('overview-event-dialog-panel-snapshot')?.hidden).toBe(false);
    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  it('downloads the tab on show as a PNG named for the event and the tab, widened for the capture, then says so', async () => {
    let widened = false;
    downloadCardAsImage.mockImplementation(async (element: HTMLElement) => {
      widened = element.hasAttribute('data-exporting');
      return true;
    });
    await render();

    query('overview-event-dialog-png')?.querySelector('button')?.click();
    await fixture.whenStable();

    expect(downloadCardAsImage).toHaveBeenCalledWith(query('overview-event-dialog-panel-trend'), 'acme-summit-registration-trend', expect.anything());
    expect(widened).toBe(true);
    expect(query('overview-event-dialog-panel-trend')?.hasAttribute('data-exporting')).toBe(false);
    expect(toast.show).toHaveBeenCalledWith({ variant: 'dark', message: 'Registration trend downloaded as PNG' });
  });

  it('says so when the PNG cannot be made', async () => {
    downloadCardAsImage.mockResolvedValue(false);
    await render({ tab: 'snapshot' });

    query('overview-event-dialog-png')?.querySelector('button')?.click();
    await fixture.whenStable();

    expect(downloadCardAsImage).toHaveBeenCalledWith(query('overview-event-dialog-panel-snapshot'), 'acme-summit-snapshot', expect.anything());
    expect(toast.show).toHaveBeenCalledWith({ variant: 'error', message: 'Snapshot could not be downloaded. Try again.' });
  });

  it('offers no download while the tab on show has nothing to save', async () => {
    await render({ isPast: true, trendFails: true });

    expect(query('overview-event-dialog-png')?.querySelector('button')?.disabled).toBe(true);
    query('overview-event-dialog-png')?.querySelector('button')?.click();
    await fixture.whenStable();

    expect(downloadCardAsImage).not.toHaveBeenCalled();
  });

  it('keeps the header and tabs fixed over a body that alone scrolls, and the trend never scrolls', async () => {
    await render();
    const body = query('overview-event-dialog-body') as HTMLElement;

    expect(body.className).toContain('overflow-hidden');
    expect(fixture.componentInstance['bodyMask']()).toBeNull();
    expect(query('overview-event-dialog-close')?.className).toContain('absolute');

    query('overview-event-dialog-tabs')?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]?.click();
    fixture.detectChanges();
    expect(body.className).toContain('overflow-y-auto');
  });

  it('fades the Snapshot body at an edge only while there is more to scroll past it', async () => {
    await render({ tab: 'snapshot' });
    const body = query('overview-event-dialog-body') as HTMLElement;
    // jsdom drops `mask-image`, so the binding's value stands in for the style.
    const mask = (): string | null => fixture.componentInstance['bodyMask']();
    const scroll = (scrollTop: number) => {
      Object.defineProperties(body, {
        scrollTop: { configurable: true, value: scrollTop },
        clientHeight: { configurable: true, value: 300 },
        scrollHeight: { configurable: true, value: 600 },
      });
      body.dispatchEvent(new Event('scroll'));
      fixture.detectChanges();
    };

    scroll(0);
    expect(mask()).toContain('black 0px, black calc(100% - 32px)');
    scroll(150);
    expect(mask()).toContain('black 32px, black calc(100% - 32px)');
    scroll(300);
    expect(mask()).toContain('black 32px, black calc(100% - 0px)');
  });

  it('on a phone, shows small badges, an icon-only Download PNG and the compact Snapshot, but captures it at desktop width', async () => {
    let compactAtCapture: boolean | undefined;
    downloadCardAsImage.mockImplementation(async (element: HTMLElement) => {
      compactAtCapture = !!element.querySelector('[data-testid="overview-snapshot-header"]')?.className.includes('76px');
      return true;
    });
    await render({ tab: 'snapshot', phone: true });

    expect(query('overview-event-dialog-goal')?.className).toContain('h-[20px]');
    const png = query('overview-event-dialog-png')?.querySelector('button');
    expect(png?.getAttribute('aria-label')).toBe('Download PNG');
    expect(png?.textContent?.trim()).toBe('');
    expect(query('overview-snapshot-header')?.className).toContain('76px');

    png?.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(compactAtCapture).toBe(false);
    expect(query('overview-snapshot-header')?.className).toContain('76px');
  });

  it('closes the dialog from its close button', async () => {
    await render();

    query('overview-event-dialog-close')?.click();

    expect(close).toHaveBeenCalledTimes(1);
  });
});
