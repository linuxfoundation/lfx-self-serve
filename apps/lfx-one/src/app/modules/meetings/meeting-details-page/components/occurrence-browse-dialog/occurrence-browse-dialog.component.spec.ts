// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MeetingOccurrenceBrowseDialogData, MeetingOccurrenceBrowseTab, MeetingOccurrenceStripItem } from '@lfx-one/shared/interfaces';
import { DynamicDialogConfig, DynamicDialogRef } from 'primeng/dynamicdialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MeetingOccurrenceBrowseDialogComponent } from './occurrence-browse-dialog.component';

const WEEK = 7 * 24 * 60 * 60 * 1000;
// Thursdays at 16:00 UTC, before and after 2026-07-20.
const at = (week: number): number => Date.UTC(2026, 6, 23, 16, 0) + week * WEEK;
const item = (week: number, extra: Partial<MeetingOccurrenceStripItem> = {}): MeetingOccurrenceStripItem => ({
  startMs: at(week),
  startTime: new Date(at(week)).toISOString(),
  duration: 60,
  endKnown: true,
  occurrenceId: String(at(week) / 1000),
  isPast: week < 0,
  cancelled: false,
  ...extra,
});

// The dialog renders the strip's loaded series and hands paging and opening back to it; the strip's
// loader and its guards are tested with the strip.
describe('MeetingOccurrenceBrowseDialogComponent', () => {
  let fixture: ComponentFixture<MeetingOccurrenceBrowseDialogComponent>;
  let items: WritableSignal<MeetingOccurrenceStripItem[]>;
  let more: Record<MeetingOccurrenceBrowseTab, WritableSignal<boolean>>;
  let pastIncomplete: WritableSignal<boolean>;
  let close: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.fn>;
  let loadMore: ReturnType<typeof vi.fn>;

  async function render(selected: number | null, cadence: string | null = 'Weekly on Thursday'): Promise<void> {
    close = vi.fn();
    open = vi.fn();
    loadMore = vi.fn().mockResolvedValue(true);
    const data: MeetingOccurrenceBrowseDialogData = {
      title: 'Acme Weekly Sync',
      logoUrl: null,
      cadence,
      timezone: 'UTC',
      items: () => items(),
      selectedStartMs: () => selected,
      hasMore: (tab) => more[tab](),
      pastIncomplete: () => pastIncomplete(),
      loadMore,
      open,
    };
    await TestBed.configureTestingModule({
      imports: [MeetingOccurrenceBrowseDialogComponent],
      providers: [
        { provide: DynamicDialogRef, useValue: { close } },
        { provide: DynamicDialogConfig, useValue: { data } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MeetingOccurrenceBrowseDialogComponent);
    fixture.detectChanges();
  }

  beforeEach(() => {
    items = signal([item(-2), item(-1), item(0), item(1)]);
    more = { past: signal(false), upcoming: signal(false) };
    pastIncomplete = signal(false);
  });

  const query = (selector: string): HTMLElement | null => fixture.nativeElement.querySelector(selector);
  const rows = (): HTMLElement[] => Array.from(fixture.nativeElement.querySelectorAll('[data-testid^="occurrence-browse-row-"]'));
  const row = (week: number): HTMLElement | null => query(`[data-testid="occurrence-browse-row-${at(week) / 1000}"]`);
  const tab = (id: MeetingOccurrenceBrowseTab): HTMLElement | null => query(`[data-testid="occurrence-browse-tab-${id}"]`);

  it("opens on the tab holding the page's occurrence, with upcoming soonest first and past newest first", async () => {
    await render(at(-1));

    expect(tab('past')?.getAttribute('aria-selected')).toBe('true');
    expect(rows().map((element) => Number(element.getAttribute('data-start-ms')))).toEqual([at(-1), at(-2)]);

    tab('upcoming')?.click();
    fixture.detectChanges();
    expect(rows().map((element) => Number(element.getAttribute('data-start-ms')))).toEqual([at(0), at(1)]);
  });

  it("marks the page's occurrence as Viewing, with aria-current", async () => {
    await render(at(0));

    expect(row(0)?.getAttribute('aria-current')).toBe('date');
    expect(row(0)?.querySelector('[data-testid="occurrence-browse-viewing"]')).not.toBeNull();
    expect(row(1)?.getAttribute('aria-current')).toBeNull();
  });

  it('shows a time range only when the end is known, else the start alone', async () => {
    items.set([item(-2, { endKnown: false }), item(-1)]);
    await render(at(-1));

    expect(row(-1)?.textContent).toContain('4:00 PM – 5:00 PM');
    expect(row(-2)?.textContent).toContain('4:00 PM');
    expect(row(-2)?.textContent).not.toContain('–');
  });

  it('has no attendance column', async () => {
    await render(at(-1));

    expect(fixture.nativeElement.textContent).not.toMatch(/attend/i);
  });

  it('opens a row through the strip and closes, but never a cancelled one', async () => {
    items.set([item(0), item(1, { cancelled: true })]);
    await render(at(0));

    row(1)?.click();
    expect(open).not.toHaveBeenCalled();
    expect(row(1)?.getAttribute('aria-disabled')).toBe('true');
    expect(row(1)?.textContent).toContain('Cancelled');

    row(0)?.click();
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ startMs: at(0) }));
    expect(close).toHaveBeenCalled();
  });

  it('asks the strip for more on the open tab, only while that side has more', async () => {
    more.past.set(true);
    await render(at(-1));

    (query('[data-testid="occurrence-browse-load-more"] button') as HTMLButtonElement).click();
    expect(loadMore).toHaveBeenCalledWith('past');

    tab('upcoming')?.click();
    fixture.detectChanges();
    expect(query('[data-testid="occurrence-browse-load-more"]')).toBeNull();
  });

  it('keeps focus in the dialog after Load more: on the first new row', async () => {
    more.past.set(true);
    await render(at(-1));
    document.body.appendChild(fixture.nativeElement);
    loadMore.mockImplementation(async () => {
      items.update((current) => [item(-4), item(-3), ...current]);
      more.past.set(false);
      return true;
    });

    const loadButton = query('[data-testid="occurrence-browse-load-more"] button') as HTMLButtonElement;
    loadButton.focus();
    loadButton.click();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    // Past runs newest first, so the first row the page added is week -3, after -1 and -2.
    expect(document.activeElement).toBe(row(-3));
    fixture.nativeElement.remove();
  });

  it('says when the past history is only partly loaded', async () => {
    pastIncomplete.set(true);
    await render(at(-1));

    expect(rows()).toHaveLength(2);
    expect(query('[data-testid="occurrence-browse-partial"]')?.textContent).toContain('Some past occurrences could not be loaded.');

    tab('upcoming')?.click();
    fixture.detectChanges();
    expect(query('[data-testid="occurrence-browse-partial"]')).toBeNull();
  });

  it('moves no focus, and shows no Loading on the other tab, when the viewer switches tabs mid-read', async () => {
    more.past.set(true);
    more.upcoming.set(true);
    await render(at(-1));
    document.body.appendChild(fixture.nativeElement);
    let settleRead: (value: boolean) => void = () => undefined;
    loadMore.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          settleRead = (value) => {
            items.update((current) => [item(-3), ...current]);
            resolve(value);
          };
        })
    );

    (query('[data-testid="occurrence-browse-load-more"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(query('[data-testid="occurrence-browse-load-more"]')?.textContent).toContain('Loading');
    tab('upcoming')?.click();
    fixture.detectChanges();
    expect(query('[data-testid="occurrence-browse-load-more"]')?.textContent).toContain('Load more');
    const focused = document.activeElement;

    settleRead(true);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();

    expect(document.activeElement).toBe(focused);
    fixture.nativeElement.remove();
  });

  it('makes an empty tab panel focusable, so its message is reached', async () => {
    items.set([item(0)]);
    await render(at(0));
    expect(query('[role="tabpanel"]')?.getAttribute('tabindex')).toBeNull();

    tab('past')?.click();
    fixture.detectChanges();

    expect(query('[role="tabpanel"]')?.getAttribute('tabindex')).toBe('0');
  });

  it('says a tab is empty, and that the past is unknown when it could not be read', async () => {
    items.set([item(0)]);
    await render(at(0));

    tab('past')?.click();
    fixture.detectChanges();
    expect(query('[data-testid="occurrence-browse-empty"]')?.textContent).toContain('No past occurrences.');

    pastIncomplete.set(true);
    fixture.detectChanges();
    expect(query('[data-testid="occurrence-browse-empty"]')).toBeNull();
    expect(query('[data-testid="occurrence-browse-unavailable"]')).not.toBeNull();
  });

  it('counts the occurrences only once the whole series is known', async () => {
    await render(at(0));
    expect(query('[data-testid="occurrence-browse-subtitle"]')?.textContent?.trim()).toBe('4 occurrences · Weekly on Thursday');

    more.past.set(true);
    fixture.detectChanges();
    expect(query('[data-testid="occurrence-browse-subtitle"]')?.textContent?.trim()).toBe('Weekly on Thursday');
  });

  it('moves between the tabs with the arrow keys, one tab stop', async () => {
    await render(at(0));
    expect(tab('upcoming')?.getAttribute('tabindex')).toBe('0');
    expect(tab('past')?.getAttribute('tabindex')).toBe('-1');

    tab('upcoming')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
    fixture.detectChanges();

    expect(tab('past')?.getAttribute('aria-selected')).toBe('true');
    expect(tab('past')?.getAttribute('tabindex')).toBe('0');
  });

  it('closes from its close button', async () => {
    await render(at(0));

    (query('[data-testid="occurrence-browse-close"] button') as HTMLButtonElement).click();

    expect(close).toHaveBeenCalled();
  });
});
