// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AnalyticsService } from '@services/analytics.service';
import { Observable, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventsSpeakerProposalsDrawerComponent } from './events-speaker-proposals-drawer.component';

import type {
  HealthMetricsEventsSpeakerProposals,
  HealthMetricsEventsSpeakerProposalsQuery,
  HealthMetricsEventsSpeakersProposal,
} from '@lfx-one/shared/interfaces';

function proposal(key: string, overrides: Partial<HealthMetricsEventsSpeakersProposal> = {}): HealthMetricsEventsSpeakersProposal {
  return {
    proposalKey: key,
    range: 'YTD',
    jobTitle: 'Platform Engineer',
    organizationName: 'Acme Motors',
    logoUrl: '',
    unaffiliated: false,
    eventName: 'Sample Summit',
    sessionTitle: 'Scaling sample workloads',
    submissionDate: '2026-03-10',
    status: 'Accepted',
    statusGroup: 'accepted',
    ...overrides,
  };
}

function page(keys: string[], totalRecords: number, events: HealthMetricsEventsSpeakerProposals['events'] = null): HealthMetricsEventsSpeakerProposals {
  return { rows: keys.map((key) => proposal(key)), totalRecords, events };
}

/** Records every observer, so a test can scroll the list end into view by hand. */
class FakeIntersectionObserver {
  public static instances: FakeIntersectionObserver[] = [];
  public readonly targets: Element[] = [];
  public disconnected = false;

  public constructor(private readonly callback: IntersectionObserverCallback) {
    FakeIntersectionObserver.instances.push(this);
  }

  public observe(target: Element): void {
    this.targets.push(target);
  }

  public disconnect(): void {
    this.disconnected = true;
  }

  public fire(isIntersecting: boolean): void {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

describe('EventsSpeakerProposalsDrawerComponent', () => {
  let fixture: ComponentFixture<EventsSpeakerProposalsDrawerComponent>;
  let getEventsSpeakerProposals: ReturnType<typeof vi.fn<(query: HealthMetricsEventsSpeakerProposalsQuery) => Observable<HealthMetricsEventsSpeakerProposals>>>;

  async function render(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [EventsSpeakerProposalsDrawerComponent],
      providers: [
        { provide: AnalyticsService, useValue: { getEventsSpeakerProposals } },
        { provide: DIALOG_DATA, useValue: { foundationSlug: 'acme', range: 'YTD' } },
        { provide: DialogRef, useValue: { close: vi.fn(), id: 'drawer-1' } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(EventsSpeakerProposalsDrawerComponent);
    await settle();
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query(testId: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
  }

  function text(testId: string): string {
    return query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  function rowKeys(): string[] {
    return Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="events-speaker-proposals-row-"]'))
      .map((row) => (row as HTMLElement).dataset['testid'] ?? '')
      .filter((id) => !id.endsWith('-status'))
      .map((id) => id.replace('events-speaker-proposals-row-', ''));
  }

  /** The observer watching the marker after the last row, as the latest render left it. */
  function listEnd(): FakeIntersectionObserver | undefined {
    return FakeIntersectionObserver.instances.filter((observer) => !observer.disconnected).at(-1);
  }

  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    getEventsSpeakerProposals = vi.fn();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads the first page of the period, lists its rows and titles the drawer with the count and period', async () => {
    getEventsSpeakerProposals.mockReturnValue(of(page(['p-1', 'p-2'], 2, [{ id: 'evt-1', name: 'Sample Summit' }])));
    await render();

    expect(getEventsSpeakerProposals).toHaveBeenCalledWith({
      foundationSlug: 'acme',
      range: 'YTD',
      eventId: '',
      status: null,
      offset: 0,
      pageSize: 25,
      includeEvents: true,
      sort: null,
    });
    expect(text('ui-drawer-title')).toBe('All speaker proposals');
    expect(text('ui-drawer-subtitle')).toBe(`2 proposals · ${new Date().getFullYear()} (YTD)`);
    expect(rowKeys()).toEqual(['p-1', 'p-2']);
    const row = text('events-speaker-proposals-row-p-1');
    expect(row).toContain('Acme Motors');
    expect(row).toContain('Platform Engineer');
    expect(row).toContain('Scaling sample workloads');
    expect(row).toContain('Sample Summit · Mar 10, 2026');
    expect(text('events-speaker-proposals-row-p-1-status')).toBe('Accepted');
    // Everything is shown, so there is no marker to load more from.
    expect(query('events-speaker-proposals-sentinel')).toBeNull();
  });

  it('puts the event and status filters in the header toolbar, listing the period events', async () => {
    getEventsSpeakerProposals.mockReturnValue(
      of(
        page(['p-1'], 1, [
          { id: 'evt-2', name: 'Later Summit' },
          { id: 'evt-1', name: 'Sample Summit' },
        ])
      )
    );
    await render();

    expect(query('ui-drawer-toolbar')?.querySelector('[data-testid="events-speaker-proposals-event"]')).not.toBeNull();
    expect(query('ui-drawer-toolbar')?.querySelector('[data-testid="events-speaker-proposals-status"]')).not.toBeNull();
    expect(fixture.componentInstance['eventOptions']().map((option) => option.label)).toEqual(['All events', 'Later Summit', 'Sample Summit']);
    expect(fixture.componentInstance['statusOptions'].map((option) => option.label)).toEqual(['All statuses', 'Accepted', 'In review', 'Declined']);
  });

  it('starts again from the first page when a filter changes', async () => {
    getEventsSpeakerProposals.mockReturnValue(of(page(['p-1', 'p-2'], 2, [{ id: 'evt-1', name: 'Sample Summit' }])));
    await render();
    getEventsSpeakerProposals.mockReturnValue(of(page(['p-9'], 1, [{ id: 'evt-1', name: 'Sample Summit' }])));

    fixture.componentInstance['onEventChange']('evt-1');
    fixture.componentInstance['onStatusChange']('declined');
    await settle();

    expect(getEventsSpeakerProposals).toHaveBeenLastCalledWith(
      expect.objectContaining({ eventId: 'evt-1', status: 'declined', offset: 0, includeEvents: false })
    );
    expect(rowKeys()).toEqual(['p-9']);
    expect(text('ui-drawer-subtitle')).toContain('1 proposal ·');
  });

  it('loads the next page once the end of the list scrolls into view, and stops at the total', async () => {
    getEventsSpeakerProposals.mockReturnValueOnce(of(page(['p-1', 'p-2'], 3, [])));
    await render();
    expect(query('events-speaker-proposals-sentinel')).not.toBeNull();

    // Out of view does nothing.
    listEnd()?.fire(false);
    expect(getEventsSpeakerProposals).toHaveBeenCalledTimes(1);

    getEventsSpeakerProposals.mockReturnValueOnce(of(page(['p-3'], 3)));
    listEnd()?.fire(true);
    await settle();

    expect(getEventsSpeakerProposals).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 2, includeEvents: false }));
    expect(rowKeys()).toEqual(['p-1', 'p-2', 'p-3']);
    // A later page carries no events, so the filter keeps the first page's.
    expect(fixture.componentInstance['eventOptions']().map((option) => option.label)).toEqual(['All events']);
    expect(query('events-speaker-proposals-sentinel')).toBeNull();
  });

  it('shows a skeleton row under the list while the next page loads', async () => {
    getEventsSpeakerProposals.mockReturnValueOnce(of(page(['p-1'], 2, [])));
    await render();
    const next = new Subject<HealthMetricsEventsSpeakerProposals>();
    getEventsSpeakerProposals.mockReturnValueOnce(next);

    listEnd()?.fire(true);
    await settle();

    expect(query('events-speaker-proposals-loading-more')).not.toBeNull();
    expect(query('events-speaker-proposals-sentinel')).toBeNull();
    next.next(page(['p-2'], 2));
    await settle();
    expect(query('events-speaker-proposals-loading-more')).toBeNull();
  });

  it('says so when no proposal matches the filters', async () => {
    getEventsSpeakerProposals.mockReturnValue(of(page([], 0, [])));
    await render();

    expect(text('events-speaker-proposals-empty')).toBe('No proposals match these filters.');
  });

  it('shows the error when the first page fails, and keeps the rows when a later page fails', async () => {
    getEventsSpeakerProposals.mockReturnValue(throwError(() => new Error('down')));
    await render();
    expect(query('events-speaker-proposals-error')).not.toBeNull();

    getEventsSpeakerProposals.mockReturnValueOnce(of(page(['p-1'], 2, [])));
    fixture.componentInstance['onStatusChange']('accepted');
    await settle();
    // The failed first page never brought the events, so the retry asks again.
    expect(getEventsSpeakerProposals).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'accepted', includeEvents: true }));
    getEventsSpeakerProposals.mockReturnValueOnce(throwError(() => new Error('down')));
    listEnd()?.fire(true);
    await settle();

    expect(rowKeys()).toEqual(['p-1']);
    expect(query('events-speaker-proposals-more-error')).not.toBeNull();
    expect(query('events-speaker-proposals-sentinel')).toBeNull();
  });

  it('retries a failed first page from scratch', async () => {
    getEventsSpeakerProposals.mockReturnValueOnce(throwError(() => new Error('down')));
    await render();
    getEventsSpeakerProposals.mockReturnValueOnce(of(page(['p-1'], 1, [])));

    query('events-speaker-proposals-retry')?.querySelector('button')?.click();
    await settle();

    expect(getEventsSpeakerProposals).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, includeEvents: true }));
    expect(rowKeys()).toEqual(['p-1']);
    expect(query('events-speaker-proposals-error')).toBeNull();
  });

  it('retries a failed later page under the rows already shown', async () => {
    getEventsSpeakerProposals.mockReturnValueOnce(of(page(['p-1'], 2, [])));
    await render();
    getEventsSpeakerProposals.mockReturnValueOnce(throwError(() => new Error('down')));
    listEnd()?.fire(true);
    await settle();
    getEventsSpeakerProposals.mockReturnValueOnce(of(page(['p-2'], 2)));

    query('events-speaker-proposals-more-retry')?.querySelector('button')?.click();
    await settle();

    expect(getEventsSpeakerProposals).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 1 }));
    expect(rowKeys()).toEqual(['p-1', 'p-2']);
    expect(query('events-speaker-proposals-more-error')).toBeNull();
  });
});
