// Copyright The Linux Foundation and each contributor to LFX.
// SPDX-License-Identifier: MIT

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MeetingVisibility, RecurrenceType } from '@lfx-one/shared/enums';
import { Meeting, MeetingHomeRow, MeetingRsvp, RsvpScope } from '@lfx-one/shared/interfaces';
import { MeetingService } from '@services/meeting.service';
import { MeetingRsvpService } from '@services/meeting-rsvp.service';
import { UiModalService } from '@shared/uikit/modal/modal.service';
import { UiToastService } from '@shared/uikit/toast/toast.service';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PendingRsvpsComponent } from './pending-rsvps.component';

const START = new Date(2026, 9, 1, 9, 0);

function buildRow(id: string, overrides: Partial<Meeting> = {}): MeetingHomeRow {
  const meeting = {
    id,
    title: `Synthetic ${id}`,
    project_name: 'Synthetic Project',
    invited: true,
    is_invite_responses_enabled: true,
    recurrence: null,
    ...overrides,
  };
  return {
    key: id,
    meeting: meeting as Meeting,
    occurrence: null,
    title: meeting.title,
    occurrenceId: meeting.recurrence ? String(START.getTime() / 1000) : null,
    startTime: START.toISOString(),
    durationMinutes: 60,
    myRsvp: null,
  };
}

describe('PendingRsvpsComponent', () => {
  let fixture: ComponentFixture<PendingRsvpsComponent>;
  let fallback: HTMLButtonElement;
  let submit: ReturnType<typeof vi.fn>;
  let openModal: ReturnType<typeof vi.fn>;
  let closed: Subject<RsvpScope | undefined>;

  const byTestId = (testId: string): HTMLElement | null => document.querySelector(`[data-testid="${testId}"]`);
  const all = (testId: string): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>(`[data-testid="${testId}"]`));
  const trigger = (): HTMLButtonElement | null => byTestId('meetings-home-pending-rsvps-button')?.querySelector('button') ?? null;
  const settle = async (): Promise<void> => {
    await fixture.whenStable();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await fixture.whenStable();
  };
  const render = async (rows: MeetingHomeRow[]): Promise<void> => {
    fixture = TestBed.createComponent(PendingRsvpsComponent);
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('fallbackFocus', fallback);
    document.body.appendChild(fixture.nativeElement);
    await fixture.whenStable();
  };
  const setRows = async (rows: MeetingHomeRow[]): Promise<void> => {
    fixture.componentRef.setInput('rows', rows);
    await settle();
  };
  const open = async (): Promise<void> => {
    trigger()?.click();
    await settle();
  };
  const answer = async (row: HTMLElement, testId: string): Promise<void> => {
    const button = row.querySelector(`[data-testid="${testId}"] button`) as HTMLButtonElement;
    button.focus();
    button.click();
    await settle();
  };

  beforeEach(() => {
    // jsdom has no layout, so every element reads as hidden to the popover's focusable check.
    vi.spyOn(Element.prototype, 'getClientRects').mockReturnValue([new DOMRect(0, 0, 10, 10)] as unknown as DOMRectList);
    fallback = document.body.appendChild(document.createElement('button'));
    submit = vi.fn((_meeting: Meeting, occurrenceId: string | undefined, response: MeetingRsvp['response_type'], scope: RsvpScope) =>
      of({ id: 'synthetic-rsvp', response_type: response, scope, occurrence_id: occurrenceId, created_at: START.toISOString() } as MeetingRsvp)
    );
    closed = new Subject<RsvpScope | undefined>();
    openModal = vi.fn(() => ({ closed, close: () => closed.next(undefined) }));
    TestBed.configureTestingModule({
      providers: [
        { provide: MeetingRsvpService, useValue: { submit$: submit, submittingMeetingIds: signal<ReadonlySet<string>>(new Set()) } },
        { provide: MeetingService, useValue: { removedRegistrationMeetingIds: signal<ReadonlySet<string>>(new Set()) } },
        { provide: UiModalService, useValue: { open: openModal } },
        { provide: UiToastService, useValue: { show: vi.fn() } },
      ],
    });
  });

  afterEach(() => {
    fixture.destroy();
    fallback.remove();
    vi.restoreAllMocks();
  });

  it('is hidden while nothing is pending', async () => {
    await render([]);

    expect(trigger()).toBeNull();
  });

  it('counts the pending dates on the button and names it for screen readers', async () => {
    await render([buildRow('a'), buildRow('b')]);

    expect(byTestId('meetings-home-pending-rsvps-count')?.textContent?.trim()).toBe('2');
    expect(trigger()?.getAttribute('aria-label')).toBe('2 Pending RSVPs');

    await setRows([buildRow('a')]);
    expect(trigger()?.getAttribute('aria-label')).toBe('1 Pending RSVP');
  });

  it('lists each pending date with its project, title, time and 24px RSVP buttons', async () => {
    await render([buildRow('a'), buildRow('b', { recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1 } })]);
    await open();

    const rows = all('meetings-home-pending-rsvps-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('[data-testid="meetings-home-pending-rsvps-row-project"]')?.textContent).toContain('Synthetic Project');
    expect(rows[0].querySelector('[data-testid="meetings-home-pending-rsvps-row-title"]')?.textContent?.trim()).toBe('Synthetic a');
    expect(rows[0].querySelector('[data-testid="meetings-home-pending-rsvps-row-when"]')?.textContent).toContain('Thu, Oct 1 · 9:00 AM');
    expect(rows[0].querySelector('[data-testid="meetings-home-pending-rsvps-row-recurring"]')).toBeNull();
    expect(rows[1].querySelector('[data-testid="meetings-home-pending-rsvps-row-recurring"]')).not.toBeNull();
    expect(rows[0].querySelector('[data-testid="meetings-home-rsvp-accepted"] button')?.className).toContain('h-ui-tiny');
  });

  it('puts the RSVP buttons in the top-right corner of each row', async () => {
    await render([buildRow('a')]);
    await open();

    const row = all('meetings-home-pending-rsvps-row')[0];
    expect(row.className).toContain('flex items-start');
    expect(row.className).not.toContain('flex-wrap');
    expect(row.lastElementChild?.querySelector('[data-testid="meetings-home-rsvp"]')).not.toBeNull();
  });

  it('badges only Private and Restricted meetings', async () => {
    await render([
      buildRow('public', { visibility: MeetingVisibility.PUBLIC, restricted: false }),
      buildRow('private', { visibility: MeetingVisibility.PRIVATE, restricted: false }),
      buildRow('restricted', { visibility: MeetingVisibility.PUBLIC, restricted: true }),
    ]);
    await open();

    const badges = all('meetings-home-pending-rsvps-row').map((row) =>
      Array.from(row.querySelectorAll('[data-testid^="meetings-home-pending-rsvps-row-visibility-"]')).map((badge) => badge.getAttribute('data-testid'))
    );
    expect(badges).toEqual([[], ['meetings-home-pending-rsvps-row-visibility-private'], ['meetings-home-pending-rsvps-row-visibility-restricted']]);
  });

  it('drops an answered date and moves focus to the date now in its place', async () => {
    await render([buildRow('a'), buildRow('b')]);
    await open();

    await answer(all('meetings-home-pending-rsvps-row')[0], 'meetings-home-rsvp-accepted');
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), undefined, 'accepted', 'all');
    // The store drops the answered date; the focused button goes with it.
    await setRows([buildRow('b')]);

    expect(all('meetings-home-pending-rsvps-row')).toHaveLength(1);
    expect(byTestId('meetings-home-pending-rsvps-count')?.textContent?.trim()).toBe('1');
    expect(document.activeElement?.textContent?.trim()).toBe('Synthetic b');
  });

  it('moves focus forward past other dates the same answer cleared', async () => {
    const rows = ['a1', 'b2', 'a8', 'c9'].map((key) => buildRow(key));
    await render(rows);
    await open();

    await answer(all('meetings-home-pending-rsvps-row')[2], 'meetings-home-rsvp-accepted');
    await setRows([rows[1], rows[3]]);

    expect(document.activeElement?.textContent?.trim()).toBe('Synthetic c9');
  });

  it('closes and hides once the last date is answered, handing focus to the fallback', async () => {
    await render([buildRow('a')]);
    await open();

    await answer(all('meetings-home-pending-rsvps-row')[0], 'meetings-home-rsvp-declined');
    await setRows([]);

    expect(byTestId('meetings-home-pending-rsvps-panel')).toBeNull();
    expect(trigger()).toBeNull();
    expect(document.activeElement).toBe(fallback);
  });

  it('leaves focus alone when a date is answered elsewhere while the popover is closed', async () => {
    await render([buildRow('a'), buildRow('b')]);
    const outside = document.body.appendChild(document.createElement('button'));
    outside.focus();

    await setRows([buildRow('b')]);
    await setRows([]);

    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('asks which dates a recurring answer covers and saves with that scope', async () => {
    await render([buildRow('a', { recurrence: { type: RecurrenceType.WEEKLY, repeat_interval: 1 } })]);
    await open();

    await answer(all('meetings-home-pending-rsvps-row')[0], 'meetings-home-rsvp-maybe');
    expect(openModal).toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();

    closed.next('this_and_following');
    await settle();

    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), String(START.getTime() / 1000), 'maybe', 'this_and_following');
  });
});
